// National teams: U17 / U19 / U21 / senior sides for every nation. At each international window
// the federation picks its squads: the user is called up when his rating (plus form and
// reputation) beats the level's bar — for the senior side that bar is the 23rd best player of his
// nationality in the world. Called-up players play two internationals that week; in even summers
// senior squads go to a 16-team tournament (group stage + knockouts).

import { abilityForOvr, ovrScale } from './attributes';
import { NATIONAL_ID_BASE, NATIONAL_LEVELS, internationalMatchDays, seasonCalendar } from './competitions';
import { COUNTRIES, NATIONS, nationName } from './data/geography';
import { dayOf, formatDate, nextWeekday } from './dates';
import { fullName, userAge, userOvr } from './footballer';
import { fixturesOf, invalidateFixtures } from './index';
import { addMessage, addNotice, addTimeline } from './messages';
import { createNpc } from './players';
import { Rng, clamp } from './rng';
import { selectLineup, type Lineup } from './selection';
import type { CareerState, Competition, Fixture, Id, NPC, NationalLevel } from './types';

const LEVEL_OFFSET: Record<NationalLevel, number> = { senior: 0, U21: 9, U19: 15, U17: 21, none: 30 };
const LEVEL_MAX_AGE: Record<NationalLevel, number> = { senior: 99, U21: 21.9, U19: 19.9, U17: 17.9, none: 0 };

export function initNationalTeams(state: CareerState): void {
  const keys = [...COUNTRIES.map((c) => c.key), ...NATIONS.map((n) => n.key)];
  state.nationalTeams = [];
  keys.forEach((nation, i) => {
    NATIONAL_LEVELS.forEach((level, j) => {
      state.nationalTeams.push({ id: NATIONAL_ID_BASE + i * 4 + j, nation, level, strength: 60 });
    });
  });
  refreshNationalStrengths(state);
}

/** senior strength from the best NPCs of the nationality (or the nation's base strength) */
export function refreshNationalStrengths(state: CareerState): void {
  const byNation = new Map<string, number[]>();
  for (const n of state.world.npcs) {
    if (n.clubId < 0) continue;
    let l = byNation.get(n.nat);
    if (!l) byNation.set(n.nat, (l = []));
    l.push(n.ovr);
  }
  for (const t of state.nationalTeams) {
    const list = (byNation.get(t.nation) ?? []).sort((a, b) => b - a);
    const def = NATIONS.find((n) => n.key === t.nation);
    const base = def ? ovrScale(def.strength) : 70;
    const fromPlayers = list.length >= 11 ? list.slice(0, 11).reduce((a, b) => a + b, 0) / 11 : base;
    const senior = list.length >= 11 ? fromPlayers * 0.8 + base * 0.2 * (def ? 1 : 0) + (def ? 0 : fromPlayers * 0.2) : base;
    t.strength = senior - LEVEL_OFFSET[t.level];
  }
}

export function nationalTeamOf(state: CareerState, nation: string, level: NationalLevel): Id {
  return state.nationalTeams.find((t) => t.nation === nation && t.level === level)?.id ?? -1;
}

/** NPCs of a nationality, best first */
function nationalPool(state: CareerState, nation: string): NPC[] {
  return state.world.npcs.filter((n) => n.nat === nation && n.clubId >= 0 && n.squad === 'first').sort((a, b) => b.ovr - a.ovr);
}

const virtualCache = new Map<string, NPC[]>();

/** a throwaway squad for a national side without enough real players (youth levels, small nations) */
function virtualSquad(state: CareerState, id: Id): NPC[] {
  const key = `${state.seed}:${state.season}:${id}`;
  let squad = virtualCache.get(key);
  if (squad) return squad;
  const t = state.nationalTeams.find((x) => x.id === id)!;
  const rng = new Rng(key);
  const positions = ['GK', 'GK', 'CB', 'CB', 'CB', 'CB', 'LB', 'RB', 'DM', 'CM', 'CM', 'CM', 'AM', 'LM', 'RM', 'CF', 'CF', 'CF'] as const;
  const age = t.level === 'U17' ? 16 : t.level === 'U19' ? 18 : t.level === 'U21' ? 20 : 26;
  squad = positions.map((pos, i) => {
    const n = createNpc(rng, { id: -2000 - i - (id % 1000) * 20, nat: t.nation, pos, clubId: -1, squad: 'first', born: state.day - Math.round((age + rng.range(0, 1.8)) * 365.25), peak: 0.5, day: state.day, contractEnd: 0, wage: 0 });
    // set the rating directly: virtual players are calibrated to the team strength
    const target = t.strength + rng.gauss(0, 3);
    n.ovr = target;
    n.ability = clamp(abilityForOvr(target), 0.2, 0.95);
    return n;
  });
  if (virtualCache.size > 200) virtualCache.clear();
  virtualCache.set(key, squad);
  return squad;
}

export function buildNationalLineup(state: CareerState, id: Id, rng: Rng): Lineup {
  const t = state.nationalTeams.find((x) => x.id === id)!;
  const userIn = t.nation === state.user.nat && t.level === state.user.national;
  let pool: NPC[];
  let virtual: NPC[] | undefined;
  if (t.level === 'senior') {
    const real = nationalPool(state, t.nation).slice(0, 23);
    if (real.length >= 16) pool = real;
    else {
      virtual = virtualSquad(state, id);
      pool = [...real, ...virtual].sort((a, b) => b.ovr - a.ovr).slice(0, 23);
    }
  } else {
    virtual = virtualSquad(state, id);
    pool = virtual;
  }
  const lineup = selectLineup(state, id, { pool, userEligible: userIn && !state.user.injury, formation: '4-3-3', seed: rng.seed() });
  lineup.virtual = virtual;
  return lineup;
}

/** which level the user would be picked for, if any */
export function evaluateCallUp(state: CareerState, rng: Rng): NationalLevel {
  const f = state.user;
  if (f.injury) return 'none';
  const age = userAge(state);
  const ovr = userOvr(f) + (f.form - 55) / 12 + f.rep.national / 25 + rng.gauss(0, 1.2);
  // senior: beat the 23rd best of his nationality
  const pool = nationalPool(state, f.nat);
  const seniorId = nationalTeamOf(state, f.nat, 'senior');
  const senior = state.nationalTeams.find((t) => t.id === seniorId)!;
  const bar = pool.length >= 23 ? pool[22].ovr : senior.strength - 6;
  if (ovr >= bar && age >= 17) return 'senior';
  for (const level of ['U21', 'U19', 'U17'] as NationalLevel[]) {
    if (age > LEVEL_MAX_AGE[level]) continue;
    // youth levels: the youngest eligible level with a bar relative to its strength
    const t = state.nationalTeams.find((x) => x.nation === f.nat && x.level === level)!;
    const minAge = level === 'U17' ? 0 : level === 'U19' ? 16.5 : 18;
    if (age < minAge) continue;
    if (ovr >= t.strength - 1) return level;
  }
  return 'none';
}

/** called on the Monday before each international window */
export function internationalWindow(state: CareerState, weekMonday: number, rng: Rng): void {
  const f = state.user;
  const cal = seasonCalendar(state.season);
  const isJune = weekMonday === cal.intlWeeks[4];
  const tournamentYear = (state.season + 1) % 2 === 0;
  const level = evaluateCallUp(state, rng);
  const prev = f.national;
  f.national = level === 'none' && prev === 'senior' ? (rng.chance(0.4) ? 'senior' : 'none') : level;
  if (f.national === 'none') {
    if (prev !== 'none') addNotice(state, `Left out of the ${nationName(f.nat)} ${prev === 'senior' ? '' : prev + ' '}squad this time.`, 'bad');
    return;
  }
  if (isJune && tournamentYear && f.national === 'senior') {
    startTournament(state, rng);
    return;
  }
  const teamId = nationalTeamOf(state, f.nat, f.national);
  const levelName = f.national === 'senior' ? '' : ` ${f.national}`;
  const first = prev !== f.national;
  addMessage(state, {
    from: `${nationName(f.nat)} Football Federation`,
    kind: 'national',
    subject: first ? `Call-up: ${nationName(f.nat)}${levelName}` : `Squad announcement: ${nationName(f.nat)}${levelName}`,
    body: first ? `Congratulations! You have been selected for the ${nationName(f.nat)}${levelName} squad for the upcoming international matches. Report to the national training centre on ${formatDate(weekMonday)}.` : `You are in the squad again for this international window.`,
  });
  if (first) {
    addNotice(state, `Called up to ${nationName(f.nat)}${levelName}!`, 'gold');
    addTimeline(state, `International call-up: ${nationName(f.nat)}${levelName}`, 'good');
    f.morale = clamp(f.morale + 8, 0, 100);
    f.rep.national = clamp(f.rep.national + (f.national === 'senior' ? 6 : 2), 0, 100);
    state.life.happiness.family = clamp(state.life.happiness.family + 5, 0, 100);
  }
  const compId = `INT-${state.season}-${f.national}`;
  if (!state.comps.some((c) => c.id === compId)) {
    state.comps.push({ id: compId, type: 'international', name: f.national === 'senior' ? 'International' : `${f.national} International`, shortName: 'International', season: state.season, teamIds: [], round: 0, roundNames: [], alive: [], finished: false, winnerId: null, roundDays: [], level: f.national });
  }
  const opponents = state.nationalTeams.filter((t) => t.level === f.national && t.nation !== f.nat);
  const [d1, d2] = internationalMatchDays(weekMonday);
  for (const d of [d1, d2]) {
    const opp = rng.weighted(opponents, (t) => 1 / (1 + Math.abs(t.strength - (state.nationalTeams.find((x) => x.id === teamId)?.strength ?? 70)) / 6));
    const home = rng.chance(0.5);
    state.fixtures.push({ id: state.nextFixtureId++, compId, round: 0, day: d, slot: d === d1 ? 2 : 1, home: home ? teamId : opp.id, away: home ? opp.id : teamId, hg: 0, ag: 0, played: false, national: true });
  }
  invalidateFixtures(state);
}

// ----- summer tournaments

export function tournamentName(year: number): string {
  return year % 4 === 2 ? 'World Championship' : 'Continental Championship';
}

function startTournament(state: CareerState, rng: Rng): void {
  const f = state.user;
  const year = state.season + 1;
  const compId = `TOUR-${year}`;
  if (state.comps.some((c) => c.id === compId)) return;
  const seniors = state.nationalTeams.filter((t) => t.level === 'senior').sort((a, b) => b.strength - a.strength);
  const userTeam = nationalTeamOf(state, f.nat, 'senior');
  const teams = [userTeam, ...seniors.filter((t) => t.id !== userTeam).slice(0, 15).map((t) => t.id)];
  const name = tournamentName(year);
  const c: Competition = { id: compId, type: 'international', name, shortName: name, season: state.season, teamIds: teams, round: 0, roundNames: ['Group stage 1', 'Group stage 2', 'Group stage 3', 'Quarter-finals', 'Semi-finals', 'Final'], alive: [...teams], finished: false, winnerId: null, roundDays: [dayOf(year, 6, 6), dayOf(year, 6, 10), dayOf(year, 6, 14), dayOf(year, 6, 19), dayOf(year, 6, 23), dayOf(year, 6, 27)], level: 'senior' };
  state.comps.push(c);
  // pots by strength -> 4 groups of 4
  const sorted = [...teams].sort((a, b) => strengthOf(state, b) - strengthOf(state, a));
  const groups: Id[][] = [[], [], [], []];
  for (let pot = 0; pot < 4; pot++) {
    const potTeams = rng.shuffle(sorted.slice(pot * 4, pot * 4 + 4));
    potTeams.forEach((t, g) => groups[g].push(t));
  }
  (c as Competition & { groups?: Id[][] }).groups = groups;
  const pairs = [
    [0, 1, 2, 3],
    [0, 2, 1, 3],
    [0, 3, 1, 2],
  ];
  for (let r = 0; r < 3; r++) {
    for (const g of groups) {
      const [a, b, x, y] = pairs[r];
      for (const [h, aw] of [
        [g[a], g[b]],
        [g[x], g[y]],
      ]) {
        state.fixtures.push({ id: state.nextFixtureId++, compId, round: r, day: c.roundDays[r], slot: 2, home: h, away: aw, hg: 0, ag: 0, played: false, national: true });
      }
    }
  }
  invalidateFixtures(state);
  addMessage(state, { from: `${nationName(f.nat)} Football Federation`, kind: 'national', subject: `${name} squad`, body: `You have been named in the ${nationName(f.nat)} squad for the ${name}! The group stage starts on ${formatDate(c.roundDays[0])}.` });
  addNotice(state, `Selected for the ${name}!`, 'gold');
  f.morale = clamp(f.morale + 10, 0, 100);
}

function strengthOf(state: CareerState, id: Id): number {
  return state.nationalTeams.find((t) => t.id === id)?.strength ?? 60;
}

/** draws the tournament knockout rounds once the previous stage is complete */
export function progressTournament(state: CareerState, rng: Rng): void {
  for (const c of state.comps) {
    if (!c.id.startsWith('TOUR-') || c.finished) continue;
    const fx = fixturesOf(state, c.id);
    const cur = fx.filter((x) => x.round === c.round);
    if (cur.length === 0 || cur.some((x) => !x.played)) continue;
    if (c.round < 2) {
      c.round++;
      continue;
    }
    let next: [Id, Id][] = [];
    if (c.round === 2) {
      const groups = (c as Competition & { groups?: Id[][] }).groups ?? [];
      const ranked = groups.map((g) => rankGroup(fx.filter((x) => x.round < 3 && g.includes(x.home)), g));
      next = [
        [ranked[0][0], ranked[1][1]],
        [ranked[1][0], ranked[0][1]],
        [ranked[2][0], ranked[3][1]],
        [ranked[3][0], ranked[2][1]],
      ];
    } else {
      const winners = cur.map((x) => winnerOf(x));
      if (c.round === 5 || winners.length === 1) {
        c.finished = true;
        c.winnerId = winners[0];
        const fin = cur[0];
        c.runnerUpId = fin.home === c.winnerId ? fin.away : fin.home;
        continue;
      }
      for (let i = 0; i + 1 < winners.length; i += 2) next.push([winners[i], winners[i + 1]]);
    }
    c.round++;
    for (const [h, a] of next) state.fixtures.push({ id: state.nextFixtureId++, compId: c.id, round: c.round, day: c.roundDays[c.round], slot: 2, home: h, away: a, hg: 0, ag: 0, played: false, national: true });
    invalidateFixtures(state);
    void rng;
  }
}

function winnerOf(f: Fixture): Id {
  if (f.hg !== f.ag) return f.hg > f.ag ? f.home : f.away;
  if (f.pens) return f.pens[0] > f.pens[1] ? f.home : f.away;
  return f.home;
}

function rankGroup(fx: Fixture[], group: Id[]): Id[] {
  const pts = new Map<Id, [number, number, number]>();
  for (const id of group) pts.set(id, [0, 0, 0]);
  for (const f of fx) {
    const h = pts.get(f.home);
    const a = pts.get(f.away);
    if (!h || !a) continue;
    h[1] += f.hg - f.ag;
    a[1] += f.ag - f.hg;
    h[2] += f.hg;
    a[2] += f.ag;
    if (f.hg > f.ag) h[0] += 3;
    else if (f.hg < f.ag) a[0] += 3;
    else {
      h[0]++;
      a[0]++;
    }
  }
  return [...group].sort((x, y) => {
    const a = pts.get(x)!;
    const b = pts.get(y)!;
    return b[0] - a[0] || b[1] - a[1] || b[2] - a[2];
  });
}

export function tournamentGroups(state: CareerState, compId: string): { teams: Id[]; table: { id: Id; pts: number; gd: number; gf: number; p: number }[] }[] {
  const c = state.comps.find((x) => x.id === compId) as (Competition & { groups?: Id[][] }) | undefined;
  if (!c?.groups) return [];
  const fx = fixturesOf(state, compId).filter((x) => x.round < 3 && x.played);
  return c.groups.map((g) => {
    const table = g.map((id) => {
      let pts = 0,
        gd = 0,
        gf = 0,
        p = 0;
      for (const f of fx) {
        if (f.home !== id && f.away !== id) continue;
        p++;
        const mine = f.home === id ? f.hg : f.ag;
        const theirs = f.home === id ? f.ag : f.hg;
        gf += mine;
        gd += mine - theirs;
        pts += mine > theirs ? 3 : mine === theirs ? 1 : 0;
      }
      return { id, pts, gd, gf, p };
    });
    table.sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf);
    return { teams: g, table };
  });
}

export function nextInternationalWindow(state: CareerState): number | null {
  const cal = seasonCalendar(state.season);
  const next = cal.intlWeeks.find((w) => w > state.day);
  return next ?? null;
}

export function internationalAnnouncementDay(weekMonday: number): number {
  return nextWeekday(weekMonday - 7, 0);
}

export function userNationalName(state: CareerState): string {
  const f = state.user;
  if (f.national === 'none') return '—';
  return `${nationName(f.nat)}${f.national === 'senior' ? '' : ' ' + f.national}`;
}

export { fullName };
