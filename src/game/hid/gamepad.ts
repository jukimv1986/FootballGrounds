// Port of hid/gamepad.{hpp,cpp}.
// Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).
//
// PORT: SDL joysticks became the browser Gamepad API (navigator.getGamepads(), polled in
// Process()). The defaults assume the W3C "standard" mapping, which has the same button numbers
// as the Xbox pad the original defaults were written for:
//   buttons 0 A, 1 B, 2 X, 3 Y, 4 LB, 5 RB, 6 LT, 7 RT, 8 back/select, 9 start, 12-15 d-pad
//   axes 0 left stick x (+ right), 1 left stick y (+ down)
// The d-pad is merged into the four direction buttons, so both the left stick and the d-pad move.

import { Vector3 } from '../../blunted/base/math/vector3';
import { int_to_str } from '../../blunted/base/utils';
import { analogStickDeadzone } from '../gamedefines';
import { GetConfiguration } from '../globals';
import { e_ButtonFunction, e_ControllerButton, e_HIDeviceType, type IHIDevice } from './ihidevice';

/** the part of the browser Gamepad object this device reads (lets tests inject fakes) */
export interface GamepadLike {
  readonly id: string;
  readonly index: number;
  readonly connected: boolean;
  readonly mapping?: string;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
}

export type GamepadSource = (gamepadIndex: number) => GamepadLike | null;

/** reads navigator.getGamepads() (null outside the browser) */
export const browserGamepadSource: GamepadSource = (gamepadIndex) => {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
  const pads = navigator.getGamepads();
  return (pads && pads[gamepadIndex]) || null;
};

/**
 * Default controller mapping, indexed by e_ControllerButton: a button index (>= 0) or an axis
 * half encoded like the original: -(axis * 2 + (positive ? 1 : 0)) - 1.
 * (C++: "xbox controller defaults"; L2/R2 are analog buttons 6/7 in the standard mapping.)
 */
export const defaultControllerMapping: readonly number[] = [
  -3, // e_ControllerButton_Up: axis 1 negative
  -2, // e_ControllerButton_Right: axis 0 positive
  -4, // e_ControllerButton_Down: axis 1 positive
  -1, // e_ControllerButton_Left: axis 0 negative
  3, // e_ControllerButton_Y
  1, // e_ControllerButton_B
  0, // e_ControllerButton_A
  2, // e_ControllerButton_X
  4, // e_ControllerButton_L1
  6, // e_ControllerButton_L2
  5, // e_ControllerButton_R1
  7, // e_ControllerButton_R2
  8, // e_ControllerButton_Select
  9, // e_ControllerButton_Start
];

/**
 * Default function mapping, indexed by e_ButtonFunction (as in the original gamepad.cpp):
 *   A: short pass / pressure       B: high pass / sliding
 *   X: shot / team pressure        Y: through (long) pass / keeper rush
 *   L1: switch   L2: special   R1: sprint   R2: dribble   start: pause menu
 */
export const defaultFunctionMapping: readonly e_ControllerButton[] = [
  e_ControllerButton.e_ControllerButton_Up, // e_ButtonFunction_Up
  e_ControllerButton.e_ControllerButton_Right, // e_ButtonFunction_Right
  e_ControllerButton.e_ControllerButton_Down, // e_ButtonFunction_Down
  e_ControllerButton.e_ControllerButton_Left, // e_ButtonFunction_Left
  e_ControllerButton.e_ControllerButton_Y, // e_ButtonFunction_LongPass
  e_ControllerButton.e_ControllerButton_B, // e_ButtonFunction_HighPass
  e_ControllerButton.e_ControllerButton_A, // e_ButtonFunction_ShortPass
  e_ControllerButton.e_ControllerButton_X, // e_ButtonFunction_Shot
  e_ControllerButton.e_ControllerButton_Y, // e_ButtonFunction_KeeperRush
  e_ControllerButton.e_ControllerButton_B, // e_ButtonFunction_Sliding
  e_ControllerButton.e_ControllerButton_A, // e_ButtonFunction_Pressure
  e_ControllerButton.e_ControllerButton_X, // e_ButtonFunction_TeamPressure
  e_ControllerButton.e_ControllerButton_L1, // e_ButtonFunction_Switch
  e_ControllerButton.e_ControllerButton_L2, // e_ButtonFunction_Special
  e_ControllerButton.e_ControllerButton_R1, // e_ButtonFunction_Sprint
  e_ControllerButton.e_ControllerButton_R2, // e_ButtonFunction_Dribble
  e_ControllerButton.e_ControllerButton_Select, // e_ButtonFunction_Select
  e_ControllerButton.e_ControllerButton_Start, // e_ButtonFunction_Start
];

export const controllerButtonNames: readonly string[] = ['Up', 'Right', 'Down', 'Left', 'Y', 'B', 'A', 'X', 'LB', 'LT', 'RB', 'RT', 'Select', 'Start'];

/** standard-mapping d-pad buttons per direction controller button (up, right, down, left) */
const dpadButtons: readonly number[] = [12, 15, 13, 14];

/** PORT: browsers report uncalibrated axes; values below this count as rest (sticks drift) */
const axisRestThreshold = 0.1;

const controllerButtonCount = e_ControllerButton.e_ControllerButton_Size;
const buttonFunctionCount = e_ButtonFunction.e_ButtonFunction_Size;

export class HIDGamepad implements IHIDevice {
  protected deviceType = e_HIDeviceType.e_HIDeviceType_Gamepad;
  protected identifier: string;
  protected gamepadID: number;
  protected source: GamepadSource;

  protected controllerButtonState: number[] = new Array<number>(controllerButtonCount).fill(0);
  protected previousControllerButtonState: number[] = new Array<number>(controllerButtonCount).fill(0);

  protected functionMapping: e_ControllerButton[] = [...defaultFunctionMapping];
  protected controllerMapping: number[] = [...defaultControllerMapping];

  constructor(gamepadID: number, source: GamepadSource = browserGamepadSource, name?: string) {
    this.gamepadID = gamepadID;
    this.source = source;
    const padName = name ?? source(gamepadID)?.id ?? 'Gamepad';
    this.identifier = padName.replace(/"/g, "'") + ' #' + int_to_str(gamepadID);
    this.LoadConfig();
  }

  protected ConfigPrefix(): string {
    return 'input_gamepad_' + this.GetIdentifier() + '_';
  }

  LoadConfig(): void {
    const config = GetConfiguration();
    for (let i = 0; i < controllerButtonCount; i++) {
      this.controllerButtonState[i] = 0;
      this.previousControllerButtonState[i] = 0;
      this.controllerMapping[i] = config.GetInt(this.ConfigPrefix() + int_to_str(i), defaultControllerMapping[i]);
    }
    for (let i = 0; i < buttonFunctionCount; i++) {
      this.functionMapping[i] = config.GetInt(this.ConfigPrefix() + 'mapping_' + int_to_str(i), defaultFunctionMapping[i]) as e_ControllerButton;
    }
  }

  /** writes the mapping into GetConfiguration(); persisting the configuration is up to the app */
  SaveConfig(): void {
    const config = GetConfiguration();
    for (let i = 0; i < controllerButtonCount; i++) config.SetInt(this.ConfigPrefix() + int_to_str(i), this.controllerMapping[i]);
    for (let i = 0; i < buttonFunctionCount; i++) config.SetInt(this.ConfigPrefix() + 'mapping_' + int_to_str(i), this.functionMapping[i]);
  }

  ResetToDefaults(): void {
    this.controllerMapping = [...defaultControllerMapping];
    this.functionMapping = [...defaultFunctionMapping];
  }

  /** true while the browser reports the pad as connected */
  IsConnected(): boolean {
    const pad = this.source(this.gamepadID);
    return pad !== null && pad.connected;
  }

  Process(): void {
    const pad = this.source(this.gamepadID);
    for (let i = 0; i < controllerButtonCount; i++) {
      this.previousControllerButtonState[i] = this.controllerButtonState[i];
      if (!pad || !pad.connected) {
        this.controllerButtonState[i] = 0;
        continue;
      }
      const buttonID = this.controllerMapping[i];
      let value = 0;
      if (buttonID >= 0) {
        // button (analog triggers report their pressure)
        const button = pad.buttons[buttonID];
        if (button && button.pressed) value = button.value > 0 ? Math.min(1, button.value) : 1.0;
      } else {
        // axis: decode
        let axisID = -buttonID - 1;
        const sign = (axisID % 2) * 2 - 1;
        axisID = Math.trunc(axisID / 2);
        let axisValue = pad.axes[axisID] ?? 0;
        if (Math.abs(axisValue) < axisRestThreshold) axisValue = 0;
        if ((sign < 0 && axisValue < 0) || (sign > 0 && axisValue > 0)) value = Math.min(1, Math.abs(axisValue));
      }
      // PORT: the d-pad also drives the direction buttons
      if (i < dpadButtons.length && pad.mapping === 'standard') {
        const dpad = pad.buttons[dpadButtons[i]];
        if (dpad && dpad.pressed) value = Math.max(value, 1.0);
      }
      this.controllerButtonState[i] = value;
    }
  }

  GetButton(buttonFunction: e_ButtonFunction): boolean {
    return this.controllerButtonState[this.functionMapping[buttonFunction]] > 0.0;
  }

  GetButtonValue(buttonFunction: e_ButtonFunction): number {
    return this.controllerButtonState[this.functionMapping[buttonFunction]];
  }

  SetButton(buttonFunction: e_ButtonFunction, state: boolean): void {
    this.controllerButtonState[this.functionMapping[buttonFunction]] = state ? 1 : 0;
  }

  GetPreviousButtonState(buttonFunction: e_ButtonFunction): boolean {
    return this.previousControllerButtonState[this.functionMapping[buttonFunction]] > 0.0;
  }

  GetDirection(): Vector3 {
    let x = 0;
    let y = 0;
    x -= this.GetButtonValue(e_ButtonFunction.e_ButtonFunction_Left);
    x += this.GetButtonValue(e_ButtonFunction.e_ButtonFunction_Right);
    y += this.GetButtonValue(e_ButtonFunction.e_ButtonFunction_Up);
    y -= this.GetButtonValue(e_ButtonFunction.e_ButtonFunction_Down);
    const inputDirection = new Vector3(x, y, 0);
    if (inputDirection.GetLength() < analogStickDeadzone) return new Vector3(0);
    return inputDirection.GetNormalized(0);
  }

  GetDeviceType(): e_HIDeviceType {
    return this.deviceType;
  }

  GetIdentifier(): string {
    return this.identifier;
  }

  GetFunctionMapping(buttonFunction: e_ButtonFunction): e_ControllerButton {
    return this.functionMapping[buttonFunction];
  }

  SetFunctionMapping(buttonFunction: e_ButtonFunction, controllerButton: e_ControllerButton): void {
    this.functionMapping[buttonFunction] = controllerButton;
  }

  GetControllerMapping(controllerButton: e_ControllerButton): number {
    return this.controllerMapping[controllerButton];
  }

  SetControllerMapping(controllerButton: e_ControllerButton, id: number): void {
    this.controllerMapping[controllerButton] = id;
  }

  GetGamepadID(): number {
    return this.gamepadID;
  }
}
