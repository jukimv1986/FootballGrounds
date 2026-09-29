// Inbox (club, agent, family, sponsors, federation) and the social feed with your own posts.

import { h } from '../../../ui/dom';
import { pushScreen } from '../../../ui/router';
import { formatDate } from '../../core/dates';
import { rngOf } from '../../core/career';
import { POST_OPTIONS, acceptSponsor, makePost } from '../../core/social';
import type { CareerApp } from '../app';
import { btn, card, emptyState, followers, pill } from '../components';
import { createSeasonReviewScreen } from '../screens/seasonreview';
import type { Message } from '../../core/types';

const KIND_LABEL: Record<Message['kind'], string> = { club: 'Club', agent: 'Agent', family: 'Family', media: 'Media', sponsor: 'Sponsor', system: 'Career', offer: 'Offer', friend: 'Friend', national: 'National team' };

function tabs(app: CareerApp, social: boolean): HTMLElement {
  return h(
    'div',
    { class: 'tabs cc-subtabs' },
    h('button', { class: `tab ${!social ? 'is-active' : ''}`, type: 'button', onclick: () => app.setSub('messages') }, `Messages (${app.state.inbox.filter((m) => !m.read).length} new)`),
    h('button', { class: `tab ${social ? 'is-active' : ''}`, type: 'button', onclick: () => app.setSub('social') }, 'Social feed'),
  );
}

function runAction(app: CareerApp, m: Message, action: string, data?: Record<string, unknown>): void {
  const s = app.state;
  switch (action) {
    case 'open_offer':
      app.go('career', `o${data?.offerId}`);
      return;
    case 'sponsor_accept':
      acceptSponsor(s, data as { brand: string; category: string; monthly: number; months: number; duties: number });
      m.resolved = true;
      app.toast(`Deal signed with ${String(data?.brand)}`, 'success');
      break;
    case 'sponsor_decline':
      m.resolved = true;
      break;
    case 'open_season_review':
      pushScreen(createSeasonReviewScreen(app, Number(data?.season ?? s.season - 1)));
      return;
  }
  app.render();
}

export function renderInbox(app: CareerApp): HTMLElement {
  const s = app.state;
  const sub = app.sub.inbox ?? 'messages';
  if (sub === 'social') {
    const today = (s.events.flags.lastPostDay ?? -1) === s.day;
    const composer = card('Post something', [
      h('p', { class: 'cc-dim' }, `${followers(s.user.followers)} followers. One post a day — choose wisely: flexing reaches far, but fans and coaches have opinions.`),
      h(
        'div',
        { class: 'cc-post-options' },
        ...POST_OPTIONS.map((o) =>
          h(
            'button',
            {
              class: 'cc-post-option',
              type: 'button',
              disabled: today ? true : undefined,
              onclick: () => {
                s.events.flags.lastPostDay = s.day;
                const res = makePost(s, o.key, rngOf(s));
                app.toast(res, 'info');
                app.render();
              },
            },
            h('strong', {}, o.label),
            h('span', { class: 'cc-dim' }, o.desc),
            o.risk > 0 ? pill(`Risk ${Math.round(o.risk * 100)}%`, o.risk > 0.4 ? 'bad' : 'warn') : pill('Safe', 'good'),
          ),
        ),
      ),
      today ? h('p', { class: 'cc-dim' }, 'You already posted today.') : null,
    ]);
    const feed = card('Feed', s.feed.length ? [h('ul', { class: 'cc-feed' }, ...s.feed.slice(0, 40).map((p) => h('li', { class: `cc-post cc-post--${p.kind} cc-post--m${p.mood + 1}` }, h('div', { class: 'cc-post-head' }, h('strong', {}, p.author), h('span', { class: 'cc-dim' }, ` ${p.handle} · ${formatDate(p.day)}`)), h('p', {}, p.text), h('span', { class: 'cc-dim cc-small' }, `♥ ${p.likes.toLocaleString()}`))))] : [emptyState('Quiet on social media… for now.')]);
    return h('div', { class: 'cc-page' }, tabs(app, true), h('div', { class: 'cc-grid cc-grid--2' }, composer, feed));
  }
  const selectedId = sub.startsWith('m') ? Number(sub.substring(1)) : s.inbox[0]?.id;
  const selected = s.inbox.find((m) => m.id === selectedId) ?? s.inbox[0];
  if (selected && !selected.read) selected.read = true;
  const list = h(
    'ul',
    { class: 'cc-msglist' },
    ...s.inbox.slice(0, 60).map((m) =>
      h(
        'li',
        {},
        h(
          'button',
          { class: `cc-msg ${m === selected ? 'is-selected' : ''} ${m.read ? '' : 'is-unread'}`, type: 'button', onclick: () => app.setSub(`m${m.id}`) },
          h('span', { class: `cc-msg-kind cc-msg-kind--${m.kind}` }, KIND_LABEL[m.kind]),
          h('strong', { class: 'cc-msg-subject' }, m.subject),
          h('span', { class: 'cc-dim cc-small' }, `${m.from} · ${formatDate(m.day)}`),
        ),
      ),
    ),
  );
  const detail = selected
    ? card(selected.subject, [
        h('p', { class: 'cc-dim' }, `From ${selected.from} · ${formatDate(selected.day, true)}`),
        h('p', { class: 'cc-msg-body' }, selected.body),
        selected.actions && !selected.resolved ? h('div', { class: 'cc-row-actions' }, ...selected.actions.map((a, i) => btn(a.label, () => runAction(app, selected, a.action, a.data), i === 0 ? 'primary' : 'default'))) : selected.actions ? pill('Done', 'dim') : null,
      ], { className: 'cc-msg-detail' })
    : card('Inbox', [emptyState('No messages.')]);
  return h('div', { class: 'cc-page' }, tabs(app, false), h('div', { class: 'cc-inbox' }, card(null, [list], { className: 'cc-msglist-card' }), detail));
}
