// Runtime layer tests: input devices, game loop step accounting, match stats.
import { describe, expect, it, beforeEach } from 'vitest';
import { Properties } from '../src/blunted/base/properties';
import { EnvironmentManager, GetScheduler, SetConfiguration, SetControllers } from '../src/game/globals';
import { e_ButtonFunction, e_ControllerButton, e_HIDeviceType } from '../src/game/hid/ihidevice';
import { HIDKeyboard, KeyboardConfigKey, KeyCodeLabel, defaultKeyIDs } from '../src/game/hid/keyboard';
import { HIDGamepad, type GamepadLike } from '../src/game/hid/gamepad';
import { HIDTouch } from '../src/game/hid/touch';
import { UserEventManager } from '../src/game/hid/usereventmanager';
import { GameLoop, type GameSequenceTask } from '../src/game/gameloop';
import { ComputeRating, MatchMinute, MatchStatsCollector, type RatingInput, type StatsMatchView, type StatsPlayer } from '../src/app/matchstats';
import { e_FunctionType, e_MatchPhase, e_PlayerRole, e_TouchType } from '../src/game/gamedefines';

const F = e_ButtonFunction;

beforeEach(() => {
  SetConfiguration(new Properties());
  SetControllers([]);
});

describe('HIDKeyboard', () => {
  it('uses the default layout', () => {
    const kb = new HIDKeyboard();
    expect(defaultKeyIDs.length).toBe(F.e_ButtonFunction_Size);
    expect(kb.GetFunctionMapping(F.e_ButtonFunction_Up)).toBe('ArrowUp');
    expect(kb.GetFunctionMapping(F.e_ButtonFunction_ShortPass)).toBe('KeyS');
    expect(kb.GetFunctionMapping(F.e_ButtonFunction_Pressure)).toBe('KeyS');
    expect(kb.GetFunctionMapping(F.e_ButtonFunction_Shot)).toBe('KeyD');
    expect(kb.GetFunctionMapping(F.e_ButtonFunction_Start)).toBe('Escape');
    expect(kb.GetDeviceType()).toBe(e_HIDeviceType.e_HIDeviceType_Keyboard);
  });

  it('loads and saves the mapping as KeyboardEvent.code strings', () => {
    const config = new Properties();
    config.Set(KeyboardConfigKey(F.e_ButtonFunction_Shot), 'KeyF');
    config.Set(KeyboardConfigKey(F.e_ButtonFunction_Sprint), '1073742049'); // SDL keycode from a C++ config: ignored
    SetConfiguration(config);
    const kb = new HIDKeyboard();
    expect(kb.GetFunctionMapping(F.e_ButtonFunction_Shot)).toBe('KeyF');
    expect(kb.GetFunctionMapping(F.e_ButtonFunction_Sprint)).toBe('KeyE');
    kb.SetFunctionMapping(F.e_ButtonFunction_Switch, 'Space');
    kb.SaveConfig();
    expect(config.Get('input_keyboard_12')).toBe('Space');
    expect(config.Get('input_keyboard_7')).toBe('KeyF');
  });

  it('reads key state on Process and keeps the previous state', () => {
    const kb = new HIDKeyboard();
    const events = UserEventManager.GetInstance();
    events.SetKeyboardState('KeyS', true);
    kb.Process();
    expect(kb.GetButton(F.e_ButtonFunction_ShortPass)).toBe(true);
    expect(kb.GetButton(F.e_ButtonFunction_Pressure)).toBe(true);
    expect(kb.GetPreviousButtonState(F.e_ButtonFunction_ShortPass)).toBe(false);
    kb.Process();
    expect(kb.GetPreviousButtonState(F.e_ButtonFunction_ShortPass)).toBe(true);
    events.SetKeyboardState('KeyS', false);
    kb.Process();
    expect(kb.GetButton(F.e_ButtonFunction_ShortPass)).toBe(false);
    expect(kb.GetButtonValue(F.e_ButtonFunction_ShortPass)).toBe(0);
  });

  it('gives a normalized direction', () => {
    const kb = new HIDKeyboard();
    const events = UserEventManager.GetInstance();
    events.SetKeyboardState('ArrowUp', true);
    events.SetKeyboardState('ArrowRight', true);
    kb.Process();
    const dir = kb.GetDirection();
    expect(dir.coords[0]).toBeCloseTo(Math.SQRT1_2);
    expect(dir.coords[1]).toBeCloseTo(Math.SQRT1_2);
    events.SetKeyboardState('ArrowUp', false);
    events.SetKeyboardState('ArrowRight', false);
    kb.Process();
    expect(kb.GetDirection().GetLength()).toBe(0);
  });

  it('labels keys', () => {
    expect(KeyCodeLabel('KeyW')).toBe('W');
    expect(KeyCodeLabel('ArrowLeft')).toBe('←');
    expect(KeyCodeLabel('ShiftLeft')).toBe('Shift Left');
  });
});

describe('HIDGamepad', () => {
  function fakePad(): GamepadLike & { axes: number[]; buttons: { pressed: boolean; value: number }[] } {
    return { id: 'Xbox Controller', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })) };
  }

  it('maps the standard layout like the original defaults', () => {
    const pad = fakePad();
    const gp = new HIDGamepad(0, () => pad);
    expect(gp.GetIdentifier()).toBe('Xbox Controller #0');
    expect(gp.GetFunctionMapping(F.e_ButtonFunction_ShortPass)).toBe(e_ControllerButton.e_ControllerButton_A);
    expect(gp.GetFunctionMapping(F.e_ButtonFunction_Shot)).toBe(e_ControllerButton.e_ControllerButton_X);
    expect(gp.GetFunctionMapping(F.e_ButtonFunction_LongPass)).toBe(e_ControllerButton.e_ControllerButton_Y);
    expect(gp.GetFunctionMapping(F.e_ButtonFunction_HighPass)).toBe(e_ControllerButton.e_ControllerButton_B);
    pad.buttons[0] = { pressed: true, value: 1 }; // A
    pad.buttons[7] = { pressed: true, value: 0.4 }; // RT (dribble), analog
    gp.Process();
    expect(gp.GetButton(F.e_ButtonFunction_ShortPass)).toBe(true);
    expect(gp.GetButton(F.e_ButtonFunction_Pressure)).toBe(true);
    expect(gp.GetButtonValue(F.e_ButtonFunction_Dribble)).toBeCloseTo(0.4);
    expect(gp.GetPreviousButtonState(F.e_ButtonFunction_ShortPass)).toBe(false);
  });

  it('decodes stick axes and applies the analog stick deadzone', () => {
    const pad = fakePad();
    const gp = new HIDGamepad(0, () => pad);
    pad.axes[0] = 1; // right
    pad.axes[1] = -1; // up (browser y grows downwards)
    gp.Process();
    expect(gp.GetButton(F.e_ButtonFunction_Right)).toBe(true);
    expect(gp.GetButton(F.e_ButtonFunction_Up)).toBe(true);
    expect(gp.GetButton(F.e_ButtonFunction_Left)).toBe(false);
    const dir = gp.GetDirection();
    expect(dir.coords[0]).toBeCloseTo(Math.SQRT1_2);
    expect(dir.coords[1]).toBeCloseTo(Math.SQRT1_2);
    pad.axes[0] = 0.5; // below analogStickDeadzone (0.75)
    pad.axes[1] = 0;
    gp.Process();
    expect(gp.GetDirection().GetLength()).toBe(0);
    pad.axes[0] = 0.05; // drift
    gp.Process();
    expect(gp.GetButton(F.e_ButtonFunction_Right)).toBe(false);
  });

  it('merges the d-pad into the direction', () => {
    const pad = fakePad();
    const gp = new HIDGamepad(0, () => pad);
    pad.buttons[14] = { pressed: true, value: 1 }; // d-pad left
    gp.Process();
    expect(gp.GetDirection().coords[0]).toBeCloseTo(-1);
    expect(gp.GetButton(F.e_ButtonFunction_Left)).toBe(true);
  });

  it('reads as idle when disconnected', () => {
    let pad: GamepadLike | null = fakePad();
    (pad as ReturnType<typeof fakePad>).buttons[0] = { pressed: true, value: 1 };
    const gp = new HIDGamepad(0, () => pad);
    gp.Process();
    expect(gp.GetButton(F.e_ButtonFunction_ShortPass)).toBe(true);
    pad = null;
    gp.Process();
    expect(gp.GetButton(F.e_ButtonFunction_ShortPass)).toBe(false);
    expect(gp.IsConnected()).toBe(false);
  });
});

describe('HIDTouch', () => {
  it('latches taps shorter than a game step', () => {
    const touch = new HIDTouch();
    touch.PressFunctions([F.e_ButtonFunction_ShortPass, F.e_ButtonFunction_Pressure], true);
    touch.PressFunctions([F.e_ButtonFunction_ShortPass, F.e_ButtonFunction_Pressure], false);
    touch.Process();
    expect(touch.GetButton(F.e_ButtonFunction_ShortPass)).toBe(true);
    touch.Process();
    expect(touch.GetButton(F.e_ButtonFunction_ShortPass)).toBe(false);
    expect(touch.GetPreviousButtonState(F.e_ButtonFunction_ShortPass)).toBe(true);
  });

  it('turns the stick into a direction', () => {
    const touch = new HIDTouch();
    touch.SetStick(0, 1);
    touch.Process();
    expect(touch.GetButton(F.e_ButtonFunction_Up)).toBe(true);
    expect(touch.GetDirection().coords[1]).toBeCloseTo(1);
    touch.SetStick(0.1, 0.1);
    touch.Process();
    expect(touch.GetDirection().GetLength()).toBe(0);
    touch.SetStick(3, 0); // clamped to the rim
    expect(touch.GetButtonValue(F.e_ButtonFunction_Right)).toBeCloseTo(1);
  });
});

describe('GameLoop', () => {
  interface Record {
    timesRan: number;
    relativeTime: number;
  }

  function setup(options: { maxStepsPerFrame?: number } = {}) {
    let now = 1000;
    const steps: Record[] = [];
    let puts = 0;
    const task: GameSequenceTask = {
      GetPhase: () => undefined,
      ProcessPhase: () => {
        const info = GetScheduler().GetTaskSequenceInfo('game');
        steps.push({ timesRan: info.timesRan, relativeTime: EnvironmentManager.GetInstance().GetTime_ms() - info.startTime_ms });
      },
      PutPhase: () => {
        puts++;
      },
    };
    const loop = new GameLoop({ task, clock: () => now, requestFrame: () => 0, maxStepsPerFrame: options.maxStepsPerFrame });
    return {
      loop,
      steps,
      puts: () => puts,
      advance: (ms: number) => {
        now += ms;
      },
      info: () => GetScheduler().GetTaskSequenceInfo('game'),
    };
  }

  it('runs one 10ms step per 10ms of wall clock, with snapshot time = timesRan * 10', () => {
    const t = setup();
    t.loop.Start();
    expect(t.info().timesRan).toBe(0);
    t.loop.Tick(); // step 0 is due at start
    expect(t.steps.length).toBe(1);
    t.advance(16);
    t.loop.Tick(); // due: 10
    t.advance(16);
    t.loop.Tick(); // due: 20, 30
    expect(t.steps.map((s) => s.timesRan)).toEqual([0, 1, 2, 3]);
    // each step runs at or after its due time (timesRan * 10), never before
    for (const s of t.steps) expect(s.relativeTime).toBeGreaterThanOrEqual(s.timesRan * 10);
    expect(t.info().timesRan).toBe(4);
    expect(t.info().sequenceTime_ms).toBe(10);
    expect(t.puts()).toBe(3);
    t.loop.Stop();
  });

  it('keeps the long-run step rate exact at odd frame times', () => {
    const t = setup();
    t.loop.Start();
    for (let i = 0; i < 600; i++) {
      t.loop.Tick();
      t.advance(7);
    }
    // 600 frames * 7ms = 4200ms -> steps due at 0..4193 -> 420 steps
    expect(t.info().timesRan).toBe(420);
  });

  it('caps catch-up steps and drops the debt without breaking the time base', () => {
    const t = setup({ maxStepsPerFrame: 5 });
    t.loop.Start();
    t.loop.Tick();
    t.advance(1000); // tab was in the background
    const frame = t.loop.Tick();
    expect(frame.steps).toBe(5);
    expect(frame.droppedSteps).toBeGreaterThan(90);
    const info = t.info();
    // relative time is back in line with the snapshot times: the next step is due now
    expect(EnvironmentManager.GetInstance().GetTime_ms() - info.startTime_ms).toBe(info.timesRan * 10);
    t.advance(10);
    expect(t.loop.Tick().steps).toBe(2);
  });

  it('freezes sequence time while suspended', () => {
    const t = setup();
    t.loop.Start();
    t.loop.Tick();
    t.loop.SetSuspended(true);
    t.advance(500);
    expect(t.loop.Tick().steps).toBe(0);
    t.loop.SetSuspended(false);
    t.advance(10);
    expect(t.loop.Tick().steps).toBe(1);
    expect(t.info().timesRan).toBe(2);
  });

  it('runs headless steps on a virtual clock', () => {
    const t = setup();
    t.loop.Start();
    const ran = t.loop.RunHeadless(1000);
    expect(ran).toBe(1000);
    expect(t.info().timesRan).toBe(1000);
    expect(t.puts()).toBe(0);
    // every step saw exactly its due time
    for (const s of t.steps) expect(s.relativeTime).toBe(s.timesRan * 10);
    // back on the wall clock without a catch-up burst
    expect(t.loop.Tick().steps).toBe(1);
    let count = 0;
    expect(t.loop.RunHeadless(100, { shouldStop: () => ++count >= 10 })).toBe(10);
    t.loop.Stop();
  });
});

describe('ComputeRating', () => {
  const base: RatingInput = {
    goals: 0,
    assists: 0,
    shots: 0,
    shotsOnTarget: 0,
    passes: 20,
    passesCompleted: 15,
    tackles: 0,
    fouls: 0,
    yellowCards: 0,
    redCards: 0,
    touches: 30,
    minutesPlayed: 90,
    teamGoals: 1,
    opponentGoals: 1,
  };

  it('starts around 6.0 for an average game', () => {
    const r = ComputeRating(base);
    expect(r).toBeGreaterThanOrEqual(6.0);
    expect(r).toBeLessThan(6.6);
  });

  it('rewards goals and assists, punishes cards', () => {
    expect(ComputeRating({ ...base, goals: 2, shots: 3, shotsOnTarget: 2 })).toBeGreaterThan(ComputeRating({ ...base, goals: 1, shots: 3, shotsOnTarget: 1 }));
    expect(ComputeRating({ ...base, assists: 1 })).toBeGreaterThan(ComputeRating(base));
    expect(ComputeRating({ ...base, redCards: 1 })).toBeLessThan(ComputeRating({ ...base, yellowCards: 1 }));
    expect(ComputeRating({ ...base, yellowCards: 1 })).toBeLessThan(ComputeRating(base));
  });

  it('clamps to 0 .. 10 with one decimal', () => {
    const great = ComputeRating({ ...base, goals: 6, assists: 5, shots: 8, shotsOnTarget: 8, tackles: 10, teamGoals: 9, opponentGoals: 0 });
    expect(great).toBe(10);
    const awful = ComputeRating({ ...base, redCards: 3, yellowCards: 3, fouls: 20, ownGoals: 4, passesCompleted: 0, teamGoals: 0, opponentGoals: 7, isDefender: true });
    expect(awful).toBeGreaterThanOrEqual(0);
    expect(awful).toBeLessThan(2);
    expect(Math.round(ComputeRating({ ...base, goals: 1 }) * 10) / 10).toBe(ComputeRating({ ...base, goals: 1 }));
  });

  it('rates keepers on clean sheets and goals conceded', () => {
    const keeper = { ...base, isGoalkeeper: true, touches: 10 };
    expect(ComputeRating({ ...keeper, opponentGoals: 0 })).toBeGreaterThan(ComputeRating({ ...keeper, opponentGoals: 3 }));
  });

  it('keeps short appearances closer to the baseline', () => {
    const full = ComputeRating({ ...base, goals: 1 });
    const cameo = ComputeRating({ ...base, goals: 1, minutesPlayed: 10 });
    expect(cameo).toBeLessThan(full);
    expect(cameo).toBeGreaterThan(6);
  });
});

describe('MatchMinute', () => {
  it('maps the match clock to minutes', () => {
    expect(MatchMinute(0, e_MatchPhase.e_MatchPhase_PreMatch)).toBe(0);
    expect(MatchMinute(30000, e_MatchPhase.e_MatchPhase_1stHalf)).toBe(1);
    expect(MatchMinute(44 * 60000 + 5000, e_MatchPhase.e_MatchPhase_1stHalf)).toBe(45);
    expect(MatchMinute(47 * 60000, e_MatchPhase.e_MatchPhase_1stHalf)).toBe(45); // stoppage time
    expect(MatchMinute(2700000, e_MatchPhase.e_MatchPhase_2ndHalf)).toBe(46);
    expect(MatchMinute(92 * 60000, e_MatchPhase.e_MatchPhase_2ndHalf)).toBe(93);
  });
});

describe('MatchStatsCollector', () => {
  class FakePlayer implements StatsPlayer {
    lastTouch = 0;
    functionType = e_FunctionType.e_FunctionType_Movement;
    cards = 0;
    constructor(
      public id: number,
      public teamID: number,
      public role = e_PlayerRole.e_PlayerRole_CM,
    ) {}
    GetID() {
      return this.id;
    }
    GetTeamID() {
      return this.teamID;
    }
    GetPlayerData() {
      return { GetDatabaseID: () => 1000 + this.id, GetFirstName: () => 'Player', GetLastName: () => `P${this.id}` };
    }
    GetLastTouchTime_ms() {
      return this.lastTouch;
    }
    GetCurrentFunctionType() {
      return this.functionType;
    }
    GetCards() {
      return this.cards;
    }
    GetFormationEntry() {
      return { role: this.role };
    }
  }

  function fakeMatch() {
    const players = [0, 1].map((team) => Array.from({ length: 11 }, (_, i) => new FakePlayer(team * 11 + i, team, i === 0 ? e_PlayerRole.e_PlayerRole_GK : e_PlayerRole.e_PlayerRole_CM)));
    const goals: [number, number] = [0, 0];
    const shots: [number, number] = [0, 0];
    const lastTouch: [FakePlayer | null, FakePlayer | null] = [null, null];
    let lastTouchTeam = -1;
    let foulPlayer: FakePlayer | null = null;
    let foulType = 0;
    const state = { actual: 0, matchTime: 0, phase: e_MatchPhase.e_MatchPhase_1stHalf };
    const match: StatsMatchView = {
      GetTeam: (id) => ({ GetLastTouchPlayer: () => lastTouch[id], GetGoalie: () => players[id][0] }),
      GetMatchData: () => ({ GetGoalCount: (id) => goals[id], GetShots: (id) => shots[id] }),
      GetActiveTeamPlayers: (id, out) => {
        out.push(...players[id]);
      },
      GetMatchTime_ms: () => state.matchTime,
      GetActualTime_ms: () => state.actual,
      GetMatchPhase: () => state.phase,
      GetLastTouchTeamID: (touchType) => (touchType === e_TouchType.e_TouchType_Intentional_Kicked ? lastTouchTeam : -1),
      GetReferee: () => ({ GetCurrentFoulPlayer: () => foulPlayer, GetCurrentFoulType: () => foulType }),
    };
    const api = {
      match,
      players,
      state,
      tick(ms = 10) {
        state.actual += ms;
        state.matchTime += ms * 2.5;
      },
      touch(p: FakePlayer, fn: e_FunctionType) {
        api.tick();
        p.lastTouch = state.actual;
        p.functionType = fn;
        lastTouch[p.teamID] = p;
        lastTouchTeam = p.teamID;
      },
      shoot(p: FakePlayer) {
        api.touch(p, e_FunctionType.e_FunctionType_Shot);
        shots[p.teamID]++;
      },
      goal(team: 0 | 1) {
        goals[team]++;
      },
      foul(p: FakePlayer | null, type: number) {
        foulPlayer = p;
        foulType = type;
      },
    };
    return api;
  }

  it('counts touches, passes, shots, goals, assists, tackles, fouls and cards', () => {
    const m = fakeMatch();
    const events: string[] = [];
    const stats = new MatchStatsCollector(m.match, { onEvent: (e) => events.push(e.type) });
    const [home, away] = m.players;

    // home: pass 5 -> 6 (completed), 6 -> 9 (completed), 9 scores, assist 6
    m.touch(home[5], e_FunctionType.e_FunctionType_ShortPass);
    stats.Step();
    m.touch(home[6], e_FunctionType.e_FunctionType_BallControl);
    stats.Step();
    m.touch(home[6], e_FunctionType.e_FunctionType_ShortPass);
    stats.Step();
    m.touch(home[9], e_FunctionType.e_FunctionType_Trap);
    stats.Step();
    m.shoot(home[9]);
    stats.Step();
    m.goal(0);
    m.tick();
    stats.Step();

    // away: pass intercepted by home 4 with a tackle
    m.touch(away[3], e_FunctionType.e_FunctionType_ShortPass);
    stats.Step();
    m.touch(home[4], e_FunctionType.e_FunctionType_Sliding);
    stats.Step();

    // away shot saved by the home keeper
    m.shoot(away[10]);
    stats.Step();
    m.touch(home[0], e_FunctionType.e_FunctionType_Catch);
    stats.Step();

    // away 2 fouls and gets booked, then a second yellow
    m.foul(away[2], 2);
    away[2].cards = 1;
    stats.Step();
    m.foul(null, 0);
    stats.Step();
    away[2].cards = 2;
    m.foul(away[2], 2);
    stats.Step();

    const s = (p: FakePlayer) => stats.GetPlayerStats(1000 + p.id)!;
    expect(s(home[5]).passes).toBe(1);
    expect(s(home[5]).passesCompleted).toBe(1);
    expect(s(home[6]).passes).toBe(1);
    expect(s(home[6]).passesCompleted).toBe(1);
    expect(s(home[6]).touches).toBe(2);
    expect(s(home[9]).shots).toBe(1);
    expect(s(home[9]).shotsOnTarget).toBe(1);
    expect(s(home[9]).goals).toBe(1);
    expect(s(home[6]).assists).toBe(1);
    expect(s(away[3]).passes).toBe(1);
    expect(s(away[3]).passesCompleted).toBe(0);
    expect(s(home[4]).tackles).toBe(1);
    expect(s(away[10]).shots).toBe(1);
    expect(s(away[10]).shotsOnTarget).toBe(1);
    expect(s(away[2]).fouls).toBe(2);
    expect(s(away[2]).yellowCards).toBe(2);
    expect(s(away[2]).redCards).toBe(1);
    expect(events).toEqual(['goal', 'yellow', 'yellow', 'red']);
    const goal = stats.GetEvents()[0];
    expect(goal.teamID).toBe(0);
    expect(goal.playerDatabaseID).toBe(1009);
    expect(goal.assistDatabaseID).toBe(1006);
    expect(goal.minute).toBe(1);

    m.state.phase = e_MatchPhase.e_MatchPhase_2ndHalf;
    m.state.matchTime = 5400000;
    const result = stats.Finish(false);
    expect(result.events[result.events.length - 1].type).toBe('fulltime');
    expect(result.playerStats.length).toBe(22);
    const scorer = result.playerStats.find((p) => p.playerDatabaseID === 1009)!;
    expect(scorer.minutesPlayed).toBe(90);
    expect(scorer.rating).toBeGreaterThan(6.5);
    const sentOff = result.playerStats.find((p) => p.playerDatabaseID === 1000 + away[2].id)!;
    expect(sentOff.minutesPlayed).toBeLessThan(90);
    expect(sentOff.rating).toBeLessThan(6);
  });

  it('detects own goals with the Match::Process rule', () => {
    const m = fakeMatch();
    const stats = new MatchStatsCollector(m.match);
    const [home] = m.players;
    m.touch(home[3], e_FunctionType.e_FunctionType_Deflect); // last intentional touch: home
    stats.Step();
    m.goal(1); // counts for away
    m.tick();
    stats.Step();
    const ev = stats.GetEvents()[0];
    expect(ev.type).toBe('owngoal');
    expect(ev.teamID).toBe(1);
    expect(ev.playerDatabaseID).toBe(1003);
  });

  it('survives a match without most APIs', () => {
    const minimal = { GetTeam: () => ({}), GetMatchData: () => ({ GetGoalCount: () => 0 }) } as StatsMatchView;
    const stats = new MatchStatsCollector(minimal);
    stats.Step();
    const result = stats.Finish(true);
    expect(result.playerStats).toEqual([]);
    expect(result.events).toEqual([]);
  });
});

describe('WebAudioBackend', () => {
  class FakeParam {
    value = 1;
    setValueAtTime(v: number) {
      this.value = v;
    }
    setTargetAtTime(v: number) {
      this.value = v;
    }
  }
  class FakeNode {
    connected = true;
    connect() {}
    disconnect() {
      this.connected = false;
    }
  }
  class FakeGain extends FakeNode {
    gain = new FakeParam();
  }
  class FakeSource extends FakeNode {
    buffer: unknown = null;
    loop = false;
    playbackRate = new FakeParam();
    started = 0;
    stopped = 0;
    onended: (() => void) | null = null;
    start() {
      this.started++;
    }
    stop() {
      this.stopped++;
    }
  }

  async function setup() {
    const sources: FakeSource[] = [];
    const gains: FakeGain[] = [];
    let decodes = 0;
    const ctx = {
      currentTime: 0,
      state: 'running',
      destination: {},
      createGain: () => {
        const g = new FakeGain();
        gains.push(g);
        return g;
      },
      createBufferSource: () => {
        const s = new FakeSource();
        sources.push(s);
        return s;
      },
      decodeAudioData: async (bytes: ArrayBuffer) => {
        decodes++;
        return { duration: 1, length: bytes.byteLength };
      },
      resume: async () => undefined,
      suspend: async () => undefined,
    };
    const { WebAudioBackend } = await import('../src/blunted/audio/webaudio');
    const { Scene3D } = await import('../src/blunted/scene/scene3d');
    const { Sound } = await import('../src/blunted/scene/objects/sound');
    const { SoundBuffer } = await import('../src/blunted/scene/resources/soundbuffer');
    const { Resource } = await import('../src/blunted/scene/resources/resource');
    const config = new Properties();
    const audio = new WebAudioBackend({ context: ctx as unknown as AudioContext, target: null, config });
    audio.scanInterval = 1;
    const scene = new Scene3D();
    const makeSound = (name: string, file: string) => {
      const buffer = new SoundBuffer();
      buffer.bytes = new ArrayBuffer(16);
      buffer.filename = file;
      const sound = new Sound(name);
      sound.SetSoundBuffer(new Resource(file, buffer));
      scene.AddObject(sound);
      return sound;
    };
    return { audio, scene, sources, gains, config, makeSound, decodes: () => decodes };
  }

  it('starts loops poked before they were first seen and follows gain/pitch live', async () => {
    const t = await setup();
    const crowd = t.makeSound('crowd01', 'media/sounds/crowd01.wav');
    crowd.SetLoop(true);
    crowd.SetGain(0);
    crowd.Poke();
    await t.audio.PrepareScene(t.scene);
    t.audio.Update(t.scene);
    expect(t.sources.length).toBe(1);
    expect(t.sources[0].started).toBe(1);
    expect(t.sources[0].loop).toBe(true);
    crowd.SetGain(0.35);
    crowd.SetPitch(1.1);
    t.audio.Update(t.scene);
    expect(t.gains[1].gain.value).toBeCloseTo(0.35); // gains[0] is the master
    expect(t.sources[0].playbackRate.value).toBeCloseTo(1.1);
    t.audio.Update(t.scene);
    expect(t.sources.length).toBe(1); // no restart without a new Poke
  });

  it('restarts one-shots on every poke, caches decoding, and stops removed sounds', async () => {
    const t = await setup();
    const ball = t.makeSound('ballsound', 'media/sounds/ballsound.wav');
    await t.audio.PrepareScene(t.scene);
    ball.Poke();
    t.audio.Update(t.scene);
    ball.Poke();
    t.audio.Update(t.scene);
    expect(t.sources.length).toBe(2);
    expect(t.sources[0].stopped).toBe(1);
    expect(t.decodes()).toBe(1);
    t.scene.DeleteObject(ball);
    t.audio.Update(t.scene);
    expect(t.sources[1].stopped).toBe(1);
  });

  it('applies the master volume from audio_volume and StopAll', async () => {
    const t = await setup();
    const whistle = t.makeSound('whistle', 'media/sounds/whistle2.wav');
    await t.audio.PrepareScene(t.scene);
    t.config.Set('audio_volume', 0.25);
    whistle.Poke();
    t.audio.Update(t.scene);
    expect(t.gains[0].gain.value).toBeCloseTo(0.5);
    t.config.Set('audio_volume', 0.5);
    t.audio.Update(t.scene);
    expect(t.gains[0].gain.value).toBeCloseTo(1);
    t.audio.StopAll();
    expect(t.sources[0].stopped).toBe(1);
    t.audio.Update(t.scene);
    expect(t.sources.length).toBe(1);
  });
});
