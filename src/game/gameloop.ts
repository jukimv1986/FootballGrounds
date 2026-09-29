// The browser replacement for the original main.cpp scheduler setup:
//
//   gameSequence ("game", 10ms, not skippable): menuTask Get/Process/Put, gameTask Get/Process
//   graphicsSequence ("graphics", as fast as possible): gameTask Put, graphics system
//
// Here one requestAnimationFrame loop does both: it runs every "game" step that is due (fixed
// 10ms steps against the wall clock, capped per frame to avoid a spiral of death), then once per
// frame the put phase and the frame callback (renderer + audio).
//
// Step accounting mirrors framework/scheduler.cpp for a non-skippable sequence, because the match
// derives its interpolation times from it:
//   - step k is due at startTime_ms + sequenceTime_ms * k (k = timesRan)
//   - while step k runs, timesRan == k, so Match::PreparePutBuffers stamps its snapshot with
//     snapshotTime = timesRan * sequenceTime_ms = k * 10
//   - after the step timesRan becomes k + 1 and lastSequenceTime_ms is the step's duration
//   - Match::FetchPutBuffers interpolates at putTime = EnvironmentManager time - startTime_ms
// When the loop falls behind by more than maxStepsPerFrame steps (tab in background, slow
// device), the remaining debt is dropped by moving startTime_ms forward, which keeps
// "relative time" and the snapshot times consistent (the original scheduler did the same with
// startTime while a sequence was paused).

import { EnvironmentManager, GetScheduler, type TaskSequenceInfo } from './globals';

/** what the loop drives: the GameTask (or a fake in tests) */
export interface GameSequenceTask {
  GetPhase(): void;
  ProcessPhase(): void;
  PutPhase(): void;
}

export interface FrameInfo {
  /** game steps run this frame */
  steps: number;
  /** due steps skipped because of the catch-up cap */
  droppedSteps: number;
  /** ms since the previous frame */
  frameTime_ms: number;
  /** relative sequence time (EnvironmentManager time - startTime_ms) at the put phase */
  putTime_ms: number;
}

export interface GameLoopOptions {
  task: GameSequenceTask;
  /** called after every game step (after Get + Process), e.g. the stats collector */
  onStep?: (timesRan: number) => void;
  /** called once per frame after the put phase: render, audio, overlays */
  onFrame?: (info: FrameInfo) => void;
  /** called when a phase throws; the loop stops. Default: rethrow after stopping */
  onError?: (error: unknown) => void;
  /** fixed step (the match code assumes 10ms) */
  sequenceTime_ms?: number;
  /** max game steps per frame before the remaining debt is dropped (default 25 = 250ms) */
  maxStepsPerFrame?: number;
  /** wall clock in ms (default performance.now); installed as the EnvironmentManager time source */
  clock?: () => number;
  /** frame scheduling (default requestAnimationFrame, falling back to setTimeout) */
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  /** task sequence name the match reads (default "game") */
  sequenceName?: string;
}

export interface HeadlessOptions {
  /** also run the put phase after every step (default false: no rendering work at all) */
  put?: boolean;
  /** checked after every step; return true to stop early (e.g. match.IsGameOver()) */
  shouldStop?: () => boolean;
}

const defaultClock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class GameLoop {
  protected task: GameSequenceTask;
  protected options: GameLoopOptions;
  protected sequenceName: string;
  protected sequenceTime_ms: number;
  protected maxStepsPerFrame: number;
  protected clock: () => number;
  protected requestFrame: (callback: () => void) => number;
  protected cancelFrame: (handle: number) => void;

  protected running = false;
  protected frameHandle: number | null = null;
  protected suspended = false;
  protected lastFrameTime_ms = 0;

  /** totals, for diagnostics */
  totalSteps = 0;
  totalDroppedSteps = 0;
  totalFrames = 0;

  constructor(options: GameLoopOptions) {
    this.options = options;
    this.task = options.task;
    this.sequenceName = options.sequenceName ?? 'game';
    this.sequenceTime_ms = options.sequenceTime_ms ?? 10;
    this.maxStepsPerFrame = Math.max(1, options.maxStepsPerFrame ?? 25);
    this.clock = options.clock ?? defaultClock;
    if (options.requestFrame) {
      this.requestFrame = options.requestFrame;
      this.cancelFrame = options.cancelFrame ?? (() => undefined);
    } else if (typeof requestAnimationFrame !== 'undefined') {
      this.requestFrame = (cb) => requestAnimationFrame(() => cb());
      this.cancelFrame = (h) => cancelAnimationFrame(h);
    } else {
      this.requestFrame = (cb) => setTimeout(cb, 16) as unknown as number;
      this.cancelFrame = (h) => clearTimeout(h);
    }
  }

  protected Info(): TaskSequenceInfo {
    return GetScheduler().GetMutableTaskSequenceInfo(this.sequenceName);
  }

  protected Now(): number {
    return EnvironmentManager.GetInstance().GetTime_ms();
  }

  /** installs this loop's clock as the EnvironmentManager time source */
  protected InstallClock(): void {
    EnvironmentManager.GetInstance().SetTimeSource(this.clock);
  }

  /**
   * Starts the frame loop. With resetSequence (default) the sequence time restarts at 0
   * (C++ Scheduler::ResetTaskSequenceTime); otherwise it continues where it was, without a
   * catch-up burst for the time the loop was stopped.
   */
  Start(resetSequence = true): void {
    if (resetSequence) {
      this.ResetSequence();
    } else {
      this.InstallClock();
      this.Rebase(this.Now());
      this.lastFrameTime_ms = this.Now();
    }
    if (this.running) return;
    this.running = true;
    this.ScheduleFrame();
  }

  /** installs the clock and restarts the sequence time at 0 without starting the frame loop */
  ResetSequence(): void {
    this.InstallClock();
    const info = this.Info();
    info.sequenceTime_ms = this.sequenceTime_ms;
    const now = this.Now();
    info.startTime_ms = now;
    info.sequenceStartTime_ms = now;
    info.lastSequenceTime_ms = 0;
    info.timesRan = 0;
    this.lastFrameTime_ms = now;
  }

  Stop(): void {
    this.running = false;
    if (this.frameHandle !== null) this.cancelFrame(this.frameHandle);
    this.frameHandle = null;
  }

  IsRunning(): boolean {
    return this.running;
  }

  /**
   * Suspended: no game steps run and the sequence time stands still (the put phase and the frame
   * callback keep running, so the picture stays). Unlike Match::Pause this also freezes the
   * camera; the pause menu uses Match::Pause like the original.
   */
  SetSuspended(suspended: boolean): void {
    this.suspended = suspended;
  }

  IsSuspended(): boolean {
    return this.suspended;
  }

  /** makes the next step due now (drops any step debt) */
  protected Rebase(now: number): void {
    const info = this.Info();
    info.startTime_ms = now - info.sequenceTime_ms * info.timesRan;
  }

  protected ScheduleFrame(): void {
    this.frameHandle = this.requestFrame(() => {
      this.frameHandle = null;
      if (!this.running) return;
      try {
        this.Tick();
      } catch (error) {
        this.Stop();
        if (this.options.onError) this.options.onError(error);
        else throw error;
        return;
      }
      if (this.running) this.ScheduleFrame();
    });
  }

  /** one game step: Get + Process, with the scheduler bookkeeping around it */
  protected RunStep(): void {
    const info = this.Info();
    info.sequenceStartTime_ms = this.Now();
    this.task.GetPhase();
    this.task.ProcessPhase();
    this.options.onStep?.(info.timesRan);
    info.timesRan++;
    info.lastSequenceTime_ms = this.Now() - info.sequenceStartTime_ms;
    this.totalSteps++;
  }

  /**
   * One frame: runs the due game steps, then the put phase and the frame callback. Called by the
   * frame loop; can be called directly when driving the loop manually (tests).
   */
  Tick(): FrameInfo {
    const info = this.Info();
    const now = this.Now();
    const frameTime_ms = now - this.lastFrameTime_ms;
    this.lastFrameTime_ms = now;

    let steps = 0;
    let droppedSteps = 0;
    if (this.suspended) {
      // time stands still for the sequence
      info.startTime_ms += frameTime_ms;
    } else {
      while (info.startTime_ms + info.sequenceTime_ms * info.timesRan <= now) {
        if (steps >= this.maxStepsPerFrame) {
          const due = Math.floor((now - info.startTime_ms) / info.sequenceTime_ms) + 1;
          droppedSteps = due - info.timesRan;
          this.Rebase(now);
          break;
        }
        this.RunStep();
        steps++;
      }
    }
    this.totalDroppedSteps += droppedSteps;

    this.task.PutPhase();
    this.totalFrames++;
    const frame: FrameInfo = { steps, droppedSteps, frameTime_ms, putTime_ms: this.Now() - info.startTime_ms };
    this.options.onFrame?.(frame);
    return frame;
  }

  /**
   * Headless mode: runs `steps` game steps as fast as possible on a virtual clock that advances
   * exactly one sequence step per step (deterministic timing, no rendering). The frame loop is
   * paused meanwhile and resumes afterwards without a catch-up burst. Returns the steps run.
   */
  RunHeadless(steps: number, options: HeadlessOptions = {}): number {
    const wasRunning = this.running;
    this.Stop();
    const env = EnvironmentManager.GetInstance();
    const info = this.Info();
    info.sequenceTime_ms = this.sequenceTime_ms;
    let virtualNow = info.startTime_ms + info.sequenceTime_ms * info.timesRan;
    env.SetTimeSource(() => virtualNow);
    let ran = 0;
    try {
      for (; ran < steps; ) {
        virtualNow = info.startTime_ms + info.sequenceTime_ms * info.timesRan;
        this.RunStep();
        ran++;
        if (options.put) this.task.PutPhase();
        if (options.shouldStop?.()) break;
      }
    } finally {
      // back to the wall clock, continuing from the virtual time
      this.InstallClock();
      this.Rebase(this.Now());
      this.lastFrameTime_ms = this.Now();
    }
    if (wasRunning) {
      this.running = true;
      this.ScheduleFrame();
    }
    return ran;
  }
}
