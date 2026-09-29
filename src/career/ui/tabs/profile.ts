// Player profile: identity, ratings, attributes grouped physical/technical/mental with growth
// since the start of the season and his natural potential per stat, position ratings, season
// statistics per competition, career history, honours and reputation.

import { h } from '../../../ui/dom';
import { POSITIONS, POSITION_NAMES, STAT_GROUPS, STAT_LABELS, ovr as ovrAt } from '../../core/attributes';
import { formatDate, seasonLabel } from '../../core/dates';
import { TRAITS, fullName, potentialRange, userAge, userOvr } from '../../core/footballer';
import { nationName } from '../../core/data/geography';
import { avgRating } from '../../core/players';
import { careerTotals } from '../../core/retirement';
import { naturalCap } from '../../core/training';
import type { StatLine } from '../../core/types';
import type { CareerApp } from '../app';
import { avatar, card, emptyState, followers, keyValue, meter, money, ovrBadge, pill, statBar, table } from '../components';

function tabs(app: CareerApp, current: string): HTMLElement {
  const mk = (key: string, label: string) => h('button', { class: `tab ${current === key ? 'is-active' : ''}`, type: 'button', onclick: () => app.setSub(key) }, label);
  return h('div', { class: 'tabs cc-subtabs' }, mk('attributes', 'Attributes'), mk('season', 'This season'), mk('history', 'Career'), mk('honours', 'Honours'));
}

function lineRow(name: string, l: StatLine): (string | number)[] {
  return [name, l.apps, l.starts, l.goals, l.assists, l.rated ? avgRating(l).toFixed(2) : '—', l.motm, l.yellows, l.reds, l.cleanSheets];
}

export function renderProfile(app: CareerApp): HTMLElement {
  const s = app.state;
  const u = s.user;
  const sub = app.sub.profile ?? 'attributes';
  const club = s.world.clubs[u.clubId];
  const [pLo, pHi] = potentialRange(s);

  const header = card(null, [
    h(
      'div',
      { class: 'cc-profile-head' },
      avatar({ skin: u.skin, hair: u.hair, hairColor: u.hairColor, shirt: club?.colors, number: u.shirt }, 132),
      h(
        'div',
        { class: 'cc-profile-id' },
        h('div', { class: 'cc-kicker' }, `#${u.shirt} · ${POSITION_NAMES[u.pos]}`),
        h('h2', {}, fullName(u)),
        h('p', { class: 'cc-dim' }, `${Math.floor(userAge(s))} years · ${nationName(u.nat)} · ${u.foot === 'L' ? 'Left' : 'Right'}-footed · ${Math.round(u.height * 100)} cm · ${u.weight} kg`),
        h('div', { class: 'cc-pills' }, ...u.traits.map((t) => pill(TRAITS.find((x) => x.key === t)?.name ?? t, 'info'))),
      ),
      h('div', { class: 'cc-profile-ratings' }, ovrBadge(userOvr(u), 'OVR', 'lg'), h('div', { class: 'cc-potential cc-potential--lg' }, h('small', {}, 'Potential'), h('strong', {}, `${pLo}–${pHi}`)), keyValue([['Value', money(s, u.marketValue)], ['Followers', followers(u.followers)]])),
    ),
  ]);

  let body: HTMLElement;
  if (sub === 'season') {
    const lines = u.season;
    body = h(
      'div',
      { class: 'cc-grid' },
      card(`Season ${seasonLabel(s.season)}`, [
        table(['Competition', 'Apps', 'Starts', 'Goals', 'Assists', 'Avg', 'MOTM', 'YC', 'RC', 'CS'], [lineRow('League', lines.league), lineRow('Cup', lines.cup), lineRow('Continental', lines.continental), lineRow('U19 / Reserves', lines.youth), lineRow('International', lines.international)]),
      ]),
      card('Last matches', [
        s.reports.length
          ? table(
              ['Date', 'Match', 'Score', 'Min', 'G', 'A', 'Rating'],
              s.reports.slice(0, 10).map((r) => [formatDate(r.day), `${r.homeName} – ${r.awayName}`, `${r.hg}-${r.ag}`, r.user?.minutes ?? '—', r.user?.goals ?? 0, r.user?.assists ?? 0, r.user ? r.user.rating.toFixed(1) : r.role === 'bench' ? 'bench' : '—']),
            )
          : emptyState('No matches yet.'),
      ]),
    );
  } else if (sub === 'history') {
    const totals = careerTotals(s);
    body = h(
      'div',
      { class: 'cc-grid' },
      card('Career history', [
        u.history.length
          ? table(
              ['Season', 'Club', 'League', 'Pos', 'Apps', 'Goals', 'Assists', 'Avg', 'OVR', 'Trophies'],
              [...u.history].reverse().map((r) => {
                const l = { ...r.league };
                for (const x of [r.cup, r.continental]) for (const k of Object.keys(l) as (keyof StatLine)[]) l[k] += x[k];
                return [seasonLabel(r.season), `${r.clubName}${r.loan ? ' (loan)' : ''}${r.squad === 'youth' ? ' U19' : ''}`, r.leagueName, r.leaguePos || '—', l.apps + (r.squad === 'youth' ? r.youth.apps : 0), l.goals + (r.squad === 'youth' ? r.youth.goals : 0), l.assists, l.rated ? avgRating(l).toFixed(2) : '—', `${r.ovrStart}→${r.ovrEnd}`, r.trophies.join(', ') || '—'];
              }),
            )
          : emptyState('Your first season is under way.'),
      ], { className: 'cc-span-all' }),
      card('Career totals', [keyValue([['Appearances', String(totals.apps)], ['Goals', String(totals.goals)], ['Assists', String(totals.assists)], ['Average rating', totals.rated ? avgRating(totals).toFixed(2) : '—'], ['Senior caps', String(u.caps)], ['International goals', String(u.intlGoals)]])]),
    );
  } else if (sub === 'honours') {
    body = h(
      'div',
      { class: 'cc-grid cc-grid--2' },
      card('Trophies', [u.trophies.length ? h('ul', { class: 'cc-list cc-trophies' }, ...u.trophies.map((t) => h('li', {}, h('span', { class: 'cc-trophy' }, '🏆'), h('strong', {}, t.name), h('span', { class: 'cc-dim' }, ` · ${seasonLabel(t.season)} · ${t.clubName}`)))) : emptyState('No trophies yet. Go and win something!')]),
      card('Awards', [u.awards.length ? h('ul', { class: 'cc-list' }, ...u.awards.map((a) => h('li', {}, h('span', { class: 'cc-trophy' }, '★'), h('strong', {}, a.name), h('span', { class: 'cc-dim' }, ` · ${seasonLabel(a.season)}`)))) : emptyState('No individual awards yet.')]),
      card('Reputation', [meter('Local', u.rep.local, { tone: 'gold' }), meter('National', u.rep.national, { tone: 'gold' }), meter('World', u.rep.world, { tone: 'gold' }), keyValue([['Followers', followers(u.followers)], ['International', u.national === 'none' ? 'Not selected' : `${nationName(u.nat)} ${u.national === 'senior' ? '' : u.national}`], ['Senior caps', String(u.caps)]])]),
      card('Injury record', [u.injuryHistory.length ? h('ul', { class: 'cc-list' }, ...u.injuryHistory.slice(0, 10).map((i) => h('li', {}, h('span', { class: 'cc-list-date' }, formatDate(i.day)), `${i.name} (${i.days} days)`))) : emptyState('Clean bill of health.')]),
    );
  } else {
    const group = (title: string, names: readonly (keyof typeof STAT_LABELS)[]) =>
      card(title, names.map((n) => statBar(STAT_LABELS[n], u.stats[n], u.stats[n] - u.seasonStartStats[n], naturalCap(s, n))));
    const positions = POSITIONS.map((p) => ({ p, v: ovrAt(u.stats, p) })).sort((a, b) => b.v - a.v);
    body = h(
      'div',
      { class: 'cc-grid cc-grid--3' },
      group('Physical', STAT_GROUPS.physical),
      group('Technical', STAT_GROUPS.technical),
      group('Mental', STAT_GROUPS.mental),
      card('Position ratings', [h('div', { class: 'cc-posgrid' }, ...positions.map(({ p, v }) => h('div', { class: `cc-posrating ${p === u.pos ? 'is-main' : ''}` }, h('strong', {}, String(Math.round(v))), h('span', {}, p))))]),
      card('Legend', [h('p', { class: 'cc-dim' }, 'Bars show your current value (0–99). The marker is your natural potential for that attribute: growth slows sharply beyond it. ▲ shows growth since the start of the season.')]),
    );
  }
  return h('div', { class: 'cc-page' }, header, tabs(app, sub), body);
}
