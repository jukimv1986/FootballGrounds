// Port of legacy/src/onthepitch/player/controller/humancontroller.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).

import { Vector3 } from '../../../../blunted/base/math/vector3';
import { clamp, pi } from '../../../../blunted/base/math/bluntmath';
import { assert } from '../../../../blunted/base/assert';
import {
  PlayerCommand,
  _default_HighPass_AutoDirection,
  _default_HighPass_AutoPower,
  _default_ShortPass_AutoDirection,
  _default_ShortPass_AutoPower,
  _default_Shot_AutoDirection,
  _default_ThroughPass_AutoDirection,
  _default_ThroughPass_AutoPower,
  analogStickDeadzone,
  dribbleVelocity,
  e_FunctionType,
  e_SetPiece,
  e_Velocity,
  idleVelocity,
  sprintVelocity,
  walkVelocity,
  type PlayerCommandQueue,
} from '../../../gamedefines';
import { GetConfiguration } from '../../../globals';
import { e_ButtonFunction, e_HIDeviceType, type IHIDevice } from '../../../hid/ihidevice';
import type { Match } from '../../match';
import { AI_GetClosestPlayer, AI_GetPass, AI_GetShotDirection } from '../../AIsupport/AIfunctions';
import type { PlayerBase } from '../playerbase';
import { IController } from './icontroller';
import { PlayerController } from './playercontroller';

export class HumanController extends PlayerController {
  protected hid: IHIDevice;

  // set when a contextual button (example: pass/defend button) is pressed
  // once this is set and the button stays pressed, it stays the same
  // 0: undefined, 1: off-the-ball button active, 2: on-the-ball button active/action queued
  protected actionMode = 0;

  protected actionButton = e_ButtonFunction.e_ButtonFunction_ShortPass;
  protected actionBufferTime_ms = 0;
  protected gauge_ms = 0;

  // stuff to keep track of analog stick (or keys even) so that we can use a direction once it's been pointed in for a while, instead of directly
  protected previousDirection = new Vector3(0, -1, 0);
  protected steadyDirection = new Vector3(0, -1, 0);
  protected lastSteadyDirectionSnapshotTime_ms = 0;

  constructor(match: Match, hid: IHIDevice) {
    super(match);
    this.hid = hid;
    this.Reset();
  }

  override SetPlayer(player: PlayerBase): void {
    this.lastSwitchTime_ms = this.match.GetActualTime_ms();

    super.SetPlayer(player);
  }

  override RequestCommand(commandQueue: PlayerCommandQueue): void {
    const castPlayer = this.CastPlayer();
    const hid = this.hid;
    const match = this.match;
    const team = this.team;
    const player = this.player;

    castPlayer.SetDesiredTimeToBall_ms(0);

    this._Preprocess(); // calculate some variables

    // human input

    const { rawInputDirection, rawInputVelocityFloat } = this._GetHidInput();
    this._SetInput(rawInputDirection, rawInputVelocityFloat);

    // clear buffer?

    const functionType = castPlayer.GetCurrentFunctionType();
    if (
      this.actionMode === 2 &&
      (functionType === e_FunctionType.e_FunctionType_ShortPass ||
        functionType === e_FunctionType.e_FunctionType_LongPass ||
        functionType === e_FunctionType.e_FunctionType_HighPass ||
        functionType === e_FunctionType.e_FunctionType_Shot) &&
      !castPlayer.TouchPending()
    ) {
      this.actionMode = 0;
      this.gauge_ms = 0;
      this.actionBufferTime_ms = 0;
    }

    if (
      this.actionMode === 1 &&
      (functionType === e_FunctionType.e_FunctionType_Sliding || functionType === e_FunctionType.e_FunctionType_Interfere) &&
      !castPlayer.TouchPending()
    ) {
      this.actionMode = 0;
      this.gauge_ms = 0;
      this.actionBufferTime_ms = 0;
    }

    // cancels

    // shot cancel
    if (this.actionMode === 2 && this.actionButton === e_ButtonFunction.e_ButtonFunction_Shot && hid.GetButton(e_ButtonFunction.e_ButtonFunction_ShortPass) && !match.IsInSetPiece()) {
      this.actionMode = 0;
      this.gauge_ms = 0;
      this.actionBufferTime_ms = 0;
    }

    // high pass cancel
    if (this.actionMode === 2 && this.actionButton === e_ButtonFunction.e_ButtonFunction_HighPass && hid.GetButton(e_ButtonFunction.e_ButtonFunction_ShortPass) && !match.IsInSetPiece()) {
      this.actionMode = 0;
      this.gauge_ms = 0;
      this.actionBufferTime_ms = 0;
    }

    // cancel action buffer
    if (
      this.actionMode === 2 &&
      !match.IsInSetPiece() &&
      (this.actionBufferTime_ms > 2000 ||
        castPlayer.GetTimeNeededToGetToBall_ms() > castPlayer.GetTimeNeededToGetToBall_previous_ms() + 700 ||
        castPlayer.GetCurrentFunctionType() === e_FunctionType.e_FunctionType_Interfere)
    ) {
      this.actionMode = 0;
      this.gauge_ms = 0;
      this.actionBufferTime_ms = 0;
    }

    // cancel pressure and such
    if (this.actionMode === 1 && this.actionBufferTime_ms > 1000) {
      this.actionMode = 0;
      this.gauge_ms = 0;
      this.actionBufferTime_ms = 0;
    }

    // execute buffer?

    if (this.actionMode === 2) {
      if (
        !hid.GetButton(this.actionButton) ||
        (hid.GetButton(this.actionButton) && this.gauge_ms > 500) || // allow anim to kick in before queue is complete (before button is released), it will usually touch ball after the remaining time anyway, so we still have time to add more power, yet still respond as fast as possible
        (!castPlayer.HasPossession() && !match.IsInSetPiece() && this.actionBufferTime_ms > 0)
      ) {
        const baseTime_ms = 60; // substract a little because we can't really press a button shorter than this
        let gaugeFactor = (this.gauge_ms - baseTime_ms) * (1.0 / (1000 - baseTime_ms));
        gaugeFactor = clamp(gaugeFactor, 0.0, 1.0);

        // action button released!

        // force set piece methods
        if (match.IsInSetPiece() && team.GetController().GetPieceTaker() === player && team.GetController().GetSetPieceType() === e_SetPiece.e_SetPiece_KickOff) {
          const command = new PlayerCommand();

          command.desiredFunctionType = e_FunctionType.e_FunctionType_ShortPass;
          command.touchInfo.autoDirectionBias = 1.0;
          command.touchInfo.autoPowerBias = 1.0;
          command.touchInfo.inputDirection = player.GetDirectionVec(); // dud
          command.touchInfo.inputPower = 0.1; // dud

          const desiredTargetPosition = player.GetPosition().Add(player.GetDirectionVec().Mul(1.0));
          command.touchInfo.forcedTargetPlayer = AI_GetClosestPlayer(team, desiredTargetPosition, false, castPlayer);

          const touchInfo = command.touchInfo;
          const pass = AI_GetPass(castPlayer, command.desiredFunctionType, touchInfo.inputDirection, touchInfo.inputPower, touchInfo.autoDirectionBias, touchInfo.autoPowerBias, touchInfo.forcedTargetPlayer);
          touchInfo.desiredDirection = pass.resultingDirection;
          touchInfo.desiredPower = pass.resultingPower;
          touchInfo.targetPlayer = pass.targetPlayer;

          commandQueue.push(command);
        } else if (this.actionButton === e_ButtonFunction.e_ButtonFunction_ShortPass) {
          const command = new PlayerCommand();
          command.desiredFunctionType = e_FunctionType.e_FunctionType_ShortPass;
          command.useDesiredMovement = false;
          command.useDesiredLookAt = false;

          const inputPower = clamp(Math.pow(gaugeFactor, 0.7), 0.01, 1.0);
          command.touchInfo.inputDirection = this.inputDirection;
          command.touchInfo.inputPower = inputPower;
          command.touchInfo.autoDirectionBias = GetConfiguration().GetReal('gameplay_shortpass_autodirection', _default_ShortPass_AutoDirection);
          command.touchInfo.autoPowerBias = GetConfiguration().GetReal('gameplay_shortpass_autopower', _default_ShortPass_AutoPower);
          this._GetPassInto(command);

          commandQueue.push(command);
        } else if (this.actionButton === e_ButtonFunction.e_ButtonFunction_LongPass) {
          const command = new PlayerCommand();
          command.desiredFunctionType = e_FunctionType.e_FunctionType_LongPass;
          command.useDesiredMovement = false;
          command.useDesiredLookAt = false;

          const inputPower = clamp(Math.pow(gaugeFactor, 0.65), 0.01, 1.0);
          command.touchInfo.inputDirection = this.inputDirection;
          command.touchInfo.inputPower = inputPower;
          command.touchInfo.autoDirectionBias = GetConfiguration().GetReal('gameplay_throughpass_autodirection', _default_ThroughPass_AutoDirection);
          command.touchInfo.autoPowerBias = GetConfiguration().GetReal('gameplay_throughpass_autopower', _default_ThroughPass_AutoPower);
          this._GetPassInto(command);

          commandQueue.push(command);
        } else if (this.actionButton === e_ButtonFunction.e_ButtonFunction_HighPass) {
          const command = new PlayerCommand();
          command.desiredFunctionType = e_FunctionType.e_FunctionType_HighPass;
          command.useDesiredMovement = false;
          command.useDesiredLookAt = false;

          const inputPower = clamp(Math.pow(gaugeFactor, 0.55), 0.01, 1.0);
          command.touchInfo.inputDirection = this.inputDirection;
          command.touchInfo.inputPower = inputPower;
          command.touchInfo.autoDirectionBias = GetConfiguration().GetReal('gameplay_highpass_autodirection', _default_HighPass_AutoDirection);
          command.touchInfo.autoPowerBias = GetConfiguration().GetReal('gameplay_highpass_autopower', _default_HighPass_AutoPower);
          this._GetPassInto(command);

          commandQueue.push(command);
        } else if (this.actionButton === e_ButtonFunction.e_ButtonFunction_Shot) {
          const command = new PlayerCommand();
          command.desiredFunctionType = e_FunctionType.e_FunctionType_Shot;
          command.useDesiredMovement = false;
          command.useDesiredLookAt = false;
          command.desiredVelocityFloat = this.inputVelocityFloat; // this is so we can use sprint/dribble buttons as shot modifiers
          command.touchInfo.inputDirection = this.inputDirection;
          command.touchInfo.autoDirectionBias = GetConfiguration().GetReal('gameplay_shot_autodirection', _default_Shot_AutoDirection);
          if (this.GetHIDevice().GetDeviceType() === e_HIDeviceType.e_HIDeviceType_Keyboard) command.touchInfo.autoDirectionBias = 1.0;
          command.touchInfo.desiredDirection = AI_GetShotDirection(castPlayer, command.touchInfo.inputDirection, command.touchInfo.autoDirectionBias);
          command.touchInfo.desiredPower = clamp(Math.pow(gaugeFactor, 0.6), 0.01, 1.0);

          commandQueue.push(command);
        }
      }
    } else if (this.actionMode === 1) {
      if (hid.GetButton(this.actionButton)) {
        if (this.actionButton === e_ButtonFunction.e_ButtonFunction_Sliding) {
          const command = new PlayerCommand();
          command.desiredFunctionType = e_FunctionType.e_FunctionType_Sliding;
          command.useDesiredMovement = true;
          command.desiredDirection = this.inputDirection;
          command.desiredVelocityFloat = this.inputVelocityFloat;
          command.useDesiredLookAt = true;
          command.desiredLookAt = castPlayer.GetPosition().Add(castPlayer.GetMovement().Mul(0.1)).Add(command.desiredDirection.Mul(10.0));
          commandQueue.push(command);
        }

        if (this.actionButton === e_ButtonFunction.e_ButtonFunction_TeamPressure) {
          team.GetController().ApplyTeamPressure();
        }

        if (this.actionButton === e_ButtonFunction.e_ButtonFunction_KeeperRush) {
          team.GetController().ApplyKeeperRush();
        }
      } else {
        // action button released!
        this.actionMode = 0;
      }
    }

    // set piece?
    if (
      (match.IsInSetPiece() &&
        team.GetController().GetPieceTaker() === player &&
        (this.actionMode !== 2 || (this.actionMode === 2 && hid.GetButton(this.actionButton)) || match.GetBallRetainer() === player)) ||
      (match.IsInSetPiece() && team.GetController().GetPieceTaker() !== player && match.GetBallRetainer() === null)
    ) {
      this._SetPieceCommand(commandQueue);
      return;
    }

    // delay direction input until we have chosen a steady direction.
    // this is because humans can only move an analog stick so fast, and we don't want requeues to happen mid-analogstick-movement.
    const inputDirectionSaveNonsteady = this.inputDirection;
    this.inputDirection = this.steadyDirection;

    if (match.IsInPlay() && !match.IsInSetPiece()) {
      let idleTurnToOpponentGoal = false;
      let knockOn = false;
      if (hid.GetButton(e_ButtonFunction.e_ButtonFunction_Dribble)) idleTurnToOpponentGoal = true;
      if (hid.GetButton(e_ButtonFunction.e_ButtonFunction_Dribble) && hid.GetButton(e_ButtonFunction.e_ButtonFunction_Sprint)) knockOn = true;

      // special adapted input for ballcontrol and trap, when we have shoot/pass buffers
      const inputDirectionSave2 = this.inputDirection;
      const inputVelocitySave2 = this.inputVelocityFloat;
      if (this.actionMode === 2) {
        let dot = castPlayer.GetDirectionVec().GetDotProduct(this.inputDirection) * 0.5 + 0.5; // todo: test
        if (castPlayer.GetEnumVelocity() !== e_Velocity.e_Velocity_Idle) {
          this.inputDirection = castPlayer.GetDirectionVec().Mul(1.0).Add(this.inputDirection.Mul(0.0)).GetNormalized(this.inputDirection); // want inputdirection to be biggest, so we won't stubbornly fail to do 180s
        }
        dot = Math.pow(dot, 1.5); // prefer braking, even on slight angles
        dot = dot * 0.8 + 0.2;
        dot *= 0.9; // else, <=walk-anims may never work (backheels and such)
        this.inputVelocityFloat = castPlayer.GetFloatVelocity() * dot;
      }

      // ball control?
      const keepCurrentBodyDirection = false;
      // sidestep dribble disabled for now, too quirky: if (hid->GetButton(e_ButtonFunction_Dribble)) keepCurrentBodyDirection = true;
      this._BallControlCommand(commandQueue, idleTurnToOpponentGoal, knockOn, true, keepCurrentBodyDirection);

      // trap?
      this._TrapCommand(commandQueue, idleTurnToOpponentGoal, knockOn);

      // reload original input
      if (this.actionMode === 2) {
        this.inputDirection = inputDirectionSave2;
        this.inputVelocityFloat = inputVelocitySave2;
      }

      // interfere?
      let byAnyMeans = false;
      if (hid.GetButton(e_ButtonFunction.e_ButtonFunction_Pressure)) byAnyMeans = true;
      this._InterfereCommand(commandQueue, byAnyMeans);
    }

    // movement
    let forceMagnet = false;
    let extraHaste = false;
    if (this.actionMode !== 2 && hid.GetButton(e_ButtonFunction.e_ButtonFunction_Pressure)) {
      forceMagnet = true;
      extraHaste = true;
    }
    if (this.actionMode === 2) {
      forceMagnet = true;
      extraHaste = true;
    }
    this._MovementCommand(commandQueue, forceMagnet, extraHaste);

    if (commandQueue.length > 0) {
      const command = commandQueue[commandQueue.length - 1];
      assert(command.desiredFunctionType === e_FunctionType.e_FunctionType_Movement); // make sure this is the movement command (is probably guaranteed, check out _MovementCommand)

      // super cancel
      if (hid.GetButton(e_ButtonFunction.e_ButtonFunction_Dribble) && hid.GetButton(e_ButtonFunction.e_ButtonFunction_Sprint)) {
        if (!this.hasBestPossession) {
          command.desiredDirection = this.inputDirection;
          command.desiredVelocityFloat = this.inputVelocityFloat;
        }
      }
    }

    // reload original input
    this.inputDirection = inputDirectionSaveNonsteady;
  }

  override Process(): void {
    const hid = this.hid;
    const match = this.match;
    const team = this.team;
    const player = this.player;

    // just doesn't work so well (fixes the 'humans can't change stick pos instantly' problem, but introduces too much lag). maybe revisit/update later
    const enableSteadyDirectionSystem: boolean = false;

    super.Process();

    const currentDirection = this._GetHidInput().rawInputDirection;
    const angle = Math.abs(currentDirection.GetAngle2D(this.previousDirection));
    this.previousDirection = currentDirection;

    // only set steadydirection if angle is small (= human probably reaching his intended direction)
    // or very large (= maybe the stick has been in deadzone space; humans can't move this fast)
    if (enableSteadyDirectionSystem) {
      if (angle < 0.01 * pi || angle > 0.65 * pi || match.GetActualTime_ms() - this.lastSteadyDirectionSnapshotTime_ms > 100) {
        this.steadyDirection = currentDirection;
        this.lastSteadyDirectionSnapshotTime_ms = match.GetActualTime_ms();
      }
    } else {
      this.steadyDirection = currentDirection;
      this.lastSteadyDirectionSnapshotTime_ms = match.GetActualTime_ms();
    }

    this._CalculateSituation();

    // action?

    if (this.actionMode === 0 && (!match.IsInSetPiece() || team.GetController().GetPieceTaker() === player)) {
      // todo: clean this up

      // what is the context: do we want defend buttons or pass/shot buttons?
      let possessionContext = this.possessionAmount - 1.0;
      if (match.GetDesignatedPossessionPlayer() === player) {
        possessionContext = 1.0; // new (keeper was allowed doing slidings before free kick sometimes lol, sign something was wrong)
      } else {
        // in situations where we aren't the designated player, we sometimes still want to do ball stuff, because we could try to extend our leg to pass, for example
        if (hid.GetButton(e_ButtonFunction.e_ButtonFunction_ShortPass)) possessionContext += 0.15; // todo: bug: the logic of these weighings are based on the default 'pes' button settings.. need to take into account the defensive function of the buttons as well
        if (hid.GetButton(e_ButtonFunction.e_ButtonFunction_LongPass)) possessionContext += 0.15;
        if (hid.GetButton(e_ButtonFunction.e_ButtonFunction_Shot)) possessionContext += 0.15;

        if (hid.GetButton(e_ButtonFunction.e_ButtonFunction_Pressure)) possessionContext -= 0.15;
        if (hid.GetButton(e_ButtonFunction.e_ButtonFunction_Sliding)) possessionContext -= 0.15;
        if (hid.GetButton(e_ButtonFunction.e_ButtonFunction_TeamPressure)) possessionContext -= 0.15;

        if (match.GetBall().Predict(0).coords[2] > 1.5) possessionContext += 0.2;
      }

      if (possessionContext < 0.0) {
        let allowPressure = true;
        let allowSliding = true;
        let allowTeamPressure = true;
        let allowKeeperRush = true;

        if (match.IsInSetPiece()) {
          allowPressure = false;
          allowSliding = false;
          allowTeamPressure = false;
          allowKeeperRush = false;
        }

        if (hid.GetButton(e_ButtonFunction.e_ButtonFunction_Pressure) && !hid.GetPreviousButtonState(e_ButtonFunction.e_ButtonFunction_Pressure) && allowPressure) {
          this.actionMode = 1;
          this.actionButton = e_ButtonFunction.e_ButtonFunction_Pressure;
        }

        if (hid.GetButton(e_ButtonFunction.e_ButtonFunction_Sliding) && !hid.GetPreviousButtonState(e_ButtonFunction.e_ButtonFunction_Sliding) && allowSliding) {
          // we don't want high passes to turn into slidings
          this.actionMode = 1;
          this.actionButton = e_ButtonFunction.e_ButtonFunction_Sliding;
        }

        if (hid.GetButton(e_ButtonFunction.e_ButtonFunction_TeamPressure) && !hid.GetPreviousButtonState(e_ButtonFunction.e_ButtonFunction_TeamPressure) && allowTeamPressure) {
          this.actionMode = 1;
          this.actionButton = e_ButtonFunction.e_ButtonFunction_TeamPressure;
        }

        if (hid.GetButton(e_ButtonFunction.e_ButtonFunction_KeeperRush) && !hid.GetPreviousButtonState(e_ButtonFunction.e_ButtonFunction_KeeperRush) && allowKeeperRush) {
          this.actionMode = 1;
          this.actionButton = e_ButtonFunction.e_ButtonFunction_KeeperRush;
        }
      } else {
        const allowShortPass = true;
        const allowLongPass = true;
        let allowHighPass = true;
        let allowShot = true;

        if (team.GetController().GetPieceTaker() === player && team.GetController().GetSetPieceType() === e_SetPiece.e_SetPiece_ThrowIn) {
          allowHighPass = false;
          allowShot = false;
        }

        if (hid.GetButton(e_ButtonFunction.e_ButtonFunction_ShortPass) && !hid.GetPreviousButtonState(e_ButtonFunction.e_ButtonFunction_ShortPass) && allowShortPass) {
          this.actionMode = 2;
          this.actionButton = e_ButtonFunction.e_ButtonFunction_ShortPass;
        }

        if (hid.GetButton(e_ButtonFunction.e_ButtonFunction_LongPass) && !hid.GetPreviousButtonState(e_ButtonFunction.e_ButtonFunction_LongPass) && allowLongPass) {
          this.actionMode = 2;
          this.actionButton = e_ButtonFunction.e_ButtonFunction_LongPass;
        }

        if (hid.GetButton(e_ButtonFunction.e_ButtonFunction_HighPass) && !hid.GetPreviousButtonState(e_ButtonFunction.e_ButtonFunction_HighPass) && allowHighPass) {
          this.actionMode = 2;
          this.actionButton = e_ButtonFunction.e_ButtonFunction_HighPass;
        }

        if (hid.GetButton(e_ButtonFunction.e_ButtonFunction_Shot) && !hid.GetPreviousButtonState(e_ButtonFunction.e_ButtonFunction_Shot) && allowShot) {
          this.actionMode = 2;
          this.actionButton = e_ButtonFunction.e_ButtonFunction_Shot;
        }
      }
    }

    if (this.actionMode === 2) {
      if (hid.GetButton(this.actionButton)) {
        this.gauge_ms += 10;
        this.gauge_ms = clamp(this.gauge_ms, 10, 1000);
        this.actionBufferTime_ms = 0;
      } else {
        // button released, stay in this actionMode until actionBufferTime_ms becomes too big
        this.actionBufferTime_ms += 10;
      }
    }

    if (hid.GetButton(e_ButtonFunction.e_ButtonFunction_Switch) && this.hasPossession) team.GetController().ApplyAttackingRun();
  }

  override GetDirection(): Vector3 {
    const direction = this.CastPlayer().GetDirectionVec();
    return this.hid.GetDirection().GetNormalized(direction);
  }

  override GetFloatVelocity(): number {
    return this._GetHidInput().rawInputVelocityFloat;
  }

  override GetReactionTime_ms(): number {
    return IController.prototype.GetReactionTime_ms.call(this); // already have human reaction time to contend with
  }

  GetHIDevice(): IHIDevice {
    return this.hid;
  }

  GetActionMode(): number {
    return this.actionMode;
  }

  override Reset(): void {
    this.actionMode = 0;
    this.gauge_ms = 0;
    this.actionButton = e_ButtonFunction.e_ButtonFunction_ShortPass;
    this.actionBufferTime_ms = 0;

    this.lastSwitchTime_ms = -10000;
    this.lastSwitchTimeDuration_ms = 300;

    this.lastSteadyDirectionSnapshotTime_ms = 0;
    this.steadyDirection = new Vector3(0, -1, 0);
    this.previousDirection = new Vector3(0, -1, 0);

    this.fadingTeamPossessionAmount = 1.0;
  }

  /** C++ _GetHidInput(Vector3 &rawInputDirection, float &rawInputVelocityFloat) */
  protected _GetHidInput(): { rawInputDirection: Vector3; rawInputVelocityFloat: number } {
    const hid = this.hid;
    let rawInputDirection = hid.GetDirection();
    let rawInputVelocityFloat: number;

    if (rawInputDirection.GetLength() < analogStickDeadzone) {
      rawInputDirection = this.CastPlayer().GetDirectionVec();
      rawInputVelocityFloat = idleVelocity;
    } else {
      if (hid.GetButton(e_ButtonFunction.e_ButtonFunction_Sprint)) rawInputVelocityFloat = sprintVelocity;
      else if (hid.GetButton(e_ButtonFunction.e_ButtonFunction_Dribble)) rawInputVelocityFloat = dribbleVelocity;
      else if (hid.GetButton(e_ButtonFunction.e_ButtonFunction_Switch) && this.match.GetDesignatedPossessionPlayer() === this.CastPlayer()) rawInputVelocityFloat = idleVelocity;
      else rawInputVelocityFloat = walkVelocity;
      assert(rawInputDirection.GetLength() > 0.001);
      rawInputDirection = rawInputDirection.GetNormalized(); // hid should do this, but still
    }

    if (this.GetLastSwitchBias() > 0.0) {
      const switchInfluence = 0.5;
      const switchBias = Math.pow(this.GetLastSwitchBias(), 0.7);
      const currentMovement = this.player.GetDirectionVec().Mul(this.player.GetFloatVelocity());
      const manualMovement = rawInputDirection.Mul(rawInputVelocityFloat);
      const resultMovement = currentMovement.Mul(switchBias * switchInfluence).Add(manualMovement.Mul(1.0 - switchBias * switchInfluence));
      rawInputDirection = resultMovement.GetNormalized(rawInputDirection);
      rawInputVelocityFloat = resultMovement.GetLength();
    }

    return { rawInputDirection, rawInputVelocityFloat };
  }

  /** helper (not in C++): the AI_GetPass(...) call shared by the pass buttons, writing into command.touchInfo */
  private _GetPassInto(command: PlayerCommand): void {
    const touchInfo = command.touchInfo;
    const pass = AI_GetPass(this.CastPlayer(), command.desiredFunctionType, touchInfo.inputDirection, touchInfo.inputPower, touchInfo.autoDirectionBias, touchInfo.autoPowerBias);
    touchInfo.desiredDirection = pass.resultingDirection;
    touchInfo.desiredPower = pass.resultingPower;
    touchInfo.targetPlayer = pass.targetPlayer;
  }
}
