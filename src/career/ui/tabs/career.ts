// Contract & career: the current deal, offers (negotiate / sign / reject), transfer situation,
// national team, and the big decisions (new contract, transfer request, retirement).

import { h } from '../../../ui/dom';
import { rngOf } from '../../core/career';
import { ROLE_NAMES, acceptOffer, askForNewContract, contractYearsLeft, inTransferWindow, interestedClubs, rejectOffer, requestTransfer } from '../../core/contracts';
import { formatDate } from '../../core/dates';
import { nationName } from '../../core/data/geography';
import { userAge, userOvr } from '../../core/footballer';
import { agent } from '../../core/life';
import { nextInternationalWindow } from '../../core/national';
import type { CareerApp } from '../app';
import { btn, card, crest, emptyState, keyValue, money, pill } from '../components';
import { showNegotiation } from '../dialogs/negotiation';

export function renderCareer(app: CareerApp): HTMLElement {
  const s = app.state;
  const u = s.user;
  const c = s.world.clubs[u.clubId];
  const k = u.contract;
  const sub = app.sub.career ?? '';
  const focusOffer = sub.startsWith('o') ? Number(sub.substring(1)) : -1;
  const age = userAge(s);

  const contractCard = card('Your contract', [
    c
      ? h('div', { class: 'cc-contract-head' }, crest(s, c.id, 'md'), h('div', {}, h('strong', {}, c.name), h('p', { class: 'cc-dim' }, `${k.kind === 'youth' ? 'Youth contract' : k.kind === 'loan' ? `On loan from ${s.world.clubs[k.parentClubId ?? -1]?.name ?? '—'}` : 'Professional contract'} · ${ROLE_NAMES[k.role]}`)))
      : h('p', { class: 'cc-alert cc-alert--warn' }, 'You are a free agent. Clubs send offers to your inbox — sign one to get back on the pitch.'),
    s.events.flags.retireAtSeasonEnd === s.season ? h('p', { class: 'cc-alert cc-alert--info' }, `Farewell season: you retire when the season ends (30 Jun ${s.season + 1}). Make it count.`) : null,
    keyValue([
      ['Wage', `${money(s, k.wage)} / week`],
      ['Expires', c ? `30 Jun ${k.endSeason + 1} (${contractYearsLeft(s)} season${contractYearsLeft(s) > 1 ? 's' : ''} left)` : '—'],
      ['Appearance bonus', k.appearanceBonus ? money(s, k.appearanceBonus) : '—'],
      ['Goal bonus', k.goalBonus ? money(s, k.goalBonus) : '—'],
      ['Release clause', k.releaseClause ? money(s, k.releaseClause) : 'None'],
      ['Market value', money(s, u.marketValue)],
    ]),
    h(
      'div',
      { class: 'cc-row-actions' },
      c ? btn('Ask for a new contract', () => (app.toast(askForNewContract(s, rngOf(s)), 'info'), app.render()), 'default', { small: true }) : null,
      c && k.kind === 'pro' && !u.transferRequest ? btn('Hand in transfer request', () => (requestTransfer(s), app.render()), 'danger', { small: true }) : null,
      u.transferRequest ? btn('Withdraw transfer request', () => ((u.transferRequest = false), app.toast('Transfer request withdrawn', 'info'), app.render()), 'ghost', { small: true }) : null,
      age >= 33 && s.events.flags.retireAtSeasonEnd !== s.season ? btn('Announce retirement (end of season)', () => ((s.events.flags.retireAtSeasonEnd = s.season), (s.events.flags.retireDecided = s.day), app.toast('You will retire at the end of the season', 'success'), app.render()), 'ghost', { small: true }) : null,
      s.events.flags.retireAtSeasonEnd === s.season ? btn('Change your mind: keep playing', () => (delete s.events.flags.retireAtSeasonEnd, app.render()), 'ghost', { small: true }) : null,
    ),
  ]);

  const pending = s.offers.filter((o) => o.status === 'pending');
  const offersCard = card(
    'Offers',
    pending.length
      ? pending.map((o) => {
          const club = s.world.clubs[o.clubId];
          return h(
            'article',
            { class: `cc-offer ${o.id === focusOffer ? 'is-focus' : ''}` },
            h('div', { class: 'cc-offer-head' }, crest(s, o.clubId, 'sm'), h('div', {}, h('strong', {}, club?.name ?? 'Club'), h('span', { class: 'cc-dim' }, ` · ${s.world.leagues[club?.leagueId ?? 0]?.name ?? ''}`)), pill(o.kind === 'transfer' ? `Transfer · ${money(s, o.fee)}` : o.kind === 'loan' ? 'Loan' : o.kind === 'renewal' ? 'Extension' : o.kind === 'pro' ? 'First pro deal' : 'Contract', 'gold')),
            h('div', { class: 'cc-pills' }, pill(`${money(s, o.wage)}/week`, 'good'), pill(`${o.years} yr`, 'dim'), pill(ROLE_NAMES[o.role], 'info'), o.releaseClause ? pill(`Clause ${money(s, o.releaseClause)}`, 'dim') : null, o.signingBonus ? pill(`Bonus ${money(s, o.signingBonus)}`, 'dim') : null, pill(`Expires ${formatDate(o.expiresDay)}`, 'warn')),
            o.note ? h('p', { class: 'cc-dim' }, o.note) : null,
            h(
              'div',
              { class: 'cc-row-actions' },
              btn('Sign', () => {
                const err = acceptOffer(s, o.id, rngOf(s));
                app.toast(err ?? 'Signed!', err ? 'warn' : 'success');
                app.render();
              }, 'primary', { small: true }),
              o.kind !== 'loan' ? btn('Negotiate', () => showNegotiation(app, o), 'default', { small: true }) : null,
              btn('Reject', () => (rejectOffer(s, o.id), app.render()), 'danger', { small: true }),
            ),
          );
        })
      : [emptyState(inTransferWindow(s.day) ? 'No offers right now. Perform well — scouts are watching.' : 'No offers. Transfer windows: July–August and January.')],
  );

  const interest = u.clubId >= 0 ? interestedClubs(s).length : 0;
  const a = agent(s);
  const marketCard = card('Transfer market', [
    keyValue([
      ['Window', inTransferWindow(s.day) ? 'OPEN' : 'Closed (opens in July and January)'],
      ['Clubs that could be interested', k.kind === 'youth' ? 'After your first pro contract' : String(interest)],
      ['Agent', a ? `${a.first} ${a.last}` : 'None — see People'],
      ['Transfer request', u.transferRequest ? 'Handed in' : 'No'],
      ['Rating', String(Math.round(userOvr(u)))],
    ]),
    h('p', { class: 'cc-dim' }, 'Interest grows with your form, reputation and market value; an agent with a big network brings more clubs to the table.'),
  ]);

  const nw = nextInternationalWindow(s);
  const nationalCard = card('National team', [
    keyValue([
      ['Nation', nationName(u.nat)],
      ['Status', u.national === 'none' ? 'Not selected' : `${u.national === 'senior' ? 'Senior squad' : `${u.national} squad`}`],
      ['Senior caps', `${u.caps} (${u.intlGoals} goals)`],
      ['Next window', nw ? formatDate(nw) : '—'],
    ]),
    h('p', { class: 'cc-dim' }, 'Squads are picked a week before each international window, on form, rating and reputation.'),
  ]);

  return h('div', { class: 'cc-page' }, h('div', { class: 'cc-grid cc-grid--2' }, contractCard, offersCard, marketCard, nationalCard));
}
