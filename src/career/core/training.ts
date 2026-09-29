// Training and physical development of the user's footballer.
//
// XP: every session (club morning session, extra session, gym, some activities) yields XP scaled
// by intensity, the coach's quality, the club's facilities, professionalism, energy (tired
// players learn less), morale, traits and education. XP flows into the session's stats.
//
// Growth per XP has diminishing returns twice over: by age (fast 15-21, slow after 25, almost
// nothing after 31) and by the gap to the stat's natural cap (profile * 2 * potential), so a
// striker's finishing climbs quickly but his tackling stays modest. Pushing past a natural cap is
// possible but slow.
//
// Decline: from ~30 physical stats erode daily (faster after 34), technique from ~32, mental
// barely. Fitness, diet and professionalism slow the decline; they cannot stop it.

import { POSITION_WEIGHTS, STAT_NAMES, statGroup, type StatName } from './attributes';
import { ageAt, weekday } from './dates';
import { DIETS, INTENSITY, TRAINING, trainingDef, type TrainingKey } from './data/lifestyle';
import { hasTrait } from './footballer';
import { club, coachOf, fixturesOn } from './index';
import { Rng, clamp, interpolate } from './rng';
import type { CareerState } from './types';

/** base stat gain per XP point */
export const GROWTH_RATE = 0.0016;

const AGE_GROWTH: [number, number][] = [
  [14, 1.3],
  [15, 1.25],
  [18, 1.15],
  [21, 1.02],
  [23, 0.88],
  [25, 0.68],
  [27, 0.46],
  [29, 0.28],
  [31, 0.15],
  [34, 0.07],
  [40, 0.03],
];

const DECLINE: Record<'physical' | 'technical' | 'mental', [number, number][]> = {
  // stat loss per year by age
  physical: [
    [29, 0],
    [30, 0.006],
    [31, 0.013],
    [32, 0.021],
    [33, 0.03],
    [34, 0.042],
    [35, 0.056],
    [36, 0.07],
    [38, 0.09],
    [41, 0.12],
  ],
  technical: [
    [31, 0],
    [32, 0.004],
    [34, 0.012],
    [36, 0.025],
    [38, 0.04],
    [41, 0.06],
  ],
  mental: [
    [34, 0],
    [36, 0.006],
    [40, 0.016],
  ],
};

/** stats that keep improving with experience late into a career */
const EXPERIENCE_STATS: StatName[] = ['mental_calmness', 'mental_vision', 'mental_defensivepositioning', 'mental_offensivepositioning', 'mental_resilience'];

export function ageGrowth(age: number): number {
  return interpolate(AGE_GROWTH, age);
}

export function naturalCap(state: CareerState, stat: StatName): number {
  const f = state.user;
  const i = STAT_NAMES.indexOf(stat);
  return clamp(f.profile[i] * 2 * f.potential + 0.02, 0.12, 1.0);
}

function gapFactor(v: number, cap: number): number {
  if (v < cap) return Math.pow((cap - v) / cap, 0.75) + 0.03;
  return 0.07 * Math.max(0, 1 - (v - cap) / 0.12);
}

export interface XpContext {
  /** 0 light, 1 normal, 2 hard */
  intensity: 0 | 1 | 2;
  /** 'club' sessions use the coach and facilities; 'self' is gym/park/personal work */
  source: 'club' | 'self';
  scale?: number;
}

export function xpMultiplier(state: CareerState, ctx: XpContext): number {
  const f = state.user;
  const c = club(state, f.clubId);
  const coach = coachOf(state, f.clubId);
  let m = INTENSITY[ctx.intensity].xp * (ctx.scale ?? 1);
  if (ctx.source === 'club') {
    m *= 0.8 + (coach?.quality ?? 0.5) * 0.4;
    m *= 0.85 + (c?.facilities ?? 0.5) * 0.3;
  }
  m *= 0.85 + (f.professionalism / 100) * 0.25;
  m *= f.energy >= 50 ? 1 : 0.55 + 0.45 * (f.energy / 50);
  m *= 0.9 + (f.morale / 100) * 0.15;
  if (hasTrait(f, 'professional')) m *= 1.05;
  if (hasTrait(f, 'ambitious')) m *= 1.05;
  if (state.life.education.completed.includes('sports_science')) m *= 1.05;
  if (f.injury) m *= 0.3;
  return m;
}

/** applies XP from a session; returns gains per stat (for feedback) */
export function applyXp(state: CareerState, key: TrainingKey, xp: number): Partial<Record<StatName, number>> {
  const f = state.user;
  const def = trainingDef(key);
  const age = ageAt(f.born, state.day);
  const ag = ageGrowth(age);
  const gains: Partial<Record<StatName, number>> = {};
  for (const [name, w] of def.stats) {
    const stat = name as StatName;
    const v = f.stats[stat];
    const cap = naturalCap(state, stat);
    const dv = xp * w * GROWTH_RATE * ag * gapFactor(v, cap);
    if (dv <= 0) continue;
    f.stats[stat] = clamp(v + dv, 0.01, 1);
    gains[stat] = dv;
  }
  return gains;
}

export interface SessionResult {
  key: TrainingKey;
  energy: number;
  gains: Partial<Record<StatName, number>>;
  injured: boolean;
}

/**
 * The session type that would raise his rating the most right now: sum over the session's stats
 * of (OVR weight at his position) x (session weight) x (room to grow). Used for the "recommended"
 * badge in the training screen and by the auto-policy.
 */
export function bestTrainingFocus(state: CareerState, exclude: TrainingKey[] = []): TrainingKey {
  const f = state.user;
  const w = POSITION_WEIGHTS[f.pos];
  let best: TrainingKey = 'fitness';
  let bestV = -1;
  for (const def of TRAINING) {
    if (def.key === 'recovery' || exclude.includes(def.key)) continue;
    if (def.key === 'goalkeeping' && f.pos !== 'GK') continue;
    let v = 0;
    for (const [name, sw] of def.stats) {
      const stat = name as StatName;
      const i = STAT_NAMES.indexOf(stat);
      v += w[i] * sw * gapFactor(f.stats[stat], naturalCap(state, stat));
    }
    v /= def.energy > 0 ? 0.6 + def.energy / 40 : 1;
    if (v > bestV) {
      bestV = v;
      best = def.key;
    }
  }
  return best;
}

/** a full training session (energy, sharpness, fitness, XP, injury roll) */
export function trainSession(state: CareerState, rng: Rng, key: TrainingKey, ctx: XpContext): SessionResult {
  const f = state.user;
  const def = trainingDef(key);
  const I = INTENSITY[ctx.intensity];
  const stamina = (f.stats.physical_stamina + f.stats.mental_workrate) / 2;
  const scale = ctx.scale ?? 1;
  let energy = def.energy * (def.energy > 0 ? I.energy * (1.15 - stamina * 0.35) : 1) * scale;
  const xp = xpMultiplier(state, ctx);
  const focus = ctx.source === 'club' ? state.life.clubFocus : null;
  const gains = applyXp(state, key, focus && focus !== key && key !== 'recovery' ? xp * 0.7 : xp);
  if (focus && focus !== key && key !== 'recovery') {
    // personal focus inside the group session (extra reps, individual drills)
    for (const [k, v] of Object.entries(applyXp(state, focus as TrainingKey, xp * 0.35))) gains[k as StatName] = (gains[k as StatName] ?? 0) + (v ?? 0);
  }
  f.energy = clamp(f.energy - energy, 0, 100);
  f.sharpness = clamp(f.sharpness + def.sharpness * (0.6 + ctx.intensity * 0.3) * scale, 0, 100);
  f.fitness = clamp(f.fitness + def.fitness * (0.6 + ctx.intensity * 0.35) * scale * (f.fitness > 85 ? 0.4 : 1), 0, 100);
  // injury risk: fatigue, intensity, diet, age and history
  const diet = DIETS.find((d) => d.kind === state.life.diet)!;
  const age = ageAt(f.born, state.day);
  let risk = 0.0022 * def.injury * I.injury * scale;
  risk *= f.energy < 25 ? 2.4 : f.energy < 45 ? 1.5 : 1;
  risk *= f.fitness < 45 ? 1.4 : 1;
  risk *= diet.injury;
  risk *= age > 30 ? 1 + (age - 30) * 0.08 : 1;
  risk *= 1 + Math.min(0.6, f.injuryHistory.filter((h) => state.day - h.day < 365).length * 0.12);
  const injured = !f.injury && rng.chance(risk);
  return { key, energy, gains, injured };
}

/** XP from playing a match: experience in the mental game plus position-relevant work */
export function matchExperience(state: CareerState, minutes: number, rating: number): void {
  const f = state.user;
  if (minutes <= 0) return;
  const share = minutes / 90;
  const quality = 0.7 + clamp((rating - 6) / 3, -0.3, 0.6);
  const age = ageAt(f.born, state.day);
  const ag = Math.max(ageGrowth(age), 0.08);
  for (const stat of EXPERIENCE_STATS) {
    const cap = naturalCap(state, stat);
    const v = f.stats[stat];
    f.stats[stat] = clamp(v + 1.6 * share * quality * GROWTH_RATE * ag * gapFactor(v, cap), 0.01, 1);
  }
  f.sharpness = clamp(f.sharpness + 14 * share, 0, 100);
  f.fitness = clamp(f.fitness + 1.2 * share, 0, 100);
}

/**
 * Daily body changes: puberty growth (physical stats creep up until ~20 regardless of training),
 * age decline after 30, fitness/sharpness drift.
 */
export function dailyDevelopment(state: CareerState): void {
  const f = state.user;
  const age = ageAt(f.born, state.day);
  const diet = DIETS.find((d) => d.kind === state.life.diet)!;
  // natural maturation
  if (age < 20.5) {
    const g = (20.5 - age) / 5.5;
    for (const stat of STAT_NAMES) {
      if (statGroup(stat) !== 'physical') continue;
      const cap = naturalCap(state, stat);
      const v = f.stats[stat];
      if (v < cap) f.stats[stat] = v + 0.00016 * g * gapFactor(v, cap);
    }
  }
  // decline
  let slow = 1;
  slow *= f.fitness > 80 ? 0.78 : f.fitness > 65 ? 0.9 : f.fitness < 40 ? 1.15 : 1;
  slow *= diet.kind === 'nutritionist' ? 0.85 : diet.kind === 'balanced' ? 0.93 : diet.kind === 'junk' ? 1.1 : 1;
  slow *= 1.1 - f.professionalism / 500;
  for (const stat of STAT_NAMES) {
    const group = statGroup(stat);
    const perYear = interpolate(DECLINE[group], age);
    if (perYear <= 0) continue;
    const loss = (perYear / 365) * (group === 'physical' ? slow : 1);
    f.stats[stat] = clamp(f.stats[stat] - loss, 0.01, 1);
  }
  // conditioning drifts down without work, sharpness fades without matches
  f.fitness = clamp(f.fitness - 0.35 + diet.fitness, 0, 100);
  f.sharpness = clamp(f.sharpness - 0.9, 0, 100);
}

/**
 * The coach's session plan: recovery the day after a match, tactical work and set pieces just
 * before one, and style-driven work (pressing coaches run, possession coaches pass) otherwise.
 * Goalkeepers do goalkeeping in most sessions. Returns null on a day off.
 */
export function clubSessionFor(state: CareerState, day: number): TrainingKey | null {
  const f = state.user;
  const coach = coachOf(state, f.clubId);
  const wd = weekday(day);
  // academy players follow the U19 schedule, first-team players the first team's
  const mine = (d: number) => fixturesOn(state, d).some((x) => (x.home === f.clubId || x.away === f.clubId) && !x.national && (f.squad === 'youth' ? !!x.youth : !x.youth));
  if (mine(day)) return null;
  if (wd === 6) return null; // Sunday off
  if (mine(day - 1)) return 'recovery';
  // the day before a match: sharpen up (set pieces / tactical shape); otherwise normal work
  if (mine(day + 1)) return f.pos === 'GK' ? 'goalkeeping' : wd % 2 === 0 ? 'setpieces' : 'tactical';
  const style = coach?.style ?? 'balanced';
  const rotation: Record<string, TrainingKey[]> = {
    pressing: ['fitness', 'speed', 'defending', 'passing', 'fitness', 'ballcontrol'],
    possession: ['passing', 'ballcontrol', 'tactical', 'passing', 'finishing', 'speed'],
    direct: ['strength', 'finishing', 'fitness', 'defending', 'setpieces', 'speed'],
    counter: ['speed', 'defending', 'finishing', 'fitness', 'passing', 'strength'],
    balanced: ['fitness', 'passing', 'finishing', 'defending', 'ballcontrol', 'speed'],
  };
  const list = rotation[style];
  // cycle through the rotation by training day (not calendar day) so every type comes up
  const key = list[(Math.floor(day / 7) * 5 + wd + (coach?.id ?? 0)) % list.length];
  if (f.pos === 'GK' && key !== 'fitness' && key !== 'strength') return 'goalkeeping';
  return key;
}
