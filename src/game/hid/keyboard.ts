// Port of hid/keyboard.{hpp,cpp}.
// Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).
//
// PORT: key identifiers are KeyboardEvent.code strings instead of SDL_Keycode ints. The mapping is
// stored in GetConfiguration() as `input_keyboard_<e_ButtonFunction index>` = code string.

import { Vector3 } from '../../blunted/base/math/vector3';
import { int_to_str } from '../../blunted/base/utils';
import { GetConfiguration } from '../globals';
import { e_ButtonFunction, e_HIDeviceType, type IHIDevice } from './ihidevice';
import { UserEventManager, type SDL_Keycode } from './usereventmanager';

/**
 * Default keyboard layout, indexed by e_ButtonFunction (C++ defaultKeyIDs in gamedefines.hpp).
 * The action keys double up depending on whether your team has the ball, like the original
 * (and the classic PC football layout):
 *
 * | key          | with the ball            | without the ball         |
 * |--------------|--------------------------|--------------------------|
 * | arrow keys   | move                     | move                     |
 * | S            | short pass               | pressure                 |
 * | W            | through pass (long pass) | keeper rush              |
 * | A            | high pass / cross        | sliding tackle           |
 * | D            | shot                     | team pressure            |
 * | E            | sprint                   | sprint                   |
 * | C            | dribble (+E: knock on)   | —                        |
 * | Q            | switch player            | switch player            |
 * | Z            | special                  | special                  |
 * | Escape       | start (pause menu)       |                          |
 * | Backspace    | select                   |                          |
 *
 * PORT: the original used F1 for Select and Return for Start. F1 opens the browser help, and the
 * in-match pause menu opens with Escape, so Start is Escape and Select is Backspace here.
 */
export const defaultKeyIDs: readonly SDL_Keycode[] = [
  'ArrowUp', // e_ButtonFunction_Up
  'ArrowRight', // e_ButtonFunction_Right
  'ArrowDown', // e_ButtonFunction_Down
  'ArrowLeft', // e_ButtonFunction_Left
  'KeyW', // e_ButtonFunction_LongPass
  'KeyA', // e_ButtonFunction_HighPass
  'KeyS', // e_ButtonFunction_ShortPass
  'KeyD', // e_ButtonFunction_Shot
  'KeyW', // e_ButtonFunction_KeeperRush
  'KeyA', // e_ButtonFunction_Sliding
  'KeyS', // e_ButtonFunction_Pressure
  'KeyD', // e_ButtonFunction_TeamPressure
  'KeyQ', // e_ButtonFunction_Switch
  'KeyZ', // e_ButtonFunction_Special
  'KeyE', // e_ButtonFunction_Sprint
  'KeyC', // e_ButtonFunction_Dribble
  'Backspace', // e_ButtonFunction_Select
  'Escape', // e_ButtonFunction_Start
];

/** human readable names of the button functions, for the settings screen */
export const buttonFunctionNames: readonly string[] = [
  'Up',
  'Right',
  'Down',
  'Left',
  'Through pass',
  'High pass / cross',
  'Short pass',
  'Shot',
  'Keeper rush',
  'Sliding tackle',
  'Pressure',
  'Team pressure',
  'Switch player',
  'Special',
  'Sprint',
  'Dribble',
  'Select',
  'Start / pause',
];

/** config key of a keyboard mapping entry */
export function KeyboardConfigKey(buttonFunction: e_ButtonFunction): string {
  return 'input_keyboard_' + int_to_str(buttonFunction);
}

/** readable label for a KeyboardEvent.code ("KeyW" -> "W", "ArrowUp" -> "↑") */
export function KeyCodeLabel(code: SDL_Keycode): string {
  if (code.startsWith('Key') && code.length === 4) return code.substring(3);
  if (code.startsWith('Digit') && code.length === 6) return code.substring(5);
  const arrows: Record<string, string> = { ArrowUp: '↑', ArrowRight: '→', ArrowDown: '↓', ArrowLeft: '←' };
  if (arrows[code]) return arrows[code];
  if (code.startsWith('Numpad')) return 'Num ' + code.substring(6);
  if (code === 'Escape') return 'Esc';
  if (code === 'Space') return 'Space';
  return code.replace(/(Left|Right)$/, ' $1');
}

const buttonFunctionCount = e_ButtonFunction.e_ButtonFunction_Size;

export class HIDKeyboard implements IHIDevice {
  protected deviceType = e_HIDeviceType.e_HIDeviceType_Keyboard;
  protected identifier = 'keyboard';

  protected functionButtonState: boolean[] = new Array<boolean>(buttonFunctionCount).fill(false);
  protected previousFunctionButtonState: boolean[] = new Array<boolean>(buttonFunctionCount).fill(false);

  protected functionMapping: SDL_Keycode[] = [...defaultKeyIDs];

  constructor() {
    this.LoadConfig();
  }

  LoadConfig(): void {
    const config = GetConfiguration();
    for (let i = 0; i < buttonFunctionCount; i++) {
      this.functionButtonState[i] = false;
      this.previousFunctionButtonState[i] = false;
      const stored = config.Get(KeyboardConfigKey(i), '');
      // PORT: configs written by the C++ game hold SDL keycode ints; ignore those
      this.functionMapping[i] = stored !== '' && !/^-?\d+$/.test(stored) ? stored : defaultKeyIDs[i];
    }
  }

  /** writes the mapping into GetConfiguration(); persisting the configuration is up to the app */
  SaveConfig(): void {
    const config = GetConfiguration();
    for (let i = 0; i < buttonFunctionCount; i++) config.Set(KeyboardConfigKey(i), this.functionMapping[i]);
  }

  /** restores defaultKeyIDs (does not save) */
  ResetToDefaults(): void {
    this.functionMapping = [...defaultKeyIDs];
  }

  Process(): void {
    const events = UserEventManager.GetInstance();
    for (let i = 0; i < buttonFunctionCount; i++) {
      this.previousFunctionButtonState[i] = this.functionButtonState[i];
      this.functionButtonState[i] = events.GetKeyboardState(this.functionMapping[i]);
    }
    // PORT: SDL delivered key state per 10ms step; browser taps can be shorter than a frame
    events.ClearLatched();
  }

  GetButton(buttonFunction: e_ButtonFunction): boolean {
    return this.functionButtonState[buttonFunction];
  }

  GetButtonValue(buttonFunction: e_ButtonFunction): number {
    return this.functionButtonState[buttonFunction] ? 1.0 : 0.0;
  }

  SetButton(buttonFunction: e_ButtonFunction, state: boolean): void {
    this.functionButtonState[buttonFunction] = state;
  }

  GetPreviousButtonState(buttonFunction: e_ButtonFunction): boolean {
    return this.previousFunctionButtonState[buttonFunction];
  }

  GetDirection(): Vector3 {
    let x = 0;
    let y = 0;
    if (this.GetButton(e_ButtonFunction.e_ButtonFunction_Left)) x -= 1;
    if (this.GetButton(e_ButtonFunction.e_ButtonFunction_Right)) x += 1;
    if (this.GetButton(e_ButtonFunction.e_ButtonFunction_Up)) y += 1;
    if (this.GetButton(e_ButtonFunction.e_ButtonFunction_Down)) y -= 1;
    return new Vector3(x, y, 0).GetNormalized(0);
  }

  GetDeviceType(): e_HIDeviceType {
    return this.deviceType;
  }

  GetIdentifier(): string {
    return this.identifier;
  }

  SetFunctionMapping(index: e_ButtonFunction, key: SDL_Keycode): void {
    this.functionMapping[index] = key;
  }

  GetFunctionMapping(buttonFunction: e_ButtonFunction): SDL_Keycode {
    return this.functionMapping[buttonFunction];
  }

  /** every key code this keyboard listens to (for preventDefault while a match runs) */
  GetMappedKeys(): Set<SDL_Keycode> {
    return new Set(this.functionMapping);
  }
}
