// Retirement & legacy: the story of the whole career — seasons, trophies, awards, caps, records,
// money, the people who were there — and what he does next. Adds the career to the hall of fame.

import { h } from '../../../ui/dom';
import type { Screen } from '../../../ui/router';
import { withNav } from '../../../ui/nav';
import { seasonLabel } from '../../core/dates';
import { nationName } from '../../core/data/geography';
import { fullName } from '../../core/footballer';
import { avgRating } from '../../core/players';
import { careerTotals, hallOfFameEntry, peakOvr } from '../../core/retirement';
import { addToHallOfFame, loadHallOfFame } from '../../core/save';
import type { StatLine } from '../../core/types';
import type { CareerApp } from '../app';
import { avatar, card, keyValue, money, ovrBadge, pill, table } from '../components';
import { openCareerMenu, showHallOfFame } from './menu';

export function createRetirementScreen(app: CareerApp): Screen {
  const s = app.state;
  const u = s.user;
  const L = s.retired!;
  const el = h('section', { class: 'screen cc-screen cc-legacy' });
  const screen = withNav({ el }, { onBack: () => openCareerMenu() });
  const entry = hallOfFameEntry(s);
  if (app.kv && !loadHallOfFame(app.kv).some((e) => e.id === entry.id)) addToHallOfFame(app.kv, entry);
  const t = careerTotals(s);
  const netWorth = s.life.money + s.life.investments.reduce((a, i) => a + i.amount, 0) + s.life.properties.reduce((a, p) => a + p.value, 0);
  const bestSeason = [...u.history].sort((a, b) => b.league.goals + b.league.assists - (a.league.goals + a.league.assists))[0];
  const closest = s.life.people.filter((p) => !p.gone && p.role !== 'coach').sort((a, b) => b.affinity - a.affinity).slice(0, 5);
  const partner = s.life.people.find((p) => p.id === s.life.partnerId && !p.gone);
  const club = s.world.clubs[u.clubId];
  el.append(
    h(
      'div',
      { class: 'cc-screen-inner' },
      h(
        'div',
        { class: 'cc-legacy-hero' },
        avatar({ skin: u.skin, hair: u.hair, hairColor: u.hairColor, shirt: club?.colors, number: u.shirt }, 150),
        h(
          'div',
          {},
          h('div', { class: 'cc-kicker' }, `Retired at ${L.age} · ${L.reason}`),
          h('h1', {}, fullName(u)),
          h('p', { class: 'cc-dim' }, `${nationName(u.nat)} · ${u.pos} · ${u.history.length} seasons · ${entry.clubs.join(' → ')}`),
          h('div', { class: 'cc-pills' }, ovrBadge(peakOvr(s), 'PEAK', 'lg'), pill(`Legacy score ${L.score}`, 'gold')),
        ),
      ),
      h('section', { class: 'cc-card cc-legacy-next' }, h('div', { class: 'cc-kicker' }, 'What happens next'), h('h2', {}, L.next), h('p', {}, L.nextDetail)),
      h(
        'div',
        { class: 'cc-grid cc-grid--3' },
        card('Career in numbers', [keyValue([['Appearances', String(t.apps)], ['Goals', String(t.goals)], ['Assists', String(t.assists)], ['Average rating', t.rated ? avgRating(t).toFixed(2) : '—'], ['Player of the match', String(t.motm)], ['Senior caps', `${u.caps} (${u.intlGoals} goals)`]])]),
        card('Honours', [u.trophies.length ? h('ul', { class: 'cc-list' }, ...u.trophies.map((x) => h('li', {}, `🏆 ${x.name}`, h('span', { class: 'cc-dim' }, ` · ${seasonLabel(x.season)}`)))) : h('p', { class: 'cc-dim' }, 'No trophies — but a career to be proud of.'), u.awards.length ? h('ul', { class: 'cc-list' }, ...u.awards.map((x) => h('li', {}, `★ ${x.name}`, h('span', { class: 'cc-dim' }, ` · ${seasonLabel(x.season)}`)))) : null]),
        card('Life', [keyValue([['Net worth', money(s, netWorth)], ['Followers', u.followers.toLocaleString()], ['Charity', `${money(s, s.life.charity.donated)} donated${s.life.charity.foundation ? ' · foundation' : ''}`], ['Education', s.life.education.completed.length ? String(s.life.education.completed.length) + ' courses' : 'None'], ['Partner', partner ? `${partner.first} (${partner.stage})` : 'Single']]), closest.length ? h('p', { class: 'cc-dim' }, `Always there: ${closest.map((p) => p.first).join(', ')}.`) : null]),
      ),
      card('Season by season', [
        table(
          ['Season', 'Club', 'Pos', 'Apps', 'Goals', 'Assists', 'Avg', 'OVR', 'Honours'],
          u.history.map((r) => {
            const l: StatLine = { ...r.league };
            for (const x of [r.cup, r.continental]) for (const k of Object.keys(l) as (keyof StatLine)[]) l[k] += x[k];
            return [seasonLabel(r.season), r.clubName + (r.loan ? ' (loan)' : ''), r.leaguePos || '—', l.apps, l.goals, l.assists, l.rated ? avgRating(l).toFixed(2) : '—', r.ovrEnd, [...r.trophies, ...r.awards].join(', ') || ''];
          }),
          { highlight: (i) => u.history[i] === bestSeason },
        ),
      ]),
      h('div', { class: 'cc-screen-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => showHallOfFame(app.kv) }, h('span', {}, 'Hall of fame')), h('button', { class: 'btn btn--primary', type: 'button', onclick: () => openCareerMenu(), 'data-nav-default': true }, h('span', {}, 'Career menu'))),
    ),
  );
  return screen;
}
