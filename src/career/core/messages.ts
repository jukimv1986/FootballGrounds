// Inbox, notifications, the social feed, the money ledger and the hub timeline. Small helpers
// every system uses to tell the player what happened (with bounded history so saves stay small).

import type { CareerState, Message, Notice, Post } from './types';

const MAX_INBOX = 120;
const MAX_FEED = 80;
const MAX_NOTICES = 30;
const MAX_LEDGER = 120;
const MAX_TIMELINE = 40;

export function addMessage(state: CareerState, m: Omit<Message, 'id' | 'day' | 'read'> & { day?: number }): Message {
  const msg: Message = { id: state.nextMsgId++, day: m.day ?? state.day, read: false, ...m };
  state.inbox.unshift(msg);
  if (state.inbox.length > MAX_INBOX) {
    // drop the oldest resolved/read messages first
    const idx = state.inbox.map((x, i) => [x, i] as const).reverse().find(([x]) => x.read && (!x.actions || x.resolved));
    state.inbox.splice(idx ? idx[1] : state.inbox.length - 1, 1);
  }
  return msg;
}

export function addNotice(state: CareerState, text: string, tone: Notice['tone'] = 'info'): void {
  state.notices.unshift({ id: state.nextMsgId++, day: state.day, text, tone });
  if (state.notices.length > MAX_NOTICES) state.notices.length = MAX_NOTICES;
}

export function addPost(state: CareerState, p: Omit<Post, 'id' | 'day'>): void {
  state.feed.unshift({ id: state.nextMsgId++, day: state.day, ...p });
  if (state.feed.length > MAX_FEED) state.feed.length = MAX_FEED;
}

export function addMoney(state: CareerState, amount: number, label: string): void {
  if (amount === 0) return;
  state.life.money += amount;
  const last = state.life.ledger[0];
  if (last && last.day === state.day && last.label === label) last.amount += amount;
  else state.life.ledger.unshift({ day: state.day, label, amount });
  if (state.life.ledger.length > MAX_LEDGER) state.life.ledger.length = MAX_LEDGER;
}

export function addTimeline(state: CareerState, text: string, tone?: 'good' | 'bad' | 'info'): void {
  state.timeline.unshift({ day: state.day, slot: state.slot, text, tone });
  if (state.timeline.length > MAX_TIMELINE) state.timeline.length = MAX_TIMELINE;
}

export function unreadCount(state: CareerState): number {
  return state.inbox.filter((m) => !m.read).length;
}

export function formatMoney(state: CareerState | null, v: number, currency = '€'): string {
  const c = state ? (state.world.countries.find((x) => x.key === state.world.clubs[state.user.clubId]?.countryKey)?.currency ?? currency) : currency;
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1e6) return `${sign}${c}${(a / 1e6).toFixed(a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e4) return `${sign}${c}${Math.round(a / 1000)}k`;
  if (a >= 1000) return `${sign}${c}${(a / 1000).toFixed(1)}k`;
  return `${sign}${c}${Math.round(a)}`;
}

export function formatFollowers(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
  return String(Math.round(n));
}
