// Port of hid/ihidevice.hpp: the controller interface the match engine reads input from.

import type { Vector3 } from '../../blunted/base/math/vector3';

export enum e_HIDeviceType {
  e_HIDeviceType_Keyboard,
  e_HIDeviceType_Gamepad,
  /** not in the original: an AI/scripted or network input source */
  e_HIDeviceType_Virtual,
}

export enum e_ButtonFunction {
  e_ButtonFunction_Up,
  e_ButtonFunction_Right,
  e_ButtonFunction_Down,
  e_ButtonFunction_Left,
  e_ButtonFunction_LongPass,
  e_ButtonFunction_HighPass,
  e_ButtonFunction_ShortPass,
  e_ButtonFunction_Shot,
  e_ButtonFunction_KeeperRush,
  e_ButtonFunction_Sliding,
  e_ButtonFunction_Pressure,
  e_ButtonFunction_TeamPressure,
  e_ButtonFunction_Switch,
  e_ButtonFunction_Special,
  e_ButtonFunction_Sprint,
  e_ButtonFunction_Dribble,
  e_ButtonFunction_Select,
  e_ButtonFunction_Start,
  e_ButtonFunction_Size,
}

export enum e_ControllerButton {
  e_ControllerButton_Up,
  e_ControllerButton_Right,
  e_ControllerButton_Down,
  e_ControllerButton_Left,
  e_ControllerButton_Y,
  e_ControllerButton_B,
  e_ControllerButton_A,
  e_ControllerButton_X,
  e_ControllerButton_L1,
  e_ControllerButton_L2,
  e_ControllerButton_R1,
  e_ControllerButton_R2,
  e_ControllerButton_Select,
  e_ControllerButton_Start,
  e_ControllerButton_Size,
}

export interface IHIDevice {
  LoadConfig(): void;
  SaveConfig(): void;
  /** called once per 10ms game step, before the match processes */
  Process(): void;
  GetButton(buttonFunction: e_ButtonFunction): boolean;
  /** for analog support */
  GetButtonValue(buttonFunction: e_ButtonFunction): number;
  SetButton(buttonFunction: e_ButtonFunction, state: boolean): void;
  GetPreviousButtonState(buttonFunction: e_ButtonFunction): boolean;
  GetDirection(): Vector3;
  GetDeviceType(): e_HIDeviceType;
  GetIdentifier(): string;
}
