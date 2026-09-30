// People: family, partner, friends, teammates, coach, agent and mentor with relationship bars
// and quick plans to spend time with them; agent hiring; what the coach thinks of you.

import { h } from '../../../ui/dom';
import { slotInfo } from '../../core/career';
import { agentOptions, clubValuation, fireAgent, hireAgent } from '../../core/contracts';
import type { Slot } from '../../core/dates';
import { activityDef } from '../../core/data/lifestyle';
import { activityBlocked, isFamily, peopleOf, setOverride } from '../../core/life';
import { coachOpinion } from '../../core/selection';
import { coachOf } from '../../core/index';
import type { CareerState, Person, PersonRole } from '../../core/types';
import type { CareerApp } from '../app';
import { btn, card, emptyState, meter, pill } from '../components';

const ROLE_LABEL: Record<PersonRole, string> = { mother: 'Mum', father: 'Dad', sibling: 'Sibling', child: 'Child', teammate: 'Teammate', friend: 'Friend', partner: 'Partner', agent: 'Agent', mentor: 'Mentor', coach: 'Coach', journalist: 'Journalist' };
const STAGE_LABEL: Record<string, string> = { dating: 'Dating', partner: 'In a relationship', living: 'Living together', engaged: 'Engaged', married: 'Married' };

/** plans an activity in the next free slot where it is possible */
export function planNext(app: CareerApp, key: string): void {
  const s = app.state;
  const def = activityDef(key.split(':')[0]);
  if (!def) return;
  for (let d = s.day; d < s.day + 5; d++) {
    for (const slot of [0, 1, 2] as Slot[]) {
      if (d === s.day && slot < s.slot) continue;
      if (!def.slots.includes(slot as 0 | 1 | 2)) continue;
      if (slotInfo(s, d, slot).kind !== 'free') continue;
      if (activityBlocked(s, def, slot)) continue;
      setOverride(s, d, slot, key);
      app.toast(`${def.name}: planned ${d === s.day ? 'today' : d === s.day + 1 ? 'tomorrow' : `in ${d - s.day} days`}`, 'success');
      app.render();
      return;
    }
  }
  app.toast(`No free slot for "${def.name}" in the next days`, 'warn');
}

function childAge(days: number): string {
  if (days < 60) return `${Math.max(1, Math.round(days / 7))} weeks old`;
  if (days < 730) return `${Math.floor(days / 30.4)} months old`;
  return `${Math.floor(days / 365.25)} years old`;
}

function initials(p: Person): string {
  return `${p.first.charAt(0)}${p.last.charAt(0)}`.toUpperCase();
}

function personCard(app: CareerApp, p: Person, actions: HTMLElement[]): HTMLElement {
  const s = app.state;
  const since = s.day - p.lastContact;
  return h(
    'article',
    { class: `cc-person cc-person--${p.role}` },
    h('span', { class: 'cc-person-avatar', 'aria-hidden': 'true' }, initials(p)),
    h(
      'div',
      { class: 'cc-person-main' },
      h('div', { class: 'cc-person-head' }, h('strong', {}, `${p.first} ${p.last}`), pill(p.stage ? STAGE_LABEL[p.stage] : ROLE_LABEL[p.role], p.role === 'partner' ? 'gold' : 'dim')),
      p.job ? h('span', { class: 'cc-dim' }, p.role === 'child' ? `Your ${p.job} · ${childAge(s.day - p.since)}` : p.job) : null,
      meter('Relationship', p.affinity, { compact: true }),
      h('span', { class: 'cc-dim cc-small' }, since <= 0 ? 'Seen today' : `Last contact ${since} day${since > 1 ? 's' : ''} ago`),
      actions.length ? h('div', { class: 'cc-row-actions' }, ...actions) : null,
    ),
  );
}

function coachSummary(state: CareerState): string {
  const coach = coachOf(state, state.user.clubId);
  if (!coach) return '';
  const op = coachOpinion(state, coach);
  const val = clubValuation(state, state.user.clubId);
  const level = val.diff > 2 ? 'one of the best players in the squad' : val.diff > -2.5 ? 'good enough to start' : val.diff > -6 ? 'close to the first XI' : 'not yet at the level of the starters';
  const attitude = op > 3 ? 'He loves your attitude.' : op > 0 ? 'He is happy with your attitude.' : op > -3 ? 'He wants more commitment from you.' : 'He is unhappy with your commitment (attendance, effort, professionalism).';
  return `The coach sees you as ${level}. ${attitude}`;
}

export function renderPeople(app: CareerApp): HTMLElement {
  const s = app.state;
  const family = s.life.people.filter((p) => !p.gone && isFamily(p)).sort((a, b) => Number(b.role === 'child') - Number(a.role === 'child'));
  const partner = peopleOf(s, 'partner');
  const friends = peopleOf(s, 'friend');
  const mates = peopleOf(s, 'teammate');
  const coach = peopleOf(s, 'coach');
  const agents = peopleOf(s, 'agent');
  const mentors = peopleOf(s, 'mentor');
  const away = s.life.cityId !== s.life.hometown;

  const familyCard = card('Family', family.map((p) => personCard(app, p, p.role === 'child' ? [btn('Time together', () => planNext(app, 'family_time'), 'ghost', { small: true })] : [btn('Call', () => planNext(app, 'call_family'), 'ghost', { small: true }), btn(away ? 'Trip home' : 'Visit', () => planNext(app, away ? 'trip_home' : 'visit_family'), 'ghost', { small: true })])));
  const romanceCard = card(
    'Love life',
    !s.settings.romance
      ? [emptyState('Romance storylines are turned off for this career.')]
      : partner.length
        ? partner.map((p) => personCard(app, p, [btn('Dinner date', () => planNext(app, 'dinner_date'), 'ghost', { small: true }), p.stage !== 'dating' ? btn('Quiet night in', () => planNext(app, 'partner_night'), 'ghost', { small: true }) : btn('Walk together', () => planNext(app, 'walk'), 'ghost', { small: true })]))
        : [emptyState('Single. You might meet someone at a bar, a quiz night, a concert or a night out.')],
  );
  const friendsCard = card('Friends', friends.length ? friends.map((p) => personCard(app, p, [btn('Coffee', () => planNext(app, 'coffee_friends'), 'ghost', { small: true })])) : [emptyState('No close friends outside football right now.')]);
  const matesCard = card('Teammates', mates.length ? mates.map((p) => personCard(app, p, [btn('Team dinner', () => planNext(app, 'team_dinner'), 'ghost', { small: true })])) : [emptyState('No teammates yet.')]);
  const coachCard = card('Coach', coach.length ? [...coach.map((p) => personCard(app, p, [btn('Video analysis', () => planNext(app, 'analysis'), 'ghost', { small: true })])), h('p', { class: 'cc-dim' }, coachSummary(s))] : [emptyState('No coach.')]);

  const current = agents[0];
  const options = agentOptions(s);
  const agentCard = card('Agent', [
    current ? personCard(app, current, [btn('Meet', () => planNext(app, 'meet_agent'), 'ghost', { small: true }), btn('Fire', () => (fireAgent(s), app.toast('Agent dismissed (two weeks of wages as compensation)', 'info'), app.render()), 'danger', { small: true })]) : h('p', { class: 'cc-dim' }, 'Agents negotiate better contracts, find transfers and sponsors — for a share of your wage.'),
    current ? h('p', { class: 'cc-dim' }, `Negotiation ${Math.round((current.skill ?? 0) * 100)} · network ${Math.round((current.reach ?? 0) * 100)} · fee ${Math.round((current.fee ?? 0) * 100)}%`) : null,
    h(
      'div',
      { class: 'cc-agents' },
      ...options.map((a) => {
        const rep = Math.max(s.user.rep.national, s.user.rep.world, s.user.rep.local * 0.5);
        const ok = rep >= a.minRep;
        return h(
          'div',
          { class: 'cc-agent' },
          h('strong', {}, `${a.first} ${a.last}`),
          h('span', { class: 'cc-dim' }, a.blurb),
          h('div', { class: 'cc-pills' }, pill(`Skill ${Math.round(a.skill * 100)}`, 'info'), pill(`Network ${Math.round(a.reach * 100)}`, 'info'), pill(`Fee ${Math.round(a.fee * 100)}%`, 'warn')),
          btn(current && current.first === a.first && current.last === a.last ? 'Your agent' : 'Hire', () => {
            const err = hireAgent(s, a);
            app.toast(err ?? `${a.first} ${a.last} now represents you`, err ? 'warn' : 'success');
            app.render();
          }, 'ghost', { small: true, disabled: !ok ? 'Only represents established players' : current && current.first === a.first && current.last === a.last ? 'Already your agent' : false }),
        );
      }),
    ),
  ]);
  const mentorCard = mentors.length ? card('Mentor', mentors.map((p) => personCard(app, p, []))) : null;
  return h('div', { class: 'cc-page' }, h('div', { class: 'cc-grid cc-grid--2' }, familyCard, romanceCard, friendsCard, matesCard, coachCard, mentorCard, agentCard));
}
