// Seasons and competitions: the season calendar (pre-season, league weekends, midweek cup nights,
// international windows, winter break, summer break), fixture generation (double round robin
// with the circle method), domestic cups and the continental cup as knockouts drawn round by
// round, the user's development (youth) league and pre-season friendlies, and standings.

import { dayOf, nextWeekday, ymd } from './dates';
import { club, comp, fixturesOf, invalidateFixtures } from './index';
import { Rng } from './rng';
import type { CareerState, Competition, Fixture, Id, NationalLevel } from './types';
import { nationName } from './data/geography';

export const NATIONAL_ID_BASE = 100000;
export const NATIONAL_LEVELS: NationalLevel[] = ['senior', 'U21', 'U19', 'U17'];

export function isNationalId(id: Id): boolean {
  return id >= NATIONAL_ID_BASE;
}

// ----- calendar

export interface SeasonCalendar {
  season: number;
  preseasonStart: number;
  leagueStart: number;
  leagueEnd: number;
  /** Mondays of the international weeks (no league football that weekend) */
  intlWeeks: number[];
  winterBreak: [number, number];
  cupDays: number[];
  continentalDays: number[];
  continentalLegs: number[];
  cupFinal: number;
  continentalFinal: number;
  summerBreak: number;
}

const calendarCache = new Map<number, SeasonCalendar>();

export function seasonCalendar(season: number): SeasonCalendar {
  let c = calendarCache.get(season);
  if (c) return c;
  const y = season;
  const leagueStart = nextWeekday(dayOf(y, 8, 8), 5); // a Saturday in the 2nd week of August
  const leagueEnd = nextWeekday(dayOf(y + 1, 5, 17), 5);
  const intlWeeks = [nextWeekday(dayOf(y, 9, 1), 0), nextWeekday(dayOf(y, 10, 6), 0), nextWeekday(dayOf(y, 11, 10), 0), nextWeekday(dayOf(y + 1, 3, 20), 0), nextWeekday(dayOf(y + 1, 6, 1), 0)];
  const wed = (m: number, d: number, yy = y) => nextWeekday(dayOf(yy, m, d), 2);
  const tue = (m: number, d: number, yy = y) => nextWeekday(dayOf(yy, m, d), 1);
  c = {
    season,
    preseasonStart: dayOf(y, 7, 1),
    leagueStart,
    leagueEnd,
    intlWeeks,
    winterBreak: [dayOf(y, 12, 22), dayOf(y + 1, 1, 9)],
    cupDays: [wed(8, 25), wed(9, 22), wed(10, 27), wed(1, 13, y + 1), wed(2, 24, y + 1), nextWeekday(dayOf(y + 1, 5, 23), 5)],
    continentalDays: [tue(10, 19), tue(2, 15, y + 1), tue(4, 5, y + 1), nextWeekday(dayOf(y + 1, 5, 29), 5)],
    continentalLegs: [tue(11, 2), tue(3, 1, y + 1), tue(4, 19, y + 1), 0],
    cupFinal: nextWeekday(dayOf(y + 1, 5, 23), 5),
    continentalFinal: nextWeekday(dayOf(y + 1, 5, 29), 5),
    summerBreak: dayOf(y + 1, 6, 1),
  };
  if (c.continentalFinal === c.cupFinal) c.continentalFinal += 7;
  calendarCache.set(season, c);
  return c;
}

export function isInternationalWeek(day: number, cal: SeasonCalendar): boolean {
  return cal.intlWeeks.some((w) => day >= w - 2 && day <= w + 6);
}

/** Thursday and Sunday of an international week */
export function internationalMatchDays(weekMonday: number): [number, number] {
  return [weekMonday + 3, weekMonday + 6];
}

// ----- round robin

/** circle method: returns rounds of [home, away] pairs, second half mirrored */
export function roundRobin(teams: Id[], rng: Rng): [Id, Id][][] {
  const list = [...teams];
  if (list.length % 2 === 1) list.push(-1);
  rng.shuffle(list);
  const n = list.length;
  const rounds: [Id, Id][][] = [];
  const fixed = list[0];
  let rest = list.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const round: [Id, Id][] = [];
    const cur = [fixed, ...rest];
    for (let i = 0; i < n / 2; i++) {
      const a = cur[i];
      const b = cur[n - 1 - i];
      if (a < 0 || b < 0) continue;
      // alternate venues so nobody plays 3 home games in a row too often
      round.push((r + i) % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(round);
    rest = [rest[rest.length - 1], ...rest.slice(0, -1)];
  }
  const second = rounds.map((round) => round.map(([h, a]) => [a, h] as [Id, Id]));
  return [...rounds, ...second];
}

/** available league dates: Saturdays outside international weeks and the winter break, plus midweeks if needed */
export function leagueDates(cal: SeasonCalendar, rounds: number, winterBreak: boolean): { day: number; slot: 1 | 2 }[] {
  const sats: number[] = [];
  for (let d = cal.leagueStart; d <= cal.leagueEnd; d += 7) {
    if (isInternationalWeek(d, cal)) continue;
    if (winterBreak && d >= cal.winterBreak[0] && d <= cal.winterBreak[1]) continue;
    if (d === cal.cupFinal) continue;
    sats.push(d);
  }
  const dates: { day: number; slot: 1 | 2 }[] = sats.map((d) => ({ day: d, slot: 1 }));
  if (!winterBreak) {
    // the festive programme: Boxing Day and New Year's Day
    const y = ymd(cal.winterBreak[0]).y;
    for (const d of [dayOf(y, 12, 26), dayOf(y + 1, 1, 1)]) if (!dates.some((x) => Math.abs(x.day - d) < 2)) dates.push({ day: d, slot: 1 });
  }
  // midweek rounds (Wednesdays between busy weekends, avoiding cup nights)
  const midweeks: number[] = [];
  for (let d = nextWeekday(cal.leagueStart + 1, 2); d < cal.leagueEnd; d += 7) {
    if (cal.cupDays.includes(d) || cal.continentalDays.includes(d - 1) || cal.continentalLegs.includes(d - 1)) continue;
    if (isInternationalWeek(d, cal)) continue;
    if (winterBreak && d >= cal.winterBreak[0] && d <= cal.winterBreak[1]) continue;
    midweeks.push(d);
  }
  const needed = rounds - dates.length;
  if (needed > 0 && midweeks.length > 0) {
    // spread the extra midweek rounds evenly through the season
    const step = midweeks.length / needed;
    const picked = new Set<number>();
    for (let i = 0; i < needed && i < midweeks.length; i++) picked.add(Math.min(midweeks.length - 1, Math.floor(i * step + step / 2)));
    for (const i of picked) dates.push({ day: midweeks[i], slot: 2 });
  }
  dates.sort((a, b) => a.day - b.day);
  if (dates.length > rounds) {
    // drop surplus dates evenly (keep the calendar compact at the end of the season)
    while (dates.length > rounds) dates.splice(dates.length - 2, 1);
  }
  return dates;
}

function addFixture(state: CareerState, f: Omit<Fixture, 'id' | 'hg' | 'ag' | 'played'>): Fixture {
  const fx: Fixture = { id: state.nextFixtureId++, hg: 0, ag: 0, played: false, ...f };
  state.fixtures.push(fx);
  return fx;
}

// ----- season setup

export function leagueCompId(leagueId: Id, season: number): string {
  return `L${leagueId}-${season}`;
}
export function cupCompId(countryKey: string, season: number): string {
  return `C${countryKey}-${season}`;
}
export function continentalCompId(season: number): string {
  return `EU-${season}`;
}
export function youthCompId(countryKey: string, season: number): string {
  return `Y${countryKey}-${season}`;
}
export function friendlyCompId(season: number): string {
  return `F-${season}`;
}

export const CONTINENTAL_NAME = 'Continental Champions Cup';

/** creates all competitions and fixtures of a season */
export function createSeason(state: CareerState, season: number, rng: Rng): void {
  const cal = seasonCalendar(season);
  state.comps = [];
  state.fixtures = [];

  for (const lg of state.world.leagues) {
    const country = state.world.countries.find((c) => c.key === lg.countryKey)!;
    const compId = leagueCompId(lg.id, season);
    state.comps.push({ id: compId, type: 'league', name: lg.name, shortName: lg.name, season, countryKey: lg.countryKey, leagueId: lg.id, tier: lg.tier, teamIds: [...lg.clubIds], round: 0, roundNames: [], alive: [], finished: false, winnerId: null, roundDays: [] });
    const rounds = roundRobin(lg.clubIds, rng);
    const dates = leagueDates(cal, rounds.length, country.winterBreak);
    rounds.forEach((pairs, r) => {
      const date = dates[Math.min(r, dates.length - 1)];
      for (const [home, away] of pairs) addFixture(state, { compId, round: r, day: date.day, slot: date.slot, home, away });
    });
  }

  // domestic cups: all clubs of both tiers, preliminary round for the lowest seeds
  for (const country of state.world.countries) {
    const clubs = country.leagueIds.flatMap((id) => state.world.leagues[id].clubIds);
    const compId = cupCompId(country.key, season);
    const names = ['Preliminary round', 'Round of 32', 'Round of 16', 'Quarter-finals', 'Semi-finals', 'Final'];
    const cup: Competition = { id: compId, type: 'cup', name: country.cupName, shortName: country.cupName, season, countryKey: country.key, teamIds: clubs, round: 0, roundNames: names, alive: [...clubs], finished: false, winnerId: null, roundDays: cal.cupDays };
    state.comps.push(cup);
    drawKnockoutRound(state, cup, rng);
  }

  // continental cup: last season's qualifiers (or the biggest clubs in the first season)
  let qualified = state.continentalQualified.filter((id) => state.world.clubs[id]);
  if (qualified.length < 16) {
    const extra = [...state.world.clubs]
      .filter((c) => state.world.leagues[c.leagueId].tier === 1 && !qualified.includes(c.id))
      .sort((a, b) => b.reputation - a.reputation)
      .slice(0, 16 - qualified.length)
      .map((c) => c.id);
    qualified = [...qualified, ...extra];
  }
  qualified = qualified.slice(0, 16);
  const eu: Competition = { id: continentalCompId(season), type: 'continental', name: CONTINENTAL_NAME, shortName: 'Champions Cup', season, teamIds: qualified, round: 0, roundNames: ['Round of 16', 'Quarter-finals', 'Semi-finals', 'Final'], alive: [...qualified], finished: false, winnerId: null, twoLegs: true, roundDays: cal.continentalDays, legDays: cal.continentalLegs };
  state.comps.push(eu);
  drawKnockoutRound(state, eu, rng);

  createUserSeasonFixtures(state, season, rng);
  invalidateFixtures(state);
}

/** the user's development league and pre-season friendlies */
export function createUserSeasonFixtures(state: CareerState, season: number, rng: Rng): void {
  const cal = seasonCalendar(season);
  const userClub = club(state, state.user.clubId);
  if (!userClub) return;
  const country = userClub.countryKey;
  const topClubs = state.world.leagues.filter((l) => l.countryKey === country).flatMap((l) => l.clubIds);
  const others = rng.shuffle(topClubs.filter((id) => id !== userClub.id)).sort((a, b) => state.world.clubs[b].youthRating - state.world.clubs[a].youthRating).slice(0, 13);
  const teams = [userClub.id, ...rng.shuffle(others).slice(0, 11)];
  const yId = youthCompId(country, season);
  if (!comp(state, yId) && !state.comps.some((c) => c.id === yId)) {
    state.comps.push({ id: yId, type: 'youth', name: `${state.world.countries.find((c) => c.key === country)!.demonym} U19 League`, shortName: 'U19 League', season, countryKey: country, teamIds: teams, round: 0, roundNames: [], alive: [], finished: false, winnerId: null, roundDays: [] });
    const rounds = roundRobin(teams, rng);
    const sundays: number[] = [];
    for (let d = nextWeekday(dayOf(season, 9, 1), 6); d <= cal.leagueEnd + 1; d += 7) {
      if (isInternationalWeek(d, cal) && d < cal.intlWeeks[cal.intlWeeks.length - 1]) continue;
      if (d >= cal.winterBreak[0] - 3 && d <= cal.winterBreak[1] + 3) continue;
      sundays.push(d);
    }
    rounds.forEach((pairs, r) => {
      const day = sundays[Math.min(r, sundays.length - 1)];
      for (const [home, away] of pairs) addFixture(state, { compId: yId, round: r, day, slot: 1, home, away, youth: true });
    });
  }
  // pre-season friendlies against clubs from other leagues
  const fId = friendlyCompId(season);
  if (!state.comps.some((c) => c.id === fId)) state.comps.push({ id: fId, type: 'friendly', name: 'Pre-season friendly', shortName: 'Friendly', season, teamIds: [], round: 0, roundNames: [], alive: [], finished: false, winnerId: null, roundDays: [] });
  const pool = state.world.clubs.filter((c) => c.id !== userClub.id && Math.abs(c.reputation - userClub.reputation) < 25);
  const start = Math.max(state.day + 1, dayOf(season, 7, 11));
  for (let i = 0; i < 3; i++) {
    const day = nextWeekday(start + i * 7, 5);
    if (day >= cal.leagueStart - 2) break;
    const opp = rng.pick(pool);
    addFixture(state, { compId: fId, round: i, day, slot: 1, home: rng.chance(0.5) ? userClub.id : opp.id, away: 0, youth: false });
    const f = state.fixtures[state.fixtures.length - 1];
    if (f.home === userClub.id) f.away = opp.id;
    else f.away = userClub.id;
  }
}

// ----- knockouts

/** draws the current round of a knockout competition and creates its fixtures */
export function drawKnockoutRound(state: CareerState, c: Competition, rng: Rng): void {
  const r = c.round;
  const day = c.roundDays[r];
  let teams = rng.shuffle([...c.alive]);
  if (c.type === 'cup' && r === 0) {
    // preliminary round: the lowest-reputation clubs play off to leave 32
    const excess = teams.length - 32;
    if (excess > 0) {
      teams.sort((a, b) => state.world.clubs[a].reputation - state.world.clubs[b].reputation);
      const playing = teams.slice(0, excess * 2);
      const byes = teams.slice(excess * 2);
      c.alive = [...byes];
      teams = rng.shuffle(playing);
      (c as Competition & { byes?: Id[] }).byes = byes;
    } else {
      c.round = 1;
      drawKnockoutRound(state, c, rng);
      return;
    }
  }
  const isFinal = r === c.roundNames.length - 1;
  for (let i = 0; i + 1 < teams.length; i += 2) {
    const home = teams[i];
    const away = teams[i + 1];
    const slot = new Date(day * 86400000).getUTCDay() === 6 ? 1 : 2;
    const first = addFixture(state, { compId: c.id, round: r, day, slot, home, away });
    if (c.twoLegs && !isFinal && c.legDays && c.legDays[r]) addFixture(state, { compId: c.id, round: r, day: c.legDays[r], slot: 2, home: away, away: home, firstLeg: first.id });
  }
  invalidateFixtures(state);
}

/** advances knockout competitions whose current round is complete */
export function progressKnockouts(state: CareerState, rng: Rng): void {
  for (const c of state.comps) {
    if (c.finished || (c.type !== 'cup' && c.type !== 'continental')) continue;
    const round = fixturesOf(state, c.id).filter((f) => f.round === c.round);
    if (round.length === 0 || round.some((f) => !f.played)) continue;
    const winners: Id[] = [];
    for (const f of round) {
      if (c.twoLegs && f.firstLeg === undefined && round.some((g) => g.firstLeg === f.id)) continue; // first legs decided with the second
      winners.push(tieWinner(state, f));
    }
    const byes = (c as Competition & { byes?: Id[] }).byes;
    if (c.type === 'cup' && c.round === 0 && byes) {
      c.alive = [...byes, ...winners];
      delete (c as Competition & { byes?: Id[] }).byes;
    } else c.alive = winners;
    if (c.alive.length <= 1 || c.round >= c.roundNames.length - 1) {
      c.finished = true;
      c.winnerId = c.alive[0] ?? null;
      const final = round[round.length - 1];
      c.runnerUpId = final ? (final.home === c.winnerId ? final.away : final.home) : null;
      continue;
    }
    c.round++;
    drawKnockoutRound(state, c, rng);
  }
}

/** winner of a single match or of a two-legged tie (given its deciding fixture) */
export function tieWinner(state: CareerState, f: Fixture): Id {
  if (f.firstLeg !== undefined) {
    const first = state.fixtures.find((x) => x.id === f.firstLeg)!;
    // aggregate: f.home was first.away
    const aggHome = f.hg + first.ag;
    const aggAway = f.ag + first.hg;
    if (aggHome !== aggAway) return aggHome > aggAway ? f.home : f.away;
    if (f.pens) return f.pens[0] > f.pens[1] ? f.home : f.away;
    return f.home;
  }
  if (f.hg !== f.ag) return f.hg > f.ag ? f.home : f.away;
  if (f.pens) return f.pens[0] > f.pens[1] ? f.home : f.away;
  return f.home;
}

/** true when a draw in this fixture must be settled by extra time / penalties */
export function needsWinner(state: CareerState, f: Fixture): { needed: boolean; aggregate?: [number, number] } {
  const c = comp(state, f.compId);
  if (!c || (c.type !== 'cup' && c.type !== 'continental' && c.type !== 'international')) return { needed: false };
  if (c.type === 'international' && f.round < 3) return { needed: false };
  if (c.twoLegs) {
    if (f.firstLeg === undefined) {
      const hasSecond = state.fixtures.some((x) => x.firstLeg === f.id);
      if (hasSecond) return { needed: false };
      return { needed: true };
    }
    const first = state.fixtures.find((x) => x.id === f.firstLeg)!;
    return { needed: true, aggregate: [first.ag, first.hg] };
  }
  return { needed: true };
}

// ----- standings

export interface TableRow {
  clubId: Id;
  p: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  pts: number;
  form: ('W' | 'D' | 'L')[];
}

export function standings(state: CareerState, compId: string): TableRow[] {
  const c = comp(state, compId);
  if (!c) return [];
  const rows = new Map<Id, TableRow>();
  for (const id of c.teamIds) rows.set(id, { clubId: id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, form: [] });
  const played = fixturesOf(state, compId)
    .filter((f) => f.played)
    .sort((a, b) => a.day - b.day);
  for (const f of played) {
    const h = rows.get(f.home);
    const a = rows.get(f.away);
    if (!h || !a) continue;
    h.p++;
    a.p++;
    h.gf += f.hg;
    h.ga += f.ag;
    a.gf += f.ag;
    a.ga += f.hg;
    if (f.hg > f.ag) {
      h.w++;
      h.pts += 3;
      a.l++;
      h.form.push('W');
      a.form.push('L');
    } else if (f.hg < f.ag) {
      a.w++;
      a.pts += 3;
      h.l++;
      h.form.push('L');
      a.form.push('W');
    } else {
      h.d++;
      a.d++;
      h.pts++;
      a.pts++;
      h.form.push('D');
      a.form.push('D');
    }
  }
  const list = [...rows.values()];
  for (const r of list) r.form = r.form.slice(-5);
  list.sort((x, y) => y.pts - x.pts || y.gf - y.ga - (x.gf - x.ga) || y.gf - x.gf || state.world.clubs[x.clubId].name.localeCompare(state.world.clubs[y.clubId].name));
  return list;
}

// ----- names

export function nationalTeamName(state: CareerState, id: Id): string {
  const t = state.nationalTeams.find((n) => n.id === id);
  if (!t) return 'National team';
  const base = nationName(t.nation);
  return t.level === 'senior' ? base : `${base} ${t.level}`;
}

export function teamName(state: CareerState, id: Id, youth = false): string {
  if (isNationalId(id)) return nationalTeamName(state, id);
  const c = state.world.clubs[id];
  if (!c) return '—';
  return youth ? `${c.name} U19` : c.name;
}

export function teamShort(state: CareerState, id: Id): string {
  if (isNationalId(id)) {
    const t = state.nationalTeams.find((n) => n.id === id);
    return t ? t.nation : 'NAT';
  }
  return state.world.clubs[id]?.shortName ?? '—';
}
