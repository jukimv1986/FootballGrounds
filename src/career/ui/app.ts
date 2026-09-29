// The career UI controller: owns the live CareerState, the save slot, the shell (top bar with
// the key meters, navigation, content area, "advance" bar) and routes the loop's stop reasons
// to the right screen or dialog (event -> event dialog, match -> match day, offer -> inbox
// badge, season -> season review, retired -> legacy screen). Autosaves when the week changes
// and at important moments, off the click path.

import { h } from '../../ui/dom';
import { showScreen, pushScreen, type Screen } from '../../ui/router';
import { withNav } from '../../ui/nav';
import { showToast } from '../../ui/widgets';
import { advanceDay, advanceSlot, advanceToNextMatch, slotInfo, upcomingUserFixtures, type StopReason } from '../core/career';
import { SLOT_NAMES, formatDate, weekday } from '../core/dates';
import { fullName, userOvr } from '../core/footballer';
import { happinessIndex } from '../core/life';
import { unreadCount } from '../core/messages';
import { activityDef, trainingDef } from '../core/data/lifestyle';
import { saveToSlot, type KV } from '../core/save';
import type { CareerState } from '../core/types';
import { crest, meter, money, ovrBadge } from './components';
import { cicon } from './icons';
import { showEventDialog } from './dialogs/event';
import { renderHub } from './tabs/hub';
import { renderCalendar } from './tabs/calendar';
import { renderTraining } from './tabs/training';
import { renderProfile } from './tabs/profile';
import { renderClub } from './tabs/club';
import { renderCity } from './tabs/city';
import { renderPeople } from './tabs/people';
import { renderInbox } from './tabs/inbox';
import { renderFinances } from './tabs/finances';
import { renderCareer } from './tabs/career';
import { createMatchDayScreen } from './screens/matchday';
import { createSeasonReviewScreen } from './screens/seasonreview';
import { createRetirementScreen } from './screens/retirement';
import { openCareerMenu } from './screens/menu';

export type TabKey = 'hub' | 'calendar' | 'training' | 'profile' | 'club' | 'city' | 'people' | 'inbox' | 'finances' | 'career';

const TABS: { key: TabKey; label: string; icon: string; render: (app: CareerApp) => HTMLElement }[] = [
  { key: 'hub', label: 'Hub', icon: 'hub', render: renderHub },
  { key: 'calendar', label: 'Planner', icon: 'calendar', render: renderCalendar },
  { key: 'training', label: 'Training', icon: 'training', render: renderTraining },
  { key: 'profile', label: 'Profile', icon: 'profile', render: renderProfile },
  { key: 'club', label: 'Club', icon: 'club', render: renderClub },
  { key: 'city', label: 'City & Life', icon: 'city', render: renderCity },
  { key: 'people', label: 'People', icon: 'people', render: renderPeople },
  { key: 'inbox', label: 'Inbox', icon: 'inbox', render: renderInbox },
  { key: 'finances', label: 'Money & Home', icon: 'finances', render: renderFinances },
  { key: 'career', label: 'Contract', icon: 'career', render: renderCareer },
];

export class CareerApp {
  tab: TabKey = 'hub';
  /** per-tab sub view (e.g. club -> 'table') */
  sub: Partial<Record<TabKey, string>> = {};
  /** misc view state (selected league, squad view…) */
  ui: Record<string, string> = {};
  readonly el: HTMLElement;
  protected content: HTMLElement;
  protected top: HTMLElement;
  protected navEl: HTMLElement;
  protected bar: HTMLElement;
  protected lastSavedWeek = -1;
  protected saveTimer = 0;
  busy = false;
  screen: Screen;

  constructor(
    public state: CareerState,
    public slot: number,
    public kv: KV | null,
  ) {
    this.top = h('header', { class: 'cc-top' });
    this.navEl = h('nav', { class: 'cc-nav', 'aria-label': 'Career sections' });
    this.content = h('main', { class: 'cc-content', tabindex: '-1' });
    this.bar = h('footer', { class: 'cc-bar' });
    this.el = h('section', { class: 'screen cc-shell' }, h('div', { class: 'cc-shell-bg', 'aria-hidden': 'true' }), this.top, h('div', { class: 'cc-body' }, this.navEl, this.content), this.bar);
    this.lastSavedWeek = Math.floor((state.day + 3) / 7);
    // browser automation hook (career-test.html?automation)
    const hook = (globalThis as unknown as { __career?: Record<string, unknown> }).__career;
    if (hook) hook.app = this;
    this.screen = withNav(
      {
        el: this.el,
        onShow: () => this.render(),
      },
      { onBack: () => (this.tab !== 'hub' ? this.go('hub') : undefined), onAction: (a) => this.onNavAction(a) },
    );
  }

  protected onNavAction(a: string): boolean {
    if (a === 'next' || a === 'prev') {
      const i = TABS.findIndex((t) => t.key === this.tab);
      const n = (i + (a === 'next' ? 1 : -1) + TABS.length) % TABS.length;
      this.go(TABS[n].key);
      return true;
    }
    if (a === 'start') {
      this.advance('slot');
      return true;
    }
    return false;
  }

  show(): void {
    showScreen(this.screen);
  }

  go(tab: TabKey, sub?: string): void {
    this.tab = tab;
    if (sub !== undefined) this.sub[tab] = sub;
    this.render();
    this.content.scrollTop = 0;
  }

  setSub(sub: string): void {
    this.sub[this.tab] = sub;
    this.render();
  }

  render(): void {
    if (this.state.retired) {
      showScreen(createRetirementScreen(this));
      return;
    }
    const tab = TABS.find((t) => t.key === this.tab) ?? TABS[0];
    const scroll = this.content.scrollTop;
    // content first: it may mark messages read / change state the chrome shows
    this.content.replaceChildren(tab.render(this));
    this.content.scrollTop = scroll;
    this.renderTop();
    this.renderNav();
    this.renderBar();
    const target = this.ui['scroll-to'];
    if (target) {
      delete this.ui['scroll-to'];
      requestAnimationFrame(() => this.content.querySelector(target)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    }
  }

  protected renderTop(): void {
    const s = this.state;
    const u = s.user;
    const club = s.world.clubs[u.clubId];
    this.top.replaceChildren(
      h(
        'div',
        { class: 'cc-top-id' },
        u.clubId >= 0 ? crest(s, u.clubId, 'sm') : h('span', { class: 'cc-crest cc-crest--sm cc-crest--none' }, '—'),
        h('div', { class: 'cc-top-name' }, h('strong', {}, fullName(u)), h('span', {}, club ? `${club.name}${u.squad === 'youth' ? ' · U19' : ''}` : 'Free agent')),
        ovrBadge(userOvr(u), u.pos, 'sm'),
      ),
      h('div', { class: 'cc-top-date' }, h('strong', {}, formatDate(s.day, true)), h('span', {}, SLOT_NAMES[s.slot])),
      h('div', { class: 'cc-top-money' }, h('span', {}, 'Balance'), h('strong', { class: s.life.money < 0 ? 'is-neg' : '' }, money(s, s.life.money))),
      h(
        'div',
        { class: 'cc-top-meters' },
        meter('Energy', u.energy, { compact: true, hint: 'Energy recovers overnight. Low energy: worse training, more injuries, weaker matches.' }),
        meter('Fitness', u.fitness, { compact: true, hint: 'Match fitness: built by training and matches.' }),
        meter('Morale', u.morale, { compact: true, hint: 'Mood: follows your happiness, results and playing time.' }),
        meter('Form', u.form, { compact: true, hint: 'Recent match ratings. Coaches pick players in form.' }),
      ),
      h(
        'div',
        { class: 'cc-top-actions' },
        h('button', { class: 'icon-btn', title: 'Save', 'aria-label': 'Save', onclick: () => this.save(true) }, cicon('save')),
        h('button', { class: 'icon-btn', title: 'Career menu', 'aria-label': 'Career menu', onclick: () => this.exitToMenu() }, cicon('menu')),
      ),
    );
  }

  protected renderNav(): void {
    const unread = unreadCount(this.state);
    const pendingOffers = this.state.offers.filter((o) => o.status === 'pending').length;
    this.navEl.replaceChildren(
      ...TABS.map((t) =>
        h(
          'button',
          { class: `cc-nav-item ${t.key === this.tab ? 'is-active' : ''}`, type: 'button', onclick: () => this.go(t.key), 'aria-current': t.key === this.tab ? 'page' : undefined },
          cicon(t.icon),
          h('span', { class: 'cc-nav-label' }, t.label),
          t.key === 'inbox' && unread > 0 ? h('span', { class: 'cc-badge' }, String(Math.min(99, unread))) : null,
          t.key === 'career' && pendingOffers > 0 ? h('span', { class: 'cc-badge cc-badge--gold' }, String(pendingOffers)) : null,
        ),
      ),
    );
  }

  /** "Up next" line for the advance bar */
  upNext(): string {
    const s = this.state;
    if (s.pendingMatch) return 'Match day — the team is waiting';
    const info = slotInfo(s, s.day, s.slot);
    const slot = SLOT_NAMES[s.slot];
    switch (info.kind) {
      case 'match':
        return `${slot}: MATCH`;
      case 'training':
        return `${slot}: ${info.label} — ${trainingDef(info.training!).name}`;
      case 'free': {
        const [k, p] = (info.activity ?? 'rest').split(':');
        const def = activityDef(k);
        return `${slot}: ${def?.name ?? k}${p ? ` (${p})` : ''}`;
      }
      default:
        return `${slot}: ${info.label}`;
    }
  }

  protected renderBar(): void {
    const s = this.state;
    const next = upcomingUserFixtures(s, 1)[0];
    const days = next ? next.day - s.day : null;
    this.bar.replaceChildren(
      h('div', { class: 'cc-bar-next' }, h('span', { class: 'cc-kicker' }, 'Up next'), h('strong', {}, this.upNext())),
      h(
        'div',
        { class: 'cc-bar-actions' },
        h('button', { class: 'btn btn--ghost cc-btn-sm', type: 'button', onclick: () => this.advance('day'), disabled: this.busy }, cicon('forward'), h('span', {}, 'Next day')),
        h('button', { class: 'btn btn--ghost cc-btn-sm', type: 'button', onclick: () => this.advance('match'), disabled: this.busy }, cicon('match'), h('span', {}, days === null ? 'Next match' : days === 0 ? 'Match today' : `Match in ${days}d`)),
        h('button', { class: 'btn btn--primary', type: 'button', onclick: () => this.advance('slot'), disabled: this.busy, 'data-nav-default': true }, h('span', {}, s.pendingMatch ? 'Match day' : 'Continue'), cicon('next')),
      ),
    );
  }

  /** runs the loop; routes stops to screens */
  advance(mode: 'slot' | 'day' | 'match'): void {
    if (this.busy) return;
    const s = this.state;
    if (s.pendingMatch) {
      this.openMatchDay();
      return;
    }
    if (s.events.pending) {
      showEventDialog(this);
      return;
    }
    this.busy = true;
    let reason: StopReason = 'none';
    try {
      reason = mode === 'slot' ? advanceSlot(s) : mode === 'day' ? advanceDay(s) : advanceToNextMatch(s);
    } catch (e) {
      console.error(e);
      showToast(`Something went wrong: ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
    this.busy = false;
    this.afterAdvance(reason);
  }

  afterAdvance(reason: StopReason): void {
    this.maybeAutosave(reason);
    switch (reason) {
      case 'event':
        this.render();
        showEventDialog(this);
        break;
      case 'match':
        this.openMatchDay();
        break;
      case 'offer':
        this.render();
        showToast('New offer — check your contract page', 'success', 3500);
        break;
      case 'season':
        pushScreen(createSeasonReviewScreen(this, this.state.season - 1));
        break;
      case 'retired':
        this.save(false);
        showScreen(createRetirementScreen(this));
        break;
      default:
        this.render();
        if (this.state.life.lastActivity && this.state.life.lastActivity.day === this.state.day) {
          // quiet feedback for activities is in the hub timeline
        }
    }
  }

  openMatchDay(): void {
    pushScreen(createMatchDayScreen(this));
  }

  protected maybeAutosave(reason: StopReason): void {
    const week = Math.floor((this.state.day + 3) / 7);
    if (week !== this.lastSavedWeek || reason === 'season' || reason === 'retired' || (reason === 'match' && weekday(this.state.day) >= 0)) {
      this.lastSavedWeek = week;
      clearTimeout(this.saveTimer);
      this.saveTimer = window.setTimeout(() => this.save(false), 60);
    }
  }

  save(manual: boolean): boolean {
    if (!this.kv) {
      if (manual) showToast('Saving is not available (browser storage is blocked)', 'warn');
      return false;
    }
    try {
      saveToSlot(this.kv, this.slot, this.state);
      if (manual) showToast('Career saved', 'success');
      return true;
    } catch (e) {
      console.error(e);
      showToast(`Could not save: ${e instanceof Error && /quota/i.test(e.message) ? 'browser storage is full — delete an old slot' : String(e)}`, 'error', 5000);
      return false;
    }
  }

  exitToMenu(): void {
    this.save(false);
    openCareerMenu();
  }

  toast(text: string, kind: 'info' | 'warn' | 'error' | 'success' = 'info'): void {
    showToast(text, kind);
  }
}
