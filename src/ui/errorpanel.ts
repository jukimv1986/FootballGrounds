// Friendly error panel for uncaught errors / rejections (and boot failures). It sits above
// everything (menus, HUD, canvas) and offers reload / dismiss plus the technical details.

import { h } from './dom';

let panel: HTMLElement | null = null;
let count = 0;
let installed = false;

function describe(error: unknown): { message: string; detail: string } {
  if (error instanceof Error) return { message: error.message || error.name, detail: error.stack ?? String(error) };
  if (typeof error === 'string') return { message: error, detail: error };
  try {
    const s = JSON.stringify(error);
    return { message: s, detail: s };
  } catch {
    return { message: String(error), detail: String(error) };
  }
}

export interface ErrorPanelOptions {
  title?: string;
  /** the friendly explanation above the details */
  hint?: string;
  /** replaces "Dismiss" by "Try again" when given */
  retry?: () => void;
  /** a fatal error hides "Dismiss" (the app cannot continue) */
  fatal?: boolean;
}

/** shows (or updates) the error panel */
export function showErrorPanel(error: unknown, o: ErrorPanelOptions = {}): void {
  if (typeof document === 'undefined') return;
  count++;
  // an error repeating every frame must not rebuild the panel: keep the first one, update the count
  if (panel && panel.isConnected && !o.fatal) {
    let counter = panel.querySelector('.error-count');
    if (!counter) {
      counter = h('p', { class: 'error-count' });
      panel.querySelector('.error-message')?.after(counter);
    }
    counter.textContent = `${count} errors so far`;
    return;
  }
  const { message, detail } = describe(error);
  panel?.remove();
  const close = () => {
    panel?.remove();
    panel = null;
  };
  panel = h(
    'div',
    { class: 'error-overlay', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'error-title' },
    h(
      'div',
      { class: 'error-panel' },
      h('div', { class: 'error-badge', 'aria-hidden': 'true' }, '!'),
      h('h2', { id: 'error-title', class: 'error-title' }, o.title ?? 'Something went wrong'),
      h('p', { class: 'error-hint' }, o.hint ?? "The game hit an unexpected problem. You can keep going, but if things look broken, reloading usually fixes it — your settings and saves are kept."),
      h('p', { class: 'error-message' }, message),
      count > 1 ? h('p', { class: 'error-count' }, `${count} errors so far`) : null,
      h('details', { class: 'error-details' }, h('summary', {}, 'Technical details'), h('pre', {}, detail)),
      h(
        'div',
        { class: 'error-actions' },
        h('button', { type: 'button', class: 'btn btn--primary', onclick: () => location.reload() }, 'Reload'),
        o.retry
          ? h('button', { type: 'button', class: 'btn', onclick: () => (close(), o.retry?.()) }, 'Try again')
          : o.fatal
            ? null
            : h('button', { type: 'button', class: 'btn btn--ghost', onclick: close }, 'Dismiss'),
      ),
    ),
  );
  document.body.appendChild(panel);
  panel.querySelector<HTMLButtonElement>('.btn')?.focus({ preventScroll: true });
  // keep the panel's buttons reachable with the keyboard while it is open
  panel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !o.fatal) close();
    e.stopPropagation();
  });
}

const IGNORED = [/ResizeObserver loop/i, /^Script error\.?$/i];

/** installs window error / unhandledrejection handlers that show the panel */
export function installGlobalErrorHandler(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e: ErrorEvent) => {
    // resource load errors (img/script 404) arrive as plain Events without a message
    if (!(e instanceof ErrorEvent) || (!e.error && !e.message)) return;
    if (IGNORED.some((re) => re.test(e.message))) return;
    console.error(e.error ?? e.message);
    showErrorPanel(e.error ?? e.message);
  });
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    const { message } = describe(e.reason);
    if (IGNORED.some((re) => re.test(message))) return;
    showErrorPanel(e.reason);
  });
}
