// Narrative event engine (data-driven).
//
// An EventDef declares when it can happen (trigger point + condition), how likely it is (weight =
// chance per check), cooldowns / one-off flags, how to fill its context (a teammate's name, the
// next opponent…) and a set of choices, each with an effect function that returns the outcome
// text. Effects can schedule follow-up events (pushed to the queue with a due day), so stories
// unfold over days or weeks: a night out -> tabloid photos -> a meeting with the coach.
//
// The career loop calls rollEvents() at fixed trigger points; when an event fires it becomes
// `state.events.pending` and advancing stops until the UI (or the headless auto-policy) resolves
// it with resolveEvent().

import { EVENT_DEFS } from './eventdefs';
import { Rng } from './rng';
import type { CareerState, EventInstance } from './types';

export type EventTrigger = 'morning' | 'evening' | 'matchEve' | 'postMatch' | 'weekly' | 'queued';

export type EventCtx = Record<string, string | number>;

export interface EventChoice {
  label: string;
  /** short effect preview shown under the button */
  hint?: string;
  /** false or a reason string when the choice is not possible */
  available?: (s: CareerState, ctx: EventCtx) => true | string;
  apply: (s: CareerState, ctx: EventCtx, rng: Rng) => string;
  /** preference of the headless auto-policy (higher = more likely) */
  auto?: number | ((s: CareerState) => number);
}

export interface EventDef {
  id: string;
  category: 'club' | 'media' | 'life' | 'family' | 'romance' | 'health' | 'career' | 'national' | 'money' | 'social';
  trigger: EventTrigger;
  title: (s: CareerState, ctx: EventCtx) => string;
  text: (s: CareerState, ctx: EventCtx) => string;
  condition?: (s: CareerState) => boolean;
  /** chance per check (0..1) */
  weight?: (s: CareerState) => number;
  cooldown?: number;
  once?: boolean;
  /** fills the context; returning null cancels the event */
  prepare?: (s: CareerState, rng: Rng) => EventCtx | null;
  choices: EventChoice[];
}

let defsById: Map<string, EventDef> | null = null;
export function eventDef(id: string): EventDef | undefined {
  if (!defsById) defsById = new Map(EVENT_DEFS.map((d) => [d.id, d]));
  return defsById.get(id);
}

function eligible(state: CareerState, d: EventDef): boolean {
  const ev = state.events;
  if (d.once && ev.counts[d.id]) return false;
  if (d.cooldown && ev.log[d.id] !== undefined && state.day - ev.log[d.id] < d.cooldown) return false;
  if (d.category === 'romance' && !state.settings.romance) return false;
  if (d.condition && !d.condition(state)) return false;
  return true;
}

/** checks due follow-ups, then rolls random events of this trigger; returns true if one is pending */
export function rollEvents(state: CareerState, trigger: EventTrigger, rng: Rng): boolean {
  const ev = state.events;
  if (ev.pending) return true;
  // queued follow-ups first (any trigger point once due)
  const dueIdx = ev.queue.findIndex((q) => q.day <= state.day);
  if (dueIdx >= 0) {
    const inst = ev.queue.splice(dueIdx, 1)[0];
    const def = eventDef(inst.defId);
    if (def && (!def.condition || def.condition(state)) && !(def.category === 'romance' && !state.settings.romance)) {
      const ctx = def.prepare ? def.prepare(state, rng) : {};
      if (ctx) {
        ev.pending = { defId: def.id, day: state.day, ctx: { ...inst.ctx, ...ctx } };
        return true;
      }
    }
  }
  if (trigger === 'queued') return false;
  const candidates = EVENT_DEFS.filter((d) => d.trigger === trigger && eligible(state, d));
  const firing: EventDef[] = [];
  for (const d of candidates) {
    const p = d.weight ? d.weight(state) : 0.02;
    if (p > 0 && rng.chance(p)) firing.push(d);
  }
  if (firing.length === 0) return false;
  const def = rng.pick(firing);
  const ctx = def.prepare ? def.prepare(state, rng) : {};
  if (!ctx) return false;
  ev.pending = { defId: def.id, day: state.day, ctx };
  return true;
}

export function pendingEvent(state: CareerState): { inst: EventInstance; def: EventDef } | null {
  const inst = state.events.pending;
  if (!inst) return null;
  const def = eventDef(inst.defId);
  if (!def) {
    state.events.pending = null;
    return null;
  }
  return { inst, def };
}

export function choiceAvailable(state: CareerState, c: EventChoice, ctx: EventCtx): true | string {
  return c.available ? c.available(state, ctx) : true;
}

/** applies a choice; returns the outcome text */
export function resolveEvent(state: CareerState, choiceIndex: number, rng: Rng): string {
  const p = pendingEvent(state);
  if (!p) return '';
  const choice = p.def.choices[choiceIndex] ?? p.def.choices[0];
  const ok = choiceAvailable(state, choice, p.inst.ctx);
  const chosen = ok === true ? choice : p.def.choices.find((c) => choiceAvailable(state, c, p.inst.ctx) === true) ?? choice;
  state.events.pending = null;
  state.events.log[p.def.id] = state.day;
  state.events.counts[p.def.id] = (state.events.counts[p.def.id] ?? 0) + 1;
  const outcome = chosen.apply(state, p.inst.ctx, rng);
  state.timeline.unshift({ day: state.day, slot: state.slot, text: `${p.def.title(state, p.inst.ctx)}: ${chosen.label}`, tone: 'info' });
  if (state.timeline.length > 40) state.timeline.length = 40;
  return outcome;
}

/** headless policy: weighted by each choice's `auto` preference */
export function autoResolve(state: CareerState, rng: Rng): string {
  const p = pendingEvent(state);
  if (!p) return '';
  const options = p.def.choices.map((c, i) => ({ c, i })).filter(({ c }) => choiceAvailable(state, c, p.inst.ctx) === true);
  if (options.length === 0) return resolveEvent(state, 0, rng);
  const pick = rng.weighted(options, ({ c }) => (typeof c.auto === 'function' ? c.auto(state) : c.auto ?? 1));
  return resolveEvent(state, pick.i, rng);
}

export function queueEvent(state: CareerState, defId: string, inDays: number, ctx: EventCtx = {}): void {
  state.events.queue.push({ defId, day: state.day + inDays, ctx });
}
