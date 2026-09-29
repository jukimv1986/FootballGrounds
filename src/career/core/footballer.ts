// The user's footballer: creation from the character creator, derived ratings (OVR per position,
// potential, market value) and the "match condition" that turns meters into performance.
//
// Talent sets where he starts and how high he can go (potential = peak mean ability). Traits are
// personality: they bias his profile a little and, more importantly, how the world reacts to him
// (coaches, media, nightlife, family). See training.ts for how stats grow.

import { POSITION_PROFILE, STAT_COUNT, STAT_NAMES, arrayToStats, ovrFromStatArray, statsFromProfile, statsToArray, type Position, type Stats } from './attributes';
import { ageAt, dayOf } from './dates';
import { marketValue } from './players';
import { Rng, clamp } from './rng';
import { emptyLine } from './players';
import type { CareerState, Contract, Footballer, TraitKey } from './types';

export type Talent = 'grafter' | 'promising' | 'wonderkid';

export interface CreatorInput {
  first: string;
  last: string;
  nat: string;
  age: 15 | 16;
  birthMonth: number;
  birthDay: number;
  pos: Position;
  foot: 'L' | 'R';
  height: number;
  weight: number;
  skin: number;
  hair: string;
  hairColor: string;
  traits: TraitKey[];
  talent: Talent;
  /** club whose academy he joins */
  clubId: number;
  romance: boolean;
  difficulty: 'easy' | 'normal' | 'hard';
  shirt: number;
}

export const TRAITS: { key: TraitKey; name: string; desc: string; excludes?: TraitKey[] }[] = [
  { key: 'ambitious', name: 'Ambitious', desc: 'Wants the biggest stage. Trains harder, hates the bench, attracts scouts.' },
  { key: 'loyal', name: 'Loyal', desc: 'Values his club and fans. Happier staying put; fans adore him.' },
  { key: 'professional', name: 'Model professional', desc: 'Lives like an athlete. Coaches trust him; nights out feel wrong.', excludes: ['party'] },
  { key: 'party', name: 'Party animal', desc: 'Loves a night out. Social life matters more — and costs more.', excludes: ['professional', 'introvert'] },
  { key: 'leader', name: 'Natural leader', desc: 'Commands the dressing room. Teammates follow; captaincy beckons.' },
  { key: 'humble', name: 'Humble', desc: 'Grounded and kind. Media and fans warm to him.' },
  { key: 'hothead', name: 'Hot-headed', desc: 'Plays with fire. More cards, more drama, more passion.', excludes: ['humble'] },
  { key: 'family', name: 'Family-oriented', desc: 'Family is everything. Their support matters twice as much.' },
  { key: 'media', name: 'Media darling', desc: 'Born for the cameras. Followers and sponsors come easily.', excludes: ['introvert'] },
  { key: 'introvert', name: 'Introvert', desc: 'Needs quiet time. Less social need, uneasy with the press.', excludes: ['media', 'party'] },
  { key: 'flair', name: 'Flair player', desc: 'Tricks and audacity. Better dribbling, higher highs and lower lows.' },
  { key: 'resilient', name: 'Resilient', desc: 'Bounces back. Recovers faster from injuries and setbacks.' },
];

export const TALENTS: { key: Talent; name: string; desc: string; start: number; potential: number }[] = [
  { key: 'grafter', name: 'Hard worker', desc: 'Nobody\'s wonderkid. Every step up will be earned.', start: 0.365, potential: 0.74 },
  { key: 'promising', name: 'Promising', desc: 'Scouts have noticed. A real shot at the top flight.', start: 0.4, potential: 0.81 },
  { key: 'wonderkid', name: 'Wonderkid', desc: 'The next big thing — if he handles the pressure.', start: 0.445, potential: 0.885 },
];

const TRAIT_PROFILE: Partial<Record<TraitKey, [number, number][]>> = {
  // stat index, delta
  flair: [[10, 0.08], [9, 0.05], [5, 0.04], [17, -0.04]],
  leader: [[17, 0.05], [18, 0.05], [16, 0.03]],
  resilient: [[18, 0.07], [4, 0.03]],
  professional: [[17, 0.04], [19, 0.02], [20, 0.02]],
  hothead: [[16, -0.06], [7, 0.04], [6, 0.03]],
};

/**
 * Birth day of a player who is exactly `age` (whole years) on the season's start date (1 July):
 * a birthday after 1 July falls in the year before.
 */
export function birthDayFor(age: number, month: number, day: number, startSeason: number): number {
  const afterStart = month > 7 || (month === 7 && day > 1);
  return dayOf(startSeason - age - (afterStart ? 1 : 0), month, day);
}

export function hasTrait(f: Footballer, t: TraitKey): boolean {
  return f.traits.includes(t);
}

export function createFootballer(input: CreatorInput, startSeason: number, rng: Rng, contract: Contract): Footballer {
  const talent = TALENTS.find((t) => t.key === input.talent) ?? TALENTS[1];
  const born = birthDayFor(input.age, input.birthMonth, input.birthDay, startSeason);
  // personal profile: position profile + traits + body type + a little randomness
  const p = [...POSITION_PROFILE[input.pos]];
  for (const t of input.traits) for (const [i, d] of TRAIT_PROFILE[t] ?? []) p[i] += d;
  const tall = (input.height - 1.8) / 0.1; // +1 per 10cm above 1.80
  p[13] += tall * 0.05; // header
  p[0] += tall * 0.03 + (input.weight - 74) * 0.003; // balance
  p[5] -= tall * 0.03; // agility
  p[2] -= tall * 0.025; // acceleration
  for (let i = 0; i < STAT_COUNT; i++) p[i] += rng.gauss(0, 0.03);
  const avg = p.reduce((a, b) => a + b, 0) / p.length;
  const profile = p.map((v) => clamp(v + 0.5 - avg, 0.06, 0.95));
  const age = ageAt(born, dayOf(startSeason, 7, 1));
  const ability = talent.start + (age - 15.5) * 0.03 + rng.gauss(0, 0.008);
  const arr = statsFromProfile(profile, ability).map((v) => clamp(v + rng.gauss(0, 0.012), 0.03, 0.95));
  const stats = arrayToStats(arr);
  const potential = clamp(talent.potential + rng.gauss(0, 0.025) + (input.difficulty === 'easy' ? 0.03 : input.difficulty === 'hard' ? -0.02 : 0), 0.6, 0.95);
  const prof = input.traits.includes('professional') ? 72 : input.traits.includes('party') ? 38 : 52;
  return {
    first: input.first,
    last: input.last,
    nat: input.nat,
    born,
    pos: input.pos,
    foot: input.foot,
    height: input.height,
    weight: input.weight,
    skin: input.skin,
    hair: input.hair,
    hairColor: input.hairColor,
    shirt: input.shirt,
    traits: [...input.traits],
    stats,
    seasonStartStats: { ...stats },
    weekStartStats: { ...stats },
    profile,
    potential,
    form: 55,
    morale: 72,
    fitness: 68,
    energy: 100,
    sharpness: 35,
    professionalism: prof,
    rep: { local: 4, national: 1, world: 0 },
    followers: 120 + rng.int(0, 150),
    injury: null,
    injuryHistory: [],
    banned: 0,
    yellows: 0,
    clubId: input.clubId,
    squad: 'youth',
    contract,
    season: { league: emptyLine(), cup: emptyLine(), continental: emptyLine(), youth: emptyLine(), international: emptyLine() },
    totals: emptyLine(),
    ratings: [],
    history: [],
    trophies: [],
    awards: [],
    caps: 0,
    intlGoals: 0,
    national: 'none',
    attendance: 1,
    effort: 0.6,
    marketValue: 0,
    transferRequest: false,
    retireOffered: false,
  };
}

export function userAge(state: CareerState): number {
  return ageAt(state.user.born, state.day);
}

export function userStatArray(f: Footballer): number[] {
  return statsToArray(f.stats);
}

export function userOvr(f: Footballer, pos: Position = f.pos): number {
  return ovrFromStatArray(statsToArray(f.stats), pos);
}

/** rating he'd have at his potential (peak mean ability) with his natural profile */
export function potentialOvr(f: Footballer): number {
  const peakStats = statsFromProfile(f.profile, f.potential);
  const cur = statsToArray(f.stats);
  // never below what he already is
  return Math.max(ovrFromStatArray(cur, f.pos), ovrFromStatArray(peakStats, f.pos));
}

/** scouts' estimate of potential: a range that narrows as he gets older */
export function potentialRange(state: CareerState): [number, number] {
  const f = state.user;
  const p = potentialOvr(f);
  const age = userAge(state);
  const spread = clamp((24 - age) * 1.1, 1, 9);
  const bias = Math.sin(f.born * 0.37) * spread * 0.4;
  return [Math.round(clamp(p - spread + bias, 1, 99)), Math.round(clamp(p + spread + bias, 1, 99))];
}

/**
 * Match condition multiplier (0.8 .. 1.06) on his rating: fitness, sharpness, morale, energy and
 * form all matter. This is what makes the life systems count on the pitch.
 */
export function conditionFactor(f: Footballer): number {
  const fit = 0.9 + 0.1 * (f.fitness / 100);
  const sharp = 0.94 + 0.06 * (f.sharpness / 100);
  const mood = 0.965 + 0.045 * (f.morale / 100);
  const energy = f.energy >= 50 ? 1 : 0.9 + 0.1 * (f.energy / 50);
  const form = 0.97 + 0.05 * (f.form / 100);
  return fit * sharp * mood * energy * form;
}

export function refreshMarketValue(state: CareerState): void {
  const f = state.user;
  const rep = Math.max(f.rep.local * 0.3, f.rep.national * 0.8, f.rep.world);
  f.marketValue = marketValue(userOvr(f), userAge(state), potentialOvr(f), rep);
}

export function fullName(f: { first: string; last: string }): string {
  return `${f.first} ${f.last}`;
}

export function statsCopy(s: Stats): Stats {
  const out = {} as Stats;
  for (const n of STAT_NAMES) out[n] = s[n];
  return out;
}
