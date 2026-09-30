// Career hub: today's schedule (with quick plan changes), the next match and your expected role,
// condition meters, a player snapshot, notifications, the recent timeline and the league table.

import { h } from '../../../ui/dom';
import { slotInfo, upcomingUserFixtures } from '../../core/career';
import { leagueCompId, standings, teamName } from '../../core/competitions';
import { SLOT_NAMES, formatDate, formatDateLong, type Slot } from '../../core/dates';
import { fullName, potentialRange, userAge, userOvr } from '../../core/footballer';
import { comp } from '../../core/index';
import { happinessIndex, setOverride } from '../../core/life';
import { milestoneCount } from '../../core/milestones';
import { POSITION_NAMES } from '../../core/attributes';
import { nationName } from '../../core/data/geography';
import { selectLineup } from '../../core/selection';
import { trainingDef } from '../../core/data/lifestyle';
import type { CareerApp } from '../app';
import { avatar, btn, card, crest, emptyState, followers, formDots, keyValue, meter, money, ovrBadge, pill } from '../components';
import { activityLabel, activitySelect } from '../pickers';
import { cicon } from '../icons';
import type { CareerState, Fixture } from '../../core/types';

function expectedRole(state: CareerState, f: Fixture): string {
  if (f.national) return 'In the squad';
  if (state.user.injury) return 'Injured';
  if (state.user.banned > 0 && !f.youth) return 'Suspended';
  const lu = f.youth ? selectLineup(state, state.user.clubId, { youth: true, userEligible: true, seed: f.id * 31 + state.user.clubId }) : selectLineup(state, state.user.clubId, { seed: f.id * 31 + state.user.clubId });
  return lu.userRole === 'start' ? 'Likely to start' : lu.userRole === 'bench' ? 'Likely on the bench' : 'Not in the squad (yet)';
}

export function renderHub(app: CareerApp): HTMLElement {
  const s = app.state;
  const u = s.user;
  const club = s.world.clubs[u.clubId];

  // --- today
  const slots = ([0, 1, 2] as Slot[]).map((slot) => {
    const past = slot < s.slot;
    const info = slotInfo(s, s.day, slot);
    let detail: Node | string = info.detail;
    if (info.kind === 'training') detail = `${trainingDef(info.training!).name}`;
    if (info.kind === 'free') {
      detail = past
        ? activityLabel(info.activity ?? 'rest')
        : activitySelect(s, slot, info.activity ?? 'rest', (v) => {
            setOverride(s, s.day, slot, v);
            app.render();
          }, { label: `${SLOT_NAMES[slot]} activity` });
    }
    if (info.kind === 'match' && info.fixture) detail = `${teamName(s, info.fixture.home, info.fixture.youth)} vs ${teamName(s, info.fixture.away, info.fixture.youth)}`;
    return h(
      'div',
      { class: `cc-slot cc-slot--${info.kind} ${slot === s.slot ? 'is-now' : ''} ${past ? 'is-past' : ''}` },
      h('span', { class: 'cc-slot-time' }, SLOT_NAMES[slot]),
      h('span', { class: 'cc-slot-kind' }, info.kind === 'free' ? 'Free time' : info.label),
      h('span', { class: 'cc-slot-detail' }, detail),
    );
  });
  const today = card('Today', [h('p', { class: 'cc-date-long' }, formatDateLong(s.day)), h('div', { class: 'cc-slots' }, ...slots), s.life.lastActivity ? h('p', { class: 'cc-last' }, cicon('check'), ` ${s.life.lastActivity.summary}`) : null], { className: 'cc-hub-today', kicker: s.life.vacation ? `On holiday: ${s.life.vacation.place}` : undefined });

  // --- next match
  const next = upcomingUserFixtures(s, 1)[0];
  let nextCard: HTMLElement;
  if (next) {
    const c = comp(s, next.compId);
    const days = next.day - s.day;
    nextCard = card(
      'Next match',
      [
        h('div', { class: 'cc-fixture-big' }, h('div', { class: 'cc-fx-team' }, crest(s, next.home, 'md'), h('span', {}, teamName(s, next.home, next.youth))), h('div', { class: 'cc-fx-vs' }, 'vs'), h('div', { class: 'cc-fx-team' }, crest(s, next.away, 'md'), h('span', {}, teamName(s, next.away, next.youth)))),
        h('div', { class: 'cc-fx-meta' }, pill(c ? (c.type === 'cup' || c.type === 'continental' ? `${c.shortName} · ${c.roundNames[next.round] ?? ''}` : c.name) : 'Match', 'info'), pill(days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days · ${formatDate(next.day, true)}`, days <= 1 ? 'gold' : 'dim'), pill(expectedRole(s, next), 'dim')),
        s.pendingMatch ? btn('Go to match day', () => app.openMatchDay(), 'primary', { icon: 'play' }) : btn('Advance to match day', () => app.advance('match'), 'default'),
      ],
      { className: 'cc-hub-next' },
    );
  } else nextCard = card('Next match', [emptyState(u.clubId < 0 ? 'You have no club. Check your offers.' : 'No matches scheduled right now.')]);

  // --- condition
  const cond = card(
    'Condition',
    [
      h(
        'div',
        { class: 'cc-meter-grid' },
        meter('Energy', u.energy, { hint: 'Recovers overnight: sleep, housing, diet and a quiet evening help.' }),
        meter('Fitness', u.fitness, { hint: 'Match conditioning.' }),
        meter('Sharpness', u.sharpness, { hint: 'Match sharpness: rises with games and intense sessions.' }),
        meter('Morale', u.morale),
        meter('Form', u.form),
        meter('Happiness', happinessIndex(s), { tone: 'gold', hint: 'Football, social life, romance, family, home and money.' }),
      ),
      u.injury ? h('p', { class: 'cc-alert cc-alert--bad' }, cicon('bandage'), ` ${u.injury.name} — back ${formatDate(u.injury.until)}`) : null,
      u.banned > 0 ? h('p', { class: 'cc-alert cc-alert--bad' }, cicon('whistle'), ` Suspended for ${u.banned} match${u.banned > 1 ? 'es' : ''}`) : null,
      s.life.fatigueMental > 65 ? h('p', { class: 'cc-alert cc-alert--warn' }, cicon('info'), ' Mentally tired: plan something relaxing.') : null,
    ],
    { className: 'cc-hub-cond' },
  );

  // --- you
  const [pLo, pHi] = potentialRange(s);
  const miles = milestoneCount(s);
  const youCard = card(
    null,
    [
      h(
        'div',
        { class: 'cc-you' },
        avatar({ skin: u.skin, hair: u.hair, hairColor: u.hairColor, shirt: club?.colors, number: u.shirt }, 96),
        h(
          'div',
          { class: 'cc-you-main' },
          h('h3', {}, fullName(u)),
          h('p', { class: 'cc-dim' }, `${Math.floor(userAge(s))} · ${POSITION_NAMES[u.pos]} · ${nationName(u.nat)}`),
          h('div', { class: 'cc-you-badges' }, ovrBadge(userOvr(u), 'OVR'), h('span', { class: 'cc-potential', title: "Scouts' estimate of your potential" }, h('small', {}, 'Potential'), h('strong', {}, `${pLo}–${pHi}`))),
          s.events.flags.retireAtSeasonEnd === s.season ? pill('Farewell season', 'gold') : null,
        ),
      ),
      keyValue([
        ['Value', money(s, u.marketValue)],
        ['Wage', `${money(s, u.contract.wage)}/wk`],
        ['Contract', `until ${u.contract.endSeason + 1}`],
        ['Followers', followers(u.followers)],
        ['Milestones', h('button', { class: 'cc-link', type: 'button', onclick: () => app.go('profile', 'milestones') }, `${miles.got} / ${miles.total}`)],
      ]),
    ],
    { className: 'cc-hub-you', action: btn('Profile', () => app.go('profile'), 'ghost', { small: true }) },
  );

  // --- notices & timeline
  const notices = card(
    'Notifications',
    s.notices.length
      ? [h('ul', { class: 'cc-list' }, ...s.notices.slice(0, 7).map((n) => h('li', { class: `cc-notice cc-notice--${n.tone}` }, h('span', { class: 'cc-list-date' }, formatDate(n.day)), h('span', {}, n.text))))]
      : [emptyState('Nothing new.')],
    { className: 'cc-hub-notices' },
  );
  const timeline = card(
    'Recently',
    s.timeline.length ? [h('ul', { class: 'cc-list cc-timeline' }, ...s.timeline.slice(0, 9).map((t) => h('li', { class: `cc-tl cc-tl--${t.tone ?? 'info'}` }, h('span', { class: 'cc-list-date' }, `${formatDate(t.day)} · ${SLOT_NAMES[t.slot].toLowerCase()}`), h('span', {}, t.text))))] : [emptyState('Your story starts now.')],
    { className: 'cc-hub-timeline' },
  );

  // --- league
  let leagueCard: HTMLElement | null = null;
  if (club) {
    const table = standings(s, leagueCompId(club.leagueId, s.season));
    const idx = table.findIndex((r) => r.clubId === club.id);
    const show = new Set<number>([0, 1, 2, idx - 1, idx, idx + 1].filter((i) => i >= 0 && i < table.length));
    leagueCard = card(
      s.world.leagues[club.leagueId].name,
      [
        h(
          'table',
          { class: 'cc-table cc-mini-table' },
          h('tbody', {}, ...[...show].sort((a, b) => a - b).map((i) => {
            const r = table[i];
            return h('tr', { class: r.clubId === club.id ? 'is-user' : '' }, h('td', {}, String(i + 1)), h('td', { class: 'cc-td-team' }, crest(s, r.clubId, 'xs'), h('span', {}, s.world.clubs[r.clubId].name)), h('td', {}, String(r.p)), h('td', {}, `${r.gf - r.ga >= 0 ? '+' : ''}${r.gf - r.ga}`), h('td', { class: 'cc-strong' }, String(r.pts)), h('td', {}, formDots(r.form)));
          })),
        ),
      ],
      { className: 'cc-hub-league', action: btn('Table', () => app.go('club', 'table'), 'ghost', { small: true }) },
    );
  }

  const unread = s.inbox.filter((m) => !m.read).slice(0, 3);
  const inbox = unread.length
    ? card(
        'Unread messages',
        [h('ul', { class: 'cc-list' }, ...unread.map((m) => h('li', {}, h('button', { class: 'cc-link', type: 'button', onclick: () => app.go('inbox', `m${m.id}`) }, h('strong', {}, m.subject), h('span', { class: 'cc-dim' }, ` — ${m.from}`)))))],
        { className: 'cc-hub-inbox' },
      )
    : null;

  return h('div', { class: 'cc-page cc-hub' }, h('div', { class: 'cc-grid cc-grid--hub' }, today, nextCard, cond, youCard, inbox, notices, leagueCard, timeline));
}
