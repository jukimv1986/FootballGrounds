// Career menu: save slots (continue / load / delete / export), new career, import, hall of fame.

import { h } from '../../../ui/dom';
import { pushScreen, showScreen, type Screen } from '../../../ui/router';
import { withNav } from '../../../ui/nav';
import { screenFrame, showModal, showToast } from '../../../ui/widgets';
import { SLOT_COUNT, browserStorage, deleteSlot, exportSave, firstFreeSlot, importSave, lastSlot, listSlots, loadFromSlot, loadHallOfFame, saveToSlot, type KV, type SlotMeta } from '../../core/save';
import { CareerApp } from '../app';
import { btn, pill, table } from '../components';
import { cicon } from '../icons';
import { createCreatorScreen } from './creator';

let menuShown = false;

function relative(ts: number): string {
  if (!ts) return '';
  const d = (Date.now() - ts) / 1000;
  if (d < 90) return 'just now';
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}

export function loadCareer(kv: KV | null, slot: number): void {
  if (!kv) return;
  try {
    const state = loadFromSlot(kv, slot);
    if (!state) {
      showToast('That slot is empty', 'warn');
      return;
    }
    new CareerApp(state, slot, kv).show();
  } catch (e) {
    console.error(e);
    showToast(`Could not load this save: ${e instanceof Error ? e.message : String(e)}`, 'error', 5000);
  }
}

function download(name: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 500);
}

export function showHallOfFame(kv: KV | null): void {
  const list = kv ? loadHallOfFame(kv) : [];
  showModal({
    title: 'Hall of fame',
    kicker: 'Careers that ended',
    className: 'modal--wide cc-hof',
    icon: 'trophy',
    body: [
      list.length
        ? table(
            ['#', 'Player', 'Pos', 'Seasons', 'Apps', 'Goals', 'Caps', 'Trophies', 'Peak', 'Next', 'Score'],
            list.map((e, i) => [i + 1, h('span', {}, h('strong', {}, e.name), h('span', { class: 'cc-dim' }, ` · ${e.nat}`)), e.pos, e.seasons, e.apps, e.goals, e.caps, e.trophies, e.peakOvr, e.next, h('strong', {}, String(e.score))]),
          )
        : h('p', { class: 'cc-dim' }, 'No finished careers yet. Play one to the end to enter the hall of fame.'),
    ],
    actions: [{ label: 'Close', kind: 'primary' }],
  });
}

function slotCard(kv: KV | null, meta: SlotMeta | null, index: number, rerender: () => void): HTMLElement {
  if (!meta)
    return h(
      'article',
      { class: 'cc-slotcard is-empty' },
      h('div', { class: 'cc-slotcard-main' }, h('span', { class: 'cc-kicker' }, `Slot ${index + 1}`), h('strong', {}, 'Empty')),
      btn('New career', () => pushScreen(createCreatorScreen(kv, index)), 'ghost', { small: true, icon: 'plus' }),
    );
  return h(
    'article',
    { class: 'cc-slotcard' },
    h(
      'div',
      { class: 'cc-slotcard-main' },
      h('span', { class: 'cc-kicker' }, `Slot ${index + 1} · ${meta.date}`),
      h('strong', {}, meta.name),
      h('span', { class: 'cc-dim' }, `${meta.club} · age ${meta.age} · OVR ${meta.ovr}`),
      h('span', { class: 'cc-dim cc-small' }, `Saved ${relative(meta.savedAt)} · ${Math.round(meta.bytes / 1024)} KB`),
      meta.retired ? pill('Retired', 'gold') : null,
    ),
    h(
      'div',
      { class: 'cc-row-actions' },
      btn(meta.retired ? 'View legacy' : 'Play', () => loadCareer(kv, index), 'primary', { small: true }),
      btn('Export', () => {
        if (!kv) return;
        const s = loadFromSlot(kv, index);
        if (s) download(`career-${meta.name.replace(/\s+/g, '_')}-${meta.date.replace(/\s+/g, '')}.json`, exportSave(s));
      }, 'ghost', { small: true }),
      btn('Delete', () => {
        showModal({
          title: `Delete ${meta.name}?`,
          kicker: `Slot ${index + 1}`,
          body: ['This career will be gone forever. Export it first if you want a backup.'],
          actions: [
            { label: 'Delete', kind: 'danger', onClick: () => (kv && deleteSlot(kv, index), rerender()) },
            { label: 'Cancel', kind: 'ghost' },
          ],
        });
      }, 'danger', { small: true }),
    ),
  );
}

export function createCareerMenuScreen(): Screen {
  const kv = browserStorage();
  const slotsEl = h('div', { class: 'cc-slots-grid' });
  const render = () => {
    const slots = kv ? listSlots(kv) : new Array(SLOT_COUNT).fill(null);
    slotsEl.replaceChildren(...slots.map((m, i) => slotCard(kv, m, i, render)));
  };
  render();
  const fileInput = h('input', {
    type: 'file',
    accept: '.json,application/json,text/plain',
    class: 'cc-hidden',
    onchange: async () => {
      const file = fileInput.files?.[0];
      if (!file || !kv) return;
      try {
        const state = importSave(await file.text());
        const slot = firstFreeSlot(kv);
        saveToSlot(kv, slot, state);
        showToast(`Imported into slot ${slot + 1}`, 'success');
        render();
      } catch (e) {
        showToast(`Import failed: ${e instanceof Error ? e.message : String(e)}`, 'error', 5000);
      }
      fileInput.value = '';
    },
  });
  const last = kv ? lastSlot(kv) : null;
  const lastMeta = kv && last !== null ? listSlots(kv)[last] : null;
  const el = screenFrame({
    id: 'career-menu',
    kicker: 'Career mode',
    title: 'Your football life',
    background: 'city',
    onBack: () => goToTitle(),
    body: [
      h(
        'div',
        { class: 'cc-menu' },
        h(
          'div',
          { class: 'cc-menu-hero' },
          h('p', { class: 'cc-menu-tag' }, 'From a 15-year-old academy kid to a legend — on the pitch and off it. Train, play, live in the city, fall in love, sign contracts, win trophies, and decide what comes after.'),
          h(
            'div',
            { class: 'cc-row-actions' },
            lastMeta && !lastMeta.retired ? btn(`Continue: ${lastMeta.name}`, () => loadCareer(kv, last!), 'primary', { icon: 'play' }) : null,
            btn('New career', () => pushScreen(createCreatorScreen(kv, kv ? firstFreeSlot(kv) : 0)), lastMeta && !lastMeta.retired ? 'default' : 'primary', { icon: 'plus' }),
            btn('Import save', () => fileInput.click(), 'ghost', { icon: 'upload', disabled: kv ? false : 'Storage unavailable' }),
            btn('Hall of fame', () => showHallOfFame(kv), 'ghost', { icon: 'trophy' }),
          ),
          !kv ? h('p', { class: 'cc-alert cc-alert--warn' }, cicon('info'), ' Browser storage is blocked: careers cannot be saved in this session.') : null,
        ),
        h('h2', { class: 'cc-h2' }, 'Save slots'),
        slotsEl,
        fileInput,
      ),
    ],
  });
  return withNav({ el, onShow: render }, { onBack: () => goToTitle() });
}

function goToTitle(): void {
  import('../../../ui/screens/title')
    .then((m) => m.showTitleScreen())
    .catch(() => showToast('Main menu not available', 'warn'));
}

/** entry point used by the main menu */
export function openCareerMenu(): void {
  const screen = createCareerMenuScreen();
  if (!menuShown) {
    menuShown = true;
    pushScreen(screen);
  } else showScreen(screen);
}
