// Implements the MatchSession contract (src/app/matchsession.ts): preloads the match assets,
// builds MatchData from database team ids, starts the ported match through the GameTask, runs it
// in the GameLoop with the Three.js renderer and Web Audio until full time (or until the user
// quits), and resolves with the result and the per-player stats.
//
// Boot (app side):
//   InitControllers();                                   // src/game/hid/controllers.ts
//   const renderer = new ThreeRenderer(canvas);          // src/blunted/render/threerenderer.ts
//   InstallMatchSessionRunner({ renderer });             // registers SetMatchSessionRunner()
//   ... StartMatchSession({ homeTeamDatabaseID, awayTeamDatabaseID, sides: [...] })

import { WebAudioBackend } from '../blunted/audio/webaudio';
import { FileSystem } from '../blunted/managers/filesystem';
import { ResourceManagerPool } from '../blunted/managers/resourcemanagerpool';
import type { Camera } from '../blunted/scene/objects/camera';
import type { Scene3D } from '../blunted/scene/scene3d';
import { MatchData } from '../game/data/matchdata';
import { _default_Difficulty, _default_MatchDuration, e_MatchPhase } from '../game/gamedefines';
import { GameLoop, type FrameInfo } from '../game/gameloop';
import { GameTask, e_GameTaskMessage } from '../game/gametask';
import { GetConfiguration, GetControllers, GetScene3D, ResetDebugPilons, SetMenuTask, GetMenuTask } from '../game/globals';
import { InitControllers, SetControllerListLocked, SetKeyboardCapture, SetTouchControlsVisible } from '../game/hid/controllers';
import { MenuTask } from '../game/menu/menutask';
import type { Match } from '../game/onthepitch/match';
import type { Player } from '../game/onthepitch/player/player';
import { setMenuLayerVisible } from '../ui/router';
import { MatchOverlay, type CameraSettings, type FullTimeScorer } from './matchoverlay';
import { SetMatchSessionRunner, type MatchResult, type MatchSessionOptions, type MatchSessionRunner } from './matchsession';
import { MatchStatsCollector, type StatsMatchView } from './matchstats';

/** what the runner needs from the renderer (ThreeRenderer implements it) */
export interface MatchRenderer {
  Render(scene3D: Scene3D, camera: Camera): void;
  /** releases everything the renderer built for the scene (end of match) */
  Clear(): void;
}

export interface MatchRuntime {
  renderer: MatchRenderer;
  /** default: a new WebAudioBackend reading GetConfiguration() */
  audio?: WebAudioBackend | null;
  /** asset directories/files preloaded for every match (default MATCH_ASSETS) */
  assets?: readonly string[];
  /** parent of the overlay layer (default document.body) */
  overlayParent?: HTMLElement;
  /** frame hook (fps meters, debug) */
  onFrame?: (info: FrameInfo) => void;
  /** show the overlay's loading panel (title + progress bar) while assets load (default true) */
  showLoadingPanel?: boolean;
}

/** everything under media/ a match reads (directories are preloaded recursively) */
export const MATCH_ASSETS: readonly string[] = [
  'media/animations',
  'media/objects/balls',
  'media/objects/helpers',
  'media/objects/lighting',
  'media/objects/officials',
  'media/objects/players',
  'media/objects/stadiums',
  'media/textures',
  'media/sounds',
  'media/menu/radar',
  'media/menu/scoreboard_bg.png',
  'media/menu/tvlogo.png',
  'databases/default/template_kit.png',
];

/** how long after the final whistle the summary appears (actual match ms) */
const fullTimeDelay_ms = 2500;

/** the match API the runner uses beyond Get/Process/Put (optional parts are checked at runtime) */
type RunnerMatch = Match & {
  IsGameOver?(): boolean;
  GetCameraParams?(): { zoom: number; height: number; fov: number; angleFactor: number };
};

interface TeamLike {
  SetLockedHumanPlayer?(playerID: number): void;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'undefined') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function isFile(path: string): boolean {
  return /\.[a-z0-9]+$/i.test(path.substring(path.lastIndexOf('/') + 1));
}

/** the file list to preload for a match between these teams */
export function CollectMatchAssets(matchData: MatchData | null, assets: readonly string[] = MATCH_ASSETS): string[] {
  const files = new Set<string>();
  for (const entry of assets) {
    if (isFile(entry)) {
      if (FileSystem.Exists(entry)) files.add(FileSystem.Normalize(entry));
    } else {
      for (const f of FileSystem.ListFiles(entry)) files.add(f);
    }
  }
  if (matchData) {
    for (const teamID of [0, 1]) {
      const team = matchData.GetTeamData(teamID);
      const kitUrl = team.GetKitUrl();
      for (const kitNum of [1, 2, 3, 4]) {
        const kit = `${kitUrl}_kit_0${kitNum}.png`;
        if (FileSystem.Exists(kit)) files.add(FileSystem.Normalize(kit));
      }
      const logo = team.GetLogoUrl();
      if (logo && FileSystem.Exists(logo)) files.add(FileSystem.Normalize(logo));
    }
  }
  return [...files];
}

/** preloads the match files (skipped when a synchronous disk reader is installed, i.e. Node tests) */
export async function PreloadMatchAssets(matchData: MatchData | null, assets: readonly string[] = MATCH_ASSETS, onProgress?: (fraction: number) => void): Promise<void> {
  if (FileSystem.syncReader) {
    onProgress?.(1);
    return;
  }
  const files = CollectMatchAssets(matchData, assets);
  await FileSystem.Preload(files, (done, total) => onProgress?.(done / Math.max(1, total)));
  onProgress?.(1);
}

/** temporarily overrides config values; Restore() puts the old ones back */
class ConfigOverrides {
  protected saved: [string, string | null, number][] = [];

  Set(name: string, value: number | undefined, fallback: number): void {
    if (value === undefined) return;
    const config = GetConfiguration();
    this.saved.push([name, config.Exists(name) ? config.Get(name) : null, fallback]);
    config.Set(name, Math.min(1, Math.max(0, value)));
  }

  Restore(): void {
    const config = GetConfiguration();
    for (const [name, old, fallback] of this.saved.reverse()) {
      // PORT: Properties has no delete; a key that was absent gets its default value back
      if (old !== null) config.Set(name, old);
      else config.Set(name, fallback);
    }
    this.saved = [];
  }
}

let sessionRunning = false;
let defaultAudio: WebAudioBackend | null = null;

/** one shared backend (browsers limit the number of AudioContexts) */
function DefaultAudio(): WebAudioBackend {
  if (!defaultAudio) defaultAudio = new WebAudioBackend({ config: GetConfiguration });
  return defaultAudio;
}

class MatchSession {
  protected runtime: MatchRuntime;
  protected options: MatchSessionOptions;
  protected audio: WebAudioBackend | null;
  protected overlay: MatchOverlay | null = null;
  protected overrides = new ConfigOverrides();
  protected gameTask: GameTask | null = null;
  protected loop: GameLoop | null = null;
  protected stats: MatchStatsCollector | null = null;
  protected matchData: MatchData | null = null;
  protected fullTimeAt_ms: number | null = null;
  protected ending = false;
  protected finished = false;
  protected resolve!: (result: MatchResult) => void;
  protected reject!: (error: unknown) => void;
  protected unsubscribeControllers: (() => void) | null = null;
  protected visibilityHandler: (() => void) | null = null;

  constructor(runtime: MatchRuntime, options: MatchSessionOptions) {
    this.runtime = runtime;
    this.options = options;
    this.audio = runtime.audio === undefined ? DefaultAudio() : runtime.audio;
  }

  Run(): Promise<MatchResult> {
    return new Promise<MatchResult>((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      this.Start().catch((error) => this.Fail(error));
    });
  }

  protected Match(): RunnerMatch | null {
    return (this.gameTask?.GetMatch() as RunnerMatch | null) ?? null;
  }

  protected Progress(fraction: number): void {
    this.options.onLoadProgress?.(fraction);
    if (this.runtime.showLoadingPanel !== false) this.overlay?.ShowLoading(this.options.title, fraction);
  }

  protected async Start(): Promise<void> {
    const options = this.options;

    if (typeof document !== 'undefined') {
      this.overlay = new MatchOverlay({
        onPause: (paused) => this.OnPause(paused),
        onQuit: () => void this.End(true),
        getCameraSettings: () => this.GetCameraSettings(),
        setCameraSettings: (s) => this.SetCameraSettings(s),
      });
      this.overlay.Mount(this.runtime.overlayParent ?? document.body);
    }
    this.Progress(0);

    // fixture
    let menuTask: MenuTask;
    try {
      menuTask = GetMenuTask();
    } catch {
      menuTask = new MenuTask();
      SetMenuTask(menuTask);
    }
    this.overrides.Set('match_duration', options.matchDuration, _default_MatchDuration);
    this.overrides.Set('match_difficulty', options.difficulty, _default_Difficulty);
    this.matchData = new MatchData(options.homeTeamDatabaseID, options.awayTeamDatabaseID);
    menuTask.SetMatchData(this.matchData);
    menuTask.SetControllerSetup(options.sides);
    menuTask.SetTeamKitNum(0, options.homeKit ?? 1);
    menuTask.SetTeamKitNum(1, options.awayKit ?? 2);

    // assets
    await PreloadMatchAssets(this.matchData, this.runtime.assets ?? MATCH_ASSETS, (fraction) => this.Progress(fraction * 0.9));
    this.Progress(0.92);
    await nextFrame();
    await nextFrame();

    // match (heavy, synchronous: animations, pitch generation, players)
    if (GetControllers().length === 0) InitControllers();
    SetControllerListLocked(true);
    this.gameTask = new GameTask();
    this.gameTask.Action(e_GameTaskMessage.e_GameTaskMessage_StartMatch);
    const match = this.Match()!;
    this.Progress(0.97);

    if (options.lockedPlayerDatabaseID !== undefined) this.LockPlayer(match, options.lockedPlayerDatabaseID);

    const statsView: StatsMatchView = match; // compile-time check: the port satisfies the stats view
    this.stats = new MatchStatsCollector(statsView, {
      onEvent: (event) => {
        if (event.type === 'halftime') this.overlay?.Toast('Half time', { kind: 'info' });
      },
    });

    if (this.audio) await this.audio.PrepareScene(GetScene3D());
    this.Progress(1);

    // go
    this.overlay?.HideLoading();
    this.overlay?.ShowPauseButton(true);
    setMenuLayerVisible(false);
    document.body?.classList.add('in-match');
    SetTouchControlsVisible(true);
    SetKeyboardCapture(true);
    this.audio?.Resume();
    if (typeof window !== 'undefined') {
      const onConnected = () => this.overlay?.Toast('Controller connected', { kind: 'info' });
      const onDisconnected = () => {
        this.overlay?.Toast('Controller disconnected', { kind: 'warn' });
        this.overlay?.OpenPauseMenu();
      };
      window.addEventListener('gamepadconnected', onConnected);
      window.addEventListener('gamepaddisconnected', onDisconnected);
      this.unsubscribeControllers = () => {
        window.removeEventListener('gamepadconnected', onConnected);
        window.removeEventListener('gamepaddisconnected', onDisconnected);
      };
    }
    if (typeof document !== 'undefined') {
      this.visibilityHandler = () => {
        if (document.hidden) this.overlay?.OpenPauseMenu();
      };
      document.addEventListener('visibilitychange', this.visibilityHandler);
    }

    this.loop = new GameLoop({
      task: this.gameTask,
      onStep: () => this.OnStep(),
      onFrame: (info) => this.OnFrame(info),
      onError: (error) => this.Fail(error),
    });
    this.loop.Start(true);
  }

  protected LockPlayer(match: RunnerMatch, playerDatabaseID: number): void {
    for (const teamID of [0, 1]) {
      const players: Player[] = [];
      match.GetAllTeamPlayers(teamID, players);
      const player = players.find((p) => p.GetPlayerData().GetDatabaseID() === playerDatabaseID);
      if (player) {
        const team = match.GetTeam(teamID) as unknown as TeamLike;
        if (team.SetLockedHumanPlayer) team.SetLockedHumanPlayer(player.GetID());
        else console.warn('MatchSession: Team.SetLockedHumanPlayer is not available');
        return;
      }
    }
    console.warn(`MatchSession: locked player ${playerDatabaseID} is not in either squad`);
  }

  protected OnStep(): void {
    this.stats?.Step();
    const match = this.Match();
    if (!match || this.ending) return;
    if (this.fullTimeAt_ms === null) {
      const gameOver = match.IsGameOver ? match.IsGameOver() : false;
      // PORT: the original goes to extra time on a draw; career matches end after 90 minutes
      const regulationOver = match.GetMatchPhase() >= e_MatchPhase.e_MatchPhase_1stExtraTime && !match.IsInPlay();
      if (gameOver || regulationOver) this.fullTimeAt_ms = match.GetActualTime_ms();
    } else if (match.GetActualTime_ms() - this.fullTimeAt_ms >= fullTimeDelay_ms) {
      void this.End(false);
    }
  }

  protected OnFrame(info: FrameInfo): void {
    const match = this.Match();
    if (!match) return;
    this.runtime.renderer.Render(GetScene3D(), match.GetCamera());
    this.audio?.Update(GetScene3D());
    this.overlay?.Frame();
    this.runtime.onFrame?.(info);
  }

  protected OnPause(paused: boolean): void {
    const match = this.Match();
    if (match && !this.ending) match.Pause(paused);
    SetKeyboardCapture(!paused);
    SetTouchControlsVisible(!paused && !this.ending);
  }

  protected GetCameraSettings(): CameraSettings | null {
    const match = this.Match();
    if (!match || !match.GetCameraParams) return null;
    const p = match.GetCameraParams();
    return { zoom: p.zoom, height: p.height };
  }

  protected SetCameraSettings(settings: CameraSettings): void {
    const match = this.Match();
    if (!match || !match.GetCameraParams) return;
    const p = match.GetCameraParams();
    match.SetCameraParams(settings.zoom, settings.height, p.fov, p.angleFactor);
    const config = GetConfiguration();
    config.Set('camera_zoom', settings.zoom);
    config.Set('camera_height', settings.height);
  }

  protected Summary(abandoned: boolean): MatchResult {
    const { events, playerStats } = this.stats ? this.stats.Finish(abandoned) : { events: [], playerStats: [] };
    const md = this.matchData;
    return {
      homeGoals: md ? md.GetGoalCount(0) : 0,
      awayGoals: md ? md.GetGoalCount(1) : 0,
      events,
      playerStats,
      abandoned,
    };
  }

  protected async End(abandoned: boolean): Promise<void> {
    if (this.ending) return;
    this.ending = true;
    const match = this.Match();
    match?.Pause(true);
    SetTouchControlsVisible(false);
    SetKeyboardCapture(false);
    const result = this.Summary(abandoned);

    if (!abandoned && this.overlay && this.matchData) {
      const scorers: FullTimeScorer[] = result.events
        .filter((e) => e.type === 'goal' || e.type === 'owngoal')
        .map((e) => ({
          teamID: e.teamID,
          name: e.playerDatabaseID !== undefined && this.stats ? this.stats.GetPlayerName(e.playerDatabaseID) : 'Goal',
          minute: e.minute,
          ownGoal: e.type === 'owngoal',
        }));
      const locked = this.options.lockedPlayerDatabaseID;
      const lockedStats = locked !== undefined ? result.playerStats.find((s) => s.playerDatabaseID === locked) : undefined;
      await this.overlay.ShowFullTime({
        homeName: this.matchData.GetTeamData(0).GetName(),
        awayName: this.matchData.GetTeamData(1).GetName(),
        homeGoals: result.homeGoals,
        awayGoals: result.awayGoals,
        scorers,
        player: lockedStats && this.stats ? { name: this.stats.GetPlayerName(lockedStats.playerDatabaseID), stats: lockedStats } : undefined,
      });
    }

    if (this.finished) return; // failed meanwhile (already cleaned up and rejected)
    this.finished = true;
    try {
      this.Cleanup();
    } catch (error) {
      console.error('MatchSession cleanup failed', error);
    }
    this.resolve(result);
  }

  protected Fail(error: unknown): void {
    if (this.finished) return;
    this.finished = true;
    console.error('MatchSession failed', error);
    try {
      this.Cleanup();
    } catch (cleanupError) {
      console.error('MatchSession cleanup failed', cleanupError);
    }
    this.reject(error);
  }

  protected Cleanup(): void {
    this.loop?.Stop();
    this.loop = null;
    this.audio?.StopAll();
    this.audio?.Reset();
    if (this.visibilityHandler) document.removeEventListener('visibilitychange', this.visibilityHandler);
    this.visibilityHandler = null;
    this.unsubscribeControllers?.();
    this.unsubscribeControllers = null;

    try {
      this.gameTask?.Exit();
    } finally {
      this.gameTask = null;
      // PORT: C++ ResourceManagerPool::CleanUp() freed unreferenced resources every 5 seconds.
      // Here everything the match built is dropped at once: the scene graph, the Gui2 widgets,
      // the renderer's GPU objects, parsed geometry/surfaces/sound buffers (per-match copies, the
      // generated pitch, kits) and the debug pilons. Downloaded files stay cached in FileSystem.
      GetScene3D().Exit();
      try {
        GetMenuTask().GetWindowManager().Clear();
        GetMenuTask().SetMatchData(null);
      } catch {
        // no menu task
      }
      this.runtime.renderer.Clear();
      ResourceManagerPool.GetInstance().Purge();
      ResetDebugPilons();

      this.overrides.Restore();
      SetTouchControlsVisible(false);
      SetKeyboardCapture(false);
      SetControllerListLocked(false);
      this.overlay?.Unmount();
      this.overlay = null;
      if (typeof document !== 'undefined') document.body?.classList.remove('in-match');
      setMenuLayerVisible(true);
    }
  }
}

/** runs one match session (the MatchSessionRunner) */
export function CreateMatchSessionRunner(runtime: MatchRuntime): MatchSessionRunner {
  return async (options: MatchSessionOptions): Promise<MatchResult> => {
    if (sessionRunning) throw new Error('a match session is already running');
    sessionRunning = true;
    try {
      return await new MatchSession(runtime, options).Run();
    } finally {
      sessionRunning = false;
    }
  };
}

/** registers the runner with SetMatchSessionRunner() */
export function InstallMatchSessionRunner(runtime: MatchRuntime): MatchSessionRunner {
  const runner = CreateMatchSessionRunner(runtime);
  SetMatchSessionRunner(runner);
  return runner;
}

/**
 * Plays a whole match without rendering, as fast as possible (tests, balancing). Uses the same
 * setup as a session but no overlay, audio or menu changes. maxSteps caps the run (10ms each).
 */
export async function SimulateMatch(options: MatchSessionOptions, maxSteps = 2_000_000): Promise<MatchResult> {
  let menuTask: MenuTask;
  try {
    menuTask = GetMenuTask();
  } catch {
    menuTask = new MenuTask();
    SetMenuTask(menuTask);
  }
  const overrides = new ConfigOverrides();
  overrides.Set('match_duration', options.matchDuration, _default_MatchDuration);
  overrides.Set('match_difficulty', options.difficulty, _default_Difficulty);
  const matchData = new MatchData(options.homeTeamDatabaseID, options.awayTeamDatabaseID);
  menuTask.SetMatchData(matchData);
  menuTask.SetControllerSetup(options.sides);
  menuTask.SetTeamKitNum(0, options.homeKit ?? 1);
  menuTask.SetTeamKitNum(1, options.awayKit ?? 2);
  await PreloadMatchAssets(matchData, MATCH_ASSETS, options.onLoadProgress);

  const gameTask = new GameTask();
  try {
    gameTask.Action(e_GameTaskMessage.e_GameTaskMessage_StartMatch);
    const match = gameTask.GetMatch() as RunnerMatch;
    const stats = new MatchStatsCollector(match);
    const loop = new GameLoop({ task: gameTask, onStep: () => stats.Step() });
    loop.ResetSequence();
    const done = (): boolean =>
      (match.IsGameOver ? match.IsGameOver() : false) || (match.GetMatchPhase() >= e_MatchPhase.e_MatchPhase_1stExtraTime && !match.IsInPlay());
    const ran = loop.RunHeadless(maxSteps, { shouldStop: done });
    const { events, playerStats } = stats.Finish(!done() && ran >= maxSteps);
    return { homeGoals: matchData.GetGoalCount(0), awayGoals: matchData.GetGoalCount(1), events, playerStats, abandoned: !done() };
  } finally {
    gameTask.Exit();
    GetScene3D().Exit();
    try {
      menuTask.GetWindowManager().Clear();
    } catch {
      // no DOM
    }
    menuTask.SetMatchData(null);
    ResourceManagerPool.GetInstance().Purge();
    ResetDebugPilons();
    overrides.Restore();
  }
}
