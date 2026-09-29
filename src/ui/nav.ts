// Focus navigation for menus and career screens: arrow keys / d-pad / left stick move the focus
// spatially between focusable elements, Enter / A activates, Escape / B goes back, Q-E / PageUp-
// PageDown / LB-RB switch tabs. Works alongside mouse and touch (the DOM focus is the single
// source of truth, so pointer and keys never disagree about what is selected).
//
// Usage:
//   initNav()                                  once at boot
//   withNav(screen, { onBack })                a router Screen gets its own scope while shown
//   const scope = pushNavScope(modalEl, {...}) a modal traps navigation until scope.pop()
//   setNavHandler(el, (action) => ...)         an element consumes actions itself (sliders,
//                                              spinners): return true when handled
//
// Elements are focusable when they are buttons/inputs/links, have a tabindex >= 0 or carry the
// `data-nav` attribute. `data-nav-skip` excludes an element. `data-nav-default` marks the element
// focused first when the scope opens.
//
// While a match is running the menu layer (#app) is hidden, and scopes whose root is not visible
// are ignored, so match controls never reach the menus.

import type { Screen } from './router';
import { back } from './router';

export type NavAction = 'up' | 'down' | 'left' | 'right' | 'accept' | 'back' | 'prev' | 'next' | 'start';

export interface NavSource {
  kind: 'keyboard' | 'gamepad';
  /** navigator.getGamepads() index, for gamepad events */
  gamepadIndex?: number;
}

/** return true when the action was consumed */
export type NavHandler = (action: NavAction, source: NavSource) => boolean;

export interface NavScopeOptions {
  /** Escape / B. Default for screen scopes: router back() */
  onBack?: () => void;
  /** screen-level hook, called before the default handling (after the focused element's handler) */
  onAction?: NavHandler;
  /** element (or selector inside root) focused when the scope opens */
  initialFocus?: HTMLElement | string | null;
  /** wrap around at the ends of the list (vertical menus) */
  wrap?: boolean;
  /** don't move DOM focus when the scope opens (e.g. a screen that manages it itself) */
  noAutoFocus?: boolean;
}

const FOCUSABLE =
  'button, [data-nav], input:not([type="hidden"]), select, textarea, a[href], [tabindex]:not([tabindex="-1"])';

export class NavScope {
  lastFocused: HTMLElement | null = null;
  private popped = false;

  constructor(
    readonly root: HTMLElement,
    readonly options: NavScopeOptions,
  ) {}

  /** focusable elements inside the scope, in document order */
  Elements(): HTMLElement[] {
    const list = Array.from(this.root.querySelectorAll<HTMLElement>(FOCUSABLE));
    return list.filter((el) => isNavigable(el));
  }

  Focus(el: HTMLElement | null | undefined, scroll = true): void {
    if (!el) return;
    el.focus({ preventScroll: true });
    this.lastFocused = el;
    if (scroll) scrollIntoViewIfNeeded(el);
  }

  FocusFirst(): void {
    const opt = this.options.initialFocus;
    let target: HTMLElement | null = null;
    if (typeof opt === 'string') target = this.root.querySelector<HTMLElement>(opt);
    else if (opt) target = opt;
    if (!target || !isNavigable(target)) target = this.root.querySelector<HTMLElement>('[data-nav-default]');
    if (!target || !isNavigable(target)) target = this.Elements()[0] ?? null;
    this.Focus(target, false);
  }

  /** restores the last focused element, or the default one */
  Restore(): void {
    if (this.lastFocused && this.root.contains(this.lastFocused) && isNavigable(this.lastFocused)) this.Focus(this.lastFocused, false);
    else this.FocusFirst();
  }

  IsActive(): boolean {
    return !this.popped && this.root.isConnected && this.root.getClientRects().length > 0;
  }

  pop(): void {
    if (this.popped) return;
    this.popped = true;
    const i = scopes.indexOf(this);
    if (i >= 0) scopes.splice(i, 1);
    // hand the focus back to the scope below
    const top = activeScope();
    if (top && (!document.activeElement || !top.root.contains(document.activeElement))) top.Restore();
  }
}

const scopes: NavScope[] = [];
const handlers = new WeakMap<HTMLElement, NavHandler>();
let initialized = false;
let enabled = true;

function isNavigable(el: HTMLElement): boolean {
  if (el.hasAttribute('data-nav-skip') || el.getAttribute('tabindex') === '-1') return false;
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.closest('[inert], [aria-hidden="true"]')) return false;
  if (el.getClientRects().length === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== 'hidden';
}

function isTextField(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color'].includes(el.type);
  return (el as HTMLElement).isContentEditable === true;
}

function scrollIntoViewIfNeeded(el: HTMLElement): void {
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function activeScope(): NavScope | null {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const s = scopes[i];
    if (!s.root.isConnected) continue;
    return s;
  }
  return null;
}

/** the element a scope considers focused (DOM focus if inside the scope) */
function focusedIn(scope: NavScope): HTMLElement | null {
  const a = document.activeElement as HTMLElement | null;
  if (a && a !== document.body && scope.root.contains(a)) return a;
  return null;
}

// ----- spatial movement

type Dir = 'up' | 'down' | 'left' | 'right';

function bestCandidate(from: DOMRect, candidates: HTMLElement[], dir: Dir): HTMLElement | null {
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of candidates) {
    const r = el.getBoundingClientRect();
    const ex = r.left + r.width / 2;
    const ey = r.top + r.height / 2;
    let primary: number;
    let gap: number;
    if (dir === 'down' || dir === 'up') {
      primary = dir === 'down' ? r.top - from.bottom : from.top - r.bottom;
      const centerDelta = dir === 'down' ? ey - cy : cy - ey;
      if (centerDelta <= 1) continue;
      gap = Math.max(0, Math.max(r.left, from.left) - Math.min(r.right, from.right));
      primary = Math.max(0, primary);
      const score = primary + gap * 2.5 + Math.abs(ex - cx) * 0.05;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    } else {
      primary = dir === 'right' ? r.left - from.right : from.left - r.right;
      const centerDelta = dir === 'right' ? ex - cx : cx - ex;
      if (centerDelta <= 1) continue;
      gap = Math.max(0, Math.max(r.top, from.top) - Math.min(r.bottom, from.bottom));
      primary = Math.max(0, primary);
      const score = primary + gap * 2.5 + Math.abs(ey - cy) * 0.05;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
  }
  return best;
}

/** moves the focus in a direction inside the active scope; returns false if nothing is there */
export function moveFocus(dir: Dir, scope: NavScope | null = activeScope()): boolean {
  if (!scope) return false;
  const elements = scope.Elements();
  if (elements.length === 0) return false;
  const current = focusedIn(scope);
  if (!current) {
    scope.Restore();
    return true;
  }
  const others = elements.filter((e) => e !== current && !current.contains(e));
  const target = bestCandidate(current.getBoundingClientRect(), others, dir);
  if (target) {
    scope.Focus(target);
    return true;
  }
  if (scope.options.wrap && (dir === 'up' || dir === 'down')) {
    scope.Focus(dir === 'down' ? elements[0] : elements[elements.length - 1]);
    return true;
  }
  return false;
}

// ----- dispatch

/** feeds an action into the navigation (also usable by on-screen buttons / tests) */
export function dispatchNavAction(action: NavAction, source: NavSource = { kind: 'keyboard' }): boolean {
  if (!enabled) return false;
  const scope = activeScope();
  if (!scope || !scope.IsActive()) return false;
  const focused = focusedIn(scope);

  // the focused element (or an ancestor inside the scope) may consume the action
  for (let el: HTMLElement | null = focused; el && scope.root.contains(el); el = el.parentElement) {
    const handler = handlers.get(el);
    if (handler && handler(action, source)) return true;
    if (el === scope.root) break;
  }
  if (scope.options.onAction?.(action, source)) return true;

  switch (action) {
    case 'up':
    case 'down':
    case 'left':
    case 'right':
      return moveFocus(action, scope);
    case 'accept':
      if (focused) {
        if (focused instanceof HTMLInputElement && focused.type === 'range') return true;
        focused.click();
      } else scope.Restore();
      return true;
    case 'back':
      if (scope.options.onBack) scope.options.onBack();
      return true;
    default:
      return false;
  }
}

/** lets an element handle nav actions itself (return true when consumed) */
export function setNavHandler(el: HTMLElement, handler: NavHandler): void {
  handlers.set(el, handler);
}

/** pushes a navigation scope (a screen or a modal); the returned scope's pop() removes it */
export function pushNavScope(root: HTMLElement, options: NavScopeOptions = {}): NavScope {
  const scope = new NavScope(root, options);
  scopes.push(scope);
  if (!options.noAutoFocus) {
    // after the element is laid out
    requestAnimationFrame(() => {
      if (activeScope() === scope && !focusedIn(scope)) scope.FocusFirst();
    });
    if (root.isConnected) scope.FocusFirst();
  }
  return scope;
}

/**
 * Gives a router screen its own navigation scope while it is shown. Back defaults to router
 * back(). The focus is restored when the screen is shown again (after a pushed screen pops).
 */
export function withNav<S extends Screen>(screen: S, options: NavScopeOptions = {}): S {
  let scope: NavScope | null = null;
  let remembered: HTMLElement | null = null;
  const show = screen.onShow?.bind(screen);
  const hide = screen.onHide?.bind(screen);
  screen.onShow = () => {
    show?.();
    scope?.pop();
    scope = pushNavScope(screen.el, { onBack: () => back(), ...options, noAutoFocus: true });
    if (remembered && screen.el.contains(remembered) && isNavigable(remembered)) scope.Focus(remembered, false);
    else if (!options.noAutoFocus) {
      scope.FocusFirst();
      requestAnimationFrame(() => {
        if (scope && activeScope() === scope && !focusedIn(scope)) scope.FocusFirst();
      });
    }
  };
  screen.onHide = () => {
    if (scope) {
      remembered = focusedIn(scope) ?? scope.lastFocused;
      scope.pop();
      scope = null;
    }
    hide?.();
  };
  return screen;
}

/** the scope on top of the stack (null when none) */
export function GetActiveNavScope(): NavScope | null {
  return activeScope();
}

/** globally enables/disables menu navigation (e.g. while capturing a key binding) */
export function setNavEnabled(on: boolean): void {
  enabled = on;
}

// ----- input sources

function setInputMode(mode: 'pointer' | 'keys' | 'gamepad'): void {
  if (document.body.dataset.input !== mode) document.body.dataset.input = mode;
}

const KEY_ACTIONS: Record<string, NavAction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'accept',
  NumpadEnter: 'accept',
  Escape: 'back',
  Backspace: 'back',
  PageUp: 'prev',
  PageDown: 'next',
  KeyQ: 'prev',
  KeyE: 'next',
};

function onKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const action = KEY_ACTIONS[e.code];
  if (!action) {
    if (e.code === 'Tab') setInputMode('keys');
    return;
  }
  const scope = activeScope();
  if (!scope || !scope.IsActive()) return;
  const target = document.activeElement;
  // text fields keep their editing keys
  if (isTextField(target)) {
    if (action === 'left' || action === 'right' || action === 'prev' || action === 'next') return;
    if (e.code === 'Backspace') return;
  }
  if (target instanceof HTMLSelectElement && (action === 'up' || action === 'down')) return;
  setInputMode('keys');
  if (dispatchNavAction(action, { kind: 'keyboard' })) e.preventDefault();
}

// Gamepad polling (standard mapping): d-pad 12-15 / left stick, A 0, B 1, LB 4, RB 5, start 9.
const PAD_BUTTONS: [number, NavAction][] = [
  [12, 'up'],
  [13, 'down'],
  [14, 'left'],
  [15, 'right'],
  [0, 'accept'],
  [1, 'back'],
  [4, 'prev'],
  [5, 'next'],
  [9, 'start'],
];
const REPEAT_DELAY_MS = 380;
const REPEAT_RATE_MS = 110;
const padState = new Map<string, number>(); // `${pad}:${action}` -> next repeat time (0 = released)
let polling = false;

function pollGamepads(): void {
  const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
  let any = false;
  const now = performance.now();
  for (const pad of pads) {
    if (!pad || !pad.connected) continue;
    any = true;
    const pressed = new Set<NavAction>();
    for (const [index, action] of PAD_BUTTONS) if (pad.buttons[index]?.pressed) pressed.add(action);
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    if (Math.abs(ax) > 0.6 || Math.abs(ay) > 0.6) {
      if (Math.abs(ax) > Math.abs(ay)) pressed.add(ax > 0 ? 'right' : 'left');
      else pressed.add(ay > 0 ? 'down' : 'up');
    }
    for (const [, action] of PAD_BUTTONS) {
      const key = `${pad.index}:${action}`;
      const next = padState.get(key) ?? 0;
      if (!pressed.has(action)) {
        padState.set(key, 0);
        continue;
      }
      const repeatable = action === 'up' || action === 'down' || action === 'left' || action === 'right';
      if (next === 0) {
        padState.set(key, repeatable ? now + REPEAT_DELAY_MS : Infinity);
        setInputMode('gamepad');
        dispatchNavAction(action, { kind: 'gamepad', gamepadIndex: pad.index });
      } else if (repeatable && now >= next) {
        padState.set(key, now + REPEAT_RATE_MS);
        dispatchNavAction(action, { kind: 'gamepad', gamepadIndex: pad.index });
      }
    }
  }
  if (any) requestAnimationFrame(pollGamepads);
  else polling = false;
}

function startPolling(): void {
  if (polling) return;
  polling = true;
  requestAnimationFrame(pollGamepads);
}

function onPointerMove(e: PointerEvent): void {
  if (e.pointerType !== 'mouse') {
    setInputMode('pointer');
    return;
  }
  if (e.movementX === 0 && e.movementY === 0) return;
  setInputMode('pointer');
  // hovering moves the focus, so keys continue from where the mouse is
  const scope = activeScope();
  if (!scope || !enabled) return;
  const target = (e.target as Element | null)?.closest?.(FOCUSABLE) as HTMLElement | null;
  if (!target || !scope.root.contains(target) || target === document.activeElement) return;
  if (isTextField(document.activeElement) || target.hasAttribute('data-nav-nohover')) return;
  if (isNavigable(target)) scope.Focus(target, false);
}

/** installs the keyboard / gamepad / pointer listeners (idempotent) */
export function initNav(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', () => setInputMode('pointer'), { passive: true });
  window.addEventListener('gamepadconnected', () => startPolling());
  // pads connected before the page loaded show up on the first poll after a button press
  if (typeof navigator.getGamepads === 'function' && Array.from(navigator.getGamepads()).some((p) => p)) startPolling();
  setInputMode('pointer');
}
