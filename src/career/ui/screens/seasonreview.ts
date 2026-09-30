// Season review: final position and table, your season line per competition, rating progress,
// trophies and awards, and what happened around the world.

import { h } from '../../../ui/dom';
import type { Screen } from '../../../ui/router';
import { withNav } from '../../../ui/nav';
import { seasonLabel } from '../../core/dates';
import { avgRating } from '../../core/players';
import { ordinal } from '../../core/season';
import type { StatLine } from '../../core/types';
import type { CareerApp } from '../app';
import { card, emptyState, ovrBadge, pill, table } from '../components';

export function createSeasonReviewScreen(app: CareerApp, season: number): Screen {
  const s = app.state;
  const rec = s.user.history.find((r) => r.season === season);
  const world = s.history.find((x) => x.season === season);
  const el = h('section', { class: 'screen cc-screen cc-review' });
  const screen = withNav({ el }, { onBack: () => app.show() });
  const line = (name: string, l: StatLine) => [name, l.apps, l.goals, l.assists, l.rated ? avgRating(l).toFixed(2) : '—', l.motm];
  el.append(
    h(
      'div',
      { class: 'cc-screen-inner' },
      h('div', { class: 'cc-kicker' }, 'Season review'),
      h('h1', { class: 'cc-review-title' }, seasonLabel(season)),
      rec
        ? h(
            'div',
            { class: 'cc-review-hero' },
            h('div', {}, h('h2', {}, rec.clubName), h('p', { class: 'cc-dim' }, `${rec.leagueName}${rec.leaguePos ? ` · finished ${ordinal(rec.leaguePos)}` : ''}${rec.loan ? ' · on loan' : ''}`)),
            h('div', { class: 'cc-review-ovr' }, ovrBadge(rec.ovrStart, 'START'), h('span', { class: 'cc-review-arrow' }, '→'), ovrBadge(rec.ovrEnd, 'END', 'lg')),
          )
        : null,
      rec && (rec.trophies.length || rec.awards.length) ? h('div', { class: 'cc-review-honours' }, ...rec.trophies.map((t) => pill(`🏆 ${t}`, 'gold')), ...rec.awards.map((a) => pill(`★ ${a}`, 'gold'))) : null,
      h(
        'div',
        { class: 'cc-grid cc-grid--2' },
        rec ? card('Your season', [table(['Competition', 'Apps', 'Goals', 'Assists', 'Avg', 'MOTM'], [line('League', rec.league), line('Cup', rec.cup), line('Continental', rec.continental), line('U19 / Reserves', rec.youth), line('International', rec.international)])]) : card('Your season', [emptyState('No record.')]),
        rec?.table ? card('Final table', [table(['#', 'Club', 'P', 'GD', 'Pts'], rec.table.map((r, i) => [i + 1, r[0], r[1], r[2] > 0 ? `+${r[2]}` : r[2], r[3]]), { highlight: (i) => rec.table![i][0] === rec.clubName })]) : null,
        world
          ? card('Around the world', [
              world.topScorer ? h('p', {}, h('strong', {}, 'Golden Boot: '), `${world.topScorer.name} (${world.topScorer.club}) — ${world.topScorer.goals}`) : null,
              world.playerOfSeason ? h('p', {}, h('strong', {}, 'Player of the Season: '), `${world.playerOfSeason.name} (${world.playerOfSeason.club})`) : null,
              h('ul', { class: 'cc-list' }, ...world.champions.map((c) => h('li', {}, h('strong', {}, c.club), h('span', { class: 'cc-dim' }, ` · ${c.comp}`)))),
            ])
          : null,
      ),
      h('div', { class: 'cc-screen-actions' }, h('button', { class: 'btn btn--primary', type: 'button', onclick: () => app.show(), 'data-nav-default': true }, h('span', {}, `On to ${seasonLabel(season + 1)}`))),
    ),
  );
  return screen;
}
