// City & life: the city (character, cost of living, your district), a map-like grid of venues
// and, per venue, the activities you can do now or plan for an upcoming free slot — with their
// energy/money cost and effects.

import { h, dataUrl } from '../../../ui/dom';
import { slotInfo } from '../../core/career';
import { SLOT_NAMES, WEEKDAYS_SHORT, formatDate, weekday, type Slot } from '../../core/dates';
import { ACTIVITIES, VENUES, type ActivityDef, type VenueKey } from '../../core/data/lifestyle';
import { nationName } from '../../core/data/geography';
import { city } from '../../core/index';
import { activityBlocked, activityCost, housingDef, setOverride, venuesIn } from '../../core/life';
import type { CareerApp } from '../app';
import { card, money, pill } from '../components';
import { activityOptions } from '../pickers';

const EFFECT_LABELS: [keyof ActivityDef['effects'], string][] = [
  ['morale', 'Morale'],
  ['social', 'Social'],
  ['romance', 'Romance'],
  ['family', 'Family'],
  ['fitness', 'Fitness'],
  ['professionalism', 'Pro'],
  ['repLocal', 'Fans'],
  ['relax', 'Relax'],
  ['coach', 'Coach'],
  ['teammates', 'Teammates'],
];

export function effectPills(def: ActivityDef): HTMLElement[] {
  const e = def.effects;
  const out: HTMLElement[] = [];
  if (e.energy) out.push(pill(e.energy > 0 ? `Energy −${e.energy}` : `Energy +${-e.energy}`, e.energy > 15 ? 'warn' : e.energy < 0 ? 'good' : 'dim'));
  for (const [k, label] of EFFECT_LABELS) {
    const v = e[k] as number | undefined;
    if (!v) continue;
    out.push(pill(`${label} ${v > 0 ? '+' : '−'}`, v > 0 ? 'good' : 'bad'));
  }
  if (e.followers) out.push(pill('Followers +', 'good'));
  if (e.train) out.push(pill(`Training: ${Object.keys(e.train).join(', ')}`, 'info'));
  if (e.sleepPenalty && e.sleepPenalty < 1) out.push(pill('Bad night', 'bad'));
  if (e.sleepPenalty && e.sleepPenalty > 1) out.push(pill('Good night', 'good'));
  if (e.injuryRisk) out.push(pill('Injury risk', 'bad'));
  if (def.special === 'extra_training') out.push(pill('Choose a focus', 'info'));
  return out;
}

/** upcoming free slots (next 3 days) where this activity can be planned */
function planSlots(app: CareerApp, def: ActivityDef): { day: number; slot: Slot; label: string }[] {
  const s = app.state;
  const out: { day: number; slot: Slot; label: string }[] = [];
  for (let d = s.day; d < s.day + 4 && out.length < 6; d++) {
    for (const slot of [0, 1, 2] as Slot[]) {
      if (d === s.day && slot < s.slot) continue;
      if (!def.slots.includes(slot as 0 | 1 | 2)) continue;
      const info = slotInfo(s, d, slot);
      if (info.kind !== 'free') continue;
      out.push({ day: d, slot, label: `${d === s.day ? 'Today' : d === s.day + 1 ? 'Tomorrow' : WEEKDAYS_SHORT[weekday(d)]} ${SLOT_NAMES[slot].toLowerCase()}` });
    }
  }
  return out;
}

export function renderCity(app: CareerApp): HTMLElement {
  const s = app.state;
  const c = city(s, s.life.cityId);
  const district = c.districts[s.life.district];
  const venues = venuesIn(s);
  const selected = (app.sub.city as VenueKey | undefined) ?? 'home';
  const nowInfo = slotInfo(s, s.day, s.slot);
  const nowFree = nowInfo.kind === 'free' && !s.pendingMatch;

  const hero = h(
    'section',
    { class: 'cc-city-hero', style: `--bg: url("${dataUrl('media/menu/backgrounds/megabackground01.jpg')}")` },
    h('div', { class: 'cc-city-hero-text' }, h('div', { class: 'cc-kicker' }, nationName(c.countryKey)), h('h2', {}, c.name), h('p', {}, c.blurb)),
    h(
      'div',
      { class: 'cc-city-facts' },
      pill(`Cost of living ×${c.cost.toFixed(2)}`, c.cost > 1.2 ? 'warn' : 'dim'),
      pill(c.coastal ? 'Coastal' : 'Inland', 'dim'),
      pill(`You live in ${district.name}`, 'info'),
      pill(housingDef(s.life.housing.kind).name, 'dim'),
    ),
  );

  const districtCard = card('Your district', [
    h('p', {}, h('strong', {}, district.name), ` — ${district.blurb}`),
    h('div', { class: 'cc-pills' }, pill(`${district.commute} min to training`, district.commute > 28 ? 'warn' : 'good'), pill(`Nightlife ${Math.round(district.fun * 10)}/10`, 'dim'), pill(`Calm ${Math.round(district.calm * 10)}/10`, 'dim'), pill(`Prestige ${Math.round(district.prestige * 10)}/10`, 'dim')),
    h('p', { class: 'cc-dim' }, 'Move house on the Money & Home page. Calm districts help you sleep; lively ones feed your social life.'),
  ]);

  const grid = h(
    'div',
    { class: 'cc-venues', role: 'list' },
    ...VENUES.filter((v) => venues.includes(v.key)).map((v) => {
      const acts = ACTIVITIES.filter((a) => a.venue === v.key);
      const availableNow = nowFree ? acts.filter((a) => !activityBlocked(s, a, s.slot)).length : 0;
      return h(
        'button',
        { class: `cc-venue ${v.key === selected ? 'is-selected' : ''}`, type: 'button', role: 'listitem', onclick: () => ((app.ui['scroll-to'] = '.cc-venue-panel'), app.setSub(v.key)) },
        h('span', { class: 'cc-venue-glyph', 'aria-hidden': 'true' }, v.glyph),
        h('span', { class: 'cc-venue-name' }, v.name),
        h('span', { class: 'cc-venue-desc' }, v.desc),
        nowFree ? h('span', { class: `cc-venue-count ${availableNow ? '' : 'is-none'}` }, availableNow ? `${availableNow} now` : 'closed now') : null,
      );
    }),
  );

  const venue = VENUES.find((v) => v.key === selected) ?? VENUES[0];
  const acts = ACTIVITIES.filter((a) => a.venue === venue.key);
  const options = activityOptions(s, nowFree ? s.slot : 1);
  const list = acts.map((a) => {
    const blockedNow = nowFree ? activityBlocked(s, a, s.slot) : 'Not a free slot right now';
    const cost = activityCost(s, a);
    const slots = planSlots(app, a);
    const variants = options.filter((o) => o.value.split(':')[0] === a.key && o.value.includes(':'));
    let variantSel: HTMLSelectElement | null = null;
    if (variants.length) variantSel = h('select', { class: 'cc-select cc-select--sm', 'aria-label': `${a.name} option` }, ...variants.map((o) => h('option', { value: o.value }, o.label)));
    const keyOf = () => variantSel?.value ?? a.key;
    const planSel = slots.length
      ? h(
          'select',
          {
            class: 'cc-select cc-select--sm',
            'aria-label': `Plan ${a.name}`,
            onchange: (e: Event) => {
              const v = (e.target as HTMLSelectElement).value;
              if (!v) return;
              const [d, sl] = v.split(':').map(Number);
              setOverride(s, d, sl as Slot, keyOf());
              app.toast(`${a.name} planned: ${formatDate(d)} ${SLOT_NAMES[sl].toLowerCase()}`, 'success');
              app.render();
            },
          },
          h('option', { value: '' }, 'Plan for…'),
          ...slots.map((x) => h('option', { value: `${x.day}:${x.slot}`, disabled: activityBlocked(s, a, x.slot) && activityBlocked(s, a, x.slot) !== 'Not at this time of day' ? true : undefined }, x.label)),
        )
      : null;
    return h(
      'article',
      { class: `cc-activity ${blockedNow ? 'is-blocked' : ''}` },
      h('header', {}, h('h4', {}, a.name), h('span', { class: 'cc-activity-cost' }, cost > 0 ? money(s, cost) : 'Free')),
      h('p', { class: 'cc-dim' }, a.desc),
      h('div', { class: 'cc-pills' }, ...effectPills(a), pill(a.slots.map((x) => SLOT_NAMES[x].toLowerCase()).join(' / '), 'dim')),
      h(
        'div',
        { class: 'cc-row-actions' },
        variantSel,
        h(
          'button',
          {
            class: 'btn btn--primary cc-btn-sm',
            type: 'button',
            disabled: blockedNow ? true : undefined,
            title: blockedNow ?? '',
            onclick: () => {
              setOverride(s, s.day, s.slot, keyOf());
              app.advance('slot');
              const last = s.life.lastActivity;
              if (last) app.toast(last.summary, 'info');
            },
          },
          h('span', {}, 'Do it now'),
        ),
        planSel,
      ),
      blockedNow && nowFree ? h('p', { class: 'cc-blocked' }, blockedNow) : null,
    );
  });

  return h(
    'div',
    { class: 'cc-page cc-city' },
    hero,
    h('div', { class: 'cc-grid cc-grid--city' }, h('div', {}, h('h2', { class: 'cc-h2' }, 'Where to?'), nowFree ? h('p', { class: 'cc-dim' }, `It is ${SLOT_NAMES[s.slot].toLowerCase()} and you are free.`) : h('p', { class: 'cc-dim' }, `Right now: ${nowInfo.label}. You can still plan ahead.`), grid), districtCard),
    card(`${venue.glyph} ${venue.name}`, [h('p', { class: 'cc-dim' }, venue.desc), h('div', { class: 'cc-activities' }, ...list)], { className: 'cc-venue-panel' }),
  );
}
