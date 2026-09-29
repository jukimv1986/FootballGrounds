// Match statistics for the career layer (not in the original game). The collector polls the
// running match after every 10ms game step through its public API only:
//
//  - touches: a player's GetLastTouchTime_ms() increases (Team::SetLastTouchPlayer stamps it)
//  - passes: a touch made during a ShortPass/LongPass/HighPass animation (GetCurrentFunctionType);
//    completed when the next touch by another player is by a teammate
//  - shots: MatchData::GetShots(team) increases (the humanoid counts every shot it strikes),
//    credited to that team's last toucher; falls back to touches during a Shot animation.
//    On target = scored, or the next touch is the opposing goalkeeper's (a save)
//  - goals / own goals / assists: MatchData goal count increases; scorer via GetLastGoalScorer()
//    when the port has it, otherwise the same rule Match::Process uses (last intentional touch
//    of the scoring team, else own goal by the other team's last toucher). Assist = the last
//    touch by a teammate before the scorer's own touches, within 12 seconds
//  - tackles: winning the ball from an opponent with a standing (Interfere) or sliding tackle
//  - fouls: Referee::GetCurrentFoulPlayer()/GetCurrentFoulType() becoming set
//  - cards: Player::GetCards() changes (1 yellow, 2 two yellows = sent off, 3 red, 4 yellow + red)
//
// Every poll is optional: if the gameplay port lacks a method the stat is skipped, and a poll
// that throws is disabled for the rest of the match (logged once).

import { e_FunctionType, e_MatchPhase, e_PlayerRole, e_TouchType } from '../game/gamedefines';
import type { MatchEvent, MatchEventType, PlayerMatchStats } from './matchsession';

// ----- the parts of the match API the collector reads (structural, all optional)

export interface StatsPlayerData {
  GetDatabaseID(): number;
  GetFirstName?(): string;
  GetLastName?(): string;
}

export interface StatsPlayer {
  GetID(): number;
  GetTeamID(): number;
  GetPlayerData(): StatsPlayerData;
  GetLastTouchTime_ms?(): number;
  GetCurrentFunctionType?(): e_FunctionType;
  GetCards?(): number;
  IsActive?(): boolean;
  GetFormationEntry?(): { role: e_PlayerRole };
}

export interface StatsTeam {
  GetLastTouchPlayer?(touchType?: e_TouchType): StatsPlayer | null;
  GetGoalie?(): StatsPlayer | null;
}

export interface StatsReferee {
  GetCurrentFoulPlayer?(): StatsPlayer | null;
  GetCurrentFoulType?(): number;
}

export interface StatsMatchData {
  GetGoalCount(teamID: number): number;
  GetShots?(teamID: number): number;
}

export interface StatsMatchView {
  GetTeam(teamID: number): StatsTeam;
  GetMatchData(): StatsMatchData;
  GetActiveTeamPlayers?(teamID: number, players: StatsPlayer[]): unknown;
  GetMatchTime_ms?(): number;
  GetActualTime_ms?(): number;
  GetMatchPhase?(): e_MatchPhase;
  GetLastGoalTeamID?(): number;
  GetLastGoalScorer?(): StatsPlayer | null;
  GetLastTouchTeamID?(touchType?: e_TouchType): number;
  GetReferee?(): StatsReferee;
}

// ----- rating

export interface RatingInput {
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
  minutesPlayed: number;
  ownGoals?: number;
  saves?: number;
  teamGoals?: number;
  opponentGoals?: number;
  isGoalkeeper?: boolean;
  isDefender?: boolean;
}

function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

/**
 * 0 .. 10 match rating: 6.0 baseline, adjusted by the player's contributions and the result,
 * scaled down for short appearances, clamped and rounded to one decimal.
 */
export function ComputeRating(s: RatingInput): number {
  let delta = 0;

  // attacking output
  delta += Math.min(3.0, s.goals * 1.0);
  delta += Math.min(1.8, s.assists * 0.6);
  delta += Math.min(0.6, s.shotsOnTarget * 0.15);
  delta -= Math.min(0.4, Math.max(0, s.shots - s.shotsOnTarget) * 0.05);

  // passing: volume and accuracy (accuracy only counts with a few attempts)
  delta += Math.min(0.6, s.passesCompleted * 0.02);
  if (s.passes >= 5) delta += Math.max(-0.5, Math.min(0.4, (s.passesCompleted / s.passes - 0.75) * 1.6));

  // defending
  delta += Math.min(1.2, s.tackles * 0.2);
  delta += Math.min(2.0, (s.saves ?? 0) * 0.3);

  // discipline
  delta -= s.fouls * 0.1;
  delta -= s.yellowCards * 0.3;
  delta -= s.redCards * 1.5;
  delta -= (s.ownGoals ?? 0) * 1.0;

  // result
  if (s.teamGoals !== undefined && s.opponentGoals !== undefined) {
    if (s.teamGoals > s.opponentGoals) delta += 0.3;
    else if (s.teamGoals < s.opponentGoals) delta -= 0.3;
    if (s.isGoalkeeper) delta += s.opponentGoals === 0 ? 0.6 : -Math.min(1.5, s.opponentGoals * 0.25);
    else if (s.isDefender) delta += s.opponentGoals === 0 ? 0.3 : -Math.min(0.8, s.opponentGoals * 0.1);
  }

  // hardly involved (outfield players)
  const minutes = Math.max(0, s.minutesPlayed);
  if (!s.isGoalkeeper && minutes >= 30 && s.touches < (minutes / 90) * 8) delta -= 0.3;

  // short appearances stay closer to the baseline
  const presence = Math.min(1, 0.4 + (minutes / 90) * 0.6);
  const positive = delta > 0 ? delta * presence : delta;

  return round1(Math.min(10, Math.max(0, 6.0 + positive)));
}

/** match clock (ms, 0 = kick off, 45:00 = second half) -> minute 1 .. 90+ (first half capped at 45) */
export function MatchMinute(matchTime_ms: number, phase?: e_MatchPhase): number {
  if (phase === e_MatchPhase.e_MatchPhase_PreMatch) return 0;
  const minute = Math.floor(Math.max(0, matchTime_ms) / 60000) + 1;
  if (phase === e_MatchPhase.e_MatchPhase_1stHalf) return Math.min(45, minute);
  if (phase === e_MatchPhase.e_MatchPhase_2ndHalf) return Math.max(46, minute);
  return minute;
}

// ----- collector

interface PlayerRecord {
  player: StatsPlayer;
  stats: PlayerMatchStats;
  ownGoals: number;
  saves: number;
  lastTouchTime_ms: number;
  cards: number;
  startMinute: number;
  endMinute: number | null;
  isGoalkeeper: boolean;
  isDefender: boolean;
}

interface TouchEvent {
  record: PlayerRecord;
  teamID: number;
  time_ms: number;
  functionType: e_FunctionType | null;
}

const passFunctions = new Set<e_FunctionType>([e_FunctionType.e_FunctionType_ShortPass, e_FunctionType.e_FunctionType_LongPass, e_FunctionType.e_FunctionType_HighPass]);
const tackleFunctions = new Set<e_FunctionType>([e_FunctionType.e_FunctionType_Interfere, e_FunctionType.e_FunctionType_Sliding]);
const defenderRoles = new Set<e_PlayerRole>([e_PlayerRole.e_PlayerRole_CB, e_PlayerRole.e_PlayerRole_LB, e_PlayerRole.e_PlayerRole_RB]);

const assistWindow_ms = 12000;
/** repeated contacts by the same player closer together than this count as one touch */
const repeatedContact_ms = 150;
const shotResolveWindow_ms = 5000;

export interface MatchStatsOptions {
  /** called for every emitted event (goal toasts etc.) */
  onEvent?: (event: MatchEvent) => void;
}

export class MatchStatsCollector {
  protected match: StatsMatchView;
  protected options: MatchStatsOptions;
  protected records = new Map<StatsPlayer, PlayerRecord>();
  protected events: MatchEvent[] = [];
  protected touches: TouchEvent[] = [];
  protected pendingPass: TouchEvent | null = null;
  protected pendingShot: { record: PlayerRecord; teamID: number; time_ms: number } | null = null;
  protected goalCount: [number, number] = [0, 0];
  protected shotCount: [number, number] = [0, 0];
  protected foulPlayer: StatsPlayer | null = null;
  protected foulType = 0;
  protected phase: e_MatchPhase | null = null;
  protected disabled = new Set<string>();
  protected finished = false;
  /** players registered after kick off (substitutes) start counting minutes from then */
  protected lateRegistration = false;
  private scratch: StatsPlayer[] = [];

  constructor(match: unknown, options: MatchStatsOptions = {}) {
    this.match = match as StatsMatchView;
    this.options = options;
    this.Guard('init', () => {
      const md = this.match.GetMatchData();
      this.goalCount = [md.GetGoalCount(0), md.GetGoalCount(1)];
      if (md.GetShots) this.shotCount = [md.GetShots(0), md.GetShots(1)];
    });
    this.Guard('players', () => this.RegisterPlayers());
    this.lateRegistration = true;
  }

  protected Guard(name: string, fn: () => void): void {
    if (this.disabled.has(name)) return;
    try {
      fn();
    } catch (error) {
      this.disabled.add(name);
      console.warn(`MatchStatsCollector: '${name}' disabled`, error);
    }
  }

  protected ActualTime(): number {
    return this.match.GetActualTime_ms ? this.match.GetActualTime_ms() : 0;
  }

  CurrentMinute(): number {
    const time = this.match.GetMatchTime_ms ? this.match.GetMatchTime_ms() : 0;
    return MatchMinute(time, this.match.GetMatchPhase?.());
  }

  protected RegisterPlayers(): void {
    if (!this.match.GetActiveTeamPlayers) return;
    for (const teamID of [0, 1] as const) {
      this.scratch.length = 0;
      this.match.GetActiveTeamPlayers(teamID, this.scratch);
      for (const player of this.scratch) {
        if (this.records.has(player)) continue;
        const role = player.GetFormationEntry?.().role;
        const record: PlayerRecord = {
          player,
          stats: {
            playerDatabaseID: player.GetPlayerData().GetDatabaseID(),
            teamID,
            minutesPlayed: 0,
            goals: 0,
            assists: 0,
            shots: 0,
            shotsOnTarget: 0,
            passes: 0,
            passesCompleted: 0,
            tackles: 0,
            fouls: 0,
            yellowCards: 0,
            redCards: 0,
            touches: 0,
            rating: 6.0,
          },
          ownGoals: 0,
          saves: 0,
          lastTouchTime_ms: player.GetLastTouchTime_ms ? player.GetLastTouchTime_ms() : 0,
          cards: player.GetCards ? player.GetCards() : 0,
          startMinute: this.lateRegistration ? this.CurrentMinute() : 0,
          endMinute: null,
          isGoalkeeper: role === e_PlayerRole.e_PlayerRole_GK,
          isDefender: role !== undefined && defenderRoles.has(role),
        };
        this.records.set(player, record);
      }
    }
  }

  protected Emit(type: MatchEventType, teamID: 0 | 1, playerDatabaseID?: number, assistDatabaseID?: number): void {
    const event: MatchEvent = { type, minute: this.CurrentMinute(), teamID };
    if (playerDatabaseID !== undefined) event.playerDatabaseID = playerDatabaseID;
    if (assistDatabaseID !== undefined) event.assistDatabaseID = assistDatabaseID;
    this.events.push(event);
    this.options.onEvent?.(event);
  }

  /** call after every game step */
  Step(): void {
    if (this.finished) return;
    if (this.ActualTime() % 1000 === 0) this.Guard('players', () => this.RegisterPlayers());
    this.Guard('phase', () => this.PollPhase());
    this.Guard('touches', () => this.PollTouches());
    this.Guard('shots', () => this.PollShots());
    this.Guard('goals', () => this.PollGoals());
    this.Guard('fouls', () => this.PollFouls());
    this.Guard('cards', () => this.PollCards());
  }

  protected PollPhase(): void {
    if (!this.match.GetMatchPhase) return;
    const phase = this.match.GetMatchPhase();
    if (this.phase === e_MatchPhase.e_MatchPhase_1stHalf && phase === e_MatchPhase.e_MatchPhase_2ndHalf) {
      this.events.push({ type: 'halftime', minute: 45, teamID: 0 });
      this.options.onEvent?.(this.events[this.events.length - 1]);
    }
    this.phase = phase;
  }

  protected PollTouches(): void {
    const newTouches: TouchEvent[] = [];
    for (const record of this.records.values()) {
      const p = record.player;
      if (!p.GetLastTouchTime_ms) return;
      const t = p.GetLastTouchTime_ms();
      if (t > record.lastTouchTime_ms) {
        record.lastTouchTime_ms = t;
        newTouches.push({ record, teamID: record.stats.teamID, time_ms: t, functionType: p.GetCurrentFunctionType ? p.GetCurrentFunctionType() : null });
      }
    }
    if (newTouches.length > 1) newTouches.sort((a, b) => a.time_ms - b.time_ms);
    for (const touch of newTouches) this.OnTouch(touch);

    // stale pending shot: missed / blocked
    if (this.pendingShot && this.ActualTime() - this.pendingShot.time_ms > shotResolveWindow_ms) this.pendingShot = null;
  }

  protected OnTouch(touch: TouchEvent): void {
    const stats = touch.record.stats;
    const previous = this.touches.length > 0 ? this.touches[this.touches.length - 1] : null;

    // the ball resting against a player registers a body contact every step: one touch
    if (previous && previous.record === touch.record && touch.time_ms - previous.time_ms <= repeatedContact_ms && !this.IsAction(touch)) {
      previous.time_ms = touch.time_ms;
      return;
    }
    stats.touches++;

    if (previous && previous.record !== touch.record) {
      // resolve the previous pass
      if (this.pendingPass && this.pendingPass === previous) {
        if (previous.teamID === touch.teamID) previous.record.stats.passesCompleted++;
        this.pendingPass = null;
      }
      // winning the ball with a tackle
      if (previous.teamID !== touch.teamID && touch.functionType !== null && tackleFunctions.has(touch.functionType)) stats.tackles++;
    }

    // resolve a pending shot: a save by the opposing goalkeeper puts it on target
    if (this.pendingShot && touch.record !== this.pendingShot.record) {
      if (touch.teamID !== this.pendingShot.teamID && this.IsGoalkeeper(touch.record)) {
        this.pendingShot.record.stats.shotsOnTarget++;
        touch.record.saves++;
      }
      this.pendingShot = null;
    }

    if (touch.functionType !== null && passFunctions.has(touch.functionType)) {
      stats.passes++;
      this.pendingPass = touch;
    }

    // shot fallback when MatchData has no shot counter
    if (!this.match.GetMatchData().GetShots && touch.functionType === e_FunctionType.e_FunctionType_Shot) this.RegisterShot(touch.record, touch.teamID);

    this.touches.push(touch);
    if (this.touches.length > 64) this.touches.splice(0, this.touches.length - 64);
  }

  /** a deliberate pass / shot / tackle touch (never merged into a previous contact) */
  protected IsAction(touch: TouchEvent): boolean {
    const f = touch.functionType;
    return f !== null && (passFunctions.has(f) || tackleFunctions.has(f) || f === e_FunctionType.e_FunctionType_Shot);
  }

  protected IsGoalkeeper(record: PlayerRecord): boolean {
    if (record.isGoalkeeper) return true;
    const team = this.match.GetTeam(record.stats.teamID);
    return team.GetGoalie ? team.GetGoalie() === record.player : false;
  }

  protected RegisterShot(record: PlayerRecord, teamID: number): void {
    record.stats.shots++;
    this.pendingShot = { record, teamID, time_ms: this.ActualTime() };
    // a shot is not a pass
    if (this.pendingPass && this.pendingPass.record === record) {
      record.stats.passes = Math.max(0, record.stats.passes - 1);
      this.pendingPass = null;
    }
  }

  protected PollShots(): void {
    const md = this.match.GetMatchData();
    if (!md.GetShots) return;
    for (const teamID of [0, 1] as const) {
      const shots = md.GetShots(teamID);
      if (shots > this.shotCount[teamID]) {
        const shooter = this.RecordOf(this.match.GetTeam(teamID).GetLastTouchPlayer?.() ?? null);
        if (shooter) this.RegisterShot(shooter, teamID);
      }
      this.shotCount[teamID] = shots;
    }
  }

  protected RecordOf(player: StatsPlayer | null | undefined): PlayerRecord | null {
    if (!player) return null;
    return this.records.get(player) ?? null;
  }

  protected PollGoals(): void {
    const md = this.match.GetMatchData();
    for (const goalTeamID of [0, 1] as const) {
      const count = md.GetGoalCount(goalTeamID);
      while (count > this.goalCount[goalTeamID]) {
        this.goalCount[goalTeamID]++;
        this.OnGoal(goalTeamID);
      }
    }
  }

  protected OnGoal(goalTeamID: 0 | 1): void {
    let scorer: StatsPlayer | null = null;
    let ownGoal = false;
    if (this.match.GetLastGoalScorer) {
      scorer = this.match.GetLastGoalScorer();
      ownGoal = scorer !== null && scorer.GetTeamID() !== goalTeamID;
    } else if (this.match.GetLastTouchTeamID) {
      // same rule as Match::Process
      ownGoal = !(
        this.match.GetLastTouchTeamID(e_TouchType.e_TouchType_Intentional_Kicked) === goalTeamID ||
        this.match.GetLastTouchTeamID(e_TouchType.e_TouchType_Intentional_Nonkicked) === goalTeamID
      );
      scorer = this.match.GetTeam(ownGoal ? 1 - goalTeamID : goalTeamID).GetLastTouchPlayer?.() ?? null;
    } else {
      scorer = this.match.GetTeam(goalTeamID).GetLastTouchPlayer?.() ?? null;
    }
    const record = this.RecordOf(scorer);

    if (ownGoal) {
      if (record) record.ownGoals++;
      this.Emit('owngoal', goalTeamID, record?.stats.playerDatabaseID);
    } else {
      let assist: PlayerRecord | null = null;
      if (record) {
        record.stats.goals++;
        if (this.pendingShot && this.pendingShot.record === record) record.stats.shotsOnTarget++;
        assist = this.FindAssist(record);
        if (assist) assist.stats.assists++;
      }
      this.Emit('goal', goalTeamID, record?.stats.playerDatabaseID, assist?.stats.playerDatabaseID);
    }
    this.pendingShot = null;
    this.pendingPass = null;
  }

  /** last touch by a teammate before the scorer's own run of touches */
  protected FindAssist(scorer: PlayerRecord): PlayerRecord | null {
    let i = this.touches.length - 1;
    while (i >= 0 && this.touches[i].record === scorer) i--;
    if (i < 0) return null;
    const candidate = this.touches[i];
    if (candidate.teamID !== scorer.stats.teamID) return null;
    const scorerTouch = this.touches[i + 1];
    if (scorerTouch && scorerTouch.time_ms - candidate.time_ms > assistWindow_ms) return null;
    return candidate.record;
  }

  protected PollFouls(): void {
    const referee = this.match.GetReferee?.();
    if (!referee || !referee.GetCurrentFoulPlayer || !referee.GetCurrentFoulType) return;
    const type = referee.GetCurrentFoulType();
    const player = referee.GetCurrentFoulPlayer();
    if (type !== 0 && player && (this.foulType === 0 || player !== this.foulPlayer)) {
      const record = this.RecordOf(player);
      if (record) record.stats.fouls++;
    }
    this.foulType = type;
    this.foulPlayer = type !== 0 ? player : null;
  }

  protected PollCards(): void {
    for (const record of this.records.values()) {
      const p = record.player;
      if (!p.GetCards) return;
      const cards = p.GetCards();
      if (cards === record.cards) continue;
      // 1 == 1 yellow; 2 == 2 yellow; 3 == 1 red; 4 == 1 yellow, 1 red
      const yellowsBefore = record.cards % 3;
      const yellowsNow = cards % 3;
      const redBefore = record.cards >= 2;
      const redNow = cards >= 2;
      record.cards = cards;
      const teamID = record.stats.teamID;
      for (let y = yellowsBefore; y < yellowsNow; y++) {
        record.stats.yellowCards++;
        this.Emit('yellow', teamID, record.stats.playerDatabaseID);
      }
      if (redNow && !redBefore) {
        record.stats.redCards = 1;
        record.endMinute = this.CurrentMinute();
        this.Emit('red', teamID, record.stats.playerDatabaseID);
      }
    }
  }

  GetEvents(): MatchEvent[] {
    return this.events;
  }

  /** goals per team as counted by the match data */
  GetScore(): [number, number] {
    try {
      const md = this.match.GetMatchData();
      return [md.GetGoalCount(0), md.GetGoalCount(1)];
    } catch {
      return [this.goalCount[0], this.goalCount[1]];
    }
  }

  GetPlayerStats(playerDatabaseID: number): PlayerMatchStats | null {
    for (const record of this.records.values()) if (record.stats.playerDatabaseID === playerDatabaseID) return record.stats;
    return null;
  }

  /** player name for summaries ("J. Doe") */
  GetPlayerName(playerDatabaseID: number): string {
    for (const record of this.records.values()) {
      if (record.stats.playerDatabaseID !== playerDatabaseID) continue;
      const data = record.player.GetPlayerData();
      const last = data.GetLastName?.() ?? '';
      const first = data.GetFirstName?.() ?? '';
      if (last && first) return `${first.charAt(0)}. ${last}`;
      return last || first || `#${playerDatabaseID}`;
    }
    return `#${playerDatabaseID}`;
  }

  /**
   * Final numbers: minutes played, ratings and the full time event. Call once at the end
   * (abandoned: the user quit; minutes count up to the current minute).
   */
  Finish(abandoned: boolean): { events: MatchEvent[]; playerStats: PlayerMatchStats[] } {
    if (!this.finished) {
      this.Step();
      this.finished = true;
      // stoppage time does not count: a full match is 90 minutes
      const endMinute = abandoned ? Math.min(90, this.CurrentMinute()) : 90;
      if (!abandoned) this.events.push({ type: 'fulltime', minute: Math.max(90, this.CurrentMinute()), teamID: 0 });
      const [homeGoals, awayGoals] = this.GetScore();
      for (const record of this.records.values()) {
        const s = record.stats;
        const end = record.endMinute ?? endMinute;
        s.minutesPlayed = Math.max(0, Math.min(end, endMinute) - record.startMinute);
        const teamGoals = s.teamID === 0 ? homeGoals : awayGoals;
        const opponentGoals = s.teamID === 0 ? awayGoals : homeGoals;
        s.rating = ComputeRating({
          ...s,
          ownGoals: record.ownGoals,
          saves: record.saves,
          teamGoals,
          opponentGoals,
          isGoalkeeper: record.isGoalkeeper,
          isDefender: record.isDefender,
        });
      }
    }
    return { events: this.events, playerStats: [...this.records.values()].map((r) => ({ ...r.stats })) };
  }
}
