// Bridge between career mode and the 3D engine's database.
//
// Before a PLAY match both sides are registered into GetDB() under reserved ids (teams 9001 /
// 9002 in a league id that has no league record, players from 900000), so the shipped database
// and the other game modes are never modified. Each side gets:
//   - a TeamRecord: name, short name, colors, logo and kit urls (real images for the shipped
//     clubs; generated textures for the rest, see kits.ts), a formation_xml built from the
//     coach's formation and tactics_xml from his style;
//   - PlayerRecords for the XI (formationorder 0..10 in formation-slot order, so the user sits in
//     the slot the coach picked for him) and the bench (11..17). Stats go through the inverse of
//     CalculateStat (attributes.engineRecordFor) with the player's real age, so the engine
//     reproduces the career attributes.
// After the match the engine's MatchResult is converted back into a MatchOutcome and applied
// exactly like a simulated one.

import type { MatchEvent, MatchResult, PlayerMatchStats } from '../../app/matchsession';
import type { Database, PlayerRecord, TeamRecord } from '../../game/data/database';
import { ENGINE_ROLE_STRING, engineRecordFor, statsToArray, type Position } from '../core/attributes';
import { ageAt } from '../core/dates';
import { club, coachOf } from '../core/index';
import { isNationalId, needsWinner } from '../core/competitions';
import { COUNTRIES, NATIONS } from '../core/data/geography';
import { settleKnockoutDraw, simulateRemainder, type MatchOutcome, type NpcMatchLine, type SimSideInput } from '../core/matchsim';
import { npcStats, shortName } from '../core/players';
import { USER_ID, FORMATIONS, lineupPlayer, type Lineup } from '../core/selection';
import { Rng, clamp } from '../core/rng';
import { sideName, type UserMatchContext } from '../core/results';
import type { CareerState, CoachStyle, FormationKey, Id, ReportEvent, RGB, UserMatchStats } from '../core/types';

export const CAREER_TEAM_IDS: [number, number] = [9001, 9002];
export const CAREER_LEAGUE_ID = 9000;
export const CAREER_PLAYER_BASE = 900000;

export interface RegisteredPlayer {
  engineId: number;
  careerId: Id;
  side: 0 | 1;
  pos: Position;
  name: string;
  /** in the starting XI (formation order 0..10) */
  starter: boolean;
}

export interface Registration {
  teamIds: [number, number];
  players: RegisteredPlayer[];
  userEngineId: number | null;
  kitUrls: [string, string];
  logoUrls: [string, string];
  colors: [[RGB, RGB], [RGB, RGB]];
  generatedKits: [boolean, boolean];
}

export function formationXml(formation: FormationKey): string {
  return FORMATIONS[formation]
    .map((s, i) => `<p${i + 1}><position>${s.x.toFixed(2)}, ${s.y.toFixed(2)}</position><role>${s.pos}</role></p${i + 1}>`)
    .join('');
}

const STYLE_TACTICS: Record<CoachStyle, Record<string, number>> = {
  possession: { dribble_centermagnet: 0.6, dribble_offensiveness: 0.5, position_defense_depth_factor: 0.55, position_defense_microfocus_strength: 0.6, position_defense_midfieldfocus: 0.65, position_defense_sidefocus_strength: 0.45, position_defense_width_factor: 0.55, position_offense_depth_factor: 0.55, position_offense_microfocus_strength: 0.65, position_offense_midfieldfocus: 0.7, position_offense_sidefocus_strength: 0.35, position_offense_width_factor: 0.75 },
  counter: { dribble_centermagnet: 0.45, dribble_offensiveness: 0.8, position_defense_depth_factor: 0.45, position_defense_microfocus_strength: 0.7, position_defense_midfieldfocus: 0.4, position_defense_sidefocus_strength: 0.5, position_defense_width_factor: 0.5, position_offense_depth_factor: 0.7, position_offense_microfocus_strength: 0.5, position_offense_midfieldfocus: 0.6, position_offense_sidefocus_strength: 0.45, position_offense_width_factor: 0.8 },
  pressing: { dribble_centermagnet: 0.5, dribble_offensiveness: 0.7, position_defense_depth_factor: 0.7, position_defense_microfocus_strength: 0.8, position_defense_midfieldfocus: 0.75, position_defense_sidefocus_strength: 0.4, position_defense_width_factor: 0.6, position_offense_depth_factor: 0.6, position_offense_microfocus_strength: 0.55, position_offense_midfieldfocus: 0.8, position_offense_sidefocus_strength: 0.35, position_offense_width_factor: 0.8 },
  direct: { dribble_centermagnet: 0.35, dribble_offensiveness: 0.85, position_defense_depth_factor: 0.55, position_defense_microfocus_strength: 0.6, position_defense_midfieldfocus: 0.5, position_defense_sidefocus_strength: 0.5, position_defense_width_factor: 0.5, position_offense_depth_factor: 0.75, position_offense_microfocus_strength: 0.45, position_offense_midfieldfocus: 0.75, position_offense_sidefocus_strength: 0.5, position_offense_width_factor: 0.85 },
  balanced: { dribble_centermagnet: 0.5, dribble_offensiveness: 0.7, position_defense_depth_factor: 0.6, position_defense_microfocus_strength: 0.7, position_defense_midfieldfocus: 0.6, position_defense_sidefocus_strength: 0.4, position_defense_width_factor: 0.54, position_offense_depth_factor: 0.6, position_offense_microfocus_strength: 0.56, position_offense_midfieldfocus: 0.8, position_offense_sidefocus_strength: 0.32, position_offense_width_factor: 0.8 },
};

export function tacticsXml(style: CoachStyle): string {
  return Object.entries(STYLE_TACTICS[style])
    .map(([k, v]) => `<${k}>${v.toFixed(6)}</${k}>`)
    .join('\n') + '\n';
}

function rgbString(c: RGB): string {
  return `${c[0]}, ${c[1]}, ${c[2]}`;
}

/** team identity for one side (club, national team or youth side) */
export function sideIdentity(state: CareerState, teamId: Id, youth: boolean): { name: string; short: string; colors: [RGB, RGB]; kitUrl: string; logoUrl: string; generated: boolean; style: CoachStyle } {
  if (isNationalId(teamId)) {
    const t = state.nationalTeams.find((x) => x.id === teamId)!;
    const def = COUNTRIES.find((c) => c.key === t.nation) ?? NATIONS.find((n) => n.key === t.nation);
    const colors = (def?.colors ?? [[255, 255, 255], [20, 20, 20]]) as [RGB, RGB];
    return { name: `${def?.name ?? t.nation}${t.level === 'senior' ? '' : ' ' + t.level}`, short: t.nation, colors, kitUrl: `fgcareer/nat_${t.nation.toLowerCase()}`, logoUrl: `fgcareer/nat_${t.nation.toLowerCase()}_logo.png`, generated: true, style: 'balanced' };
  }
  const c = club(state, teamId)!;
  const coach = coachOf(state, teamId);
  const real = c.dbTeamId !== undefined && !!c.kitUrl && !youth;
  return {
    name: youth ? `${c.name} U19` : c.name,
    short: c.shortName,
    colors: c.colors,
    kitUrl: real ? c.kitUrl! : `fgcareer/club_${c.id}${youth ? 'y' : ''}`,
    logoUrl: c.logoUrl ?? `fgcareer/club_${c.id}_logo.png`,
    generated: !real,
    style: coach?.style ?? 'balanced',
  };
}

/** removes everything career mode registered before */
export function unregisterCareer(db: Database): void {
  db.players = db.players.filter((p) => p.id < CAREER_PLAYER_BASE);
  db.teams = db.teams.filter((t) => !CAREER_TEAM_IDS.includes(t.id));
}

export function registerMatch(state: CareerState, ctx: UserMatchContext, db: Database): Registration {
  unregisterCareer(db);
  const f = ctx.fixture;
  const reg: Registration = { teamIds: CAREER_TEAM_IDS, players: [], userEngineId: null, kitUrls: ['', ''], logoUrls: ['', ''], colors: [[[0, 0, 0], [0, 0, 0]], [[0, 0, 0], [0, 0, 0]]], generatedKits: [false, false] };
  let nextId = CAREER_PLAYER_BASE;
  for (const side of [0, 1] as const) {
    const teamId = side === 0 ? f.home : f.away;
    const lineup = ctx.lineups[side];
    const ident = sideIdentity(state, teamId, !!f.youth);
    reg.kitUrls[side] = ident.kitUrl;
    reg.logoUrls[side] = ident.logoUrl;
    reg.colors[side] = ident.colors;
    reg.generatedKits[side] = ident.generated;
    const team: TeamRecord = {
      id: CAREER_TEAM_IDS[side],
      league_id: CAREER_LEAGUE_ID,
      name: ident.name,
      logo_url: ident.logoUrl,
      kit_url: ident.kitUrl,
      formation_xml: formationXml(lineup.formation),
      formation_factory_xml: formationXml(lineup.formation),
      tactics_xml: tacticsXml(ident.style),
      tactics_factory_xml: tacticsXml(ident.style),
      shortname: ident.short,
      color1: rgbString(ident.colors[0]),
      color2: rgbString(ident.colors[1]),
    };
    db.UpsertTeam(team);
    const entries = [...lineup.starters, ...lineup.bench];
    entries.forEach((e, order) => {
      const rec = playerRecord(state, lineup, e.npcId, e.pos, CAREER_TEAM_IDS[side], order, nextId);
      if (!rec) return;
      db.UpsertPlayer(rec);
      reg.players.push({ engineId: nextId, careerId: e.npcId, side, pos: e.pos, name: `${rec.firstname.charAt(0)}. ${rec.lastname}`, starter: order < lineup.starters.length });
      if (e.npcId === USER_ID) reg.userEngineId = nextId;
      nextId++;
    });
  }
  return reg;
}

function playerRecord(state: CareerState, lineup: Lineup, id: Id, slotPos: Position, teamId: number, order: number, engineId: number): PlayerRecord | null {
  if (id === USER_ID) {
    const u = state.user;
    // the engine reads an integer age (PlayerData truncates it), so invert for that age
    const age = Math.floor(ageAt(u.born, state.day));
    const rec = engineRecordFor(statsToArray(u.stats), age);
    return {
      id: engineId,
      team_id: teamId,
      nationalteam_id: -1,
      firstname: u.first,
      lastname: u.last,
      role: ENGINE_ROLE_STRING[u.pos],
      age: Math.floor(age),
      base_stat: rec.base_stat,
      profile_xml: rec.profile_xml,
      skincolor: u.skin,
      hairstyle: u.hair,
      haircolor: u.hairColor,
      height: u.height,
      weight: u.weight,
      formationorder: order,
      nationalteamformationorder: -1,
    };
  }
  const n = lineupPlayer(state, lineup, id);
  if (!n) return null;
  const age = Math.floor(ageAt(n.born, state.day));
  const rec = engineRecordFor(npcStats(n), age);
  void slotPos;
  return {
    id: engineId,
    team_id: teamId,
    nationalteam_id: -1,
    firstname: n.first,
    lastname: n.last,
    role: ENGINE_ROLE_STRING[n.pos],
    age: Math.floor(age),
    base_stat: rec.base_stat,
    profile_xml: rec.profile_xml,
    skincolor: n.skin,
    hairstyle: n.hair,
    haircolor: n.hairColor,
    height: n.height,
    weight: n.weight,
    formationorder: order,
    nationalteamformationorder: -1,
  };
}

/** home kit for the home side; the away side switches to its second kit when colors clash */
export function kitNumbers(reg: Registration): [number, number] {
  const [h, a] = reg.colors;
  const d = (x: RGB, y: RGB) => Math.abs(x[0] - y[0]) + Math.abs(x[1] - y[1]) + Math.abs(x[2] - y[2]);
  return [1, d(h[0], a[0]) < 160 ? 2 : 1];
}

// ----- results back into the career

function statsLine(s: PlayerMatchStats | undefined): { rating: number; mins: number } {
  return { rating: s ? clamp(s.rating, 3, 10) : 6, mins: s ? s.minutesPlayed : 0 };
}

/** matches quit this early are replayed as a whole simulation instead of being continued */
export const ABANDON_RESIMULATE_MINUTE = 10;

/** the match minute an (abandoned) engine result reached */
export function resultMinute(result: MatchResult): number {
  if (!result.abandoned) return 90;
  let m = 0;
  for (const s of result.playerStats) m = Math.max(m, s.minutesPlayed);
  for (const e of result.events) if (e.type !== 'fulltime') m = Math.max(m, Math.min(90, e.minute));
  return Math.min(90, m);
}

export interface ConversionInfo {
  /** the rest of an abandoned match was simulated from this minute */
  continuedFrom?: number;
}

/**
 * Converts the engine's MatchResult into a MatchOutcome for the career:
 *  - scorers/cards/stats of everyone registered, the user's line from his locked player;
 *  - an abandoned match keeps what happened so far and the remaining minutes are simulated
 *    (he counts as substituted when he left);
 *  - knockout draws get simulated extra time and, if still level, penalties (the engine always
 *    stops after 90 minutes).
 */
export function resultToOutcome(state: CareerState, ctx: UserMatchContext, reg: Registration, result: MatchResult, info: ConversionInfo = {}): MatchOutcome {
  const rng = new Rng(ctx.fixture.id * 131 + state.day * 7 + 1);
  const byEngine = new Map(reg.players.map((p) => [p.engineId, p]));
  const statsById = new Map(result.playerStats.map((s) => [s.playerDatabaseID, s]));
  const userName = `${state.user.first} ${state.user.last}`;
  const events: (ReportEvent & { npcId?: number; assistId?: number })[] = [];
  const nameOf = (engineId?: number) => (engineId === undefined ? 'Unknown' : engineId === reg.userEngineId ? userName : byEngine.get(engineId)?.name ?? 'Unknown');
  for (const e of result.events as MatchEvent[]) {
    const side = e.teamID;
    const isUser = e.playerDatabaseID !== undefined && e.playerDatabaseID === reg.userEngineId;
    const minute = Math.max(1, e.minute);
    if (e.type === 'goal') events.push({ minute, type: 'goal', side, name: e.playerDatabaseID === undefined ? 'Goal' : nameOf(e.playerDatabaseID), assist: e.assistDatabaseID !== undefined ? nameOf(e.assistDatabaseID) : undefined, user: isUser || (e.assistDatabaseID !== undefined && e.assistDatabaseID === reg.userEngineId) });
    else if (e.type === 'owngoal') events.push({ minute, type: 'owngoal', side, name: 'Own goal', text: e.playerDatabaseID !== undefined ? nameOf(e.playerDatabaseID) : undefined, user: isUser });
    else if (e.type === 'yellow' || e.type === 'red') events.push({ minute, type: e.type, side: byEngine.get(e.playerDatabaseID ?? -1)?.side ?? side, name: nameOf(e.playerDatabaseID), user: isUser });
  }

  const minute = resultMinute(result);
  const continued = result.abandoned;
  if (continued) info.continuedFrom = minute;
  let hg = result.homeGoals;
  let ag = result.awayGoals;

  const lines: NpcMatchLine[] = [];
  const lineOf = new Map<number, NpcMatchLine>();
  for (const p of reg.players) {
    if (p.careerId === USER_ID || p.careerId < 0) continue;
    const s = statsById.get(p.engineId);
    let { rating, mins } = statsLine(s);
    // an abandoned match: the players on the pitch play on in the simulated remainder
    if (continued && p.starter && !(s && s.redCards > 0)) mins = 90;
    if (mins <= 0) continue;
    const l: NpcMatchLine = { id: p.careerId, side: p.side, mins, started: p.starter, goals: s?.goals ?? 0, assists: s?.assists ?? 0, yellow: s?.yellowCards ?? 0, red: s?.redCards ?? 0, rating, injuryDays: 0 };
    lines.push(l);
    lineOf.set(p.careerId, l);
  }
  const sides: [SimSideInput, SimSideInput] = [
    { lineup: ctx.lineups[0], name: sideName(state, ctx.lineups[0]) },
    { lineup: ctx.lineups[1], name: sideName(state, ctx.lineups[1]) },
  ];
  const credit = (evs: (ReportEvent & { npcId?: number; assistId?: number })[]) => {
    for (const ev of evs) {
      if (ev.npcId !== undefined) {
        const l = lineOf.get(ev.npcId);
        if (l) {
          l.goals++;
          l.rating = clamp(l.rating + 0.8, 3, 10);
        }
      }
      if (ev.assistId !== undefined) {
        const l = lineOf.get(ev.assistId);
        if (l) l.assists++;
      }
      events.push(ev);
    }
  };
  if (continued) {
    const rest = simulateRemainder(rng, sides[0], sides[1], minute, !!ctx.fixture.national);
    hg += rest.goals[0];
    ag += rest.goals[1];
    credit(rest.events);
  }

  let user: UserMatchStats | null = null;
  if (reg.userEngineId !== null) {
    const s = statsById.get(reg.userEngineId);
    if (s && s.minutesPlayed > 0) {
      const opp = result.playerStats.filter((x) => x.teamID !== ctx.side);
      const conceded = ctx.side === 0 ? result.awayGoals : result.homeGoals;
      const isGk = (reg.players.find((p) => p.engineId === reg.userEngineId)?.pos ?? state.user.pos) === 'GK';
      user = {
        minutes: s.minutesPlayed,
        goals: s.goals,
        assists: s.assists,
        shots: s.shots,
        shotsOnTarget: s.shotsOnTarget,
        passes: s.passes,
        passesCompleted: s.passesCompleted,
        keyPasses: 0,
        dribbles: 0,
        tackles: s.tackles,
        interceptions: 0,
        saves: isGk ? Math.max(0, opp.reduce((a, x) => a + x.shotsOnTarget, 0) - conceded) : 0,
        touches: s.touches,
        fouls: s.fouls,
        yellow: s.yellowCards,
        red: s.redCards,
        rating: clamp(Math.round(s.rating * 10) / 10, 3, 10),
        motm: false,
      };
      if (continued && s.redCards === 0) events.push({ minute: Math.max(1, minute), type: 'sub_off', side: ctx.side, name: userName, user: true, text: 'left the match' });
    }
  }

  // knockout draws: the engine plays 90 minutes, so extra time and penalties are simulated
  const ko = needsWinner(state, ctx.fixture);
  const settle = settleKnockoutDraw(rng, sides[0], sides[1], ko, hg, ag, !!ctx.fixture.national);
  if (settle.aet) {
    hg += settle.extra[0];
    ag += settle.extra[1];
    credit(settle.events);
    if (user && user.red === 0 && !continued) user.minutes += 30;
  }

  let motmId = -2;
  let best = -1;
  for (const l of lines) if (l.rating > best) {
    best = l.rating;
    motmId = l.id;
  }
  if (user && user.rating >= best) {
    user.motm = true;
    motmId = USER_ID;
  }
  const shots: [number, number] = [0, 0];
  for (const s of result.playerStats) shots[s.teamID] += s.shots;
  const passes = [0, 0];
  for (const s of result.playerStats) passes[s.teamID] += s.passes;
  const possession = passes[0] + passes[1] > 0 ? clamp(passes[0] / (passes[0] + passes[1]), 0.2, 0.8) : 0.5;
  events.sort((x, y) => x.minute - y.minute);
  return { hg, ag, pens: settle.pens, aet: settle.aet || undefined, events, lines, user, possession, shots: [Math.max(shots[0], hg), Math.max(shots[1], ag)], motmId, userInjuryDays: 0 };
}

export { shortName };
