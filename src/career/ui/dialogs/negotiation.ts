// Contract negotiation dialog: the player (or his agent) proposes wage, length, squad role,
// release clause and signing bonus; the club accepts, counters or walks away.

import { h } from '../../../ui/dom';
import { rngOf } from '../../core/career';
import { ROLE_NAMES, acceptOffer, agentNegotiate, negotiate, rejectOffer, roleRank } from '../../core/contracts';
import { agent } from '../../core/life';
import type { ContractOffer, SquadRole } from '../../core/types';
import type { CareerApp } from '../app';
import { crest, money, pill } from '../components';
import { openModalShell } from './event';

const ROLES: SquadRole[] = ['youth', 'prospect', 'rotation', 'regular', 'key', 'star'];

function range(label: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string): { el: HTMLElement; input: HTMLInputElement } {
  const out = h('output', { class: 'cc-range-value' }, fmt(value));
  const input = h('input', { class: 'cc-range', type: 'range', min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label, oninput: () => (out.textContent = fmt(Number(input.value))) });
  return { el: h('label', { class: 'cc-range-row' }, h('span', {}, label), input, out), input };
}

export function showNegotiation(app: CareerApp, offer: ContractOffer): void {
  const s = app.state;
  const c = s.world.clubs[offer.clubId];
  const a = agent(s);
  const body = h('div', { class: 'cc-nego modal-body' });
  const content = h('div', {}, h('div', { class: 'modal-head' }, crest(s, offer.clubId, 'md'), h('div', {}, h('div', { class: 'modal-kicker' }, `${offer.kind === 'renewal' ? 'Contract extension' : offer.kind === 'pro' ? 'First professional contract' : offer.kind === 'loan' ? 'Loan' : offer.kind === 'transfer' ? `Transfer · fee ${money(s, offer.fee)}` : 'Contract offer'}`), h('h2', { class: 'modal-title' }, c?.name ?? 'Club'))), body);
  const shell = openModalShell('cc-nego-modal modal--wide', content, () => shell.close());
  const render = (message?: string, tone: 'good' | 'bad' | 'info' = 'info') => {
    const cur = offer;
    const wage = range('Weekly wage', Math.round(cur.wage * 0.7), Math.round(cur.wage * 2.2), Math.max(10, Math.round(cur.wage / 100) * 5), Math.round(cur.wage), (v) => money(s, v));
    const years = range('Years', 1, 5, 1, cur.years, (v) => `${v} year${v > 1 ? 's' : ''}`);
    const clause = cur.releaseClause > 0 ? range('Release clause', Math.round(cur.releaseClause * 0.3), Math.round(cur.releaseClause * 2), Math.max(1000, Math.round(cur.releaseClause / 200)), cur.releaseClause, (v) => money(s, v)) : null;
    const bonus = range('Signing bonus', 0, Math.max(1000, Math.round(cur.signingBonus * 3 + cur.wage * 4)), Math.max(100, Math.round(cur.wage / 10)), cur.signingBonus, (v) => money(s, v));
    const role = h('select', { class: 'cc-select', 'aria-label': 'Squad role' }, ...ROLES.filter((r) => roleRank(r) >= roleRank(cur.role) - 1).map((r) => h('option', { value: r, selected: r === cur.role ? true : undefined }, ROLE_NAMES[r])));
    const pending = cur.status === 'pending';
    const children: (Node | null)[] = [
      h('div', { class: 'cc-nego-offer' }, h('h4', { class: 'cc-h4' }, 'On the table'), h('div', { class: 'cc-pills' }, pill(`${money(s, cur.wage)}/week`, 'gold'), pill(`${cur.years} years`, 'dim'), pill(ROLE_NAMES[cur.role], 'info'), cur.releaseClause ? pill(`Release clause ${money(s, cur.releaseClause)}`, 'dim') : null, cur.signingBonus ? pill(`Signing bonus ${money(s, cur.signingBonus)}`, 'dim') : null, cur.appearanceBonus ? pill(`Appearance ${money(s, cur.appearanceBonus)}`, 'dim') : null, cur.goalBonus ? pill(`Goal ${money(s, cur.goalBonus)}`, 'dim') : null)),
      h('p', { class: 'cc-dim' }, a ? `${a.first} ${a.last} negotiates for you (skill ${Math.round((a.skill ?? 0) * 100)}).` : 'You negotiate yourself. An agent would get more out of the club.'),
      message ? h('p', { class: `cc-alert cc-alert--${tone}` }, message) : null,
      pending ? h('div', { class: 'cc-nego-form' }, wage.el, years.el, h('label', { class: 'cc-range-row' }, h('span', {}, 'Squad role'), role), clause?.el ?? null, bonus.el) : null,
      h(
        'div',
        { class: 'modal-actions' },
        pending
          ? h('button', { class: 'btn btn--primary', type: 'button', 'data-nav-default': true, onclick: () => {
              const res = acceptOffer(s, cur.id, rngOf(s));
              shell.close();
              app.toast(res ?? 'Contract signed!', res ? 'warn' : 'success');
              app.render();
            } }, h('span', {}, 'Sign these terms'))
          : null,
        pending
          ? h('button', { class: 'btn', type: 'button', onclick: () => {
              const r = negotiate(s, cur.id, { wage: Number(wage.input.value), years: Number(years.input.value), role: role.value as SquadRole, releaseClause: clause ? Number(clause.input.value) : 0, signingBonus: Number(bonus.input.value) });
              if (r.outcome === 'withdrawn') {
                render(r.message, 'bad');
                return;
              }
              render(r.message, r.outcome === 'accepted' ? 'good' : 'info');
            } }, h('span', {}, 'Propose'))
          : null,
        pending && a && cur.note !== 'Terms agreed'
          ? h('button', { class: 'btn', type: 'button', title: `${a.first} ${a.last} negotiates for you and settles close to what the club can pay`, onclick: () => {
              const r = agentNegotiate(s, cur.id, rngOf(s));
              render(r.message, r.outcome === 'accepted' ? 'good' : r.outcome === 'withdrawn' ? 'bad' : 'info');
            } }, h('span', {}, `Let ${a.first} handle it`))
          : null,
        pending
          ? h('button', { class: 'btn btn--danger', type: 'button', onclick: () => {
              rejectOffer(s, cur.id);
              shell.close();
              app.render();
            } }, h('span', {}, 'Reject'))
          : null,
        h('button', { class: 'btn btn--ghost', type: 'button', onclick: () => (shell.close(), app.render()) }, h('span', {}, pending ? 'Think about it' : 'Close')),
      ),
    ];
    body.replaceChildren(...children.filter((x): x is Node => x !== null));
  };
  render();
}
