// NPC footballers: stat profiles, the development curve, market value and wages, and generation.
//
// An NPC is stored compactly (peak ability, development timing, a profile seed); his 22 stats
// are derived on demand: stats = clamp(profile * 2 * ability(age)). The age curve gives the arc
// every career follows: fast growth 15-21, a plateau 25-29, decline from ~31 that speeds up
// after 34. The user's footballer does NOT use this curve (he develops through training), but
// his training model is tuned so an average diligent career lands on the same arc.

import { POSITION_PROFILE, STAT_COUNT, abilityForOvr, ovrFromStatArray, statsFromProfile, type Position } from './attributes';
import { ageAt } from './dates';
import { randomName } from './data/names';
import { Rng, clamp, interpolate } from './rng';
import type { Id, NPC, StatLine } from './types';

export const AGE_CURVE: [number, number][] = [
  [14, 0.46],
  [15, 0.52],
  [16, 0.58],
  [17, 0.65],
  [18, 0.72],
  [19, 0.78],
  [20, 0.83],
  [21, 0.87],
  [22, 0.91],
  [23, 0.94],
  [24, 0.97],
  [25, 0.99],
  [26, 1.0],
  [29, 1.0],
  [30, 0.985],
  [31, 0.965],
  [32, 0.94],
  [33, 0.91],
  [34, 0.87],
  [35, 0.83],
  [36, 0.78],
  [37, 0.73],
  [38, 0.68],
  [40, 0.58],
  [45, 0.4],
];

/** fraction of peak ability at an age; `bloom` delays (+) or advances (-) the growth phase */
export function ageCurve(age: number, bloom = 0): number {
  const growthAge = age < 26 ? Math.min(26, age - bloom) : age;
  return interpolate(AGE_CURVE, growthAge);
}

export function emptyLine(): StatLine {
  return { apps: 0, starts: 0, mins: 0, goals: 0, assists: 0, ratingSum: 0, rated: 0, yellows: 0, reds: 0, motm: 0, cleanSheets: 0 };
}

export function avgRating(line: StatLine): number {
  return line.rated > 0 ? line.ratingSum / line.rated : 0;
}

// ----- profiles

/** archetype tweaks give squads variety (a pacey winger vs a creative one) */
const ARCHETYPES: Partial<Record<Position, number[][]>> = {};
function tweak(pairs: [number, number][]): number[] {
  const v = new Array(STAT_COUNT).fill(0);
  for (const [i, d] of pairs) v[i] = d;
  return v;
}
// indices: 0 bal 1 rea 2 acc 3 vel 4 sta 5 agi 6 pow 7 stk 8 slk 9 ctl 10 dri 11 spa 12 hpa 13 hea 14 sho 15 vol 16 cal 17 wor 18 res 19 dpo 20 opo 21 vis
ARCHETYPES.CF = [tweak([[13, 0.15], [0, 0.12], [6, 0.05], [2, -0.08], [3, -0.06]]), tweak([[2, 0.12], [3, 0.12], [10, 0.06], [13, -0.1]]), tweak([[21, 0.12], [11, 0.1], [9, 0.08], [3, -0.06]])];
ARCHETYPES.LM = [tweak([[2, 0.12], [3, 0.12], [10, 0.05]]), tweak([[12, 0.12], [21, 0.08], [3, -0.05]]), tweak([[14, 0.1], [20, 0.08]])];
ARCHETYPES.RM = ARCHETYPES.LM;
ARCHETYPES.CM = [tweak([[4, 0.12], [17, 0.12], [7, 0.08], [21, -0.06]]), tweak([[21, 0.12], [12, 0.1], [4, -0.05]]), tweak([[14, 0.1], [20, 0.1], [7, -0.08]])];
ARCHETYPES.CB = [tweak([[13, 0.12], [0, 0.1], [3, -0.08]]), tweak([[3, 0.1], [2, 0.08], [13, -0.06]]), tweak([[11, 0.12], [12, 0.1], [9, 0.06], [8, -0.08]])];
ARCHETYPES.LB = [tweak([[2, 0.1], [3, 0.1], [12, 0.06], [19, -0.06]]), tweak([[7, 0.08], [19, 0.1], [20, -0.08]])];
ARCHETYPES.RB = ARCHETYPES.LB;
ARCHETYPES.AM = [tweak([[21, 0.12], [11, 0.08], [3, -0.05]]), tweak([[10, 0.12], [5, 0.08], [12, -0.06]]), tweak([[14, 0.12], [15, 0.08], [21, -0.08]])];
ARCHETYPES.DM = [tweak([[7, 0.1], [8, 0.08], [0, 0.06], [21, -0.08]]), tweak([[11, 0.1], [21, 0.1], [8, -0.08]])];
ARCHETYPES.GK = [tweak([[1, 0.06], [5, 0.05]]), tweak([[12, 0.1], [11, 0.06]])];

export function generateProfile(seed: number, pos: Position): number[] {
  const rng = new Rng(seed);
  const base = POSITION_PROFILE[pos];
  const types = ARCHETYPES[pos];
  const arch = types ? rng.pick(types) : null;
  const p = base.map((v, i) => v + (arch ? arch[i] : 0) + rng.gauss(0, 0.055));
  const avg = p.reduce((a, b) => a + b, 0) / p.length;
  return p.map((v) => clamp(v + 0.5 - avg, 0.05, 0.95));
}

const profileCache = new Map<string, number[]>();

export function npcProfile(npc: NPC): number[] {
  if (npc.profile) return npc.profile;
  const key = `${npc.seed}:${npc.pos}`;
  let p = profileCache.get(key);
  if (!p) {
    p = generateProfile(npc.seed, npc.pos);
    if (profileCache.size > 20000) profileCache.clear();
    profileCache.set(key, p);
  }
  return p;
}

export function npcAbilityAt(npc: NPC, day: number): number {
  return npc.peak * ageCurve(ageAt(npc.born, day), npc.bloom);
}

export function npcStats(npc: NPC, out?: number[]): number[] {
  return statsFromProfile(npcProfile(npc), npc.ability, out);
}

/** recomputes the cached ability/ovr for the given day */
export function refreshNpc(npc: NPC, day: number): void {
  npc.ability = npcAbilityAt(npc, day);
  npc.ovr = ovrFromStatArray(npcStats(npc), npc.pos);
}

const tmpStats = new Array<number>(STAT_COUNT);
/** NPC rating when used in another position (lineup building) */
export function npcOvrAt(npc: NPC, pos: Position): number {
  if (pos === npc.pos) return npc.ovr;
  return ovrFromStatArray(npcStats(npc, tmpStats), pos);
}

// ----- money

/**
 * Market value (in currency units) from rating, age and potential headroom. Exponential in OVR
 * like real markets: a 60 is worth ~0.3M, a 75 ~5M, an 85 ~30M, a 92 ~100M.
 */
export function marketValue(ovr: number, age: number, potentialOvr: number, reputation = 50): number {
  let v = 20000 * Math.exp((ovr - 45) / 5.5);
  if (age < 24) v *= 1 + Math.max(0, potentialOvr - ovr) * 0.035 * ((24 - age) / 8);
  if (age > 29) v *= Math.pow(0.82, age - 29);
  v *= 0.8 + reputation / 250;
  return roundMoney(Math.max(5000, v));
}

/** weekly wage a player of this level expects at a club of this reputation */
export function expectedWage(ovr: number, clubReputation: number, age: number): number {
  let w = 420 * Math.exp((ovr - 50) / 9);
  w *= 0.45 + clubReputation / 55;
  if (age < 18) w *= 0.35;
  else if (age < 20) w *= 0.7;
  return roundMoney(Math.max(age < 18 ? 120 : 400, w));
}

export function roundMoney(v: number): number {
  if (v < 1000) return Math.round(v / 10) * 10;
  if (v < 100000) return Math.round(v / 100) * 100;
  if (v < 1000000) return Math.round(v / 1000) * 1000;
  return Math.round(v / 10000) * 10000;
}

// ----- generation

const SKIN_WEIGHTS: Record<string, number[]> = {
  default: [55, 30, 9, 6],
  NGA: [0, 2, 18, 80],
  SEN: [0, 2, 13, 85],
  MAR: [10, 45, 40, 5],
  BRA: [25, 30, 25, 20],
  JPN: [55, 45, 0, 0],
  FRA: [40, 25, 15, 20],
  ENG: [55, 25, 8, 12],
  POR: [40, 40, 12, 8],
  ESP: [45, 45, 7, 3],
  ITA: [45, 48, 5, 2],
  URU: [45, 40, 10, 5],
  USA: [45, 25, 12, 18],
  NED: [55, 25, 8, 12],
  BEL: [55, 25, 8, 12],
  SWE: [80, 15, 2, 3],
  POL: [85, 13, 1, 1],
  CRO: [80, 18, 1, 1],
  GER: [65, 25, 5, 5],
};
const HAIR_STYLES = ['short01', 'short02', 'medium01', 'medium02', 'long01', 'bald'];
const HAIR_STYLE_WEIGHTS = [30, 30, 22, 6, 6, 6];
const HAIR_COLORS = ['black', 'brown', 'darkblonde', 'blonde', 'red'];

export function hairColorWeights(nation: string, skin: number): number[] {
  if (skin >= 3) return [85, 15, 0, 0, 0];
  if (['SWE', 'POL', 'NED', 'GER', 'BEL', 'CRO'].includes(nation)) return [15, 25, 30, 26, 4];
  if (['ENG'].includes(nation)) return [20, 30, 25, 18, 7];
  if (['JPN'].includes(nation)) return [95, 5, 0, 0, 0];
  return [55, 30, 10, 4, 1];
}

export function randomAppearance(rng: Rng, nation: string, pos: Position): { skin: number; hair: string; hairColor: string; height: number; weight: number } {
  const sw = SKIN_WEIGHTS[nation] ?? SKIN_WEIGHTS.default;
  const skin = rng.weighted([1, 2, 3, 4], (s) => sw[s - 1]);
  const hair = rng.weighted(HAIR_STYLES, (h) => HAIR_STYLE_WEIGHTS[HAIR_STYLES.indexOf(h)]);
  const hcw = hairColorWeights(nation, skin);
  const hairColor = rng.weighted(HAIR_COLORS, (c) => hcw[HAIR_COLORS.indexOf(c)]);
  const tall = pos === 'GK' || pos === 'CB' ? 0.07 : pos === 'CF' ? 0.02 : 0;
  const height = Math.round(clamp(rng.gauss(1.8 + tall, 0.055), 1.62, 2.02) * 100) / 100;
  const weight = Math.round((height - 1) * 100 - 6 + rng.gauss(0, 4));
  return { skin, hair, hairColor, height, weight };
}

export interface NpcSpec {
  id: Id;
  nat: string;
  pos: Position;
  clubId: Id;
  squad: 'first' | 'youth';
  born: number;
  peak: number;
  day: number;
  contractEnd: number;
  wage: number;
}

export function createNpc(rng: Rng, spec: NpcSpec): NPC {
  const name = randomName(rng, spec.nat);
  const look = randomAppearance(rng, spec.nat, spec.pos);
  const npc: NPC = {
    id: spec.id,
    first: name.first,
    last: name.last,
    nat: spec.nat,
    clubId: spec.clubId,
    squad: spec.squad,
    pos: spec.pos,
    foot: spec.pos === 'LB' || spec.pos === 'LM' ? (rng.chance(0.8) ? 'L' : 'R') : rng.chance(0.2) ? 'L' : 'R',
    born: spec.born,
    peak: clamp(spec.peak, 0.3, 0.95),
    bloom: clamp(rng.gauss(0, 0.9), -2, 2.5),
    seed: rng.seed(),
    ability: 0,
    ovr: 0,
    form: clamp(Math.round(rng.gauss(60, 10)), 30, 90),
    injuredUntil: 0,
    banned: 0,
    yellows: 0,
    contractEnd: spec.contractEnd,
    wage: spec.wage,
    ...look,
    season: emptyLine(),
    careerApps: 0,
    careerGoals: 0,
    caps: 0,
  };
  refreshNpc(npc, spec.day);
  return npc;
}

/** squad template: positions of a 24-man first-team squad */
export const SQUAD_TEMPLATE: Position[] = ['GK', 'GK', 'GK', 'CB', 'CB', 'CB', 'CB', 'LB', 'LB', 'RB', 'RB', 'DM', 'DM', 'CM', 'CM', 'CM', 'AM', 'AM', 'LM', 'LM', 'RM', 'RM', 'CF', 'CF', 'CF'];

/** development squad template (U19 / reserves) */
export const YOUTH_TEMPLATE: Position[] = ['GK', 'GK', 'CB', 'CB', 'CB', 'LB', 'RB', 'DM', 'CM', 'CM', 'AM', 'LM', 'RM', 'CF', 'CF', 'CM'];

export function potentialOvrOf(npc: NPC): number {
  return ovrFromStatArray(statsFromProfile(npcProfile(npc), npc.peak), npc.pos);
}

export function npcName(npc: { first: string; last: string }): string {
  return `${npc.first} ${npc.last}`;
}

export function shortName(p: { first: string; last: string }): string {
  return `${p.first.charAt(0)}. ${p.last}`;
}

/**
 * Throwaway players for sides that are not stored in the world (opponents' youth teams, small
 * national teams): full NPC records (so they can be registered in the 3D engine) calibrated to
 * a target rating.
 */
export function virtualPlayers(rng: Rng, spec: { idBase: number; nat: string; positions: readonly Position[]; targetOvr: number; ageMin: number; ageMax: number; day: number; spread?: number }): NPC[] {
  return spec.positions.map((pos, i) => {
    const age = rng.range(spec.ageMin, spec.ageMax);
    const n = createNpc(rng, { id: spec.idBase - i, nat: spec.nat, pos, clubId: -1, squad: 'first', born: spec.day - Math.round(age * 365.25), peak: 0.6, day: spec.day, contractEnd: 0, wage: 0 });
    const target = spec.targetOvr + rng.gauss(0, spec.spread ?? 3);
    const ability = clamp(abilityForOvr(target), 0.15, 0.98);
    n.peak = clamp(ability / Math.max(0.3, ageCurve(age, n.bloom)), 0.2, 1.2);
    refreshNpc(n, spec.day);
    return n;
  });
}
