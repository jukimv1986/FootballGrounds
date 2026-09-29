// Controller -> side assignment (C++ menu/controllerselect): every detected controller can be
// moved to the home side (-1), "not playing" (0) or the away side (1). The keyboard moves the
// focused controller; each gamepad moves its own card with its d-pad / stick, like the original.

import { GetControllers } from '../../game/globals';
import { e_HIDeviceType, type IHIDevice } from '../../game/hid/ihidevice';
import type { SideSelection } from '../../game/menu/menutask';
import { dataUrl, h } from '../dom';
import { icon } from '../icons';
import { setNavHandler, withNav, type NavSource } from '../nav';
import { back, pushScreen, type Screen } from '../router';
import { getTeamInfo, teamCrest } from '../teams';
import { HINT_BACK, HINT_SELECT, button, screenFrame } from '../widgets';
import { QUICKMATCH_STEPS, type QuickMatchSetup } from './quickmatch';
import { createMatchOptionsScreen } from './matchoptions';

export interface ControllerEntry {
  /** index into GetControllers() (0 = keyboard when the runtime is not up yet) */
  controllerID: number;
  name: string;
  kind: 'keyboard' | 'gamepad' | 'touch' | 'other';
  /** navigator.getGamepads() index for gamepads, when known */
  gamepadIndex?: number;
}

/** GetControllers() as menu entries; always offers "Keyboard" as controller 0 */
export function listControllers(): ControllerEntry[] {
  const controllers: IHIDevice[] = GetControllers();
  if (controllers.length === 0) return [{ controllerID: 0, name: 'Keyboard', kind: 'keyboard' }];
  let pads = 0;
  return controllers.map((c, i) => {
    const type = c.GetDeviceType();
    const id = c.GetIdentifier();
    if (type === e_HIDeviceType.e_HIDeviceType_Keyboard) return { controllerID: i, name: 'Keyboard', kind: 'keyboard' };
    if (type === e_HIDeviceType.e_HIDeviceType_Gamepad) {
      pads++;
      const gamepadIndex = (c as unknown as { GetGamepadID?: () => number }).GetGamepadID?.();
      return { controllerID: i, name: prettyPadName(id, pads), kind: 'gamepad', gamepadIndex };
    }
    const touch = /touch/i.test(id);
    return { controllerID: i, name: touch ? 'Touch controls' : id || `Controller ${i + 1}`, kind: touch ? 'touch' : 'other' };
  });
}

function prettyPadName(identifier: string, n: number): string {
  // browser ids look like "Xbox 360 Controller (XInput STANDARD GAMEPAD) #0"
  const base = identifier.replace(/\s*#\d+\s*$/, '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/\b(Vendor|Product): \w+/gi, '').trim();
  return base && base.length <= 32 ? base : `Gamepad ${n}`;
}

/** default sides like the original: one controller -> home; several -> the first gamepad is home */
export function defaultSides(entries: ControllerEntry[]): SideSelection[] {
  return entries.map((e, i) => {
    let side = 0;
    if (i === 0 && entries.length < 2) side = -1;
    else if (i === 1) side = -1;
    return { controllerID: e.controllerID, side };
  });
}

export function createControllerSelectScreen(setup: QuickMatchSetup): Screen {
  let entries = listControllers();
  const sameControllers = (a: SideSelection[]) => a.length === entries.length && a.every((s, i) => s.controllerID === entries[i].controllerID);
  if (!sameControllers(setup.sides)) setup.sides = defaultSides(entries);

  const home = getTeamInfo(setup.homeTeamID);
  const away = getTeamInfo(setup.awayTeamID);
  const rows = h('div', { class: 'ctrl-rows' });
  const summary = h('p', { class: 'ctrl-summary' });

  const move = (index: number, delta: number) => {
    const s = setup.sides[index];
    const next = Math.max(-1, Math.min(1, s.side + delta));
    if (next === s.side) return;
    s.side = next;
    update();
  };
  const place = (index: number, side: number) => {
    setup.sides[index].side = side;
    update();
  };

  const rowEls: HTMLElement[] = [];
  const build = () => {
    rows.replaceChildren();
    rowEls.length = 0;
    entries.forEach((entry, i) => {
      const card = h(
        'div',
        { class: `ctrl-card ctrl-card--${entry.kind}` },
        h('button', { type: 'button', class: 'ctrl-arrow is-left', tabindex: '-1', 'aria-label': 'Move left', onclick: () => move(i, -1) }, icon('prev')),
        h(
          'span',
          { class: 'ctrl-card-body' },
          entry.kind === 'keyboard' || entry.kind === 'gamepad'
            ? h('img', { class: 'ctrl-img', src: dataUrl(`media/menu/controller/${entry.kind === 'keyboard' ? 'keyboard' : 'controller'}_small.png`), alt: '', draggable: 'false' })
            : h('span', { class: 'ctrl-img ctrl-img--icon' }, icon(entry.kind === 'touch' ? 'touch' : 'gamepad')),
          h('span', { class: 'ctrl-name' }, entry.name),
          h('span', { class: 'ctrl-player' }, `P${i + 1}`),
        ),
        h('button', { type: 'button', class: 'ctrl-arrow is-right', tabindex: '-1', 'aria-label': 'Move right', onclick: () => move(i, 1) }, icon('next')),
      );
      const slots = [-1, 0, 1].map((side) =>
        h('button', { type: 'button', class: 'ctrl-slot', tabindex: '-1', 'aria-label': side === -1 ? `Play for ${home.name}` : side === 1 ? `Play for ${away.name}` : 'Not playing', onclick: () => place(i, side) }),
      );
      const row = h(
        'div',
        {
          class: 'ctrl-row',
          tabindex: '0',
          role: 'group',
          'aria-label': `${entry.name}: left and right to choose a side`,
          'data-nav-default': i === 0 ? true : undefined,
          dataset: { index: String(i) },
        },
        h('div', { class: 'ctrl-slots' }, ...slots),
        h('div', { class: 'ctrl-track' }, card),
      );
      setNavHandler(row, (action, source: NavSource) => {
        if (action !== 'left' && action !== 'right') return false;
        const delta = action === 'left' ? -1 : 1;
        // a gamepad moves its own card (C++ ProcessJoystickEvent), the keyboard the focused one
        if (source.kind === 'gamepad' && source.gamepadIndex !== undefined) {
          const own = entries.findIndex((e) => e.gamepadIndex === source.gamepadIndex);
          if (own >= 0) {
            move(own, delta);
            return true;
          }
        }
        move(i, delta);
        return true;
      });
      rowEls.push(row);
      rows.appendChild(row);
    });
    update();
  };

  const update = () => {
    setup.sides.forEach((s, i) => {
      const row = rowEls[i];
      if (!row) return;
      row.dataset.side = String(s.side);
      row.classList.toggle('is-home', s.side === -1);
      row.classList.toggle('is-away', s.side === 1);
    });
    const h1 = setup.sides.filter((s) => s.side === -1).length;
    const a1 = setup.sides.filter((s) => s.side === 1).length;
    summary.textContent =
      h1 === 0 && a1 === 0
        ? 'Nobody is playing: sit back and watch the CPU play both teams.'
        : `${home.shortName}: ${h1 ? `${h1} player${h1 > 1 ? 's' : ''}` : 'CPU'}  ·  ${away.shortName}: ${a1 ? `${a1} player${a1 > 1 ? 's' : ''}` : 'CPU'}`;
  };

  build();

  // controllers plugged in / out while the screen is open (the runtime updates GetControllers())
  const refresh = () =>
    setTimeout(() => {
      const fresh = listControllers();
      if (fresh.length === entries.length && fresh.every((e, i) => e.name === entries[i].name)) return;
      const previous = new Map(setup.sides.map((s) => [s.controllerID, s.side]));
      entries = fresh;
      setup.sides = defaultSides(entries).map((s) => ({ ...s, side: previous.get(s.controllerID) ?? s.side }));
      build();
    }, 50);

  const header = h(
    'div',
    { class: 'ctrl-header' },
    h('div', { class: 'ctrl-team ctrl-team--home', style: `--c1: ${home.color1}` }, teamCrest(home, 'crest--sm'), h('span', { class: 'ctrl-team-name' }, home.name), h('span', { class: 'ctrl-team-side' }, 'Home')),
    h('div', { class: 'ctrl-team ctrl-team--none' }, h('span', { class: 'ctrl-team-name' }, 'Not playing')),
    h('div', { class: 'ctrl-team ctrl-team--away', style: `--c1: ${away.color1}` }, teamCrest(away, 'crest--sm'), h('span', { class: 'ctrl-team-name' }, away.name), h('span', { class: 'ctrl-team-side' }, 'Away')),
  );

  const next = () => pushScreen(createMatchOptionsScreen(setup));

  const el = screenFrame({
    id: 'controllers',
    kicker: 'Quick match',
    title: 'Controls',
    onBack: () => back(),
    steps: { labels: QUICKMATCH_STEPS, active: 1 },
    background: 'stadium',
    body: [
      h(
        'div',
        { class: 'panel ctrl-panel' },
        header,
        rows,
        summary,
        h('p', { class: 'ctrl-tip muted' }, 'Connect a gamepad and press a button to add it. Move controllers with ← → (each gamepad moves its own card).'),
      ),
    ],
    hints: [{ keys: ['↑', '↓'], pad: ['✥'], label: 'Controller' }, { keys: ['←', '→'], pad: ['◀', '▶'], label: 'Choose side' }, HINT_SELECT, HINT_BACK],
    actions: [button('Next', next, { kind: 'primary', icon: 'next', className: 'btn--next' })],
  });

  return withNav(
    {
      el,
      onShow() {
        window.addEventListener('gamepadconnected', refresh);
        window.addEventListener('gamepaddisconnected', refresh);
        refresh();
      },
      onHide() {
        window.removeEventListener('gamepadconnected', refresh);
        window.removeEventListener('gamepaddisconnected', refresh);
      },
    },
    {
      onBack: () => back(),
      onAction: (action) => {
        // Enter / A on a controller row continues, like the original (IsActivate -> team select)
        if (action === 'accept' && (document.activeElement as HTMLElement | null)?.classList.contains('ctrl-row')) {
          next();
          return true;
        }
        return false;
      },
    },
  );
}
