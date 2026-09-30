// Player attributes: the match engine's 22 stats (0 .. 1), grouped physical / technical / mental,
// position profiles (from the original InitDefaultProfiles in legacy/src/utils.cpp), the overall
// rating (OVR) shown in the UI, and the mapping to/from engine database records.
//
// Design: career attributes ARE the engine stats, so a 3D match reproduces exactly what the
// career screens show. The engine derives in-match stats as
//   CalculateStat(base_stat, profile, age) = clamp(profile * 2 * base_stat * ageMult(age) * 1.2, .01, 1)
// so `engineRecordFor()` inverts that: given the stats we want and the real age it produces a
// base_stat + profile_xml pair the engine turns back into (within float precision) those stats.

import { clamp, interpolate } from './rng';

export const STAT_NAMES = [
  'physical_balance',
  'physical_reaction',
  'physical_acceleration',
  'physical_velocity',
  'physical_stamina',
  'physical_agility',
  'physical_shotpower',
  'technical_standingtackle',
  'technical_slidingtackle',
  'technical_ballcontrol',
  'technical_dribble',
  'technical_shortpass',
  'technical_highpass',
  'technical_header',
  'technical_shot',
  'technical_volley',
  'mental_calmness',
  'mental_workrate',
  'mental_resilience',
  'mental_defensivepositioning',
  'mental_offensivepositioning',
  'mental_vision',
] as const;

export type StatName = (typeof STAT_NAMES)[number];
export type Stats = Record<StatName, number>;
export const STAT_COUNT = STAT_NAMES.length;

export const STAT_LABELS: Record<StatName, string> = {
  physical_balance: 'Balance',
  physical_reaction: 'Reactions',
  physical_acceleration: 'Acceleration',
  physical_velocity: 'Sprint speed',
  physical_stamina: 'Stamina',
  physical_agility: 'Agility',
  physical_shotpower: 'Shot power',
  technical_standingtackle: 'Standing tackle',
  technical_slidingtackle: 'Sliding tackle',
  technical_ballcontrol: 'Ball control',
  technical_dribble: 'Dribbling',
  technical_shortpass: 'Short passing',
  technical_highpass: 'Long passing',
  technical_header: 'Heading',
  technical_shot: 'Finishing',
  technical_volley: 'Volleys',
  mental_calmness: 'Composure',
  mental_workrate: 'Work rate',
  mental_resilience: 'Resilience',
  mental_defensivepositioning: 'Def. positioning',
  mental_offensivepositioning: 'Att. positioning',
  mental_vision: 'Vision',
};

export type StatGroup = 'physical' | 'technical' | 'mental';
export function statGroup(name: StatName): StatGroup {
  return name.startsWith('physical') ? 'physical' : name.startsWith('technical') ? 'technical' : 'mental';
}
export const STAT_GROUPS: Record<StatGroup, StatName[]> = {
  physical: STAT_NAMES.filter((s) => statGroup(s) === 'physical'),
  technical: STAT_NAMES.filter((s) => statGroup(s) === 'technical'),
  mental: STAT_NAMES.filter((s) => statGroup(s) === 'mental'),
};

// ----- positions

export const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LM', 'RM', 'CF'] as const;
export type Position = (typeof POSITIONS)[number];

export const POSITION_NAMES: Record<Position, string> = {
  GK: 'Goalkeeper',
  CB: 'Centre-back',
  LB: 'Left-back',
  RB: 'Right-back',
  DM: 'Defensive midfielder',
  CM: 'Central midfielder',
  AM: 'Attacking midfielder',
  LM: 'Left winger',
  RM: 'Right winger',
  CF: 'Centre-forward',
};

export type Line = 'GK' | 'DEF' | 'MID' | 'ATT';
export const POSITION_LINE: Record<Position, Line> = {
  GK: 'GK',
  CB: 'DEF',
  LB: 'DEF',
  RB: 'DEF',
  DM: 'MID',
  CM: 'MID',
  AM: 'MID',
  LM: 'ATT',
  RM: 'ATT',
  CF: 'ATT',
};

/** role string for the engine's players table (Football-Manager style, like the shipped database) */
export const ENGINE_ROLE_STRING: Record<Position, string> = {
  GK: 'GK',
  CB: 'D C',
  LB: 'D/WB L',
  RB: 'D/WB R',
  DM: 'DM',
  CM: 'M C',
  AM: 'AM C',
  LM: 'AM L',
  RM: 'AM R',
  CF: 'ST',
};

/** parses the shipped database's FM-style role strings ("D/WB L, DM", "AM RLC, F C", "ST") */
export function positionFromRoleString(role: string): Position {
  const first = role.split(',')[0].trim();
  const [main, side = ''] = first.split(' ');
  const parts = main.split('/');
  const p = parts[0];
  const hasL = side.includes('L');
  const hasR = side.includes('R');
  const hasC = side.includes('C') || side === '';
  if (p === 'GK') return 'GK';
  if (p === 'SW') return 'CB';
  if (p === 'D') {
    if (parts.includes('WB') || (!hasC && (hasL || hasR))) return hasL && !hasR ? 'LB' : 'RB';
    return 'CB';
  }
  if (p === 'WB') return hasL && !hasR ? 'LB' : 'RB';
  if (p === 'DM') return 'DM';
  if (p === 'M') return hasC ? 'CM' : hasL ? 'LM' : 'RM';
  if (p === 'AM') {
    if (parts.includes('F')) return 'CF';
    if (hasC && !hasL && !hasR) return 'AM';
    if (hasC) return 'AM';
    return hasL && !hasR ? 'LM' : 'RM';
  }
  if (p === 'F' || p === 'ST') return 'CF';
  return 'CM';
}

// Original default profiles (legacy/src/utils.cpp InitDefaultProfiles), in STAT_NAMES order.
const RAW_PROFILES: Record<string, number[]> = {
  GK: [0.6, 0.8, 0.5, 0.4, 0.5, 0.6, 0.6, 0.2, 0.2, 0.3, 0.2, 0.6, 0.7, 0.2, 0.3, 0.2, 0.5, 0.5, 0.5, 0.9, 0.1, 0.5],
  D: [0.8, 0.7, 0.5, 0.5, 0.5, 0.5, 0.6, 0.8, 0.8, 0.5, 0.3, 0.5, 0.5, 0.6, 0.3, 0.2, 0.5, 0.5, 0.5, 0.8, 0.3, 0.6],
  WB: [0.6, 0.5, 0.6, 0.6, 0.5, 0.5, 0.5, 0.7, 0.7, 0.5, 0.5, 0.7, 0.7, 0.5, 0.4, 0.3, 0.5, 0.5, 0.5, 0.6, 0.4, 0.6],
  DM: [0.7, 0.6, 0.5, 0.5, 0.5, 0.5, 0.6, 0.7, 0.6, 0.5, 0.4, 0.7, 0.7, 0.5, 0.4, 0.3, 0.5, 0.5, 0.5, 0.6, 0.4, 0.6],
  M: [0.4, 0.5, 0.6, 0.6, 0.5, 0.6, 0.6, 0.4, 0.3, 0.7, 0.6, 0.8, 0.7, 0.4, 0.5, 0.4, 0.5, 0.5, 0.5, 0.5, 0.5, 0.7],
  AM: [0.4, 0.5, 0.6, 0.6, 0.5, 0.7, 0.7, 0.2, 0.2, 0.6, 0.7, 0.6, 0.5, 0.4, 0.7, 0.5, 0.5, 0.5, 0.5, 0.3, 0.7, 0.4],
  F: [0.4, 0.5, 0.7, 0.7, 0.5, 0.7, 0.7, 0.2, 0.1, 0.5, 0.8, 0.6, 0.6, 0.4, 0.7, 0.4, 0.5, 0.5, 0.5, 0.25, 0.75, 0.5],
  ST: [0.3, 0.6, 0.6, 0.6, 0.5, 0.7, 0.8, 0.1, 0.1, 0.5, 0.7, 0.5, 0.4, 0.6, 0.8, 0.7, 0.5, 0.5, 0.5, 0.2, 0.8, 0.3],
};

function normalizeProfile(values: number[]): number[] {
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return values.map((v) => v + (0.5 - avg));
}

function mix(a: number[], b: number[], t: number): number[] {
  return a.map((v, i) => v * (1 - t) + b[i] * t);
}

/** position profile: relative stat distribution, averaging 0.5 (like profile_xml) */
export const POSITION_PROFILE: Record<Position, number[]> = {
  GK: normalizeProfile(RAW_PROFILES.GK),
  CB: normalizeProfile(RAW_PROFILES.D),
  LB: normalizeProfile(RAW_PROFILES.WB),
  RB: normalizeProfile(RAW_PROFILES.WB),
  DM: normalizeProfile(RAW_PROFILES.DM),
  CM: normalizeProfile(RAW_PROFILES.M),
  AM: normalizeProfile(RAW_PROFILES.AM),
  LM: normalizeProfile(mix(RAW_PROFILES.M, RAW_PROFILES.F, 0.6)),
  RM: normalizeProfile(mix(RAW_PROFILES.M, RAW_PROFILES.F, 0.6)),
  CF: normalizeProfile(mix(RAW_PROFILES.ST, RAW_PROFILES.F, 0.35)),
};

/**
 * OVR weights per position: stats the position profile emphasises count much more. Defensive
 * stats barely matter for a striker's rating and vice versa.
 */
export const POSITION_WEIGHTS: Record<Position, number[]> = Object.fromEntries(
  POSITIONS.map((p) => {
    const w = POSITION_PROFILE[p].map((v) => Math.pow(Math.max(0.02, v - 0.28), 1.6));
    const sum = w.reduce((a, b) => a + b, 0);
    return [p, w.map((x) => x / sum)];
  }),
) as Record<Position, number[]>;

/**
 * Weighted mean of the relevant stats is mapped to a familiar 0..99 scale. Calibrated so a
 * typical top-flight regular at his peak is ~75-80, stars ~85-90 and a 15-year-old prospect ~40.
 */
export function ovrFromStatArray(stats: ArrayLike<number>, pos: Position): number {
  const w = POSITION_WEIGHTS[pos];
  let sum = 0;
  for (let i = 0; i < STAT_COUNT; i++) sum += w[i] * stats[i];
  return ovrScale(abilityFromWeightedMean(pos, sum));
}

/**
 * Per-position lookup: weighted mean -> the mean ability a player with the textbook profile of
 * that position would need to reach it (including the engine's clamp at 1.0). This makes ratings
 * comparable between positions whose key stats saturate at different abilities (keepers, CBs).
 */
const ABILITY_TABLE: Record<Position, number[]> = Object.fromEntries(
  POSITIONS.map((p) => {
    const table: number[] = [];
    const tmp = new Array<number>(STAT_COUNT);
    for (let a = 0; a <= 150; a++) {
      statsFromProfile(POSITION_PROFILE[p], a / 100, tmp);
      table.push(tmp.reduce((acc, v, i) => acc + v * POSITION_WEIGHTS[p][i], 0));
    }
    return [p, table];
  }),
) as Record<Position, number[]>;

function abilityFromWeightedMean(pos: Position, wm: number): number {
  const t = ABILITY_TABLE[pos];
  if (wm <= t[0]) return 0;
  if (wm >= t[t.length - 1]) return 1.5;
  // binary search for the first entry >= wm (table is monotonic)
  let lo = 1;
  let hi = t.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] >= wm) hi = mid;
    else lo = mid + 1;
  }
  return (lo - 1 + (wm - t[lo - 1]) / Math.max(1e-9, t[lo] - t[lo - 1])) / 100;
}

const OVR_CURVE: [number, number][] = [
  [0, 0],
  [0.3, 32],
  [0.4, 44],
  [0.5, 57],
  [0.6, 69],
  [0.7, 79],
  [0.8, 87],
  [0.9, 93],
  [1.0, 97],
  [1.2, 99],
];

/** inverse of ovrScale: the mean ability that yields a rating */
export function abilityForOvr(ovr: number): number {
  for (let i = 1; i < OVR_CURVE.length; i++) {
    const [a1, o1] = OVR_CURVE[i];
    if (ovr <= o1) {
      const [a0, o0] = OVR_CURVE[i - 1];
      return a0 + ((a1 - a0) * (ovr - o0)) / Math.max(1e-9, o1 - o0);
    }
  }
  return 1.2;
}

/** normalised ability (mean-stat equivalent) -> 0..99 rating */
export function ovrScale(normalizedAbility: number): number {
  return clamp(interpolate(OVR_CURVE, normalizedAbility), 1, 99);
}

export function statsToArray(stats: Stats): number[] {
  return STAT_NAMES.map((n) => stats[n]);
}

export function arrayToStats(values: ArrayLike<number>): Stats {
  const out = {} as Stats;
  STAT_NAMES.forEach((n, i) => (out[n] = values[i]));
  return out;
}

export function ovr(stats: Stats, pos: Position): number {
  return ovrFromStatArray(statsToArray(stats), pos);
}

/** best position rating and which position that is */
export function bestPosition(stats: Stats): { pos: Position; ovr: number } {
  const arr = statsToArray(stats);
  let best: Position = 'CM';
  let bestOvr = -1;
  for (const p of POSITIONS) {
    const o = ovrFromStatArray(arr, p);
    if (o > bestOvr) {
      bestOvr = o;
      best = p;
    }
  }
  return { pos: best, ovr: bestOvr };
}

/** NPC stats: stat = clamp(profile * 2 * ability) — the same shape the engine uses */
export function statsFromProfile(profile: ArrayLike<number>, ability: number, out: number[] = new Array(STAT_COUNT)): number[] {
  for (let i = 0; i < STAT_COUNT; i++) out[i] = clamp(profile[i] * 2 * ability, 0.01, 1.0);
  return out;
}

export function meanStat(stats: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < STAT_COUNT; i++) s += stats[i];
  return s / STAT_COUNT;
}

// ----- engine mapping (legacy/src/utils.cpp CalculateStat and its inverse)

function curve(source: number, bias = 1.0): number {
  return (Math.sin((source - 0.5) * Math.PI) * 0.5 + 0.5) * bias + source * (1.0 - bias);
}

/** the engine's age multiplier: agedBaseStat = baseStat * EngineAgeMultiplier(age) */
export function engineAgeMultiplier(age: number): number {
  const idealAge = 27;
  const n = clamp(Math.abs(age - idealAge), 0, 13) / 13;
  const ageFactor = curve(1.0 - n * 0.5, 1.0) * 2.0 - 1.0;
  return (ageFactor * 0.5 + 0.5) * 1.2;
}

/** exact port of CalculateStat (legacy/src/utils.cpp) */
export function calculateStat(baseStat: number, profileStat: number, age: number): number {
  const agedBaseStat = baseStat * engineAgeMultiplier(age);
  return clamp(profileStat * 2.0 * agedBaseStat, 0.01, 1.0);
}

export interface EngineStatRecord {
  base_stat: number;
  profile: number[];
  profile_xml: string;
}

/**
 * Inverse of CalculateStat: base_stat + profile such that the engine reproduces `stats` for a
 * player of `age`. The profile keeps the engine's convention (average 0.5): the aged base stat is
 * the mean stat and each profile value is stat / (2 * mean).
 */
export function engineRecordFor(stats: ArrayLike<number>, age: number): EngineStatRecord {
  const values = Array.from({ length: STAT_COUNT }, (_, i) => clamp(stats[i], 0.01, 1.0));
  const mean = meanStat(values);
  const agedBase = Math.max(0.01, mean);
  const base_stat = agedBase / engineAgeMultiplier(age);
  const profile = values.map((v) => v / (2 * agedBase));
  const profile_xml = STAT_NAMES.map((n, i) => `<${n}>${profile[i].toFixed(6)}</${n}>`).join('\n') + '\n';
  return { base_stat, profile, profile_xml };
}

/** parses a profile_xml string (22 tags) into an array in STAT_NAMES order */
export function parseProfileXml(xml: string): number[] {
  return STAT_NAMES.map((n) => {
    const m = xml.match(new RegExp(`<${n}>\\s*([-0-9.eE]+)\\s*</${n}>`));
    return m ? parseFloat(m[1]) : 0.5;
  });
}

/** stats the engine produces from a database record (for tests / imports) */
export function engineStatsFromRecord(base_stat: number, profile: ArrayLike<number>, age: number): number[] {
  return Array.from({ length: STAT_COUNT }, (_, i) => calculateStat(base_stat, profile[i], age));
}
