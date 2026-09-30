// In-match DOM overlay: loading panel, pause menu (Escape / Start), toasts and the full-time
// summary. Lives in its own layer (#match-overlay) above the canvas and the Gui2 #hud layer
// (Gui2WindowManager.Clear() wipes #hud at the end of a match, so the overlay is not inside it).
//
// Gamepads can drive the menus too: d-pad / stick up/down moves the focus, the short pass button
// (A) activates, the high pass button (B) goes back, Start toggles the pause menu.

import { h, clear } from '../ui/dom';
import { GetControllers } from '../game/globals';
import { e_ButtonFunction, e_HIDeviceType, type IHIDevice } from '../game/hid/ihidevice';
import { HIDKeyboard } from '../game/hid/keyboard';
import type { PlayerMatchStats } from './matchsession';
import '../ui/hud.css';

export interface CameraSettings {
  zoom: number;
  height: number;
}

export interface MatchOverlayCallbacks {
  /** the pause menu opened (true) or closed (false) */
  onPause(paused: boolean): void;
  /** the user confirmed "Quit match" */
  onQuit(): void;
  getCameraSettings?(): CameraSettings | null;
  setCameraSettings?(settings: CameraSettings): void;
}

export interface FullTimeScorer {
  teamID: 0 | 1;
  name: string;
  minute: number;
  ownGoal?: boolean;
  penalty?: boolean;
}

export interface FullTimeSummary {
  homeName: string;
  awayName: string;
  homeGoals: number;
  awayGoals: number;
  scorers: FullTimeScorer[];
  /** "be a pro": the locked player's line */
  player?: { name: string; stats: PlayerMatchStats };
  /** header text (default "Full time") */
  title?: string;
}

type Panel = 'none' | 'loading' | 'pause' | 'confirm-quit' | 'fulltime';

const F = e_ButtonFunction;
const navFunctions = [F.e_ButtonFunction_Start, F.e_ButtonFunction_Up, F.e_ButtonFunction_Down, F.e_ButtonFunction_ShortPass, F.e_ButtonFunction_HighPass] as const;

function ratingClass(rating: number): string {
  if (rating >= 8) return 'rating-great';
  if (rating >= 7) return 'rating-good';
  if (rating >= 6) return 'rating-ok';
  return 'rating-poor';
}

export class MatchOverlay {
  protected root: HTMLElement | null = null;
  protected toasts: HTMLElement | null = null;
  protected panelHost: HTMLElement | null = null;
  protected pauseButton: HTMLElement | null = null;
  protected panel: Panel = 'none';
  protected callbacks: MatchOverlayCallbacks;
  protected keyHandler: ((e: KeyboardEvent) => void) | null = null;
  protected fullTimeResolve: (() => void) | null = null;
  protected loadingBar: HTMLElement | null = null;
  protected loadingText: HTMLElement | null = null;
  /** per controller, per nav function: state seen at the previous frame (own edge detection) */
  protected navState = new Map<IHIDevice, boolean[]>();

  constructor(callbacks: MatchOverlayCallbacks) {
    this.callbacks = callbacks;
  }

  Mount(parent: HTMLElement = document.body): void {
    if (this.root) return;
    this.toasts = h('div', { class: 'mo-toasts', 'aria-live': 'polite' });
    this.panelHost = h('div', { class: 'mo-panel-host' });
    this.pauseButton = h(
      'button',
      { class: 'mo-pause-button', 'aria-label': 'Pause', title: 'Pause (Esc)', hidden: true, onclick: () => this.OpenPauseMenu() },
      h('span', { class: 'mo-pause-icon', 'aria-hidden': 'true' }),
    );
    this.root = h('div', { id: 'match-overlay', class: 'match-overlay' }, this.toasts, this.pauseButton, this.panelHost);
    parent.appendChild(this.root);
    this.keyHandler = (e) => this.OnKey(e);
    window.addEventListener('keydown', this.keyHandler);
  }

  Unmount(): void {
    if (this.keyHandler) window.removeEventListener('keydown', this.keyHandler);
    this.keyHandler = null;
    this.root?.remove();
    this.root = null;
    this.toasts = null;
    this.panelHost = null;
    this.pauseButton = null;
    this.panel = 'none';
    this.navState.clear();
    if (this.fullTimeResolve) {
      const resolve = this.fullTimeResolve;
      this.fullTimeResolve = null;
      resolve();
    }
  }

  GetPanel(): Panel {
    return this.panel;
  }

  IsPauseMenuOpen(): boolean {
    return this.panel === 'pause' || this.panel === 'confirm-quit';
  }

  /** the small on-screen pause button (touch / mouse), shown while no panel is open */
  ShowPauseButton(visible: boolean): void {
    if (this.pauseButton) this.pauseButton.hidden = !visible;
  }

  protected SetPanel(panel: Panel, content: HTMLElement | null): void {
    this.panel = panel;
    this.root?.classList.toggle('has-panel', content !== null);
    if (!this.panelHost) return;
    clear(this.panelHost);
    this.panelHost.classList.toggle('active', content !== null);
    this.panelHost.classList.toggle('mo-modal', panel === 'pause' || panel === 'confirm-quit' || panel === 'fulltime');
    if (content) {
      this.panelHost.appendChild(content);
      const first = content.querySelector<HTMLElement>('[data-autofocus]') ?? content.querySelector<HTMLElement>('button');
      first?.focus({ preventScroll: true });
    }
  }

  // ----- loading

  ShowLoading(title: string | undefined, fraction: number): void {
    if (this.panel !== 'loading') {
      this.loadingBar = h('div', { class: 'mo-progress-bar' });
      this.loadingText = h('div', { class: 'mo-loading-percent' }, '0%');
      const panel = h(
        'div',
        { class: 'mo-panel mo-loading' },
        h('div', { class: 'mo-kicker' }, 'Loading match'),
        title ? h('div', { class: 'mo-title' }, title) : null,
        h('div', { class: 'mo-progress' }, this.loadingBar),
        this.loadingText,
      );
      this.SetPanel('loading', panel);
    }
    const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
    if (this.loadingBar) this.loadingBar.style.width = `${pct}%`;
    if (this.loadingText) this.loadingText.textContent = `${pct}%`;
  }

  HideLoading(): void {
    if (this.panel === 'loading') this.SetPanel('none', null);
  }

  // ----- pause menu

  OpenPauseMenu(): void {
    if (this.panel === 'fulltime' || this.panel === 'loading' || this.IsPauseMenuOpen()) return;
    this.RenderPauseMenu(false);
    this.callbacks.onPause(true);
  }

  ClosePauseMenu(): void {
    if (!this.IsPauseMenuOpen()) return;
    this.SetPanel('none', null);
    this.callbacks.onPause(false);
  }

  TogglePauseMenu(): void {
    if (this.IsPauseMenuOpen()) this.ClosePauseMenu();
    else this.OpenPauseMenu();
  }

  protected RenderPauseMenu(showCamera: boolean): void {
    const cam = this.callbacks.getCameraSettings?.() ?? null;
    const slider = (label: string, value: number, apply: (v: number) => void) => {
      const out = h('span', { class: 'mo-slider-value' }, `${Math.round(value * 100)}`);
      const input = h('input', {
        type: 'range',
        min: '0',
        max: '100',
        step: '1',
        value: String(Math.round(value * 100)),
        oninput: (e: Event) => {
          const v = Number((e.target as HTMLInputElement).value) / 100;
          out.textContent = `${Math.round(v * 100)}`;
          apply(v);
        },
      });
      return h('label', { class: 'mo-slider' }, h('span', { class: 'mo-slider-label' }, label), input, out);
    };
    let cameraSection: HTMLElement | null = null;
    if (showCamera && cam && this.callbacks.setCameraSettings) {
      const current = { ...cam };
      cameraSection = h(
        'div',
        { class: 'mo-camera' },
        slider('Zoom', current.zoom, (v) => {
          current.zoom = v;
          this.callbacks.setCameraSettings!({ ...current });
        }),
        slider('Height', current.height, (v) => {
          current.height = v;
          this.callbacks.setCameraSettings!({ ...current });
        }),
      );
    }
    const panel = h(
      'div',
      { class: 'mo-panel mo-pause', role: 'dialog', 'aria-label': 'Paused' },
      h('div', { class: 'mo-title' }, 'Paused'),
      h('button', { class: 'mo-button mo-primary', 'data-autofocus': true, onclick: () => this.ClosePauseMenu() }, 'Resume'),
      cam && this.callbacks.setCameraSettings
        ? h('button', { class: 'mo-button', 'aria-expanded': showCamera ? 'true' : 'false', onclick: () => this.RenderPauseMenu(!showCamera) }, showCamera ? 'Hide camera settings' : 'Camera settings')
        : null,
      cameraSection,
      h('button', { class: 'mo-button mo-danger', onclick: () => this.RenderConfirmQuit() }, 'Quit match'),
      h('div', { class: 'mo-hint' }, 'Esc / Start to resume'),
    );
    this.SetPanel('pause', panel);
  }

  protected RenderConfirmQuit(): void {
    const panel = h(
      'div',
      { class: 'mo-panel mo-pause', role: 'alertdialog', 'aria-label': 'Quit match' },
      h('div', { class: 'mo-title' }, 'Quit match?'),
      h('p', { class: 'mo-text' }, 'The match will be abandoned.'),
      h('button', { class: 'mo-button', 'data-autofocus': true, onclick: () => this.RenderPauseMenu(false) }, 'Keep playing'),
      h(
        'button',
        {
          class: 'mo-button mo-danger',
          onclick: () => {
            this.SetPanel('none', null);
            this.callbacks.onQuit();
          },
        },
        'Quit',
      ),
    );
    this.SetPanel('confirm-quit', panel);
  }

  // ----- toasts

  Toast(message: string, options: { kind?: 'info' | 'goal' | 'warn' | 'card'; duration_ms?: number } = {}): void {
    if (!this.toasts) return;
    const toast = h('div', { class: `mo-toast mo-toast-${options.kind ?? 'info'}` }, message);
    this.toasts.appendChild(toast);
    while (this.toasts.childElementCount > 4) this.toasts.firstElementChild?.remove();
    const duration = options.duration_ms ?? 3000;
    setTimeout(() => {
      toast.classList.add('mo-toast-out');
      setTimeout(() => toast.remove(), 400);
    }, duration);
  }

  // ----- full time

  /** shows the summary; resolves when the user presses Continue */
  ShowFullTime(summary: FullTimeSummary): Promise<void> {
    const scorerList = (teamID: 0 | 1) =>
      h(
        'ul',
        { class: 'mo-scorers' },
        summary.scorers
          .filter((s) => s.teamID === teamID)
          .map((s) => h('li', {}, `${s.name} ${s.minute}'`, s.ownGoal ? h('span', { class: 'mo-og' }, ' (og)') : null)),
      );
    let playerLine: HTMLElement | null = null;
    if (summary.player) {
      const s = summary.player.stats;
      const facts: string[] = [];
      if (s.goals) facts.push(`${s.goals} goal${s.goals > 1 ? 's' : ''}`);
      if (s.assists) facts.push(`${s.assists} assist${s.assists > 1 ? 's' : ''}`);
      facts.push(`${s.passesCompleted}/${s.passes} passes`);
      if (s.shots) facts.push(`${s.shotsOnTarget}/${s.shots} shots on target`);
      if (s.tackles) facts.push(`${s.tackles} tackle${s.tackles > 1 ? 's' : ''}`);
      if (s.yellowCards) facts.push('booked');
      if (s.redCards) facts.push('sent off');
      playerLine = h(
        'div',
        { class: 'mo-player' },
        h('div', { class: `mo-rating ${ratingClass(s.rating)}` }, s.rating.toFixed(1)),
        h('div', { class: 'mo-player-info' }, h('div', { class: 'mo-player-name' }, summary.player.name), h('div', { class: 'mo-player-facts' }, facts.join(' · '))),
      );
    }
    return new Promise<void>((resolve) => {
      this.fullTimeResolve = resolve;
      const panel = h(
        'div',
        { class: 'mo-panel mo-fulltime', role: 'dialog', 'aria-label': summary.title ?? 'Full time' },
        h('div', { class: 'mo-kicker' }, summary.title ?? 'Full time'),
        h(
          'div',
          { class: 'mo-score' },
          h('div', { class: 'mo-team mo-home' }, summary.homeName),
          h('div', { class: 'mo-result' }, `${summary.homeGoals} – ${summary.awayGoals}`),
          h('div', { class: 'mo-team mo-away' }, summary.awayName),
        ),
        h('div', { class: 'mo-scorer-cols' }, scorerList(0), scorerList(1)),
        playerLine,
        h(
          'button',
          {
            class: 'mo-button mo-primary',
            'data-autofocus': true,
            onclick: () => {
              this.SetPanel('none', null);
              const r = this.fullTimeResolve;
              this.fullTimeResolve = null;
              r?.();
            },
          },
          'Continue',
        ),
      );
      this.SetPanel('fulltime', panel);
    });
  }

  // ----- input

  protected OnKey(e: KeyboardEvent): void {
    if ((e.code === 'ArrowUp' || e.code === 'ArrowDown') && this.panel !== 'none' && this.panel !== 'loading') {
      // arrows move between the panel's buttons (sliders keep their own arrow handling)
      if ((document.activeElement as HTMLElement | null)?.tagName !== 'INPUT') {
        e.preventDefault();
        this.MoveFocus(e.code === 'ArrowUp' ? -1 : 1);
      }
      return;
    }
    if (e.code !== 'Escape' || e.repeat) return;
    if (this.panel === 'pause') {
      e.preventDefault();
      this.ClosePauseMenu();
    } else if (this.panel === 'confirm-quit') {
      e.preventDefault();
      this.RenderPauseMenu(false);
    } else if (this.panel === 'none') {
      e.preventDefault();
      this.OpenPauseMenu();
    }
  }

  /** moves the focus among the panel's buttons/sliders */
  protected MoveFocus(step: number): void {
    if (!this.panelHost) return;
    const items = [...this.panelHost.querySelectorAll<HTMLElement>('button, input')];
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = items[(i + step + items.length) % items.length] ?? items[0];
    next.focus({ preventScroll: true });
  }

  /**
   * Call once per rendered frame: Start toggles the pause menu, and gamepads navigate the open
   * panel. Edges are detected per frame (a frame can contain zero or several game steps).
   */
  Frame(): void {
    for (const c of GetControllers()) {
      let prev = this.navState.get(c);
      if (!prev) {
        prev = navFunctions.map((f) => c.GetButton(f));
        this.navState.set(c, prev);
        continue;
      }
      const isKeyboard = c.GetDeviceType() === e_HIDeviceType.e_HIDeviceType_Keyboard;
      for (let n = 0; n < navFunctions.length; n++) {
        const f = navFunctions[n];
        const down = c.GetButton(f);
        const pressed = down && !prev[n];
        prev[n] = down;
        if (!pressed) continue;
        if (f === F.e_ButtonFunction_Start) {
          // the keydown handler already handles Escape
          if (c instanceof HIDKeyboard && c.GetFunctionMapping(F.e_ButtonFunction_Start) === 'Escape') continue;
          if (this.panel === 'none' || this.IsPauseMenuOpen()) this.TogglePauseMenu();
          continue;
        }
        // keyboards navigate the DOM natively (Tab / Enter)
        if (isKeyboard || this.panel === 'none' || this.panel === 'loading') continue;
        if (f === F.e_ButtonFunction_Up) this.MoveFocus(-1);
        else if (f === F.e_ButtonFunction_Down) this.MoveFocus(1);
        else if (f === F.e_ButtonFunction_ShortPass) (document.activeElement as HTMLElement | null)?.click();
        else if (f === F.e_ButtonFunction_HighPass) {
          if (this.panel === 'pause') this.ClosePauseMenu();
          else if (this.panel === 'confirm-quit') this.RenderPauseMenu(false);
        }
      }
    }
  }
}
