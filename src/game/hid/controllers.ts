// Builds and maintains the controller list the match reads (C++ main.cpp: keyboard first, then one
// HIDGamepad per joystick). Browser additions: gamepads come and go at runtime
// (gamepadconnected / gamepaddisconnected), and touch devices get an on-screen controller.
//
// Controller indices are what SideSelection.controllerID refers to, so the list must not reorder
// while a match is running: SetControllerListLocked(true) freezes the order (new pads are appended,
// disconnected pads stay in place and read as idle) until it is unlocked again.

import { SetControllers, GetControllers } from '../globals';
import { HIDGamepad, browserGamepadSource, type GamepadSource } from './gamepad';
import type { IHIDevice } from './ihidevice';
import { HIDKeyboard } from './keyboard';
import { HIDTouch, IsTouchDevice } from './touch';
import { UserEventManager } from './usereventmanager';

export interface ControllerSetupOptions {
  /** create the on-screen touch controller: 'auto' (default) = on touch devices only */
  touch?: boolean | 'auto';
  /** element the touch controls are added to (default document.body) */
  touchContainer?: HTMLElement | null;
  /** gamepad reader (tests) */
  gamepadSource?: GamepadSource;
  /** list the gamepads the source reports (tests); default navigator.getGamepads() */
  listGamepads?: () => number[];
}

type ControllersListener = (controllers: IHIDevice[]) => void;

const state = {
  initialized: false,
  keyboard: null as HIDKeyboard | null,
  touch: null as HIDTouch | null,
  gamepads: new Map<number, HIDGamepad>(),
  source: browserGamepadSource as GamepadSource,
  listGamepads: null as (() => number[]) | null,
  locked: false,
  listeners: new Set<ControllersListener>(),
  keyCapture: false,
  keyCaptureHandler: null as ((e: KeyboardEvent) => void) | null,
};

function connectedGamepadIndices(): number[] {
  if (state.listGamepads) return state.listGamepads();
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
  const out: number[] = [];
  for (const pad of navigator.getGamepads()) if (pad && pad.connected) out.push(pad.index);
  return out;
}

function GetOrCreateGamepad(index: number): HIDGamepad {
  let pad = state.gamepads.get(index);
  const name = state.source(index)?.id;
  if (pad && name !== undefined && !pad.GetIdentifier().startsWith(name.replace(/"/g, "'"))) {
    // a different pad took over this slot
    pad = undefined;
  }
  if (!pad) {
    pad = new HIDGamepad(index, state.source);
    state.gamepads.set(index, pad);
  }
  return pad;
}

function notify(): void {
  const list = GetControllers();
  for (const l of state.listeners) l(list);
}

/**
 * Creates the keyboard (+ touch) controllers, attaches the keyboard listener to the window and
 * starts following gamepad connections. Call once at app start. Returns the controller list.
 */
export function InitControllers(options: ControllerSetupOptions = {}): IHIDevice[] {
  if (options.gamepadSource) state.source = options.gamepadSource;
  if (options.listGamepads) state.listGamepads = options.listGamepads;
  if (!state.initialized) {
    state.initialized = true;
    if (typeof window !== 'undefined') {
      UserEventManager.GetInstance().Attach(window);
      window.addEventListener('gamepadconnected', () => OnGamepadsChanged());
      window.addEventListener('gamepaddisconnected', () => OnGamepadsChanged());
    }
  }
  if (!state.keyboard) state.keyboard = new HIDKeyboard();
  const wantTouch = options.touch === undefined || options.touch === 'auto' ? IsTouchDevice() : options.touch;
  if (wantTouch && !state.touch) state.touch = new HIDTouch(options.touchContainer ?? null);
  return RefreshControllers();
}

/** rebuilds the list: keyboard, connected gamepads (by browser index), touch. Returns it. */
export function RefreshControllers(): IHIDevice[] {
  if (state.locked) {
    // keep indices stable: only append pads we have not seen yet
    const list = GetControllers();
    for (const index of connectedGamepadIndices()) {
      const pad = GetOrCreateGamepad(index);
      if (!list.includes(pad)) list.push(pad);
    }
    notify();
    return list;
  }
  const list: IHIDevice[] = [];
  if (state.keyboard) list.push(state.keyboard);
  for (const index of connectedGamepadIndices().sort((a, b) => a - b)) list.push(GetOrCreateGamepad(index));
  if (state.touch) list.push(state.touch);
  SetControllers(list);
  notify();
  return list;
}

function OnGamepadsChanged(): void {
  RefreshControllers();
}

/** freezes controller indices (while a match runs); unlocking rebuilds the list */
export function SetControllerListLocked(locked: boolean): void {
  if (state.locked === locked) return;
  state.locked = locked;
  if (!locked) RefreshControllers();
}

/** called whenever the list changes (settings / controller select screens) */
export function OnControllersChanged(listener: ControllersListener): () => void {
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

export function GetKeyboard(): HIDKeyboard | null {
  return state.keyboard;
}

export function GetTouchController(): HIDTouch | null {
  return state.touch;
}

/** index of the keyboard in GetControllers() (-1 if none) */
export function GetKeyboardControllerIndex(): number {
  return state.keyboard ? GetControllers().indexOf(state.keyboard) : -1;
}

/** index of the touch controller in GetControllers() (-1 if none) */
export function GetTouchControllerIndex(): number {
  return state.touch ? GetControllers().indexOf(state.touch) : -1;
}

/** shows/hides the on-screen touch controls (the match session runner does this) */
export function SetTouchControlsVisible(visible: boolean): void {
  if (!state.touch) return;
  if (visible) state.touch.Show();
  else state.touch.Hide();
}

/**
 * While enabled, keydown events for keys the keyboard controller maps are preventDefault()ed, so
 * arrows / space / backspace / tab don't scroll or navigate. The runner enables it during play and
 * disables it while the pause menu is open.
 */
export function SetKeyboardCapture(enabled: boolean): void {
  state.keyCapture = enabled;
  if (typeof window === 'undefined') return;
  if (enabled && !state.keyCaptureHandler) {
    state.keyCaptureHandler = (e: KeyboardEvent) => {
      if (!state.keyCapture || !state.keyboard) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      if (e.code !== 'Escape' && state.keyboard.GetMappedKeys().has(e.code)) e.preventDefault();
    };
    window.addEventListener('keydown', state.keyCaptureHandler);
  }
}
