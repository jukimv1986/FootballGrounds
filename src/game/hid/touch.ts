// On-screen touch controller (not in the original): a floating virtual joystick on the left half
// of the screen and action buttons on the right, for phones and tablets. Shown only while a match
// is running on a touch device (see src/game/hid/controllers.ts).
//
// Every action button drives the same pair of button functions the keyboard keys do (attacking
// function with the ball, defending function without it), so the gameplay code sees a normal HID.

import { Vector3 } from '../../blunted/base/math/vector3';
import { e_ButtonFunction, e_HIDeviceType, type IHIDevice } from './ihidevice';
import '../../ui/hud.css';

const F = e_ButtonFunction;

export interface TouchButtonDef {
  id: string;
  label: string;
  /** smaller second line: what the button does without the ball */
  sublabel?: string;
  functions: e_ButtonFunction[];
  /** larger primary buttons */
  big?: boolean;
}

/** layout of the action buttons (rendered right-to-left, bottom-to-top in .touch-buttons) */
export const touchButtonLayout: readonly TouchButtonDef[] = [
  { id: 'shot', label: 'Shoot', sublabel: 'team press', functions: [F.e_ButtonFunction_Shot, F.e_ButtonFunction_TeamPressure], big: true },
  { id: 'pass', label: 'Pass', sublabel: 'press', functions: [F.e_ButtonFunction_ShortPass, F.e_ButtonFunction_Pressure], big: true },
  { id: 'through', label: 'Through', sublabel: 'keeper', functions: [F.e_ButtonFunction_LongPass, F.e_ButtonFunction_KeeperRush] },
  { id: 'lob', label: 'Lob', sublabel: 'slide', functions: [F.e_ButtonFunction_HighPass, F.e_ButtonFunction_Sliding] },
  { id: 'sprint', label: 'Sprint', functions: [F.e_ButtonFunction_Sprint] },
  { id: 'switch', label: 'Switch', functions: [F.e_ButtonFunction_Switch] },
];

/** fraction of the joystick radius below which the stick counts as centered */
const touchStickDeadzone = 0.3;

const buttonFunctionCount = e_ButtonFunction.e_ButtonFunction_Size;

/** true on phones/tablets (coarse pointer with touch support) */
export function IsTouchDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const hasTouch = 'ontouchstart' in window || (navigator.maxTouchPoints ?? 0) > 0;
  const coarse = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)').matches : true;
  return hasTouch && coarse;
}

export class HIDTouch implements IHIDevice {
  // PORT: reports as a keyboard so the gameplay code gives it the same full pass/shot direction
  // assistance it gives digital keyboard input (humancontroller, AI_GetPass).
  protected deviceType = e_HIDeviceType.e_HIDeviceType_Keyboard;
  protected identifier = 'touch';

  protected functionButtonState: boolean[] = new Array<boolean>(buttonFunctionCount).fill(false);
  protected previousFunctionButtonState: boolean[] = new Array<boolean>(buttonFunctionCount).fill(false);
  /** live state from the pointer handlers */
  protected held = new Array<number>(buttonFunctionCount).fill(0);
  /** pressed since the last Process() (so taps shorter than a game step are not lost) */
  protected latched = new Array<boolean>(buttonFunctionCount).fill(false);

  protected stick = new Vector3(0);
  protected stickPointer: number | null = null;
  protected stickOrigin = { x: 0, y: 0 };
  protected stickRadius = 60;

  protected root: HTMLElement | null = null;
  protected stickBase: HTMLElement | null = null;
  protected stickKnob: HTMLElement | null = null;
  protected buttonPointers = new Map<number, TouchButtonDef>();

  constructor(protected container: HTMLElement | null = null) {}

  LoadConfig(): void {}

  SaveConfig(): void {}

  /** creates the DOM (lazily, on first Show) */
  protected Build(): void {
    if (this.root || typeof document === 'undefined') return;
    const root = document.createElement('div');
    root.className = 'touch-controls';
    root.hidden = true;

    const stickZone = document.createElement('div');
    stickZone.className = 'touch-stick-zone';
    const base = document.createElement('div');
    base.className = 'touch-stick-base';
    const knob = document.createElement('div');
    knob.className = 'touch-stick-knob';
    base.appendChild(knob);
    stickZone.appendChild(base);
    root.appendChild(stickZone);

    stickZone.addEventListener('pointerdown', (e) => this.OnStickDown(e, stickZone));
    stickZone.addEventListener('pointermove', (e) => this.OnStickMove(e));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) stickZone.addEventListener(type, (e) => this.OnStickUp(e));

    const buttons = document.createElement('div');
    buttons.className = 'touch-buttons';
    for (const def of touchButtonLayout) {
      const btn = document.createElement('div');
      btn.className = 'touch-button' + (def.big ? ' touch-button-big' : '');
      btn.dataset.id = def.id;
      const label = document.createElement('span');
      label.className = 'touch-button-label';
      label.textContent = def.label;
      btn.appendChild(label);
      if (def.sublabel) {
        const sub = document.createElement('span');
        sub.className = 'touch-button-sublabel';
        sub.textContent = def.sublabel;
        btn.appendChild(sub);
      }
      btn.addEventListener('pointerdown', (e) => this.OnButtonDown(e, btn, def));
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) btn.addEventListener(type, (e) => this.OnButtonUp(e, btn));
      buttons.appendChild(btn);
    }
    root.appendChild(buttons);
    root.addEventListener('contextmenu', (e) => e.preventDefault());

    (this.container ?? document.body).appendChild(root);
    this.root = root;
    this.stickBase = base;
    this.stickKnob = knob;
  }

  Show(): void {
    this.Build();
    if (this.root) this.root.hidden = false;
  }

  Hide(): void {
    this.ReleaseAll();
    if (this.root) this.root.hidden = true;
  }

  IsVisible(): boolean {
    return !!this.root && !this.root.hidden;
  }

  /** removes the DOM */
  Exit(): void {
    this.ReleaseAll();
    this.root?.remove();
    this.root = null;
  }

  protected ReleaseAll(): void {
    this.held.fill(0);
    this.stick = new Vector3(0);
    this.stickPointer = null;
    this.buttonPointers.clear();
    this.UpdateKnob(0, 0);
    this.root?.querySelectorAll('.touch-button.active').forEach((el) => el.classList.remove('active'));
  }

  // ----- joystick

  protected OnStickDown(e: PointerEvent, zone: HTMLElement): void {
    if (this.stickPointer !== null) return;
    e.preventDefault();
    this.stickPointer = e.pointerId;
    try {
      zone.setPointerCapture(e.pointerId);
    } catch {
      // not capturable (synthetic event)
    }
    const zoneRect = zone.getBoundingClientRect();
    const baseSize = this.stickBase?.offsetWidth || 120;
    this.stickRadius = baseSize * 0.5;
    // floating stick: the base centers on the touch point (kept inside the zone)
    const x = Math.min(Math.max(e.clientX, zoneRect.left + this.stickRadius), zoneRect.right - this.stickRadius);
    const y = Math.min(Math.max(e.clientY, zoneRect.top + this.stickRadius), zoneRect.bottom - this.stickRadius);
    this.stickOrigin = { x, y };
    if (this.stickBase) {
      this.stickBase.style.left = `${x - zoneRect.left}px`;
      this.stickBase.style.top = `${y - zoneRect.top}px`;
      this.stickBase.classList.add('active');
    }
    this.OnStickMove(e);
  }

  protected OnStickMove(e: PointerEvent): void {
    if (e.pointerId !== this.stickPointer) return;
    e.preventDefault();
    const dx = (e.clientX - this.stickOrigin.x) / this.stickRadius;
    const dy = (e.clientY - this.stickOrigin.y) / this.stickRadius;
    // screen y grows downwards, game "up" is +y
    this.SetStick(dx, -dy);
  }

  protected OnStickUp(e: PointerEvent): void {
    if (e.pointerId !== this.stickPointer) return;
    this.stickPointer = null;
    this.SetStick(0, 0);
    this.stickBase?.classList.remove('active');
  }

  /** sets the stick deflection (-1 .. 1 per axis, +y = up); also used by tests */
  SetStick(x: number, y: number): void {
    let v = new Vector3(x, y, 0);
    if (v.GetLength() > 1) v = v.GetNormalized(0);
    this.stick = v;
    this.UpdateKnob(v.coords[0], v.coords[1]);
  }

  protected UpdateKnob(x: number, y: number): void {
    if (this.stickKnob) this.stickKnob.style.transform = `translate(calc(-50% + ${x * this.stickRadius}px), calc(-50% + ${-y * this.stickRadius}px))`;
  }

  // ----- buttons

  protected OnButtonDown(e: PointerEvent, el: HTMLElement, def: TouchButtonDef): void {
    e.preventDefault();
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      // not capturable (synthetic event)
    }
    if (this.buttonPointers.has(e.pointerId)) return;
    this.buttonPointers.set(e.pointerId, def);
    this.PressFunctions(def.functions, true);
    el.classList.add('active');
  }

  protected OnButtonUp(e: PointerEvent, el: HTMLElement): void {
    const def = this.buttonPointers.get(e.pointerId);
    if (!def) return;
    this.buttonPointers.delete(e.pointerId);
    this.PressFunctions(def.functions, false);
    if (![...this.buttonPointers.values()].includes(def)) el.classList.remove('active');
  }

  /** presses/releases a set of button functions (reference counted); also used by tests */
  PressFunctions(functions: readonly e_ButtonFunction[], down: boolean): void {
    for (const f of functions) {
      if (down) {
        this.held[f]++;
        this.latched[f] = true;
      } else {
        this.held[f] = Math.max(0, this.held[f] - 1);
      }
    }
  }

  // ----- IHIDevice

  Process(): void {
    const x = this.stick.coords[0];
    const y = this.stick.coords[1];
    const active = this.stick.GetLength() >= touchStickDeadzone;
    for (let i = 0; i < buttonFunctionCount; i++) {
      this.previousFunctionButtonState[i] = this.functionButtonState[i];
      let state = this.held[i] > 0 || this.latched[i];
      if (i === F.e_ButtonFunction_Up) state = active && y > touchStickDeadzone * 0.5;
      else if (i === F.e_ButtonFunction_Down) state = active && y < -touchStickDeadzone * 0.5;
      else if (i === F.e_ButtonFunction_Right) state = active && x > touchStickDeadzone * 0.5;
      else if (i === F.e_ButtonFunction_Left) state = active && x < -touchStickDeadzone * 0.5;
      this.functionButtonState[i] = state;
      this.latched[i] = false;
    }
  }

  GetButton(buttonFunction: e_ButtonFunction): boolean {
    return this.functionButtonState[buttonFunction];
  }

  GetButtonValue(buttonFunction: e_ButtonFunction): number {
    switch (buttonFunction) {
      case F.e_ButtonFunction_Up:
        return Math.max(0, this.stick.coords[1]);
      case F.e_ButtonFunction_Down:
        return Math.max(0, -this.stick.coords[1]);
      case F.e_ButtonFunction_Right:
        return Math.max(0, this.stick.coords[0]);
      case F.e_ButtonFunction_Left:
        return Math.max(0, -this.stick.coords[0]);
      default:
        return this.functionButtonState[buttonFunction] ? 1.0 : 0.0;
    }
  }

  SetButton(buttonFunction: e_ButtonFunction, state: boolean): void {
    this.functionButtonState[buttonFunction] = state;
  }

  GetPreviousButtonState(buttonFunction: e_ButtonFunction): boolean {
    return this.previousFunctionButtonState[buttonFunction];
  }

  GetDirection(): Vector3 {
    if (this.stick.GetLength() < touchStickDeadzone) return new Vector3(0);
    return this.stick.GetNormalized(0);
  }

  GetDeviceType(): e_HIDeviceType {
    return this.deviceType;
  }

  GetIdentifier(): string {
    return this.identifier;
  }
}
