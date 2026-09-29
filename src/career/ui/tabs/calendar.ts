// Planner: the next 7 days (club sessions, matches, school are fixed; free slots can be planned
// for a specific date), the weekly template the career follows by default, and the fixture list
// with the season's key dates.

import { h } from '../../../ui/dom';
import { slotInfo, upcomingUserFixtures } from '../../core/career';
import { seasonCalendar, teamName } from '../../core/competitions';
import { SLOT_NAMES, WEEKDAYS, WEEKDAYS_SHORT, formatDate, weekday, type Slot } from '../../core/dates';
import { comp } from '../../core/index';
import { setOverride } from '../../core/life';
import { trainingDef } from '../../core/data/lifestyle';
import type { CareerApp } from '../app';
import { btn, card, crest, pill } from '../components';
import { activityLabel, activitySelect } from '../pickers';

function tabs(app: CareerApp, current: string): HTMLElement {
  const mk = (key: string, label: string) => h('button', { class: `tab ${current === key ? 'is-active' : ''}`, type: 'button', onclick: () => app.setSub(key) }, label);
  return h('div', { class: 'tabs cc-subtabs' }, mk('week', 'This week'), mk('template', 'Weekly routine'), mk('fixtures', 'Fixtures & dates'));
}

export function renderCalendar(app: CareerApp): HTMLElement {
  const sub = app.sub.calendar ?? 'week';
  const s = app.state;
  let body: HTMLElement;
  if (sub === 'template') {
    const rows = WEEKDAYS.map((name, wd) =>
      h(
        'div',
        { class: 'cc-plan-row' },
        h('div', { class: 'cc-plan-day' }, name),
        ...([0, 1, 2] as Slot[]).map((slot) => {
          const v = s.life.plan[wd][slot];
          if (slot === 0 && v === null)
            return h('div', { class: 'cc-plan-cell cc-plan-cell--fixed' }, h('span', { class: 'cc-slot-time' }, SLOT_NAMES[slot]), h('span', {}, 'Club schedule'), h('button', { class: 'cc-link', type: 'button', onclick: () => ((s.life.plan[wd][0] = 'rest'), app.render()) }, 'Plan on days off'));
          return h(
            'div',
            { class: 'cc-plan-cell' },
            h('span', { class: 'cc-slot-time' }, SLOT_NAMES[slot]),
            activitySelect(s, slot, v ?? 'rest', (val) => {
              s.life.plan[wd][slot] = val;
              app.render();
            }, { label: `${name} ${SLOT_NAMES[slot]}` }),
            slot === 0 ? h('button', { class: 'cc-link', type: 'button', onclick: () => ((s.life.plan[wd][0] = null), app.render()) }, 'Reset') : null,
          );
        }),
      ),
    );
    body = card('Weekly routine', [h('p', { class: 'cc-dim' }, 'Your default week. Club training, matches and school always take priority; free slots follow this routine unless you plan something specific for a date.'), h('div', { class: 'cc-plan' }, ...rows)]);
  } else if (sub === 'fixtures') {
    const list = upcomingUserFixtures(s, 12);
    const cal = seasonCalendar(s.season);
    body = h(
      'div',
      { class: 'cc-grid cc-grid--2' },
      card('Upcoming fixtures', [
        list.length
          ? h(
              'ul',
              { class: 'cc-list cc-fixtures' },
              ...list.map((f) => {
                const c = comp(s, f.compId);
                return h('li', { class: 'cc-fixture-row' }, h('span', { class: 'cc-list-date' }, formatDate(f.day, true)), crest(s, f.home, 'xs'), h('span', { class: 'cc-fx-name' }, teamName(s, f.home, f.youth)), h('span', { class: 'cc-dim' }, 'vs'), crest(s, f.away, 'xs'), h('span', { class: 'cc-fx-name' }, teamName(s, f.away, f.youth)), pill(c?.shortName ?? '', 'dim'));
              }),
            )
          : h('p', { class: 'cc-empty' }, 'No fixtures scheduled.'),
      ]),
      card('Season dates', [
        h(
          'ul',
          { class: 'cc-list' },
          h('li', {}, h('span', { class: 'cc-list-date' }, formatDate(cal.preseasonStart)), 'Pre-season & summer transfer window opens'),
          h('li', {}, h('span', { class: 'cc-list-date' }, formatDate(cal.leagueStart)), 'League season kicks off'),
          ...cal.intlWeeks.map((w) => h('li', {}, h('span', { class: 'cc-list-date' }, formatDate(w)), 'International week')),
          h('li', {}, h('span', { class: 'cc-list-date' }, formatDate(cal.winterBreak[0])), 'Winter break (some leagues) · January window'),
          h('li', {}, h('span', { class: 'cc-list-date' }, formatDate(cal.cupFinal)), 'Cup finals'),
          h('li', {}, h('span', { class: 'cc-list-date' }, formatDate(cal.summerBreak)), 'Summer break'),
        ),
      ]),
    );
  } else {
    const days = Array.from({ length: 7 }, (_, i) => s.day + i);
    body = card('Next seven days', [
      h('p', { class: 'cc-dim' }, 'Pick what you do in each free slot. Plans for a date override your weekly routine.'),
      h(
        'div',
        { class: 'cc-week' },
        ...days.map((d) =>
          h(
            'div',
            { class: `cc-week-day ${d === s.day ? 'is-today' : ''}` },
            h('div', { class: 'cc-week-head' }, h('strong', {}, d === s.day ? 'Today' : WEEKDAYS_SHORT[weekday(d)]), h('span', {}, formatDate(d))),
            ...([0, 1, 2] as Slot[]).map((slot) => {
              const info = slotInfo(s, d, slot);
              const past = d === s.day && slot < s.slot;
              let content: Node | string;
              if (info.kind === 'free' && !past)
                content = activitySelect(s, slot, info.activity ?? 'rest', (v) => {
                  setOverride(s, d, slot, v);
                  app.render();
                }, { label: `${formatDate(d)} ${SLOT_NAMES[slot]}` });
              else if (info.kind === 'free') content = activityLabel(info.activity ?? 'rest');
              else if (info.kind === 'training') content = trainingDef(info.training!).name;
              else if (info.kind === 'match' && info.fixture) content = `vs ${teamName(s, info.fixture.home === s.user.clubId ? info.fixture.away : info.fixture.home, info.fixture.youth)}`;
              else content = info.detail;
              return h('div', { class: `cc-week-slot cc-slot--${info.kind} ${past ? 'is-past' : ''}` }, h('span', { class: 'cc-slot-time' }, `${SLOT_NAMES[slot]} · ${info.kind === 'free' ? 'free' : info.label}`), h('span', { class: 'cc-week-content' }, content));
            }),
          ),
        ),
      ),
      h('div', { class: 'cc-row-actions' }, btn('Clear plans for this week', () => {
        for (const d of days) for (const slot of [0, 1, 2] as Slot[]) setOverride(s, d, slot, null);
        app.render();
      }, 'ghost', { small: true })),
    ]);
  }
  return h('div', { class: 'cc-page' }, tabs(app, sub), body);
}
