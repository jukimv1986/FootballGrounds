// Reusable menu building blocks (plain DOM, styled in menus.css): screen frame with header,
// footer button hints, modals, toasts, sliders, segmented controls and value spinners.
// Career screens can use these to look consistent with the main menus.

import { dataUrl, h } from './dom';
import { icon } from './icons';
import { pushNavScope, setNavHandler, type NavAction, type NavScope } from './nav';

// ----- screen frame

export interface ScreenFrameOptions {
  /** css modifier: `.screen--${id}` */
  id: string;
  title: string;
  /** small line above the title (breadcrumb / mode) */
  kicker?: string;
  /** back button in the header */
  onBack?: () => void;
  /** step indicator, e.g. ['Teams', 'Controls', 'Options'] */
  steps?: { labels: string[]; active: number };
  /** background style */
  background?: 'city' | 'stadium' | 'plain';
  body: (Node | null | false)[];
  /** buttons at the bottom right */
  actions?: (Node | null | false)[];
  /** control hints at the bottom left */
  hints?: Hint[];
  /** extra header content on the right */
  headerRight?: (Node | null | false)[];
}

export function screenFrame(o: ScreenFrameOptions): HTMLElement {
  return h(
    'section',
    { class: `screen screen--${o.id}` },
    backgroundLayer(o.background ?? 'city'),
    h(
      'header',
      { class: 'screen-header' },
      o.onBack ? h('button', { class: 'icon-btn back-btn', 'aria-label': 'Back', onclick: o.onBack, 'data-nav-skip': true }, icon('back')) : null,
      h('div', { class: 'screen-titles' }, o.kicker ? h('div', { class: 'screen-kicker' }, o.kicker) : null, h('h1', { class: 'screen-title' }, o.title)),
      o.steps ? stepper(o.steps.labels, o.steps.active) : null,
      o.headerRight ? h('div', { class: 'screen-header-right' }, ...o.headerRight) : null,
    ),
    h('main', { class: 'screen-body' }, ...o.body),
    o.hints || o.actions
      ? h('footer', { class: 'screen-footer' }, hintBar(o.hints ?? []), h('div', { class: 'screen-actions' }, ...(o.actions ?? [])))
      : null,
  );
}

const BACKGROUNDS = {
  city: 'media/menu/backgrounds/megabackground01.jpg',
  stadium: 'media/menu/credits/bg.png',
  plain: '',
};

/** full-screen background (original menu art, darkened) behind a screen */
export function backgroundLayer(kind: 'city' | 'stadium' | 'plain'): HTMLElement {
  const img = BACKGROUNDS[kind];
  return h(
    'div',
    { class: `screen-bg screen-bg--${kind}`, 'aria-hidden': 'true' },
    img ? h('div', { class: 'screen-bg-img', style: `background-image: url("${dataUrl(img)}")` }) : null,
    h('div', { class: 'screen-bg-shade' }),
  );
}

function stepper(labels: string[], active: number): HTMLElement {
  return h(
    'ol',
    { class: 'stepper', 'aria-label': 'Progress' },
    labels.map((label, i) =>
      h('li', { class: `step ${i < active ? 'is-done' : ''} ${i === active ? 'is-active' : ''}` }, h('span', { class: 'step-num' }, String(i + 1)), h('span', { class: 'step-label' }, label)),
    ),
  );
}

// ----- control hints

export interface Hint {
  /** keyboard glyphs, e.g. ['↑', '↓'] */
  keys: string[];
  /** gamepad glyphs, e.g. ['A'] */
  pad?: string[];
  label: string;
}

export const HINT_NAVIGATE: Hint = { keys: ['↑', '↓', '←', '→'], pad: ['✥'], label: 'Navigate' };
export const HINT_SELECT: Hint = { keys: ['Enter'], pad: ['A'], label: 'Select' };
export const HINT_BACK: Hint = { keys: ['Esc'], pad: ['B'], label: 'Back' };
export const HINT_TABS: Hint = { keys: ['Q', 'E'], pad: ['LB', 'RB'], label: 'Switch tab' };

export function hintBar(hints: Hint[]): HTMLElement {
  return h(
    'div',
    { class: 'hints' },
    hints.map((hint) =>
      h(
        'span',
        { class: 'hint' },
        h('span', { class: 'hint-keys hint-keys--kb' }, hint.keys.map((k) => h('kbd', {}, k))),
        h('span', { class: 'hint-keys hint-keys--pad' }, (hint.pad ?? hint.keys).map((k) => h('kbd', { class: `pad pad-${k.toLowerCase()}` }, k))),
        h('span', { class: 'hint-label' }, hint.label),
      ),
    ),
  );
}

// ----- buttons

export function button(label: string | Node, onClick: () => void, opts: { kind?: 'primary' | 'ghost' | 'danger' | 'default'; icon?: string; className?: string; attrs?: Record<string, unknown> } = {}): HTMLButtonElement {
  return h(
    'button',
    { class: `btn btn--${opts.kind ?? 'default'} ${opts.className ?? ''}`, type: 'button', onclick: onClick, ...(opts.attrs ?? {}) },
    opts.icon ? icon(opts.icon) : null,
    typeof label === 'string' ? h('span', {}, label) : label,
  );
}

// ----- toast

let toastRoot: HTMLElement | null = null;

export function showToast(text: string, kind: 'info' | 'warn' | 'error' | 'success' = 'info', duration_ms = 2800): void {
  if (!toastRoot || !toastRoot.isConnected) {
    toastRoot = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastRoot);
  }
  const el = h('div', { class: `toast toast--${kind}` }, icon(kind === 'success' ? 'trophy' : kind === 'info' ? 'info' : 'warn'), h('span', {}, text));
  toastRoot.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  setTimeout(() => {
    el.classList.remove('is-in');
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 300);
  }, duration_ms);
}

// ----- modal

export interface ModalAction {
  label: string;
  kind?: 'primary' | 'ghost' | 'danger' | 'default';
  /** return false to keep the modal open */
  onClick?: () => void | boolean;
}

export interface ModalOptions {
  title: string;
  kicker?: string;
  body?: (Node | string | null | false)[];
  actions?: ModalAction[];
  /** Escape / B / click outside; default: close */
  onDismiss?: () => void;
  dismissible?: boolean;
  className?: string;
  icon?: string;
}

export interface ModalHandle {
  el: HTMLElement;
  scope: NavScope;
  close(): void;
}

/** a centered dialog in the menu layer with its own navigation scope */
export function showModal(o: ModalOptions): ModalHandle {
  const host = document.getElementById('app') ?? document.body;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    scope.pop();
    overlay.classList.add('is-out');
    setTimeout(() => overlay.remove(), 180);
  };
  const dismiss = () => {
    if (o.dismissible === false) return;
    close();
    o.onDismiss?.();
  };
  const actions = (o.actions ?? [{ label: 'OK', kind: 'primary' }]).map((a, i) =>
    button(
      a.label,
      () => {
        if (a.onClick?.() === false) return;
        close();
      },
      { kind: a.kind ?? (i === 0 ? 'primary' : 'default'), attrs: i === 0 ? { 'data-nav-default': true } : {} },
    ),
  );
  const dialog = h(
    'div',
    { class: `modal ${o.className ?? ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': o.title },
    h(
      'div',
      { class: 'modal-head' },
      o.icon ? h('span', { class: 'modal-icon' }, icon(o.icon)) : null,
      h('div', {}, o.kicker ? h('div', { class: 'modal-kicker' }, o.kicker) : null, h('h2', { class: 'modal-title' }, o.title)),
    ),
    h('div', { class: 'modal-body' }, ...(o.body ?? [])),
    actions.length ? h('div', { class: 'modal-actions' }, ...actions) : null,
  );
  const overlay = h('div', { class: 'modal-overlay', onclick: (e: MouseEvent) => e.target === overlay && dismiss() }, dialog);
  host.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-in'));
  const scope = pushNavScope(overlay, { onBack: dismiss });
  return { el: overlay, scope, close };
}

// ----- slider

export interface SliderOptions {
  label: string;
  description?: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  /** value -> display text */
  format?: (v: number) => string;
  onInput: (v: number) => void;
  /** default value: shows a reset marker */
  defaultValue?: number;
}

export interface SliderHandle {
  el: HTMLElement;
  input: HTMLInputElement;
  set(v: number): void;
}

/** labelled range slider row; ←/→ (keys, d-pad) adjust it */
export function sliderRow(o: SliderOptions): SliderHandle {
  const min = o.min ?? 0;
  const max = o.max ?? 1;
  const step = o.step ?? 0.01;
  const fmt = o.format ?? ((v: number) => `${Math.round(((v - min) / (max - min)) * 100)}%`);
  const valueEl = h('output', { class: 'slider-value' });
  const input = h('input', { type: 'range', class: 'slider', min: String(min), max: String(max), step: String(step), 'aria-label': o.label });
  const sync = () => {
    const v = Number(input.value);
    valueEl.textContent = fmt(v);
    input.style.setProperty('--fill', `${((v - min) / (max - min)) * 100}%`);
    if (o.defaultValue !== undefined) input.style.setProperty('--default', `${((o.defaultValue - min) / (max - min)) * 100}%`);
  };
  input.value = String(o.value);
  sync();
  input.addEventListener('input', () => {
    sync();
    o.onInput(Number(input.value));
  });
  setNavHandler(input, (action: NavAction) => {
    if (action !== 'left' && action !== 'right') return false;
    const coarse = Math.max(step, (max - min) / 20);
    const v = Math.min(max, Math.max(min, Number(input.value) + (action === 'right' ? coarse : -coarse)));
    input.value = String(Math.round(v / step) * step);
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change'));
    return true;
  });
  const el = h(
    'div',
    { class: 'setting-row setting-row--slider' },
    h('div', { class: 'setting-text' }, h('div', { class: 'setting-label' }, o.label), o.description ? h('div', { class: 'setting-desc' }, o.description) : null),
    h('div', { class: 'setting-control' }, input, valueEl),
  );
  return {
    el,
    input,
    set(v: number) {
      input.value = String(v);
      sync();
    },
  };
}

// ----- segmented choice

export interface SegmentedOptions<T extends string | number> {
  label: string;
  description?: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}

/** a row of mutually exclusive options; ←/→ move the selection */
export function segmentedRow<T extends string | number>(o: SegmentedOptions<T>): { el: HTMLElement; set(v: T): void } {
  let current = o.value;
  const buttons = o.options.map((opt) =>
    h('button', { type: 'button', class: 'seg-btn', 'aria-pressed': 'false', tabindex: '-1', onclick: () => select(opt.value, true) }, opt.label),
  );
  const group = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': o.label, tabindex: '0', 'data-nav': true }, ...buttons);
  const select = (v: T, notify: boolean) => {
    current = v;
    o.options.forEach((opt, i) => {
      buttons[i].classList.toggle('is-selected', opt.value === v);
      buttons[i].setAttribute('aria-pressed', String(opt.value === v));
    });
    if (notify) o.onChange(v);
  };
  select(current, false);
  setNavHandler(group, (action) => {
    if (action !== 'left' && action !== 'right' && action !== 'accept') return false;
    const i = o.options.findIndex((opt) => opt.value === current);
    const n = action === 'left' ? Math.max(0, i - 1) : action === 'right' ? Math.min(o.options.length - 1, i + 1) : (i + 1) % o.options.length;
    if (n !== i) select(o.options[n].value, true);
    return true;
  });
  const el = h(
    'div',
    { class: 'setting-row' },
    h('div', { class: 'setting-text' }, h('div', { class: 'setting-label' }, o.label), o.description ? h('div', { class: 'setting-desc' }, o.description) : null),
    h('div', { class: 'setting-control' }, group),
  );
  return { el, set: (v: T) => select(v, false) };
}

// ----- misc

/** "king's league" -> "King's League" */
export function titleCase(s: string): string {
  return s.replace(/(^|[\s-])(\p{L})/gu, (_m, sep: string, c: string) => sep + c.toUpperCase());
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
