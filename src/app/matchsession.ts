// Contract between the app/career layers and the 3D match engine.
//
// A match session: preloads the match assets, builds MatchData from database team IDs, runs the
// ported GameplayFootball match (src/game) with the Three.js renderer until full time, and
// resolves with the result. Career mode uses `lockedPlayerDatabaseID` for "be a pro" matches:
// the human controls only that one player, the camera follows him, and his stats are returned.

import type { SideSelection } from '../game/menu/menutask';

export interface PlayerMatchStats {
  playerDatabaseID: number;
  teamID: 0 | 1;
  minutesPlayed: number;
  goals: number;
  assists: number;
  shots: number;
  shotsOnTarget: number;
  passes: number;
  passesCompleted: number;
  tackles: number;
  fouls: number;
  yellowCards: number;
  redCards: number;
  touches: number;
  /** 0 .. 10 match rating */
  rating: number;
}

export type MatchEventType = 'goal' | 'owngoal' | 'yellow' | 'red' | 'halftime' | 'fulltime';

export interface MatchEvent {
  type: MatchEventType;
  /** match minute (0 .. 90+) */
  minute: number;
  teamID: 0 | 1;
  playerDatabaseID?: number;
  assistDatabaseID?: number;
}

export interface MatchResult {
  homeGoals: number;
  awayGoals: number;
  events: MatchEvent[];
  playerStats: PlayerMatchStats[];
  /** true when the user quit before full time */
  abandoned: boolean;
}

export interface MatchSessionOptions {
  homeTeamDatabaseID: number;
  awayTeamDatabaseID: number;
  /** kit number per side (1 = home kit, 2 = away kit) */
  homeKit?: number;
  awayKit?: number;
  /** controller -> side assignments (controller index into GetControllers()) */
  sides: SideSelection[];
  /** "be a pro": the human only controls this player (database id); camera follows him */
  lockedPlayerDatabaseID?: number;
  /** overrides config match_duration (0 .. 1) */
  matchDuration?: number;
  /** overrides config match_difficulty (0 .. 1) */
  difficulty?: number;
  /** caption shown on the loading screen, e.g. "League matchday 12" */
  title?: string;
  /** progress callback while assets load (0 .. 1) */
  onLoadProgress?: (fraction: number) => void;
}

export type MatchSessionRunner = (options: MatchSessionOptions) => Promise<MatchResult>;

let runner: MatchSessionRunner | null = null;

/** installed by the app bootstrap once the engine is ready */
export function SetMatchSessionRunner(r: MatchSessionRunner): void {
  runner = r;
}

export function HasMatchSessionRunner(): boolean {
  return runner !== null;
}

export function StartMatchSession(options: MatchSessionOptions): Promise<MatchResult> {
  if (!runner) return Promise.reject(new Error('match engine not available'));
  return runner(options);
}
