// Activity pickers shared by the hub, planner and city screens.

import { h } from '../../ui/dom';
import type { Slot } from '../core/dates';
import { ACTIVITIES, HOBBIES, TRAINING, VENUES, activityDef } from '../core/data/lifestyle';
import { activityBlocked, venuesIn } from '../core/life';
import { POST_OPTIONS } from '../core/social';
import type { CareerState } from '../core/types';

export interface ActivityOption {
  value: string;
  label: string;
  group: string;
  blocked: string | null;
}

/** every choice for a free slot, grouped by venue; parameterised variants included */
export function activityOptions(state: CareerState, slot: Slot): ActivityOption[] {
  const venues = venuesIn(state);
  const out: ActivityOption[] = [];
  for (const v of VENUES) {
    if (!venues.includes(v.key)) continue;
    for (const a of ACTIVITIES.filter((x) => x.venue === v.key && x.slots.includes(slot as 0 | 1 | 2))) {
      const blocked = activityBlocked(state, a, slot);
      if (a.special === 'extra_training') {
        for (const t of TRAINING) {
          if (t.key === 'recovery' || (t.key === 'goalkeeping' && state.user.pos !== 'GK')) continue;
          out.push({ value: `${a.key}:${t.key}`, label: `Extra training: ${t.name}`, group: v.name, blocked });
        }
      } else if (a.special === 'post') {
        for (const p of POST_OPTIONS) out.push({ value: `${a.key}:${p.key}`, label: `Post: ${p.label}`, group: v.name, blocked });
      } else if (a.special === 'hobby') {
        const owned = Object.keys(state.life.hobbies);
        if (owned.length === 0) out.push({ value: a.key, label: a.name, group: v.name, blocked });
        for (const k of owned) out.push({ value: `${a.key}:${k}`, label: `Hobby: ${HOBBIES.find((x) => x.key === k)?.name ?? k}`, group: v.name, blocked });
      } else out.push({ value: a.key, label: a.name, group: v.name, blocked });
    }
  }
  return out;
}

export function activityLabel(value: string | null): string {
  if (!value) return 'Club schedule';
  const [k, p] = value.split(':');
  const def = activityDef(k);
  if (!def) return k;
  if (k === 'extra_training' && p) return `Extra: ${TRAINING.find((t) => t.key === p)?.name ?? p}`;
  if (k === 'social_post' && p) return `Post: ${POST_OPTIONS.find((o) => o.key === p)?.label ?? p}`;
  if (k === 'hobby' && p) return HOBBIES.find((x) => x.key === p)?.name ?? def.name;
  return def.name;
}

export function activitySelect(state: CareerState, slot: Slot, value: string | null, onChange: (v: string) => void, opts: { className?: string; label?: string } = {}): HTMLSelectElement {
  const options = activityOptions(state, slot);
  const groups = new Map<string, ActivityOption[]>();
  for (const o of options) {
    const g = groups.get(o.group) ?? [];
    g.push(o);
    groups.set(o.group, g);
  }
  const sel = h(
    'select',
    { class: `cc-select ${opts.className ?? ''}`, 'aria-label': opts.label ?? 'Activity', onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) },
    ...[...groups.entries()].map(([g, list]) =>
      h('optgroup', { label: g }, ...list.map((o) => h('option', { value: o.value, disabled: o.blocked ? true : undefined, selected: o.value === value ? true : undefined }, o.blocked ? `${o.label} — ${o.blocked}` : o.label))),
    ),
  );
  if (value && !options.some((o) => o.value === value)) {
    sel.prepend(h('option', { value, selected: true }, activityLabel(value)));
  }
  return sel;
}
