// Team selection: formations (slot positions + engine pitch coordinates) and the coach AI that
// picks a starting XI and bench for every fixture.
//
// The coach scores each (slot, player) pair by the player's rating in that slot, his form and
// fitness, and — for the user — by what the coach sees: training attendance and effort,
// professionalism, their relationship, morale and the role promised in his contract. The coach's
// personality weighs these (a youth-friendly coach gives kids minutes, a disciplinarian punishes
// skipped sessions). Assignment is a greedy global best-pair matching, then a 7-man bench.

import { POSITIONS, ovrFromStatArray, statsToArray, type Position } from './attributes';
import { ageAt } from './dates';
import { conditionFactor, potentialRange } from './footballer';
import { club, coachOf, npc, squadOf, youthOf } from './index';
import { npcOvrAt } from './players';
import { Rng, clamp } from './rng';
import type { CareerState, Coach, FormationKey, Id, MatchRole, NPC } from './types';

export interface FormationSlot {
  pos: Position;
  /** engine formation coordinates: x -1 (own goal) .. 1 (attack), y +1 left .. -1 right */
  x: number;
  y: number;
}

export const FORMATIONS: Record<FormationKey, FormationSlot[]> = {
  '4-4-2': [
    { pos: 'GK', x: -1, y: 0 },
    { pos: 'LB', x: -0.7, y: 0.75 },
    { pos: 'CB', x: -1, y: 0.25 },
    { pos: 'CB', x: -1, y: -0.25 },
    { pos: 'RB', x: -0.7, y: -0.75 },
    { pos: 'LM', x: 0.3, y: 0.85 },
    { pos: 'CM', x: -0.2, y: 0.25 },
    { pos: 'CM', x: -0.2, y: -0.25 },
    { pos: 'RM', x: 0.3, y: -0.85 },
    { pos: 'CF', x: 0.9, y: 0.25 },
    { pos: 'CF', x: 0.9, y: -0.25 },
  ],
  '4-3-3': [
    { pos: 'GK', x: -1, y: 0 },
    { pos: 'LB', x: -0.7, y: 0.75 },
    { pos: 'CB', x: -1, y: 0.25 },
    { pos: 'CB', x: -1, y: -0.25 },
    { pos: 'RB', x: -0.7, y: -0.75 },
    { pos: 'DM', x: -0.45, y: 0 },
    { pos: 'CM', x: -0.1, y: 0.35 },
    { pos: 'CM', x: -0.1, y: -0.35 },
    { pos: 'LM', x: 0.75, y: 0.85 },
    { pos: 'RM', x: 0.75, y: -0.85 },
    { pos: 'CF', x: 1, y: 0 },
  ],
  '4-2-3-1': [
    { pos: 'GK', x: -1, y: 0 },
    { pos: 'LB', x: -0.7, y: 0.75 },
    { pos: 'CB', x: -1, y: 0.25 },
    { pos: 'CB', x: -1, y: -0.25 },
    { pos: 'RB', x: -0.7, y: -0.75 },
    { pos: 'DM', x: -0.4, y: 0.25 },
    { pos: 'CM', x: -0.4, y: -0.25 },
    { pos: 'LM', x: 0.55, y: 0.85 },
    { pos: 'AM', x: 0.3, y: 0 },
    { pos: 'RM', x: 0.55, y: -0.85 },
    { pos: 'CF', x: 1, y: 0 },
  ],
  '4-4-1-1': [
    { pos: 'GK', x: -1, y: 0 },
    { pos: 'LB', x: -0.7, y: 0.75 },
    { pos: 'CB', x: -1, y: 0.25 },
    { pos: 'CB', x: -1, y: -0.25 },
    { pos: 'RB', x: -0.7, y: -0.75 },
    { pos: 'CM', x: -0.2, y: 0.3 },
    { pos: 'CM', x: -0.2, y: -0.3 },
    { pos: 'LM', x: 0.7, y: 0.9 },
    { pos: 'AM', x: 0.2, y: 0 },
    { pos: 'RM', x: 0.7, y: -0.9 },
    { pos: 'CF', x: 1, y: 0 },
  ],
  '3-5-2': [
    { pos: 'GK', x: -1, y: 0 },
    { pos: 'CB', x: -1, y: 0.45 },
    { pos: 'CB', x: -1, y: 0 },
    { pos: 'CB', x: -1, y: -0.45 },
    { pos: 'LM', x: 0.0, y: 0.9 },
    { pos: 'DM', x: -0.45, y: 0 },
    { pos: 'CM', x: -0.05, y: 0.3 },
    { pos: 'CM', x: -0.05, y: -0.3 },
    { pos: 'RM', x: 0.0, y: -0.9 },
    { pos: 'CF', x: 0.9, y: 0.25 },
    { pos: 'CF', x: 0.9, y: -0.25 },
  ],
  '4-1-4-1': [
    { pos: 'GK', x: -1, y: 0 },
    { pos: 'LB', x: -0.7, y: 0.75 },
    { pos: 'CB', x: -1, y: 0.25 },
    { pos: 'CB', x: -1, y: -0.25 },
    { pos: 'RB', x: -0.7, y: -0.75 },
    { pos: 'DM', x: -0.5, y: 0 },
    { pos: 'LM', x: 0.4, y: 0.85 },
    { pos: 'CM', x: 0, y: 0.3 },
    { pos: 'CM', x: 0, y: -0.3 },
    { pos: 'RM', x: 0.4, y: -0.85 },
    { pos: 'CF', x: 1, y: 0 },
  ],
};

/** an entry of a lineup: an NPC, or the user (npcId === USER_ID) */
export const USER_ID = -1;

export interface LineupEntry {
  npcId: Id;
  pos: Position;
  /** effective rating on the day (includes condition) */
  rating: number;
}

export interface Lineup {
  teamId: Id;
  formation: FormationKey;
  starters: LineupEntry[];
  bench: LineupEntry[];
  userRole: MatchRole;
  /** throwaway players (virtual national/youth squads), looked up before the world */
  virtual?: NPC[];
}

export interface SelectOptions {
  /** cup rotation: rest some regulars, give youngsters a chance */
  rotation?: boolean;
  /** include the development squad and use it as the main pool (youth fixtures) */
  youth?: boolean;
  /** candidate pool override (national teams) */
  pool?: NPC[];
  formation?: FormationKey;
  /** whether the user is eligible for this team */
  userEligible?: boolean;
  seed?: number;
}

function slotAffinity(natural: Position, slot: Position): number {
  if (natural === slot) return 0;
  if (natural === 'GK' || slot === 'GK') return -40;
  return 0;
}

/** what the coach thinks of the user (a bonus in rating points) */
export function coachOpinion(state: CareerState, coach: Coach | undefined): number {
  const f = state.user;
  const coachPerson = state.life.people.find((p) => p.role === 'coach' && !p.gone);
  const affinity = coachPerson ? coachPerson.affinity : 50;
  const d = coach?.discipline ?? 0.5;
  let bonus = 0;
  bonus += (affinity - 50) * 0.05;
  bonus += (f.attendance - 0.9) * 14 * (0.5 + d);
  bonus += (f.effort - 0.55) * 4;
  bonus += (f.professionalism - 55) * 0.03 * (0.5 + d);
  if (f.transferRequest) bonus -= 2.5;
  const roleBonus: Record<string, number> = { youth: 0, prospect: 0.5, rotation: 1, regular: 2, key: 3, star: 4 };
  bonus += roleBonus[f.contract.role] ?? 0;
  if (f.morale < 30) bonus -= 1;
  return bonus;
}

function ageBonus(age: number, coach: Coach | undefined): number {
  if (age >= 22) return age > 32 ? -0.5 : 0;
  return (coach?.youthFaith ?? 0.5) * (22 - age) * 0.35 - 1.5;
}

/** development-squad match counters kept in the event flags (persisted with the save) */
export const YOUTH_BENCH_RUN = 'youthBenchRun';
export const YOUTH_START_RUN = 'youthStartRun';

/**
 * Academy football is about development minutes, not only results: the academy coach plays the
 * prospects he rates (scouted potential), gives game time to a kid who has been left out for a
 * few matches ("minutes owed") and rotates a regular now and then. Returned in rating points on
 * top of his usual score, only for development-squad fixtures.
 */
export function youthDevelopmentBonus(state: CareerState, coach: Coach | undefined): number {
  const [lo, hi] = potentialRange(state);
  const talent = clamp(((lo + hi) / 2 - 80) * 0.35, -1, 4.5);
  const faith = 0.5 + Math.max(0.55, coach?.youthFaith ?? 0.5) * 1.2;
  const flags = state.events.flags;
  const owed = Math.min(7, (flags[YOUTH_BENCH_RUN] ?? 0) * 1.7);
  const rested = Math.max(0, (flags[YOUTH_START_RUN] ?? 0) - 4) * 0.7;
  return talent + faith + owed - rested;
}

/** selects the XI and bench of a club (or a pool) for a match */
export function selectLineup(state: CareerState, teamId: Id, opts: SelectOptions = {}): Lineup {
  const clubRec = club(state, teamId);
  const coach = clubRec ? coachOf(state, teamId) : undefined;
  const formation = opts.formation ?? coach?.formation ?? '4-4-2';
  const slots = FORMATIONS[formation];
  const rng = new Rng(opts.seed ?? (state.day * 7919 + teamId));
  const day = state.day;

  let pool: NPC[];
  if (opts.pool) pool = opts.pool;
  else if (opts.youth) pool = youthOf(state, teamId);
  else pool = squadOf(state, teamId);
  pool = pool.filter((n) => n.injuredUntil <= day && n.banned <= 0);

  interface Cand {
    id: Id;
    natural: Position;
    score: (slot: Position) => number;
    rating: (slot: Position) => number;
  }
  // academy selection is looser: coaches rotate and share out development minutes
  const noiseSd = opts.youth ? 2.4 : 1.1;
  const cands: Cand[] = pool.map((n) => {
    const age = ageAt(n.born, day);
    const cond = 0.93 + (n.form / 100) * 0.1;
    const noise = rng.gauss(0, noiseSd) + (opts.rotation ? (age > 28 ? -2.5 : age < 22 ? 2 : 0) : 0);
    const bonus = ageBonus(age, coach) + noise;
    return {
      id: n.id,
      natural: n.pos,
      rating: (slot) => npcOvrAt(n, slot) * cond,
      score: (slot) => npcOvrAt(n, slot) * cond + bonus + slotAffinity(n.pos, slot),
    };
  });

  const f = state.user;
  const userHere = opts.userEligible ?? (f.clubId === teamId && !opts.pool);
  if (userHere && !f.injury && f.banned <= 0) {
    const userStats = statsToArray(f.stats);
    const cond = conditionFactor(f);
    const age = ageAt(f.born, day);
    const perceived = coachOpinion(state, coach) + ageBonus(age, coach);
    const youthPenalty = !opts.youth && f.squad === 'youth' ? -2.5 + (coach?.youthFaith ?? 0.5) * 2 : 0;
    const energyPenalty = f.energy < 35 ? -3 : 0;
    const dev = opts.youth ? youthDevelopmentBonus(state, coach) : 0;
    const noise = rng.gauss(0, opts.youth ? 2.4 : 0.8);
    cands.push({
      id: USER_ID,
      natural: f.pos,
      rating: (slot) => ovrFromStatArray(userStats, slot) * cond,
      // out of position he is only a stopgap (the coach picks him where he trains)
      score: (slot) => ovrFromStatArray(userStats, slot) * (0.94 + 0.06 * (f.form / 100)) * (0.92 + 0.08 * (f.fitness / 100)) + perceived + youthPenalty + energyPenalty + dev * (slot === f.pos ? 1 : 0.6) + noise + slotAffinity(f.pos, slot),
    });
  }

  // greedy global best-pair assignment
  const open = slots.map((s, i) => ({ ...s, i }));
  const starters: (LineupEntry | null)[] = new Array(slots.length).fill(null);
  const remaining = new Set(cands.map((_, i) => i));
  const scoreCache = cands.map((c) => new Map<Position, number>());
  const scoreOf = (ci: number, pos: Position) => {
    let v = scoreCache[ci].get(pos);
    if (v === undefined) {
      v = cands[ci].score(pos);
      scoreCache[ci].set(pos, v);
    }
    return v;
  };
  while (open.length > 0 && remaining.size > 0) {
    let best = -Infinity;
    let bi = -1;
    let bs = -1;
    for (let s = 0; s < open.length; s++) {
      for (const ci of remaining) {
        const v = scoreOf(ci, open[s].pos);
        if (v > best) {
          best = v;
          bi = ci;
          bs = s;
        }
      }
    }
    const slot = open.splice(bs, 1)[0];
    remaining.delete(bi);
    starters[slot.i] = { npcId: cands[bi].id, pos: slot.pos, rating: cands[bi].rating(slot.pos) };
  }
  const xi = starters.filter((s): s is LineupEntry => s !== null);

  // bench: best remaining by natural rating, at least one keeper
  const rest = [...remaining].map((ci) => ({ ci, v: scoreOf(ci, cands[ci].natural) }));
  rest.sort((a, b) => b.v - a.v);
  const bench: LineupEntry[] = [];
  const gk = rest.find((r) => cands[r.ci].natural === 'GK');
  if (gk) bench.push({ npcId: cands[gk.ci].id, pos: 'GK', rating: cands[gk.ci].rating('GK') });
  for (const r of rest) {
    if (bench.length >= 7) break;
    if (gk && r.ci === gk.ci) continue;
    bench.push({ npcId: cands[r.ci].id, pos: cands[r.ci].natural, rating: cands[r.ci].rating(cands[r.ci].natural) });
  }

  let userRole: MatchRole = 'out';
  if (xi.some((e) => e.npcId === USER_ID)) userRole = 'start';
  else if (bench.some((e) => e.npcId === USER_ID)) userRole = 'bench';
  return { teamId, formation, starters: xi, bench, userRole };
}

/**
 * Fast lineup for background fixtures (no user involved): best available player of the natural
 * position per slot, falling back to anyone with a mismatch penalty. Same shape as selectLineup.
 */
export function quickLineup(state: CareerState, teamId: Id, rng: Rng): Lineup {
  const coach = coachOf(state, teamId);
  const formation = coach?.formation ?? '4-4-2';
  const slots = FORMATIONS[formation];
  const day = state.day;
  const pool = squadOf(state, teamId).filter((n) => n.injuredUntil <= day && n.banned <= 0 && n.id !== USER_ID);
  const used = new Set<Id>();
  const starters: LineupEntry[] = [];
  const cond = (n: NPC) => 0.93 + (n.form / 100) * 0.1;
  for (const s of slots) {
    let best: NPC | null = null;
    let bv = -Infinity;
    for (const n of pool) {
      if (used.has(n.id)) continue;
      const v = (n.pos === s.pos ? n.ovr : n.ovr - (s.pos === 'GK' || n.pos === 'GK' ? 40 : 7)) * cond(n) + rng.gauss(0, 1);
      if (v > bv) {
        bv = v;
        best = n;
      }
    }
    if (!best) continue;
    used.add(best.id);
    starters.push({ npcId: best.id, pos: s.pos, rating: (best.pos === s.pos ? best.ovr : best.ovr - (s.pos === 'GK' || best.pos === 'GK' ? 40 : 7)) * cond(best) });
  }
  const bench = pool
    .filter((n) => !used.has(n.id))
    .sort((a, b) => b.ovr - a.ovr)
    .slice(0, 7)
    .map((n) => ({ npcId: n.id, pos: n.pos, rating: n.ovr * cond(n) }));
  return { teamId, formation, starters, bench, userRole: 'out' };
}

export interface TeamStrength {
  gk: number;
  def: number;
  mid: number;
  att: number;
  overall: number;
}

/** line ratings of a lineup (OVR scale) */
export function lineupStrength(l: Lineup): TeamStrength {
  const byLine = { GK: [] as number[], DEF: [] as number[], MID: [] as number[], ATT: [] as number[] };
  for (const e of l.starters) {
    if (e.pos === 'GK') byLine.GK.push(e.rating);
    else if (e.pos === 'CB' || e.pos === 'LB' || e.pos === 'RB') byLine.DEF.push(e.rating);
    else if (e.pos === 'DM' || e.pos === 'CM' || e.pos === 'AM') byLine.MID.push(e.rating);
    else byLine.ATT.push(e.rating);
  }
  const avg = (a: number[], fallback: number) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : fallback);
  const all = l.starters.map((e) => e.rating);
  const overall = avg(all, 40) - Math.max(0, 11 - l.starters.length) * 4;
  const mid = avg(byLine.MID, overall);
  return {
    gk: avg(byLine.GK, overall - 15),
    def: avg(byLine.DEF, overall),
    mid,
    att: avg(byLine.ATT, mid),
    overall,
  };
}

export function lineupPlayer(state: CareerState, l: Lineup, id: Id): NPC | undefined {
  if (l.virtual) {
    const v = l.virtual.find((n) => n.id === id);
    if (v) return v;
  }
  return npc(state, id);
}

/** quick average strength of a club's best XI (for previews, club comparisons) */
export function clubStrength(state: CareerState, clubId: Id): number {
  const squad = squadOf(state, clubId);
  const best = [...squad].sort((a, b) => b.ovr - a.ovr).slice(0, 11);
  if (best.length === 0) return 50;
  return best.reduce((a, n) => a + n.ovr, 0) / best.length;
}

export function positionsOrder(): Position[] {
  return [...POSITIONS];
}

export function clampRating(r: number): number {
  return clamp(Math.round(r * 10) / 10, 1, 10);
}
