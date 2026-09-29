// Applying match outcomes to the world: fixture scores, NPC season stats, form, cards and bans,
// injuries, knockout progress — and for the user's matches everything that flows from his
// performance: stats per competition, rating history, form, morale, reputation (local /
// national / world), followers, bonuses, coach and teammate relationships, fan reactions.

import { comp, fixturesOf, club, getIndex } from './index';
import { isNationalId, needsWinner, progressKnockouts, teamName } from './competitions';
import { conditionFactor, fullName, hasTrait, refreshMarketValue, userAge } from './footballer';
import { startUserInjury } from './health';
import { detailedSim, quickSim, type MatchOutcome, type SimSideInput, type UserSimInput } from './matchsim';
import { addMessage, addMoney, addNotice, addPost, addTimeline } from './messages';
import { ageCurve, shortName, virtualPlayers } from './players';
import { ovrScale } from './attributes';
import { clubLevel } from './world';
import { Rng, clamp } from './rng';
import { USER_ID, YOUTH_BENCH_RUN, YOUTH_START_RUN, lineupPlayer, quickLineup, selectLineup, type Lineup } from './selection';
import { matchExperience } from './training';
import { reactToMatch } from './social';
import { statsToArray } from './attributes';
import type { CareerState, CompType, Fixture, MatchReport, MatchRole, StatLine, UserMatchStats } from './types';
import { buildNationalLineup } from './national';
import { bumpAffinity } from './life';

export function sideName(state: CareerState, lineup: Lineup): (id: number) => string {
  return (id: number) => {
    if (id === USER_ID) return fullName(state.user);
    const p = lineupPlayer(state, lineup, id);
    return p ? shortName(p) : 'Unknown';
  };
}

/** lineups for a fixture (user's club uses the full coach AI; others the quick picker) */
export function lineupsFor(state: CareerState, f: Fixture, rng: Rng): [Lineup, Lineup] {
  if (f.national) return [buildNationalLineup(state, f.home, rng), buildNationalLineup(state, f.away, rng)];
  const c = comp(state, f.compId);
  const rotation = c?.type === 'cup' && c.round <= 2;
  const mk = (teamId: number): Lineup => {
    if (f.youth) return selectLineup(state, teamId, { youth: true, userEligible: teamId === state.user.clubId && userInYouthSide(state, f.day) && !state.user.injury, seed: f.id * 31 + teamId });
    if (teamId === state.user.clubId) return selectLineup(state, teamId, { rotation, seed: f.id * 31 + teamId });
    return quickLineup(state, teamId, rng);
  };
  const home = f.youth && f.home !== state.user.clubId ? virtualYouthLineup(state, f.home, rng) : mk(f.home);
  const away = f.youth && f.away !== state.user.clubId ? virtualYouthLineup(state, f.away, rng) : mk(f.away);
  return [home, away];
}

/** opponents' youth sides are not stored: a virtual squad from the club's youth rating */
export function virtualYouthLineup(state: CareerState, clubId: number, rng: Rng): Lineup {
  const c = club(state, clubId);
  const r = new Rng(clubId * 977 + state.season * 13);
  // calibrated like a real development squad: club level x academy quality x the age curve at ~17
  const target = ovrScale(clubLevel(c?.reputation ?? 50) * (0.92 + (c?.youthFacilities ?? 0.5) * 0.12) * ageCurve(17.2)) + 2;
  const positions = ['GK', 'LB', 'CB', 'CB', 'RB', 'LM', 'CM', 'CM', 'RM', 'CF', 'CF', 'GK', 'CB', 'CM', 'AM', 'CF'] as const;
  const virtual = virtualPlayers(r, { idBase: -1000 - (clubId % 500) * 20, nat: c?.countryKey ?? 'ENG', positions, targetOvr: target, ageMin: 16, ageMax: 18.9, day: state.day });
  const starters = virtual.slice(0, 11).map((n, i) => ({ npcId: n.id, pos: positions[i], rating: n.ovr + rng.gauss(0, 1.5) }));
  const bench = virtual.slice(11).map((n) => ({ npcId: n.id, pos: n.pos, rating: n.ovr }));
  return { teamId: clubId, formation: '4-4-2', starters, bench, userRole: 'out', virtual };
}

export function compTypeOf(state: CareerState, f: Fixture): CompType {
  return comp(state, f.compId)?.type ?? 'friendly';
}

function lineKey(t: CompType): keyof CareerState['user']['season'] | null {
  if (t === 'league' || t === 'cup' || t === 'continental' || t === 'youth' || t === 'international') return t;
  return null;
}

function isCompetitive(t: CompType): boolean {
  return t !== 'friendly';
}

/** simulates and applies a background fixture */
export function playBackgroundFixture(state: CareerState, f: Fixture, rng: Rng): void {
  const [hl, al] = lineupsFor(state, f, rng);
  const ko = needsWinner(state, f);
  const home: SimSideInput = { lineup: hl, name: sideName(state, hl) };
  const away: SimSideInput = { lineup: al, name: sideName(state, al) };
  const out = quickSim(rng, home, away, ko, f.national);
  applyOutcome(state, f, out, hl, al, rng);
}

/** applies an outcome (from any simulator or the 3D engine) to fixture and NPCs */
export function applyOutcome(state: CareerState, f: Fixture, out: MatchOutcome, hl: Lineup, al: Lineup, rng: Rng): void {
  f.hg = out.hg;
  f.ag = out.ag;
  f.pens = out.pens;
  f.played = true;
  const type = compTypeOf(state, f);
  const idx = getIndex(state);
  const competitive = isCompetitive(type) && !f.youth;
  for (const l of out.lines) {
    if (l.id < 0) continue;
    const n = idx.npcs.get(l.id);
    if (!n) continue;
    if (competitive && !f.national) {
      const s = n.season;
      s.apps++;
      if (l.started) s.starts++;
      s.mins += l.mins;
      s.goals += l.goals;
      s.assists += l.assists;
      s.ratingSum += l.rating;
      s.rated++;
      s.yellows += l.yellow;
      s.reds += l.red;
      if (out.motmId === n.id) s.motm++;
      n.careerApps++;
      n.careerGoals += l.goals;
    }
    if (f.national) n.caps++;
    n.form = clamp(n.form * 0.75 + ((l.rating - 3) / 7) * 100 * 0.25, 10, 99);
    if (l.injuryDays > 0) n.injuredUntil = state.day + l.injuryDays;
    if (competitive) {
      if (l.red) n.banned += 1 + (rng.chance(0.3) ? 1 : 0);
      if (l.yellow) {
        n.yellows++;
        if (n.yellows % 5 === 0) n.banned += 1;
      }
    }
  }
  // serve bans: players of both clubs who did not play
  if (competitive && !f.national) {
    for (const teamId of [f.home, f.away]) {
      for (const n of idx.squads.get(teamId) ?? []) if (n.banned > 0 && !out.lines.some((l) => l.id === n.id)) n.banned--;
    }
  }
  if (type === 'cup' || type === 'continental') progressKnockouts(state, rng);
}

// ----- the user's match

export interface UserMatchContext {
  fixture: Fixture;
  lineups: [Lineup, Lineup];
  side: 0 | 1;
  role: MatchRole;
}

export function userMatchContext(state: CareerState, f: Fixture, rng: Rng): UserMatchContext {
  const lineups = lineupsFor(state, f, rng);
  const side: 0 | 1 = f.national ? (isUserNational(state, f.home) ? 0 : 1) : f.home === state.user.clubId ? 0 : 1;
  return { fixture: f, lineups, side, role: lineups[side].userRole };
}

function isUserNational(state: CareerState, id: number): boolean {
  const t = state.nationalTeams.find((n) => n.id === id);
  return !!t && t.nation === state.user.nat;
}

export function userSimInput(state: CareerState, ctx: UserMatchContext): UserSimInput {
  const f = state.user;
  const lu = ctx.lineups[ctx.side];
  const entry = [...lu.starters, ...lu.bench].find((e) => e.npcId === USER_ID);
  const age = userAge(state);
  const risk = 0.00022 * (age > 30 ? 1 + (age - 30) * 0.1 : 1) * (f.fitness < 50 ? 1.5 : 1) * (f.energy < 30 ? 1.6 : 1);
  return {
    side: ctx.side,
    pos: entry?.pos ?? f.pos,
    role: ctx.role === 'start' ? 'start' : 'bench',
    stats: statsToArray(f.stats),
    condition: conditionFactor(f),
    fitness: f.fitness,
    energy: f.energy,
    hothead: hasTrait(f, 'hothead'),
    flair: hasTrait(f, 'flair'),
    subChance: ctx.role === 'bench' ? 0.45 + (f.form - 50) / 250 : 0,
    name: fullName(f),
    injuryRisk: risk,
  };
}

/** SIMULATE for the user's match */
export function simulateUserMatch(state: CareerState, ctx: UserMatchContext, rng: Rng): MatchOutcome {
  const [hl, al] = ctx.lineups;
  const home: SimSideInput = { lineup: hl, name: sideName(state, hl) };
  const away: SimSideInput = { lineup: al, name: sideName(state, al) };
  const ko = needsWinner(state, ctx.fixture);
  if (ctx.role === 'out') return quickSim(rng, home, away, ko, ctx.fixture.national);
  return detailedSim(rng, home, away, ko, userSimInput(state, ctx), ctx.fixture.national);
}

/** applies the user's match (outcome from detailedSim or converted from the 3D engine) */
export function applyUserMatch(state: CareerState, ctx: UserMatchContext, out: MatchOutcome, rng: Rng, played3D: boolean): MatchReport {
  const f = ctx.fixture;
  const [hl, al] = ctx.lineups;
  if (f.youth) trackYouthSelection(state, ctx.role);
  applyOutcome(state, f, out, hl, al, rng);
  const user = state.user;
  const type = compTypeOf(state, f);
  const c = comp(state, f.compId);
  const us = out.user;
  const gf = ctx.side === 0 ? out.hg : out.ag;
  const ga = ctx.side === 0 ? out.ag : out.hg;
  const won = gf > ga || (gf === ga && out.pens !== undefined && (ctx.side === 0 ? out.pens[0] > out.pens[1] : out.pens[1] > out.pens[0]));
  const lost = gf < ga || (gf === ga && out.pens !== undefined && !won);
  const played = !!us && us.minutes > 0;

  if (played && us) {
    const key = lineKey(type);
    if (key) addToLine(user.season[key], us, ctx.role === 'start', ga === 0 && us.minutes >= 60 && (user.pos === 'GK' || ['CB', 'LB', 'RB'].includes(user.pos)));
    if (type !== 'friendly') addToLine(user.totals, us, ctx.role === 'start', false);
    user.ratings.push(us.rating);
    if (user.ratings.length > 12) user.ratings.shift();
    user.form = clamp(user.form * 0.62 + ((us.rating - 3) / 7) * 100 * 0.38, 5, 99);
    matchExperience(state, us.minutes, us.rating);
    const stamina = (user.stats.physical_stamina + user.stats.mental_workrate) / 2;
    user.energy = clamp(user.energy - us.minutes * 0.42 * (1.25 - stamina * 0.45), 0, 100);
    // cards
    if (type !== 'friendly') {
      if (us.red) user.banned += us.yellow >= 2 ? 1 : rng.int(1, 3);
      else if (us.yellow) {
        user.yellows++;
        if (user.yellows % 5 === 0) {
          user.banned++;
          addNotice(state, 'Five bookings: suspended for the next match.', 'bad');
        }
      }
    }
    if (f.national && user.national === 'senior') {
      user.caps++;
      user.intlGoals += us.goals;
    }
    // reputation: bigger stages count more
    const tier = c?.tier ?? 1;
    const stage = type === 'continental' ? 1.6 : type === 'international' ? (user.national === 'senior' ? 1.8 : 0.6) : type === 'league' ? (tier === 1 ? 1 : 0.55) : type === 'cup' ? 0.8 : type === 'youth' ? 0.25 : 0.2;
    const perf = us.rating - 6.4 + us.goals * 0.6 + us.assists * 0.3 + (us.motm ? 0.5 : 0);
    const clubRep = club(state, user.clubId)?.reputation ?? 50;
    const room = (v: number) => Math.max(0.15, 1 - v / 110);
    user.rep.local = clamp(user.rep.local + perf * 0.9 * Math.max(0.3, stage) * (perf > 0 ? room(user.rep.local) : 1), 0, 100);
    user.rep.national = clamp(user.rep.national + perf * 0.5 * stage * (0.4 + clubRep / 130) * (perf > 0 ? room(user.rep.national) : 1), 0, 100);
    if (stage >= 1 || clubRep > 75) user.rep.world = clamp(user.rep.world + perf * 0.3 * stage * Math.pow(clubRep / 90, 2) * (perf > 0 ? room(user.rep.world) : 1), 0, 100);
    const fame = hasTrait(user, 'media') ? 1.5 : 1;
    const baseFans = Math.max(200, (club(state, user.clubId)?.fans ?? 10000) * 0.0005);
    user.followers = Math.round(user.followers + Math.max(0, perf) * baseFans * stage * fame * rng.range(0.5, 1.2) + us.goals * baseFans * 0.6 * fame);
    // money: bonuses from the contract
    if (!f.national && !f.youth && type !== 'friendly' && user.contract.kind !== 'youth') {
      addMoney(state, user.contract.appearanceBonus, 'Appearance bonus');
      if (us.goals > 0) addMoney(state, user.contract.goalBonus * us.goals, 'Goal bonus');
      if (won) addMoney(state, Math.round(user.contract.wage * 0.15), 'Win bonus');
    }
    // relationships
    const coach = state.life.people.find((p) => p.role === 'coach' && !p.gone);
    if (coach && !f.national) bumpAffinity(coach, (us.rating - 6.4) * 1.5);
    if (out.userInjuryDays !== 0) startUserInjury(state, rng, 'match');
  }

  // morale from the result and his involvement
  let dm = won ? 4 : lost ? -4 : 0.5;
  if (played && us) dm += (us.rating - 6.5) * 3 + (us.motm ? 4 : 0);
  else if (ctx.role === 'bench') dm -= hasTrait(user, 'ambitious') ? 4 : 2.5;
  else if (ctx.role === 'out' && !f.youth) dm -= hasTrait(user, 'ambitious') ? 5 : 3;
  if (hasTrait(user, 'resilient') && dm < 0) dm *= 0.7;
  user.morale = clamp(user.morale + dm, 0, 100);
  state.life.happiness.football = clamp(state.life.happiness.football + dm * 0.8, 0, 100);
  if (type !== 'friendly' && !f.youth && !f.national && user.banned > 0 && !played) user.banned = Math.max(0, user.banned - 1);
  if (ctx.role === 'out' && !f.youth && !f.national) state.events.flags.droppedToYouth = state.day;

  refreshMarketValue(state);
  const report = buildReport(state, ctx, out, played3D);
  state.reports.unshift(report);
  if (state.reports.length > 12) state.reports.length = 12;
  const res = won ? 'W' : lost ? 'L' : 'D';
  addTimeline(state, `${report.homeName} ${out.hg}-${out.ag} ${report.awayName}${us && us.minutes > 0 ? ` — rating ${us.rating.toFixed(1)}${us.goals ? `, ${us.goals} goal${us.goals > 1 ? 's' : ''}` : ''}` : ctx.role === 'out' ? ' (not involved)' : ' (unused sub)'}`, res === 'W' ? 'good' : res === 'L' ? 'bad' : 'info');
  reactToMatch(state, report, rng);
  if (us?.motm) addNotice(state, `Player of the match! (${us.rating.toFixed(1)})`, 'gold');
  if (played && us && us.goals >= 3) {
    addNotice(state, `Hat-trick! You take the match ball home.`, 'gold');
    addMessage(state, { from: 'Mum', kind: 'family', subject: 'THREE GOALS!!!', body: 'We watched every minute. Your dad has not stopped shouting. So proud of you. xx' });
  }
  return report;
}

/** development-squad rotation memory: consecutive starts / matches without a start (fit only) */
export function trackYouthSelection(state: CareerState, role: MatchRole): void {
  const flags = state.events.flags;
  if (role === 'start') {
    flags[YOUTH_START_RUN] = (flags[YOUTH_START_RUN] ?? 0) + 1;
    flags[YOUTH_BENCH_RUN] = 0;
  } else if (!state.user.injury && state.user.banned <= 0) {
    flags[YOUTH_BENCH_RUN] = (flags[YOUTH_BENCH_RUN] ?? 0) + 1;
    flags[YOUTH_START_RUN] = 0;
  }
}

function addToLine(line: StatLine, us: UserMatchStats, started: boolean, cleanSheet: boolean): void {
  line.apps++;
  if (started) line.starts++;
  line.mins += us.minutes;
  line.goals += us.goals;
  line.assists += us.assists;
  line.ratingSum += us.rating;
  line.rated++;
  line.yellows += us.yellow;
  line.reds += us.red;
  if (us.motm) line.motm++;
  if (cleanSheet) line.cleanSheets++;
}

export function buildReport(state: CareerState, ctx: UserMatchContext, out: MatchOutcome, played3D: boolean): MatchReport {
  const f = ctx.fixture;
  const c = comp(state, f.compId);
  const homeName = teamName(state, f.home, f.youth);
  const awayName = teamName(state, f.away, f.youth);
  const us = out.user;
  const gf = ctx.side === 0 ? out.hg : out.ag;
  const ga = ctx.side === 0 ? out.ag : out.hg;
  const oppName = ctx.side === 0 ? awayName : homeName;
  const motm = out.motmId === USER_ID ? fullName(state.user) : sideName(state, ctx.lineups[0])(out.motmId) !== 'Unknown' ? sideName(state, ctx.lineups[0])(out.motmId) : sideName(state, ctx.lineups[1])(out.motmId);
  let headline: string;
  if (us && us.goals >= 3) headline = `${state.user.last} hat-trick destroys ${oppName}`;
  else if (us && us.goals === 2) headline = `Brace from ${state.user.last} ${gf > ga ? 'sinks' : 'not enough against'} ${oppName}`;
  else if (us && us.goals === 1 && gf > ga) headline = `${state.user.last} on target as ${gf > ga ? 'victory is sealed' : 'points are shared'} against ${oppName}`;
  else if (us && us.red) headline = `Red card for ${state.user.last} in ${gf > ga ? 'narrow win' : gf < ga ? 'defeat' : 'draw'} with ${oppName}`;
  else if (gf > ga + 2) headline = `Dominant display against ${oppName}`;
  else if (gf > ga) headline = `Hard-fought win over ${oppName}`;
  else if (gf < ga - 2) headline = `Humbling defeat to ${oppName}`;
  else if (gf < ga) headline = `Defeat against ${oppName}`;
  else headline = `Honours even with ${oppName}`;
  if (out.pens) headline += ` (penalties ${out.pens[0]}-${out.pens[1]})`;
  return {
    fixtureId: f.id,
    day: state.day,
    compName: c ? (c.type === 'cup' || c.type === 'continental' ? `${c.name} · ${c.roundNames[f.round] ?? ''}` : c.name) : 'Match',
    homeName,
    awayName,
    home: f.home,
    away: f.away,
    hg: out.hg,
    ag: out.ag,
    pens: out.pens,
    userSide: ctx.side,
    events: out.events.filter((e) => e.type !== 'chance' || e.user),
    user: us && us.minutes > 0 ? us : null,
    role: ctx.role,
    played3D,
    possession: Math.round((ctx.side === 0 ? out.possession : 1 - out.possession) * 100),
    shots: ctx.side === 0 ? out.shots : [out.shots[1], out.shots[0]],
    motmName: motm,
    headline,
    youth: f.youth,
    national: f.national,
  };
}

/** simulates all background fixtures of a day that are still unplayed */
export function playDayFixtures(state: CareerState, day: number, rng: Rng, exceptId?: number): void {
  const list = state.fixtures.filter((f) => f.day === day && !f.played && f.id !== exceptId);
  for (const f of list) {
    if (isUserFixture(state, f)) continue;
    playBackgroundFixture(state, f, rng);
  }
}

export function isUserFixture(state: CareerState, f: Fixture): boolean {
  const u = state.user;
  if (f.national) return state.nationalTeams.some((n) => (n.id === f.home || n.id === f.away) && n.nation === u.nat && n.level === u.national);
  if (f.youth) return (f.home === u.clubId || f.away === u.clubId) && userInYouthSide(state, f.day);
  return f.home === u.clubId || f.away === u.clubId;
}

/**
 * The user plays development-squad football when he belongs to the youth squad, or when a young
 * first-team player was left out of the senior matchday squad that weekend.
 */
export function userInYouthSide(state: CareerState, day: number): boolean {
  const u = state.user;
  if (u.squad === 'youth') return true;
  return userAge(state) < 21.5 && (state.events.flags.droppedToYouth ?? -99) >= day - 3;
}

/** the next fixture the user is (potentially) involved in */
export function nextUserFixture(state: CareerState): Fixture | undefined {
  let best: Fixture | undefined;
  for (const f of state.fixtures) {
    if (f.played || f.day < state.day) continue;
    if (!isUserFixture(state, f)) continue;
    if (f.youth && !userInYouthSide(state, f.day) && state.user.squad !== 'youth') continue;
    if (!best || f.day < best.day || (f.day === best.day && f.slot < best.slot)) best = f;
  }
  return best;
}

export function userClubResults(state: CareerState, compId: string): Fixture[] {
  return fixturesOf(state, compId).filter((f) => f.played && (f.home === state.user.clubId || f.away === state.user.clubId));
}

export { isNationalId };
