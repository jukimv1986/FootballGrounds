// Club: identity (crest, kit, stadium, coach), the squad with roles and ratings, league tables
// (any league), the fixture list and the knockout competitions.

import { h } from '../../../ui/dom';
import { POSITIONS, POSITION_LINE } from '../../core/attributes';
import { continentalCompId, cupCompId, leagueCompId, standings, teamName } from '../../core/competitions';
import { ageAt, formatDate, seasonLabel } from '../../core/dates';
import { fullName, userAge, userOvr } from '../../core/footballer';
import { city, coachOf, comp, fixturesOf, squadOf, youthOf } from '../../core/index';
import { nationName } from '../../core/data/geography';
import { clubStrength } from '../../core/selection';
import type { CareerApp } from '../app';
import { card, crest, emptyState, formDots, keyValue, money, ovrBadge, pill, stars, table } from '../components';
import { kitPreviewDataUrl } from '../../engine/kits';
import type { CareerState, Id } from '../../core/types';

function tabs(app: CareerApp, current: string): HTMLElement {
  const mk = (key: string, label: string) => h('button', { class: `tab ${current === key ? 'is-active' : ''}`, type: 'button', onclick: () => app.setSub(key) }, label);
  return h('div', { class: 'tabs cc-subtabs' }, mk('squad', 'Squad'), mk('table', 'Table'), mk('fixtures', 'Fixtures'), mk('cups', 'Cups'), mk('world', 'Around the world'));
}

const kitCache = new Map<string, string>();
function kitImage(state: CareerState, clubId: Id): HTMLElement | null {
  const c = state.world.clubs[clubId];
  if (!c) return null;
  if (c.dbTeamId !== undefined && c.kitUrl) return h('span', { class: 'kit cc-kit', style: `--kit: url("${new URL(`./data/databases/default/${c.kitUrl}_kit_01.png`, document.baseURI).href}")` }, h('span', { class: 'kit-shirt' }), h('span', { class: 'kit-shorts' }));
  const key = `${clubId}:${c.colors.join()}`;
  let url = kitCache.get(key);
  if (!url) {
    url = kitPreviewDataUrl(c.colors, c.kitPattern, c.sponsor, 1);
    kitCache.set(key, url);
  }
  return url ? h('span', { class: 'kit cc-kit', style: `--kit: url("${url}")` }, h('span', { class: 'kit-shirt' }), h('span', { class: 'kit-shorts' })) : null;
}

export function renderClub(app: CareerApp): HTMLElement {
  const s = app.state;
  const u = s.user;
  const c = s.world.clubs[u.clubId];
  if (!c) return h('div', { class: 'cc-page' }, card('No club', [emptyState('You are a free agent. Offers from clubs arrive in your inbox — check the Contract page.')]));
  const sub = app.sub.club ?? 'squad';
  const coach = coachOf(s, c.id);
  const lg = s.world.leagues[c.leagueId];
  const head = card(null, [
    h(
      'div',
      { class: 'cc-club-head', style: `--c1: rgb(${c.colors[0].join(',')}); --c2: rgb(${c.colors[1].join(',')})` },
      crest(s, c.id, 'xl'),
      h(
        'div',
        { class: 'cc-club-id' },
        h('div', { class: 'cc-kicker' }, `${lg.name} · ${city(s, c.cityId).name}`),
        h('h2', {}, c.name),
        h('p', { class: 'cc-dim' }, `"${c.nickname}" · founded ${c.founded} · ${c.stadium} (${c.capacity.toLocaleString()})`),
        keyValue([
          ['Reputation', stars(c.reputation / 20)],
          ['Facilities', stars(c.facilities * 5)],
          ['Academy', stars(c.youthFacilities * 5)],
          ['Squad strength', String(Math.round(clubStrength(s, c.id)))],
          ['Coach', coach ? `${coach.first} ${coach.last} (${coach.style}, ${coach.formation})` : '—'],
          ['Sponsor', c.sponsor],
          ['Rival', s.world.clubs[c.rivalId]?.name ?? '—'],
          ['Budget', money(s, c.balance)],
        ]),
      ),
      kitImage(s, c.id),
    ),
  ]);

  let body: HTMLElement;
  if (sub === 'table') {
    const leagueId = Number(app.ui['club-league'] ?? c.leagueId);
    const table2 = standings(s, leagueCompId(leagueId, s.season));
    const picker = h(
      'select',
      {
        class: 'cc-select',
        'aria-label': 'League',
        onchange: (e: Event) => {
          app.ui['club-league'] = (e.target as HTMLSelectElement).value;
          app.render();
        },
      },
      ...s.world.countries.flatMap((co) => co.leagueIds.map((id) => h('option', { value: String(id), selected: id === leagueId ? true : undefined }, `${nationName(co.key)} — ${s.world.leagues[id].name}`))),
    );
    const n = table2.length;
    body = card(s.world.leagues[leagueId].name, [
      picker,
      table(
        ['#', 'Club', 'P', 'W', 'D', 'L', 'GF', 'GA', 'GD', 'Pts', 'Form'],
        table2.map((r, i) => [String(i + 1), h('span', { class: 'cc-td-team' }, crest(s, r.clubId, 'xs'), h('span', {}, s.world.clubs[r.clubId].name)), r.p, r.w, r.d, r.l, r.gf, r.ga, r.gf - r.ga, h('strong', {}, String(r.pts)), formDots(r.form)]),
        { highlight: (i) => table2[i].clubId === u.clubId, className: `cc-league-table ${s.world.leagues[leagueId].tier === 1 ? 'is-top' : 'is-second'}` },
      ),
      h('p', { class: 'cc-dim cc-legend' }, s.world.leagues[leagueId].tier === 1 ? `Top 2 qualify for the Champions Cup · bottom 3 (${n - 2}–${n}) are relegated` : 'Top 3 are promoted'),
    ]);
  } else if (sub === 'fixtures') {
    const mine = s.fixtures.filter((f) => (f.home === c.id || f.away === c.id) && !f.national).sort((a, b) => a.day - b.day);
    body = card('Fixtures & results', [
      mine.length
        ? table(
            ['Date', 'Competition', 'Home', '', 'Away'],
            mine.map((f) => {
              const cp = comp(s, f.compId);
              const res = f.played ? `${f.hg} - ${f.ag}${f.pens ? ` (p ${f.pens[0]}-${f.pens[1]})` : ''}` : 'vs';
              const won = f.played && ((f.home === c.id && f.hg > f.ag) || (f.away === c.id && f.ag > f.hg));
              const lost = f.played && ((f.home === c.id && f.hg < f.ag) || (f.away === c.id && f.ag < f.hg));
              return [formatDate(f.day, true), `${cp?.shortName ?? ''}${f.youth ? ' (U19)' : ''}`, h('span', { class: 'cc-td-team' }, crest(s, f.home, 'xs'), teamName(s, f.home, f.youth)), h('strong', { class: won ? 'cc-good' : lost ? 'cc-bad' : '' }, res), h('span', { class: 'cc-td-team' }, crest(s, f.away, 'xs'), teamName(s, f.away, f.youth))];
            }),
          )
        : emptyState('No fixtures.'),
    ]);
  } else if (sub === 'cups') {
    const cups = [cupCompId(c.countryKey, s.season), continentalCompId(s.season)].map((id) => comp(s, id)).filter((x) => !!x);
    body = h(
      'div',
      { class: 'cc-grid cc-grid--2' },
      ...cups.map((cp) => {
        const fx = fixturesOf(s, cp!.id).filter((f) => f.home === c.id || f.away === c.id);
        const alive = cp!.alive.includes(c.id) && !cp!.finished;
        const inIt = cp!.teamIds.includes(c.id);
        return card(cp!.name, [
          h('div', { class: 'cc-pills' }, pill(cp!.finished ? `Winner: ${teamName(s, cp!.winnerId ?? -1)}` : `Round: ${cp!.roundNames[cp!.round] ?? ''}`, cp!.finished ? 'gold' : 'info'), inIt ? pill(alive ? 'Still in it' : cp!.winnerId === c.id ? 'Champions!' : 'Eliminated', alive ? 'good' : cp!.winnerId === c.id ? 'gold' : 'bad') : pill('Not qualified', 'dim')),
          fx.length ? h('ul', { class: 'cc-list' }, ...fx.map((f) => h('li', {}, h('span', { class: 'cc-list-date' }, `${cp!.roundNames[f.round] ?? ''} · ${formatDate(f.day)}`), `${teamName(s, f.home)} ${f.played ? `${f.hg}-${f.ag}` : 'vs'} ${teamName(s, f.away)}${f.pens ? ` (pens ${f.pens[0]}-${f.pens[1]})` : ''}`))) : null,
        ]);
      }),
    );
  } else if (sub === 'world') {
    const hist = s.history[0];
    body = h(
      'div',
      { class: 'cc-grid cc-grid--2' },
      card('League leaders', [
        table(
          ['League', 'Leader', 'Pts'],
          s.world.leagues.filter((l) => l.tier === 1).map((l) => {
            const t = standings(s, leagueCompId(l.id, s.season))[0];
            return [l.name, t ? h('span', { class: 'cc-td-team' }, crest(s, t.clubId, 'xs'), s.world.clubs[t.clubId].name) : '—', t ? t.pts : 0];
          }),
        ),
      ]),
      card(hist ? `Champions ${seasonLabel(hist.season)}` : 'Last season', [hist ? h('ul', { class: 'cc-list' }, ...hist.champions.slice(0, 20).map((x) => h('li', {}, h('strong', {}, x.club), h('span', { class: 'cc-dim' }, ` · ${x.comp}`)))) : emptyState('History is written at the end of your first season.')]),
    );
  } else {
    const youthView = app.ui['club-squad'] === 'youth';
    const squad = youthView ? youthOf(s, c.id) : squadOf(s, c.id);
    const order = (p: string) => POSITIONS.indexOf(p as never);
    const rows = [...squad].sort((a, b) => order(a.pos) - order(b.pos) || b.ovr - a.ovr);
    const userInView = youthView ? u.squad === 'youth' : u.squad === 'first';
    const lineRank = { GK: 0, DEF: 1, MID: 2, ATT: 3 } as const;
    const tableRows = rows.map((n) => ({ key: order(n.pos) * 1000 - n.ovr, row: [n.pos, h('span', {}, `${n.first} ${n.last}`), Math.floor(ageAt(n.born, s.day)), nationName(n.nat), ovrBadge(n.ovr, '', 'sm'), Math.round(n.form), n.injuredUntil > s.day ? pill('Injured', 'bad') : n.banned > 0 ? pill('Banned', 'warn') : '', `${money(s, n.wage)}/wk`], user: false }));
    if (userInView) tableRows.push({ key: order(u.pos) * 1000 - userOvr(u) - 0.5, row: [u.pos, h('strong', {}, `${fullName(u)} (you)`), Math.floor(userAge(s)), nationName(u.nat), ovrBadge(userOvr(u), '', 'sm'), Math.round(u.form), u.injury ? pill('Injured', 'bad') : u.banned > 0 ? pill('Banned', 'warn') : '', `${money(s, u.contract.wage)}/wk`], user: true });
    tableRows.sort((a, b) => a.key - b.key);
    void lineRank;
    void POSITION_LINE;
    body = card(youthView ? 'U19 / development squad' : 'First-team squad', [
      h('div', { class: 'segmented cc-seg' }, h('button', { class: `seg-btn ${!youthView ? 'is-selected' : ''}`, type: 'button', onclick: () => ((app.ui['club-squad'] = 'first'), app.render()) }, 'First team'), h('button', { class: `seg-btn ${youthView ? 'is-selected' : ''}`, type: 'button', onclick: () => ((app.ui['club-squad'] = 'youth'), app.render()) }, 'U19')),
      table(['Pos', 'Name', 'Age', 'Nation', 'OVR', 'Form', 'Status', 'Wage'], tableRows.map((r) => r.row), { highlight: (i) => tableRows[i].user }),
    ]);
  }
  return h('div', { class: 'cc-page' }, head, tabs(app, sub), body);
}
