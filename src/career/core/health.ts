// Injuries of the user's footballer: occurrence (from training, matches and risky activities),
// durations scaled by age and traits, permanent damage from the worst ones, career-ending risk
// for veterans, rehab choices (via a narrative event), daily recovery and the return to fitness.

import { ageAt, formatDate } from './dates';
import { INJURIES, REHAB_OPTIONS, type InjuryDef } from './data/injuries';
import { hasTrait } from './footballer';
import { addMessage, addNotice, addTimeline } from './messages';
import { Rng, clamp } from './rng';
import type { CareerState, Injury } from './types';

export type InjurySource = 'training' | 'match' | 'activity';

export function startUserInjury(state: CareerState, rng: Rng, source: InjurySource): Injury {
  const f = state.user;
  const age = ageAt(f.born, state.day);
  const def: InjuryDef = rng.weighted(INJURIES, (i) => {
    let w = i.weight;
    if (source === 'activity') w *= i.severity < 0.2 ? 2.5 : 0.3;
    if (source === 'training' && (i.key === 'hamstring' || i.key === 'calf' || i.key === 'groin')) w *= 1.8;
    if (source === 'match' && (i.key === 'ankle' || i.key === 'mcl' || i.key === 'acl' || i.key === 'knock')) w *= 1.4;
    return w;
  });
  let days = rng.int(def.minDays, def.maxDays);
  days *= 1 + Math.max(0, age - 29) * 0.045;
  if (hasTrait(f, 'resilient')) days *= 0.85;
  days = Math.max(1, Math.round(days));
  const injury: Injury = { key: def.key, name: def.name, until: state.day + days, startDay: state.day, severity: def.severity, rehab: def.severity >= 0.2 ? null : 'standard' };
  f.injury = injury;
  f.injuryHistory.unshift({ name: def.name, day: state.day, days });
  if (f.injuryHistory.length > 30) f.injuryHistory.length = 30;
  if (def.permanent) {
    for (const s of ['physical_velocity', 'physical_acceleration', 'physical_agility'] as const) f.stats[s] = clamp(f.stats[s] * (1 - def.permanent * rng.range(0.6, 1.3)), 0.01, 1);
  }
  f.morale = clamp(f.morale - 4 - def.severity * 18, 0, 100);
  addTimeline(state, `Injured: ${def.name} (${days} days)`, 'bad');
  addNotice(state, `Injury: ${def.name} — out for about ${days < 14 ? `${days} days` : `${Math.round(days / 7)} weeks`}.`, 'bad');
  addMessage(state, {
    from: 'Club medical department',
    kind: 'club',
    subject: `Scan results: ${def.name}`,
    body: `The scans confirm a ${def.name.toLowerCase()}. Expected return: ${formatDate(injury.until)}. ${def.severity >= 0.2 ? 'Come and see us to agree a rehab plan.' : 'Rest up, it is nothing serious.'}`,
  });
  // veterans can be forced to stop
  if (def.careerEnding && age > 31 && rng.chance(def.careerEnding * clamp((age - 30) / 5, 0.3, 1.6))) {
    state.events.flags.careerEndingInjury = state.day;
  }
  if (injury.rehab === null) state.events.queue.push({ defId: 'rehab_choice', day: state.day, ctx: { days, injury: def.name } });
  return injury;
}

export function applyRehabChoice(state: CareerState, key: 'standard' | 'aggressive' | 'specialist'): void {
  const f = state.user;
  if (!f.injury) return;
  const opt = REHAB_OPTIONS.find((o) => o.key === key)!;
  const left = f.injury.until - state.day;
  f.injury.until = state.day + Math.max(1, Math.round(left / opt.speed));
  f.injury.rehab = key;
  if (key === 'aggressive') {
    state.events.flags.reinjuryUntil = f.injury.until + 30;
    state.events.flags.reinjuryMult = opt.reinjury;
  } else if (key === 'specialist') {
    state.events.flags.reinjuryUntil = f.injury.until + 30;
    state.events.flags.reinjuryMult = opt.reinjury;
  }
}

/** extra injury-risk multiplier after a rushed comeback */
export function reinjuryMultiplier(state: CareerState): number {
  const until = state.events.flags.reinjuryUntil ?? 0;
  return state.day <= until ? state.events.flags.reinjuryMult ?? 1 : 1;
}

/** cost of the private specialist */
export function specialistCost(state: CareerState): number {
  const f = state.user;
  const days = f.injury ? f.injury.until - state.day : 30;
  return Math.round(2000 + days * 250);
}

/** daily injury bookkeeping: recovery, fitness loss while out */
export function dailyHealth(state: CareerState): void {
  const f = state.user;
  if (!f.injury) return;
  f.fitness = clamp(f.fitness - 0.45, 20, 100);
  f.sharpness = clamp(f.sharpness - 0.6, 0, 100);
  if (state.day >= f.injury.until) {
    addNotice(state, `Back in training after the ${f.injury.name.toLowerCase()}.`, 'good');
    addTimeline(state, 'Fit again!', 'good');
    f.morale = clamp(f.morale + 6, 0, 100);
    f.injury = null;
  }
}

/** rehab / physio sessions shorten the lay-off a little */
export function rehabProgress(state: CareerState, amountDays: number): void {
  const f = state.user;
  if (!f.injury) return;
  f.injury.until = Math.max(state.day + 1, f.injury.until - amountDays);
}
