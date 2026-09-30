// Match report: score, headline, timeline of events, your stats and rating, man of the match,
// team stats and the other results of the day.

import { h } from '../../../ui/dom';
import type { Screen } from '../../../ui/router';
import { withNav } from '../../../ui/nav';
import { teamName } from '../../core/competitions';
import { formatDate } from '../../core/dates';
import { fixturesOn } from '../../core/index';
import type { MatchReport } from '../../core/types';
import type { CareerApp } from '../app';
import { crest, pill } from '../components';
import { showEventDialog } from '../dialogs/event';

const EVENT_ICON: Record<string, string> = { goal: '⚽', owngoal: '⚽', yellow: '🟨', red: '🟥', sub_on: '↑', sub_off: '↓', injury: '✚', chance: '•', save: '🧤', penalty_miss: '✕' };

export function createReportScreen(app: CareerApp, r: MatchReport, note?: string): Screen {
  const s = app.state;
  const el = h('section', { class: 'screen cc-screen cc-report' });
  const done = () => {
    app.show();
    if (s.events.pending) setTimeout(() => showEventDialog(app), 150);
  };
  const screen = withNav({ el }, { onBack: done });
  const u = r.user;
  const us = r.userSide;
  const gf = us === 0 ? r.hg : r.ag;
  const ga = us === 0 ? r.ag : r.hg;
  const result = gf > ga || (r.pens && (us === 0 ? r.pens[0] > r.pens[1] : r.pens[1] > r.pens[0])) ? 'win' : gf < ga || r.pens ? 'loss' : 'draw';
  const events = r.events.filter((e) => e.type !== 'chance' || e.user).slice(0, 30);
  const stat = (label: string, v: string | number) => h('div', { class: 'cc-rstat' }, h('strong', {}, String(v)), h('span', {}, label));
  const others = fixturesOn(s, r.day).filter((f) => f.played && f.id !== r.fixtureId && f.compId === s.fixtures.find((x) => x.id === r.fixtureId)?.compId).slice(0, 10);
  el.append(
    h(
      'div',
      { class: 'cc-screen-inner' },
      h('div', { class: 'cc-kicker' }, `${r.compName} · ${formatDate(r.day, true)}${r.played3D ? ' · played in 3D' : ' · simulated'}`),
      h('h1', { class: `cc-report-headline cc-report--${result}` }, r.headline),
      note ? h('p', { class: 'cc-alert cc-alert--warn' }, note) : null,
      h(
        'div',
        { class: 'cc-scoreboard' },
        h('div', { class: 'cc-sb-team' }, crest(s, r.home, 'lg'), h('strong', {}, r.homeName)),
        h('div', { class: 'cc-sb-score' }, h('span', {}, String(r.hg)), h('span', { class: 'cc-sb-sep' }, '–'), h('span', {}, String(r.ag)), r.pens ? h('small', {}, `${r.aet ? 'a.e.t. · ' : ''}pens ${r.pens[0]}–${r.pens[1]}`) : r.aet ? h('small', {}, 'after extra time') : null),
        h('div', { class: 'cc-sb-team' }, crest(s, r.away, 'lg'), h('strong', {}, r.awayName)),
      ),
      h(
        'div',
        { class: 'cc-report-grid' },
        h(
          'section',
          { class: 'cc-card cc-report-you' },
          h('h3', { class: 'cc-card-title' }, 'Your match'),
          u
            ? h(
                'div',
                {},
                h('div', { class: 'cc-rating-big' }, h('strong', { class: u.rating >= 7.5 ? 'cc-good' : u.rating < 6 ? 'cc-bad' : '' }, u.rating.toFixed(1)), h('span', {}, 'Rating'), u.motm ? pill('Player of the match', 'gold') : null),
                h(
                  'div',
                  { class: 'cc-rstats' },
                  stat('Minutes', u.minutes),
                  stat('Goals', u.goals),
                  stat('Assists', u.assists),
                  stat('Shots (on target)', `${u.shots} (${u.shotsOnTarget})`),
                  stat('Passes', `${u.passesCompleted}/${u.passes}`),
                  // the 3D engine does not track key passes, dribbles or interceptions
                  r.played3D ? stat('Touches', u.touches ?? '—') : stat('Key passes', u.keyPasses),
                  r.played3D ? null : stat('Dribbles', u.dribbles),
                  stat('Tackles', u.tackles),
                  r.played3D ? null : stat('Interceptions', u.interceptions),
                  u.saves ? stat('Saves', u.saves) : null,
                  stat('Fouls', u.fouls),
                ),
              )
            : h('p', { class: 'cc-dim' }, r.role === 'bench' ? 'You stayed on the bench.' : 'You were not involved.'),
        ),
        h(
          'section',
          { class: 'cc-card' },
          h('h3', { class: 'cc-card-title' }, 'Match events'),
          events.length ? h('ol', { class: 'cc-events' }, ...events.map((e) => h('li', { class: `cc-ev cc-ev--${e.type} cc-ev--side${e.side} ${e.user ? 'is-user' : ''}` }, h('span', { class: 'cc-ev-min' }, `${e.minute}'`), h('span', { class: 'cc-ev-icon' }, EVENT_ICON[e.type] ?? '•'), h('span', { class: 'cc-ev-text' }, e.name, e.assist ? h('span', { class: 'cc-dim' }, ` (${e.assist})`) : null, e.text ? h('span', { class: 'cc-dim' }, ` — ${e.text}`) : null), h('span', { class: 'cc-ev-team cc-ev-crest' }, crest(s, e.side === 0 ? r.home : r.away, 'xs'))))) : h('p', { class: 'cc-dim' }, 'A quiet game.'),
        ),
        h(
          'section',
          { class: 'cc-card' },
          h('h3', { class: 'cc-card-title' }, 'Match stats'),
          h('div', { class: 'cc-bars2' }, h('span', {}, `${r.possession}%`), h('div', { class: 'cc-bar2' }, h('div', { style: `width: ${r.possession}%` })), h('span', {}, `${100 - r.possession}%`)),
          h('p', { class: 'cc-dim cc-center' }, 'Possession (you · them)'),
          h('div', { class: 'cc-bars2' }, h('span', {}, String(r.shots[0])), h('div', { class: 'cc-bar2' }, h('div', { style: `width: ${(r.shots[0] / Math.max(1, r.shots[0] + r.shots[1])) * 100}%` })), h('span', {}, String(r.shots[1]))),
          h('p', { class: 'cc-dim cc-center' }, 'Shots'),
          h('p', {}, h('strong', {}, 'Player of the match: '), r.motmName),
          others.length ? h('div', {}, h('h4', { class: 'cc-h4' }, 'Other results'), h('ul', { class: 'cc-list' }, ...others.map((f) => h('li', {}, `${teamName(s, f.home, f.youth)} ${f.hg}-${f.ag} ${teamName(s, f.away, f.youth)}`)))) : null,
        ),
      ),
      h('div', { class: 'cc-screen-actions' }, h('button', { class: 'btn btn--primary', type: 'button', onclick: done, 'data-nav-default': true }, h('span', {}, 'Continue'))),
    ),
  );
  return screen;
}
