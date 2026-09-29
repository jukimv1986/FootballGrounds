// Port of legacy/src/onthepitch/player/humanoid/humanoid.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).
//
// The football-specific layer of the player animation system: ball touches (trap, ballcontrol, pass, shot, interfere,
// deflect, sliding), anim selection for football commands, the 'cheatable' ball interaction math and the body part
// orientation offsets.
//
// Signatures that differ from C++ because of out-parameters (docs/PORTING.md):
//   GetBestCheatableAnimID(sortedDataSet, useDesiredMovement, desiredDirection, desiredVelocityFloat, useDesiredBodyDirection,
//                          desiredBodyDirectionRel, positions_ret, hasteFactor, localInterruptAnim, preferPassAndShot = false)
//     -> { result, animTouchFrame_ret, radiusOffset_ret, touchPos_ret, fullActionSmuggle_ret, actionSmuggle_ret, rotationSmuggle_ret }
//     (positions_ret is still filled in place).

import { assert } from '../../../../blunted/base/assert';
import { Line } from '../../../../blunted/base/geometry/line';
import { Log, e_FatalError, e_Warning } from '../../../../blunted/base/log';
import { ModulateIntoRange, NormalizedClamp, clamp, curve, pi, random, signSide, type radian } from '../../../../blunted/base/math/bluntmath';
import { Quaternion, Vector3 } from '../../../../blunted/base/math/vector3';
import { GetVectorFromString, atof, atoi, int_to_str, real_to_str } from '../../../../blunted/base/utils';
import type { Node } from '../../../../blunted/scene/node';
import type { Resource } from '../../../../blunted/scene/resources/resource';
import type { Surface } from '../../../../blunted/scene/resources/surface';
import {
  StringToFunctionType,
  _default_AccelerationFactor,
  _default_AgilityFactor,
  ballDistanceOptimizeThreshold,
  defaultPlayerHeight,
  defaultTouchOffset_ms,
  dribbleWalkSwitch,
  e_FunctionType,
  e_PlayerCommandModifier,
  e_PlayerRole,
  e_StrictMovement,
  e_TouchType,
  e_Velocity,
  idleDribbleSwitch,
  idleVelocity,
  lineHalfW,
  pitchHalfH,
  pitchHalfW,
  sprintVelocity,
  walkVelocity,
  type DataSet,
  type PlayerCommand,
  type PlayerCommandQueue,
} from '../../../gamedefines';
import {
  GetConfiguration,
  IsReleaseVersion,
  SetBlueDebugPilon,
  SetGreenDebugPilon,
  SetRedDebugPilon,
  SetYellowDebugPilon,
} from '../../../globals';
import { e_Foot, type Animation, type BiasedOffset } from '../../../utils/animation';
import type { FootballAnimationExtension } from '../../../utils/animationextensions/footballanimationextension';
import { AI_GetPass, AI_GetShotDirection } from '../../AIsupport/AIfunctions';
import type { Ball } from '../../ball';
import type { Team } from '../../team';
import type { Player } from '../player';
import { CrudeSelectionQuery, FixAngle, FloatToEnumVelocity, type AnimCollection } from './animcollection';
import {
  CalculateMovementAtFrame,
  GetBallControlVector,
  GetDifficultyFactors,
  GetFrontOfFootOffsetRel,
  GetShotVector,
  GetTouchTypeForBodyPart,
  GetTrapVector,
} from './humanoid_utils';
import { HumanoidBase, e_InterruptAnim } from './humanoidbase';

const spatialDebugPilons = false;
const movementSmuggleDebugPilons = false;
const animSmoothing = true;
const cheatFactor = 0.5;
const useContinuousBallCheck = true;
const enableMovementSmuggle = true;
const cheatDiscardDistance = 0.02; // don't 'display' this distance of cheat (looks better for small distances, but will look funny when too large, players 'missing' the ball and all. also has big influence on gameplay, since this influences player collisions etc)
const cheatDistanceBonus = 0.02; // add extra allowed cheat distance (in meters). don't 'display' this distance of cheat (looks better for small distances, but will look funny when too large, players 'missing' the ball and all. also has big influence on gameplay, since this influences player collisions etc)
const cheatDiscardDistanceMultiplier = 0.4; // lower == more snappy
const maxSmuggleDiscardDistance = 0.2;
const enableActionSmuggleDiscard = true;
const forceFullActionSmuggleDiscard = false;
const discardForwardSmuggle = true;
const discardSidewaysSmuggle = false;
const bodyRotationSmoothingFactor = 1.0;
const bodyRotationSmoothingMaxAngle = animSmoothing ? 0.25 * pi : 0.0;
const initialReQueueDelayFrames = 22;
const minRemainingMovementReQueueFrames = 6; // after this # of frames remaining, just let anim finish; we're almost there anyway
const minRemainingTrapReQueueFrames = 6; // after this # of frames remaining to touchframe, just let anim finish; we're almost there anyway
const maxBallControlReQueueFrame = 8;
const allowReQueue = true;
const allowMovementReQueue = true;
const allowBallControlReQueue = true;
const allowTrapReQueue = true;
const allowPreTouchRotationSmuggle = false;
const enableControlledBallCollisions = true;

function _PassFiddlingEnabled(): boolean {
  return true;
}

/** C++ std::stable_sort(dataSet.begin(), dataSet.end(), boost::bind(&Humanoid::CompareXxx, this, _1, _2)) (JS sort is stable) */
function StableSortDataSet(dataSet: DataSet, less: (animIndex1: number, animIndex2: number) => boolean): void {
  dataSet.sort((a, b) => (less(a, b) ? -1 : less(b, a) ? 1 : 0));
}

/** C++ `std::map<std::string, BiasedOffset> copy = offsets;` */
function CopyOffsets(offsets: Map<string, BiasedOffset>): Map<string, BiasedOffset> {
  const copy = new Map<string, BiasedOffset>();
  for (const [name, offset] of offsets) copy.set(name, offset.Clone());
  return copy;
}

const up = new Vector3(0, -1, 0);

export class Humanoid extends HumanoidBase {
  protected team: Team;

  protected stat_GetBodyBallDistanceAdvantage_RadiusDeny: number;
  protected stat_GetBodyBallDistanceAdvantage_DistanceDeny: number;

  constructor(
    player: Player,
    humanoidSourceNode: Node,
    fullbodySourceNode: Node,
    colorCoords: Map<string, Vector3>,
    animCollection: AnimCollection,
    fullbodyTargetNode: Node,
    kit: Resource<Surface> | null,
    bodyUpdatePhaseOffset: number,
  ) {
    super(player, player.GetTeam().GetMatch(), humanoidSourceNode, fullbodySourceNode, colorCoords, animCollection, fullbodyTargetNode, kit, bodyUpdatePhaseOffset);

    this.team = this.CastPlayer().GetTeam();

    this.stat_GetBodyBallDistanceAdvantage_RadiusDeny = 0;
    this.stat_GetBodyBallDistanceAdvantage_DistanceDeny = 0;
  }

  CastPlayer(): Player {
    return this.player as Player;
  }

  TouchPending(): boolean {
    return this.currentAnim.frameNum < this.currentAnim.touchFrame ? true : false;
  }

  TouchAnim(): boolean {
    return this.currentAnim.touchFrame !== -1 ? true : false;
  }

  GetTouchPos(): Vector3 {
    return this.currentAnim.touchPos;
  }

  GetTouchFrame(): number {
    return this.currentAnim.touchFrame;
  }

  GetCurrentFrame(): number {
    return this.currentAnim.frameNum;
  }

  override Process(): void {
    const match = this.match;
    const player = this.CastPlayer();
    const team = this.team;
    const ball: Ball = match.GetBall();

    this._cache_AgilityFactor = GetConfiguration().GetReal('gameplay_agilityfactor', _default_AgilityFactor);
    this._cache_AccelerationFactor = GetConfiguration().GetReal('gameplay_accelerationfactor', _default_AccelerationFactor);

    // this might be the solution to long-term inbalance
    this.decayingPositionOffset = this.decayingPositionOffset.Mul(0.95);
    if (this.decayingPositionOffset.GetLength() < 0.005) this.decayingPositionOffset = new Vector3(0);
    this.decayingDifficultyFactor = clamp(this.decayingDifficultyFactor - 0.002, 0.0, 1.0);

    if (player.GetDebug() && spatialDebugPilons) {
      SetGreenDebugPilon(this.spatialState.position.Add(this.spatialState.directionVec.Mul(0.5)).Add(this.spatialState.movement.Mul(0.5)));
    }

    assert(match);

    if (!this.currentMentalImage) {
      this.currentMentalImage = match.GetMentalImage(0); // first-time run (todo: ehh, why this specific branch?)
    } else {
      let instaDoorheb = false;
      if (match.GetLastTouchTeamID() === team.GetID()) instaDoorheb = true;
      this.currentMentalImage = match.GetMentalImage(instaDoorheb ? 0 : player.GetController().GetReactionTime_ms());
    }
    const mentalImage = this.currentMentalImage!;

    this.CalculateSpatialState();
    this.spatialState.positionOffsetMovement = new Vector3(0);

    this.currentAnim.frameNum++;
    this.previousAnim.frameNum++;

    assert(team);

    if (this.currentAnim.frameNum === this.currentAnim.anim.GetFrameCount() - 1 && this.interruptAnim === e_InterruptAnim.e_InterruptAnim_None) {
      this.interruptAnim = e_InterruptAnim.e_InterruptAnim_Switch;
    }

    let mayReQueue = allowReQueue;


    // already some anim interrupt waiting?

    if (mayReQueue) {
      if (this.interruptAnim !== e_InterruptAnim.e_InterruptAnim_None) {
        mayReQueue = false;
      }
    }


    // may requeue on this frame?

    if (mayReQueue) {
      let frameNumPredicate = false;
      const actionDistance = this.spatialState.position.Add(this.spatialState.movement.Mul(0.1)).Sub(ball.Predict(100).Get2D()).GetLength();
      const actualTime_ms = match.GetActualTime_ms();

      if (match.GetDesignatedPossessionPlayer() === this.player && actionDistance < 3.0) {
        frameNumPredicate = (actualTime_ms + team.GetID() * 10) % 20 === 0; // .. 1 .. 2 .. 1 .. 2 ..

      } else if (match.GetDesignatedPossessionPlayer() === this.player) {
        frameNumPredicate = (actualTime_ms + team.GetID() * 10) % 30 === 0; // .. 1 .. 2 .. x .. 1 .. 2 .. x ..

      } else if (team.GetDesignatedTeamPossessionPlayer() === this.player) {
        frameNumPredicate = (actualTime_ms + team.GetID() * 20) % 40 === 0; // .. 1 .. x .. 2 .. x .. 1 .. x .. 2 ..

      } else if (actionDistance < 5.0) {
        frameNumPredicate = (actualTime_ms + team.GetID() * 20) % 50 === 0; // .. 1 .. x .. 2 .. x .. x ..

      } else if (actionDistance < 10.0) {
        frameNumPredicate = (actualTime_ms + team.GetID() * 40) % 80 === 0; // .. 1 .. x .. x .. x .. 2 .. x .. x .. x ..
      }

      if (!frameNumPredicate) mayReQueue = false;
    }


    // right anim to requeue?

    if (mayReQueue) {
      const ballDistance = mentalImage.GetBallPrediction(500).Get2D().Sub(this.spatialState.position).GetLength();
      const functionType = this.currentAnim.functionType;
      if (
        ((functionType === e_FunctionType.e_FunctionType_Movement && !player.HasPossession() && ballDistance < 16.0) ||
          (functionType === e_FunctionType.e_FunctionType_Movement && player.HasPossession()) || // passes / shot
          (functionType === e_FunctionType.e_FunctionType_Trap && this.TouchPending()) ||
          (functionType === e_FunctionType.e_FunctionType_BallControl && this.TouchPending())) &&
        this.currentAnim.anim.GetVariable('incoming_special_state') === '' &&
        this.currentAnim.anim.GetVariable('outgoing_special_state') === ''
      ) {
        mayReQueue = true;
      } else {
        mayReQueue = false;
      }
    }


    // okay, see if we need to requeue

    if (mayReQueue) {
      this.interruptAnim = e_InterruptAnim.e_InterruptAnim_ReQueue;
    }

    if (this.interruptAnim !== e_InterruptAnim.e_InterruptAnim_None) {
      const commandQueue: PlayerCommandQueue = [];

      if (this.interruptAnim === e_InterruptAnim.e_InterruptAnim_Trip && this.tripType !== 0) {
        this.AddTripCommandToQueue(commandQueue, this.tripDirection, this.tripType);
        this.tripType = 0;
        commandQueue.push(this.GetBasicMovementCommand(this.tripDirection, this.spatialState.floatVelocity)); // backup, if there's no applicable trip anim
      } else {
        player.RequestCommand(commandQueue);
      }


      // iterate through the command queue and pick the first that is applicable

      let found = false;
      let preferPassAndShot = false; // pass/shot and such; in that case we want trap/ballcontrol anims to be less prefered
      for (let i = 0; i < commandQueue.length; i++) {
        const command = commandQueue[i];

        if (
          command.desiredFunctionType === e_FunctionType.e_FunctionType_ShortPass ||
          command.desiredFunctionType === e_FunctionType.e_FunctionType_LongPass ||
          command.desiredFunctionType === e_FunctionType.e_FunctionType_HighPass ||
          command.desiredFunctionType === e_FunctionType.e_FunctionType_Shot
        ) {
          preferPassAndShot = true;
        }

        found = this.SelectAnim(command, this.interruptAnim, preferPassAndShot);
        if (found) break;
      }

      if (this.interruptAnim === e_InterruptAnim.e_InterruptAnim_Switch && !found) {
        Log(e_Warning, 'Humanoid', 'Process', 'RED ALERT! NO APPLICABLE ANIM FOUND! NOOOO!');
        Log(e_Warning, 'Humanoid', 'Process', 'currentanimtype: ' + this.currentAnim.anim.GetVariable('type'));
        for (let i = 0; i < commandQueue.length; i++) {
          Log(e_Warning, 'Humanoid', 'Process', 'desiredanimtype:' + int_to_str(commandQueue[i].desiredFunctionType));
          Log(e_Warning, 'Humanoid', 'Process', 'desired velo: ' + real_to_str(commandQueue[i].desiredVelocityFloat));
          const dir = commandQueue[i].desiredDirection;
          Log(e_Warning, 'Humanoid', 'Process', 'desired direction: ' + real_to_str(dir.coords[0]) + ', ' + real_to_str(dir.coords[1]) + ', ' + real_to_str(dir.coords[2]));
        }
        Log(e_Warning, 'Humanoid', 'Process', 'current velo: ' + real_to_str(this.spatialState.floatVelocity));
        Log(e_Warning, 'Humanoid', 'Process', 'current body angle: abs: ' + real_to_str(this.spatialState.bodyAngle) + ', rel: ' + real_to_str(this.spatialState.relBodyAngle));
        const pos = this.spatialState.position;
        Log(e_Warning, 'Humanoid', 'Process', 'current position: ' + real_to_str(pos.coords[0]) + ', ' + real_to_str(pos.coords[1]) + ', ' + real_to_str(pos.coords[2]));
        Log(e_Warning, 'Humanoid', 'Process', 'special state: ' + this.currentAnim.anim.GetVariable('outgoing_special_state'));

        if (!IsReleaseVersion()) {
          // PORT: C++ exit(1)
          throw new Error('Humanoid::Process: no applicable anim found');
        } else {
          this.ResetPosition(this.spatialState.position, ball.Predict(0).Get2D()); // NOT supposed to happen!
        }
      }

      if (found) {
        this.startPos = this.spatialState.position;
        this.startAngle = this.spatialState.angle;

        const predicted = this.CalculatePredictedSituation();
        this.nextStartPos = predicted.predictedPos;
        this.nextStartAngle = predicted.predictedAngle;

        const functionType = this.currentAnim.functionType;
        this.animApplyBuffer.anim = this.currentAnim.anim;
        this.animApplyBuffer.smooth = animSmoothing;
        this.animApplyBuffer.smoothFactor =
          this.interruptAnim === e_InterruptAnim.e_InterruptAnim_Switch &&
          this.previousAnim.functionType === e_FunctionType.e_FunctionType_Movement &&
          functionType === e_FunctionType.e_FunctionType_Movement
            ? 0.0
            : 1.0; // more smoothing for mid-anim requeues
        if (functionType === e_FunctionType.e_FunctionType_Shot) this.animApplyBuffer.smoothFactor = 0.8;
        if (functionType === e_FunctionType.e_FunctionType_ShortPass ||
            functionType === e_FunctionType.e_FunctionType_HighPass) this.animApplyBuffer.smoothFactor = 0.8;
        if (functionType === e_FunctionType.e_FunctionType_Deflect ||
            functionType === e_FunctionType.e_FunctionType_Sliding) this.animApplyBuffer.smoothFactor = 0.8;
        if (functionType === e_FunctionType.e_FunctionType_BallControl ||
            functionType === e_FunctionType.e_FunctionType_Trap) this.animApplyBuffer.smoothFactor = 0.8;

        // decaying difficulty
        const animDiff = atof(this.currentAnim.anim.GetVariable('animdifficultyfactor'));
        if (animDiff > this.decayingDifficultyFactor) this.decayingDifficultyFactor = animDiff;

        // if we just requeued, for example, from movement to ballcontrol, there's no reason we can not immediately requeue to another ballcontrol again (next time). only apply the initial requeue delay on subsequent anims of the same type
        // (so we can have a fast ballcontrol -> ballcontrol requeue, but after that, use the initial delay)
        if (this.interruptAnim === e_InterruptAnim.e_InterruptAnim_ReQueue && this.previousAnim.functionType === functionType) {
          this.reQueueDelayFrames = initialReQueueDelayFrames; // don't try requeueing (some types of anims, see selectanim()) too often
        }
      }
    }
    this.reQueueDelayFrames = Math.max(this.reQueueDelayFrames - 1, 0);

    this.interruptAnim = e_InterruptAnim.e_InterruptAnim_None;

    if (this.startPos.coords[2] !== 0) {
      Log(e_FatalError, 'Humanoid', 'Process', 'BWAAAAAH FLYING PLAYERS!! height: ' + real_to_str(this.startPos.coords[2]));
    }

    const ballDistanceNow = ball.Predict(0).Get2D().Sub(this.spatialState.position).GetLength();
    const ballDistanceFuture = ball.Predict(200).Get2D().Sub(this.spatialState.position.Add(this.spatialState.movement.Mul(0.2))).GetLength();
    const lastTouchBias = player.GetLastTouchBias(1500);
    const opponentTeam: Team = match.GetTeam(Math.abs(team.GetID() - 1));
    const oppLastTouchBias = opponentTeam.GetLastTouchBias(240);

    if (
      player === match.GetDesignatedPossessionPlayer() &&
      ((lastTouchBias <= 0.01 && oppLastTouchBias <= 0.01 && this.currentAnim.functionType === e_FunctionType.e_FunctionType_Movement &&
        ballDistanceNow < 0.6 && ballDistanceFuture > 0.65 && ballDistanceFuture > ballDistanceNow) || // 0.5 / 0.6
        (lastTouchBias <= 0.7 && player.HasPossession() && this.currentAnim.functionType === e_FunctionType.e_FunctionType_Trip && ballDistanceNow < 0.4)) && // todo: only when triptype is 1 ?
      ball.Predict(0).coords[2] < 1.6
    ) {
      player.TriggerControlledBallCollision();
    }

    // ------------------------ EXPERIMENTAL ------------------------------------------------
    const controlledBallCollision = player.IsControlledBallCollisionTriggered();
    if (controlledBallCollision) player.ResetControlledBallCollisionTrigger();
    if (enableControlledBallCollisions && controlledBallCollision && this.currentAnim.touchFrame === -1) {
      const currentBallVec = ball.GetMovement();
      const nextBodyAngle = this.startAngle + this.currentAnim.anim.GetOutgoingAngle() + this.currentAnim.anim.GetOutgoingBodyAngle() + this.currentAnim.rotationSmuggle.end;

      const trap = GetTrapVector(match, player, this.nextStartPos, this.nextStartAngle, nextBodyAngle, this.CalculateOutgoingMovement(this.currentAnim.positions), this.currentAnim, this.currentAnim.frameNum, this.spatialState, this.decayingPositionOffset);
      let touchVec = trap.result;
      if ((this.currentAnim.originatingCommand.modifier & e_PlayerCommandModifier.e_PlayerCommandModifier_KnockOn) !== 0) {
        touchVec = touchVec.Mul(1.35); //1.2f;
      }

      const bumpyRideBias = 0.0;
      touchVec = touchVec.Mul(1.0 - bumpyRideBias).Add(currentBallVec.Mul(bumpyRideBias));

      ball.Touch(touchVec);
      ball.SetRotation(trap.xRot, trap.yRot, 0, 0.2 * (1.0 - bumpyRideBias)); // 0.9
      ball.TriggerBallTouchSound(Math.pow(NormalizedClamp(touchVec.GetLength(), 4.0, 40.0), 0.7));

      team.SetLastTouchPlayer(player, GetTouchTypeForBodyPart(this.currentAnim.anim.GetVariable('touch_bodypart')));
      player.UpdatePossessionStats(false);
    }
    // ---------------------- / EXPERIMENTAL ------------------------------------------------

    if (this.currentAnim.touchFrame === this.currentAnim.frameNum) {
      const touchPosResult = (this.currentAnim.anim.GetExtension('football') as FootballAnimationExtension).GetTouchPos(this.currentAnim.touchFrame);
      const desiredBallPosition = touchPosResult.result ? touchPosResult.position : new Vector3(0);
      const desiredBallHeight = desiredBallPosition.coords[2];

      let touchableDistance = 0.4;

      let fullBallDistance = ball.Predict(0).Sub(this.currentAnim.touchPos.Add(this.currentAnim.positionOffset)).GetLength();

      if (this.currentAnim.anim.GetVariable('incoming_retain_state') !== '') {
        fullBallDistance = 0.0;
        touchableDistance = 1.0;
      }

      let bumpyRideBias = fullBallDistance / touchableDistance;
      bumpyRideBias = clamp(bumpyRideBias - 0.001, 0.0, 1.0);
      bumpyRideBias = curve(bumpyRideBias, 1.0);
      bumpyRideBias = curve(bumpyRideBias, 0.5);
      const currentBallVec = ball.GetMovement();

      if (fullBallDistance < touchableDistance && Math.abs(desiredBallHeight - ball.Predict(0).coords[2]) < 1.0) {
        const nextBodyAngle = this.startAngle + this.currentAnim.anim.GetOutgoingAngle() + this.currentAnim.anim.GetOutgoingBodyAngle() + this.currentAnim.rotationSmuggle.end;
        const functionType = this.currentAnim.functionType;
        const originatingCommand = this.currentAnim.originatingCommand;
        const touchInfo = originatingCommand.touchInfo;

        if (functionType === e_FunctionType.e_FunctionType_Trap || (functionType === e_FunctionType.e_FunctionType_BallControl && player.HasPossession() === false)) {
          const trap = GetTrapVector(match, player, this.nextStartPos, this.nextStartAngle, nextBodyAngle, this.CalculateOutgoingMovement(this.currentAnim.positions), this.currentAnim, this.currentAnim.frameNum, this.spatialState, this.decayingPositionOffset);
          let touchVec = trap.result;
          if ((originatingCommand.modifier & e_PlayerCommandModifier.e_PlayerCommandModifier_KnockOn) !== 0) {
            touchVec = touchVec.Mul(1.35);
          }

          touchVec = touchVec.Mul(1.0 - bumpyRideBias).Add(currentBallVec.Mul(bumpyRideBias));

          ball.Touch(touchVec);
          ball.SetRotation(trap.xRot, trap.yRot, 0, 0.5 * (1.0 - bumpyRideBias));

          team.SetLastTouchPlayer(player, GetTouchTypeForBodyPart(this.currentAnim.anim.GetVariable('touch_bodypart')));
          player.UpdatePossessionStats(false);
        }

        else if (functionType === e_FunctionType.e_FunctionType_BallControl) {
          const ballControl = GetBallControlVector(ball, player, this.nextStartPos, this.nextStartAngle, nextBodyAngle, this.CalculateOutgoingMovement(this.currentAnim.positions), this.currentAnim, this.currentAnim.frameNum, this.spatialState, this.decayingPositionOffset);
          let touchVec = ballControl.result;
          if ((originatingCommand.modifier & e_PlayerCommandModifier.e_PlayerCommandModifier_KnockOn) !== 0) {
            touchVec = touchVec.Mul(1.35);
          }

          touchVec = touchVec.Mul(1.0 - bumpyRideBias).Add(currentBallVec.Mul(bumpyRideBias));

          ball.Touch(touchVec);
          ball.SetRotation(ballControl.xRot, ballControl.yRot, 0, 0.6 * (1.0 - bumpyRideBias)); // 1.0

          team.SetLastTouchPlayer(player, GetTouchTypeForBodyPart(this.currentAnim.anim.GetVariable('touch_bodypart')));
          player.UpdatePossessionStats(false);
        }

        else if (functionType === e_FunctionType.e_FunctionType_ShortPass ||
                 functionType === e_FunctionType.e_FunctionType_LongPass ||
                 functionType === e_FunctionType.e_FunctionType_HighPass) {
          let ballDirection = touchInfo.desiredDirection;
          let ballPower = touchInfo.desiredPower;
          let targetPlayer: Player | null = touchInfo.targetPlayer;
          let inputDirection = touchInfo.inputDirection;
          const externalController = player.GetExternalController();
          if (externalController) inputDirection = externalController.GetDirection();


          // refine/change target, if new target is close enough to old target

          const pass = AI_GetPass(player, originatingCommand.desiredFunctionType, inputDirection, touchInfo.inputPower, touchInfo.autoDirectionBias, touchInfo.autoPowerBias, touchInfo.forcedTargetPlayer);
          const tmpBallDirection = pass.resultingDirection;
          const tmpBallPower = pass.resultingPower;
          const tmpTargetPlayer: Player | null = pass.targetPlayer;
          const maxDeviationAngle = 0.15 * pi;
          const angleDiff = tmpBallDirection.Get2D().GetAngle2D(ballDirection.Get2D());
          if (Math.abs(angleDiff) <= maxDeviationAngle) {
            ballDirection = tmpBallDirection;
            ballPower = tmpBallPower;
            targetPlayer = tmpTargetPlayer;
          } else if (Math.abs(angleDiff) < 2.0 * maxDeviationAngle) {
            // get as close as possible
            const clampedAngleDiff = clamp(angleDiff, -maxDeviationAngle, maxDeviationAngle);
            ballDirection = ballDirection.GetRotated2D(clampedAngleDiff);

            if (tmpTargetPlayer !== targetPlayer) {
              // if we can't make it to our refined target at all, just stick with original ballpower (think about refined target at ~180 deg, would be weird to pass forward with the power of that (unreachable) target)
              const refinedBias = NormalizedClamp(Math.abs(clampedAngleDiff), 0.0, Math.abs(angleDiff));
              ballPower = ballPower * (1.0 - refinedBias) + tmpBallPower * refinedBias;
              targetPlayer = tmpTargetPlayer; // new, and removed line below
            } else {
              ballPower = tmpBallPower;
            }

          } // else: just stick to original


          if (targetPlayer) team.SelectPlayer(targetPlayer);

          let zcurve = 0.0;
          let touchVec = ballDirection.Mul(36).Mul(ballPower + 0.3);

          if (_PassFiddlingEnabled()) {
            touchVec = this.GetBestPossibleTouch(touchVec, functionType);

            // add a little curve for aesthetics & realism
            let bodyTouchAngle = this.spatialState.bodyDirectionVec.GetAngle2D(touchVec) / pi;
            if (Math.abs(bodyTouchAngle) > 0.5) bodyTouchAngle = (1.0 - Math.abs(bodyTouchAngle)) * signSide(bodyTouchAngle);
            bodyTouchAngle *= 2.0;
            let amount = bodyTouchAngle * 0.25;
            if (functionType === e_FunctionType.e_FunctionType_HighPass) amount *= 0.2;
            touchVec = touchVec.GetRotated2D(amount * (0.4 + 0.6 * NormalizedClamp(touchVec.GetLength(), 0.0, 70.0)));
            zcurve = amount * -340; //-600;
          }

          touchVec = touchVec.Mul(1.0 - bumpyRideBias).Add(currentBallVec.Mul(bumpyRideBias));

          ball.Touch(touchVec);
          ball.TriggerBallTouchSound(Math.pow(NormalizedClamp(touchVec.GetLength(), 4.0, 40.0), 0.7));

          let forwardness = 3.5;
          if (functionType === e_FunctionType.e_FunctionType_HighPass) forwardness = -1.3;
          const touchDir = touchVec.GetNormalized(0);
          const xRot = touchDir.coords[1] * (clamp(touchVec.GetLength(), 0.0, 15.0) * forwardness);
          const yRot = touchDir.coords[0] * (clamp(touchVec.GetLength(), 0.0, 15.0) * forwardness);
          ball.SetRotation(xRot, yRot, zcurve, 0.9 * (1.0 - bumpyRideBias));

          team.SetLastTouchPlayer(player, GetTouchTypeForBodyPart(this.currentAnim.anim.GetVariable('touch_bodypart')));
          player.UpdatePossessionStats(false);
          if (targetPlayer) targetPlayer.UpdatePossessionStats(false);
        }

        else if (functionType === e_FunctionType.e_FunctionType_Shot) {
          // alter direction, if neeeded
          // (as in the original, the resulting ballDirection is not used: GetShotVector works from touchInfo.desiredDirection)
          let ballDirection = touchInfo.desiredDirection;
          let inputDirection = touchInfo.inputDirection;
          const externalController = player.GetExternalController();
          if (externalController) inputDirection = externalController.GetDirection();
          const ballDirectionAltered = AI_GetShotDirection(player, inputDirection, touchInfo.autoDirectionBias);

          const maxDeviationAngle = 0.1 * pi;
          const angleDiff = ballDirectionAltered.Get2D().GetAngle2D(ballDirection.Get2D());
          if (Math.abs(angleDiff) > maxDeviationAngle) {
            // get as close as possible
            const clampedAngleDiff = clamp(angleDiff, -maxDeviationAngle, maxDeviationAngle);
            ballDirection = ballDirection.GetRotated2D(clampedAngleDiff);
          } else {
            ballDirection = ballDirectionAltered;
          }

          const shot = GetShotVector(match, player, this.nextStartPos, this.nextStartAngle, nextBodyAngle, this.CalculateOutgoingMovement(this.currentAnim.positions), this.currentAnim, this.currentAnim.frameNum, this.spatialState, this.decayingPositionOffset, touchInfo.autoDirectionBias);
          let touchVec = shot.result;

          touchVec = touchVec.Mul(1.0 - bumpyRideBias).Add(currentBallVec.Mul(bumpyRideBias));

          ball.Touch(touchVec);
          ball.SetRotation(shot.xRot, shot.yRot, shot.zRot, 0.7 * (1.0 - bumpyRideBias));
          ball.TriggerBallTouchSound(Math.pow(NormalizedClamp(touchVec.GetLength(), 4.0, 40.0), 0.7));

          team.SetLastTouchPlayer(player, GetTouchTypeForBodyPart(this.currentAnim.anim.GetVariable('touch_bodypart')));
          match.GetMatchData().AddShot(team.GetID());
        }

        else if (functionType === e_FunctionType.e_FunctionType_Interfere) {
          const trap = GetTrapVector(match, player, this.nextStartPos, this.nextStartAngle, nextBodyAngle, this.CalculateOutgoingMovement(this.currentAnim.positions), this.currentAnim, this.currentAnim.frameNum, this.spatialState, this.decayingPositionOffset);
          let touchVec = trap.result.Mul(0.5)
            .Add(ball.Predict(0).Get2D().Sub(this.spatialState.position).GetNormalized().Mul(4.0))
            .Add(new Vector3(0, 0, random(0.5, 1.5))); // was 1 .. 6

          touchVec = touchVec.Mul(1.0 - bumpyRideBias).Add(currentBallVec.Mul(bumpyRideBias));

          ball.Touch(touchVec);
          // PORT: faithful to the original, which passes the bias as the z rotation (bias stays at its default)
          ball.SetRotation(trap.xRot, trap.yRot, 0.3 * (1.0 - bumpyRideBias));
          team.SetLastTouchPlayer(player, e_TouchType.e_TouchType_Accidental); // it's not truly accidental, but the resulting direction somewhat is, so goalies may fetch these balls
        }

        else if (functionType === e_FunctionType.e_FunctionType_Deflect) {
          let canRetain = true; // can we grab hold of the ball?
          if (this.currentAnim.anim.GetVariable('outgoing_retain_state') === '') canRetain = false; // not the right anim, hopeless!
          if (match.GetBallRetainer()) canRetain = false; // somebody is already holding the ball :( (dafuq, this should not happen, right?)

          const veloDifficulty = NormalizedClamp(ball.GetMovement().Sub(this.player.GetMovement()).GetLength(), 0.0, 40.0);
          let reactionDifficulty = 0.0;
          const lastTouchPlayer = opponentTeam.GetLastTouchPlayer();
          if (lastTouchPlayer) {
            // (C++ int decay_ms parameter: the float argument is truncated)
            reactionDifficulty = Math.pow(lastTouchPlayer.GetLastTouchBias(Math.trunc(1200 - this.player.GetStat('physical_reaction') * 400)), 0.6);
          }
          if ((1.0 - veloDifficulty) * (1.0 - reactionDifficulty) < 0.3) canRetain = false; // too hard!

          if (canRetain) {
            match.SetBallRetainer(player);
          } else {
            const currentBallMovement = ball.GetMovement().Get2D();
            const playerMovement = this.spatialState.movement;
            let touchVec = currentBallMovement.Neg().Mul(0.1)
              .Add(playerMovement.Mul(2.0))
              .Add(new Vector3(-team.GetSide(), 0, 0).Mul(4.0))
              .Add(new Vector3(0, random(-1, 1), 0))
              .GetNormalized(0)
              .Mul(currentBallMovement.GetLength() * 0.3 + playerMovement.GetLength() * 2.5);
            touchVec = touchVec.WithCoord(2, touchVec.coords[2] + 1.2);

            touchVec = touchVec.Mul(1.0 - bumpyRideBias).Add(currentBallVec.Mul(bumpyRideBias));

            ball.Touch(touchVec);
            ball.SetRotation(0, 0, 0, 0.2 * (1.0 - bumpyRideBias));
          }
          team.SetLastTouchPlayer(player, e_TouchType.e_TouchType_Accidental);
        }

        else if (functionType === e_FunctionType.e_FunctionType_Sliding) {
          let touchVec = GetVectorFromString(this.currentAnim.anim.GetVariable('balldirection')).GetRotated2D(this.spatialState.angle);
          touchVec = touchVec.Mul(6.0).Add(ball.GetMovement().Mul(-0.28));
          touchVec = touchVec.Add(new Vector3(0, 0, 6));

          touchVec = touchVec.Mul(1.0 - bumpyRideBias).Add(currentBallVec.Mul(bumpyRideBias));

          ball.Touch(touchVec);

          team.SetLastTouchPlayer(player, e_TouchType.e_TouchType_Accidental);
        }
      }
    }

    if (match.GetBallRetainer() === this.player) {
      const outgoingRetainState = this.currentAnim.anim.GetVariable('outgoing_retain_state');
      const incomingRetainState = this.currentAnim.anim.GetVariable('incoming_retain_state');
      if ((this.currentAnim.touchFrame <= this.currentAnim.frameNum && outgoingRetainState !== '') ||
          (this.currentAnim.touchFrame > this.currentAnim.frameNum && incomingRetainState !== '') ||
          (incomingRetainState !== '' && outgoingRetainState !== '')) {
        // find body part the ball is stuck to (superglue powers)
        let bodyPart = this.nodeMap.get(outgoingRetainState);
        if (bodyPart === undefined) bodyPart = this.nodeMap.get(incomingRetainState);
        assert(bodyPart !== undefined);
        ball.Touch(new Vector3(0));
        ball.SetRotation(0, 0, 0, 1.0);
        ball.SetPosition(bodyPart.GetDerivedPosition().Add(bodyPart.GetDerivedRotation().MulVec(new Vector3(0, 0, -0.36))));
        team.SetLastTouchPlayer(player, e_TouchType.e_TouchType_Intentional_Nonkicked);
      } else {
        // no longer retaining
        match.SetBallRetainer(null);
      }
    }


    // action smuggle

    const frameNum = this.currentAnim.frameNum;
    const touchFrame = this.currentAnim.touchFrame;
    const effectiveFrameCount = this.currentAnim.anim.GetEffectiveFrameCount();

    // start with +1, because we want to influence the first frame as well
    // as for finishing, finish with frameBias = 1.0, even if the last frame is 'spiritually' the one-to-last, since the first frame of the next anim is actually 'same-tempered' as the current anim's last frame.
    // however, it works best to have all values 'done' at this one-to-last frame, so the next anim can read out these correct (new starting) values.

    if (touchFrame !== -1 && frameNum <= touchFrame) {
      // smooth version
      assert(touchFrame > 0);
      let value = Math.cos((frameNum / (touchFrame + 1) - 0.5) * pi * 2.0) + 1.0;
      // add some linearity
      value = value * 0.1 + 0.9;
      this.spatialState.actionSmuggleMovement = this.currentAnim.actionSmuggle.Div(touchFrame + 1).Mul(value).Mul(100.0);
      this.currentAnim.actionSmuggleOffset = this.currentAnim.actionSmuggleOffset.Add(this.spatialState.actionSmuggleMovement.Div(100.0));

    } else {
      this.spatialState.actionSmuggleMovement = new Vector3(0);
    }


    // movement smuggle

    if (touchFrame === -1 && frameNum <= effectiveFrameCount) { // omit one frame, or balltouch will be influenced because of velo
      // smooth version
      let value = Math.cos((frameNum / (effectiveFrameCount + 1) - 0.5) * pi * 2.0) + 1.0;
      // add some linearity
      value = value * 0.1 + 0.9;
      this.spatialState.movementSmuggleMovement = this.currentAnim.movementSmuggle.Div(effectiveFrameCount + 1).Mul(value).Mul(100.0);
      this.currentAnim.movementSmuggleOffset = this.currentAnim.movementSmuggleOffset.Add(this.spatialState.movementSmuggleMovement.Div(100.0));
    } else {
      this.spatialState.movementSmuggleMovement = new Vector3(0);
    }


    // rotation smuggle

    const beginRotationFrameCount = 16; // after this amount of frames, be ready with 'ease-in' rotation smuggle
    const cappedFrameBias = Math.min(1.0, (frameNum + 1) / Math.min(beginRotationFrameCount, effectiveFrameCount + 1));
    let beginFrameBias = cappedFrameBias;
    let endFrameBias = cappedFrameBias;
    if (touchFrame !== -1) {
      // beginFrameBias ranges from 0 to 1 during frame 0 to (touchframe OR beginRotationFrameCount) (depending on which comes first)
      beginFrameBias = Math.min(1.0, (frameNum + 1) / Math.min(beginRotationFrameCount, touchFrame + 1));
      if (!allowPreTouchRotationSmuggle) {
        if (frameNum > touchFrame) {
          // end rotation smuggle starts after touch
          endFrameBias = (frameNum - touchFrame) / (effectiveFrameCount - touchFrame);
        } else {
          // no smuggle before touch
          endFrameBias = 0.0;
        }
      }
    }
    this.currentAnim.rotationSmuggleOffset = this.currentAnim.rotationSmuggle.begin * (1.0 - beginFrameBias) +
                                             this.currentAnim.rotationSmuggle.end * endFrameBias;


    // ballretainer should not get out of 16 meter box

    if (match.GetBallRetainer() === this.player && player.GetFormationEntry().role === e_PlayerRole.e_PlayerRole_GK && match.IsInSetPiece() === false && match.IsInPlay() === true) {
      const side = team.GetSide();
      if (ball.Predict(0).coords[1] > 20.05) {
        this.OffsetPosition(new Vector3(0, clamp(20.05 - ball.Predict(0).coords[1], -0.5, 0.5), 0).Mul(0.3));
      }
      if (ball.Predict(0).coords[1] < -20.05) {
        this.OffsetPosition(new Vector3(0, clamp(-20.05 - ball.Predict(0).coords[1], -0.5, 0.5), 0).Mul(0.3));
      }
      if (ball.Predict(0).coords[0] * -side > -pitchHalfW + 16.4) {
        this.OffsetPosition(new Vector3(clamp((-pitchHalfW + 16.4) - ball.Predict(0).coords[0] * -side, -0.5, 0.5), 0, 0).Mul(-side).Mul(0.3));
      }
      if (ball.Predict(0).coords[0] * -side < -pitchHalfW + 0.1) {
        this.OffsetPosition(new Vector3(clamp((-pitchHalfW + 0.1) - ball.Predict(0).coords[0] * -side, -0.5, 0.5), 0, 0).Mul(-side).Mul(0.4));
      }
    }


    // next frame

    this.animApplyBuffer.frameNum = this.currentAnim.frameNum;

    if (this.currentAnim.positions.length > this.currentAnim.frameNum) {
      this.animApplyBuffer.position = this.startPos
        .Add(this.currentAnim.positions[this.currentAnim.frameNum])
        .Add(this.currentAnim.actionSmuggleOffset)
        .Add(this.currentAnim.actionSmuggleSustainOffset)
        .Add(this.currentAnim.movementSmuggleOffset);
      this.animApplyBuffer.orientation = this.startAngle + this.currentAnim.rotationSmuggleOffset;
      this.animApplyBuffer.noPos = true;
    } else {
      if (player.GetDebug()) console.debug(`ERROR: ${this.currentAnim.positions.length}, ${this.currentAnim.frameNum} (${this.currentAnim.anim.GetName()})`);
      this.animApplyBuffer.position = this.startPos
        .Add(this.currentAnim.actionSmuggleOffset)
        .Add(this.currentAnim.actionSmuggleSustainOffset)
        .Add(this.currentAnim.movementSmuggleOffset);
      this.animApplyBuffer.orientation = this.startAngle;
      this.animApplyBuffer.noPos = false;
    }

    this.animApplyBuffer.offsets = CopyOffsets(this.offsets);
  }

  override CalculateGeomOffsets(): void {
    this.SetOffset('middle', 0.0, Quaternion.IDENTITY);
    this.SetOffset('neck', 0.0, Quaternion.IDENTITY);
    this.SetOffset('left_thigh', 0.0, Quaternion.IDENTITY);
    this.SetOffset('right_thigh', 0.0, Quaternion.IDENTITY);
    this.SetOffset('left_knee', 0.0, Quaternion.IDENTITY);
    this.SetOffset('right_knee', 0.0, Quaternion.IDENTITY);
    this.SetOffset('left_ankle', 0.0, Quaternion.IDENTITY);
    this.SetOffset('right_ankle', 0.0, Quaternion.IDENTITY);
    this.SetOffset('left_shoulder', 0.0, Quaternion.IDENTITY);
    this.SetOffset('right_shoulder', 0.0, Quaternion.IDENTITY);
    this.SetOffset('left_elbow', 0.0, Quaternion.IDENTITY);
    this.SetOffset('right_elbow', 0.0, Quaternion.IDENTITY);
    this.SetOffset('body', 0.0, Quaternion.IDENTITY);

    const adaptLegsToTrueVelocity = true;
    const adaptLegsToTrueVelocity_influence = 0.7;
    const adaptBodyToBallPosition = true;
    const adaptBodyToBallPosition_influence = 0.5;
    const adaptLegToTouchPos = false;
    const adaptLegToTouchPos_influence = 0.5;
    const adaptArmsToOpp = true;
    const adaptArmsToOpp_influence = 0.9;

    const match = this.match;

    if (match.IsInPlay() && match.GetBallRetainer() !== this.player) {

      if (this.currentAnim.functionType === e_FunctionType.e_FunctionType_Movement) {


        // slow down legs when we're going slower than the anim (or speed up if we're going faster)

        if (adaptLegsToTrueVelocity) {
          const actualVelo = this.spatialState.actualMovement.GetLength();
          const animVelo = this.spatialState.animMovement.GetLength();
          let veloFactor = (actualVelo + 0.2) / (animVelo + 0.2); // avoid div by zero

          let allowFasterFactor = 0.0;
          if (this.spatialState.actualMovement.GetLength() > 7.0) allowFasterFactor += 0.1;
          veloFactor = clamp(veloFactor, 0.1, 1.0 + allowFasterFactor);

          const bendFactor = 0.8;

          const defaultLeftHipOrientation = Quaternion.FromAngleAxis(-0.15 * pi * bendFactor, new Vector3(1, 0.06, -0.12).GetNormalized());
          const defaultRightHipOrientation = Quaternion.FromAngleAxis(-0.15 * pi * bendFactor, new Vector3(1, -0.06, 0.12).GetNormalized());
          const defaultKneeOrientation = Quaternion.FromAngleAxis(0.3 * pi * bendFactor, new Vector3(1, 0, 0));
          const defaultAnkleOrientation = Quaternion.FromAngleAxis(-0.1 * pi * bendFactor, new Vector3(1, 0, 0));

          const bias = (1.0 - veloFactor) * adaptLegsToTrueVelocity_influence;
          this.SetOffset('left_thigh', bias, defaultLeftHipOrientation);
          this.SetOffset('right_thigh', bias, defaultRightHipOrientation);
          this.SetOffset('left_knee', bias, defaultKneeOrientation);
          this.SetOffset('right_knee', bias, defaultKneeOrientation);
          this.SetOffset('left_ankle', bias, defaultAnkleOrientation);
          this.SetOffset('right_ankle', bias, defaultAnkleOrientation);
        }


        // aim a bit towards ball

        if (adaptBodyToBallPosition && !this.CastPlayer().HasPossession()) {
          const toBall = this.currentMentalImage!.GetBallPrediction(10).Get2D().Sub(this.spatialState.position).GetNormalized(this.spatialState.directionVec);

          let angle = toBall.GetAngle2D(this.spatialState.relBodyDirectionVecNonquantized.GetRotated2D(this.spatialState.angle));
          angle = clamp(Math.abs(angle) - 0.05 * pi, 0.0, pi) * signSide(angle); // less influence
          let lookAtBallBias = Math.pow(1.0 - Math.abs(angle / pi), 0.3);
          lookAtBallBias = clamp(lookAtBallBias * adaptBodyToBallPosition_influence, 0.0, 1.0);
          const ballDistance = match.GetBall().Predict(100).Get2D().GetDistance(this.spatialState.position);
          const ballProximityFalloff = 1.6;
          if (ballDistance < ballProximityFalloff) { // close ball can be a problem
            lookAtBallBias *= NormalizedClamp(ballDistance, ballProximityFalloff * 0.4, ballProximityFalloff);
          }
          lookAtBallBias *= 1.0 - Math.pow(NormalizedClamp(this.spatialState.floatVelocity, idleVelocity, sprintVelocity - 0.5), 2.0) * 0.3; // less effect on high velo

          const middleOrientation = Quaternion.FromAngleAxis(angle, new Vector3(0, 0, 1)).GetNormalized();

          // correct for body orientation
          this.SetOffset('middle', lookAtBallBias * 0.3, middleOrientation, true);

          // this is an incorrect guesstimation
          const headOrientation = Quaternion.FromAngleAxis(angle, new Vector3(0, 0, 1)).GetNormalized();
          // correct for body orientation
          this.SetOffset('neck', lookAtBallBias * 0.7, headOrientation, true);
        }


        // use arms to keep opponents away

        if (adaptArmsToOpp) {
          const opponentTeam: Team = match.GetTeam(Math.abs(this.team.GetID() - 1));
          const opp: Player = match.GetPlayer(opponentTeam.GetBestPossessionPlayerID())!;
          if (opp.GetPosition().Sub(this.spatialState.position).GetLength() < 1.4 && opp.GetDirectionVec().GetDotProduct(this.spatialState.directionVec) > 0.0) {

            const baseRotVec = up.GetRotated2D(this.spatialState.angle).GetRotated2D(this.spatialState.relBodyAngle);
            const oppVec = opp.GetPosition().Sub(this.spatialState.position);
            const angle = baseRotVec.GetAngle2D(oppVec.GetNormalized(baseRotVec));

            let shoulder: Quaternion;
            let elbow: Quaternion;

            // player is behind us, somewhat to the left or right. hold up arm to keep him back
            if (Math.abs(angle) > 0.6 * pi && Math.abs(angle) < 0.85 * pi) {
              if (angle > 0) {

                shoulder = Quaternion.FromAngleAxis(0.4 * pi, new Vector3(0, 1, 0));
                elbow = Quaternion.FromAngleAxis(0, new Vector3(0, 1, 0));
                this.SetOffset('right_shoulder', 0.8 * adaptArmsToOpp_influence, shoulder.GetNormalized());
                this.SetOffset('right_elbow', 0.7 * adaptArmsToOpp_influence, elbow.GetNormalized());

              } else {

                shoulder = Quaternion.FromAngleAxis(-0.4 * pi, new Vector3(0, 1, 0));
                elbow = Quaternion.FromAngleAxis(0, new Vector3(0, 1, 0));
                this.SetOffset('left_shoulder', 0.8 * adaptArmsToOpp_influence, shoulder.GetNormalized());
                this.SetOffset('left_elbow', 0.7 * adaptArmsToOpp_influence, elbow.GetNormalized());

              }

              // bend forwards
              const middle = Quaternion.FromAngleAxis(0.2 * pi, new Vector3(1, 0, 0));
              this.SetOffset('middle', 0.3 * adaptArmsToOpp_influence, middle.GetNormalized());
            }

            // player is next to us, use arm to protect our position
            if (Math.abs(angle) > 0.2 * pi && Math.abs(angle) <= 0.6 * pi) {
              if (angle > 0) {

                shoulder = Quaternion.FromAngleAxis(0.4 * pi, new Vector3(0, 1, 0));
                elbow = Quaternion.FromAngleAxis(-0.5 * pi, new Vector3(1, 0, 0));
                this.SetOffset('right_shoulder', 0.7 * adaptArmsToOpp_influence, shoulder.GetNormalized());
                this.SetOffset('right_elbow', 0.8 * adaptArmsToOpp_influence, elbow.GetNormalized());

              } else {

                shoulder = Quaternion.FromAngleAxis(-0.4 * pi, new Vector3(0, 1, 0));
                elbow = Quaternion.FromAngleAxis(-0.5 * pi, new Vector3(1, 0, 0));
                this.SetOffset('left_shoulder', 0.7 * adaptArmsToOpp_influence, shoulder.GetNormalized());
                this.SetOffset('left_elbow', 0.8 * adaptArmsToOpp_influence, elbow.GetNormalized());

              }
            }

            // player is in front of us, pull shirt :p
            // (0.2 radians, not 0.2 * pi: as in the original)
            if (Math.abs(angle) < 0.2) {
              if (angle > 0) {

                shoulder = Quaternion.FromAngleAxis(-0.4 * pi, new Vector3(1, 0, 0));
                elbow = Quaternion.FromAngleAxis(-0.2 * pi, new Vector3(1, 0, 0));
                this.SetOffset('right_shoulder', 0.6 * adaptArmsToOpp_influence, shoulder.GetNormalized());
                this.SetOffset('right_elbow', 0.8 * adaptArmsToOpp_influence, elbow.GetNormalized());

              } else {

                shoulder = Quaternion.FromAngleAxis(-0.4 * pi, new Vector3(1, 0, 0));
                elbow = Quaternion.FromAngleAxis(-0.2 * pi, new Vector3(1, 0, 0));
                this.SetOffset('left_shoulder', 0.6 * adaptArmsToOpp_influence, shoulder.GetNormalized());
                this.SetOffset('left_elbow', 0.8 * adaptArmsToOpp_influence, elbow.GetNormalized());

              }
            }
          }

        }

      }

      else if (this.currentAnim.touchFrame !== -1) {

        if (adaptLegToTouchPos) {

          // dynamic legs so we can reach the ball

          const smoothFrames = 0;

          const bodypart = this.currentAnim.anim.GetVariable('touch_bodypart');
          let leftOrRightLeg = 0; // -1 == left, 1 == right
          if (bodypart.includes('left_foot') || bodypart.includes('left_leg')) leftOrRightLeg = -1;
          if (bodypart.includes('right_foot') || bodypart.includes('right_leg')) leftOrRightLeg = 1;

          if (leftOrRightLeg !== 0) { // wrong bodypart? don't do anything

            const influenceFrames = 8;
            const frameFactor = curve(NormalizedClamp(influenceFrames - Math.abs(this.currentAnim.frameNum - (this.currentAnim.touchFrame - smoothFrames)), 0.0, influenceFrames), 0.5);
            const neededFactor = 1.0;

            let hipJointPos: Vector3;
            if (leftOrRightLeg === -1) hipJointPos = this.nodeMap.get('left_thigh')!.GetDerivedPosition();
            else hipJointPos = this.nodeMap.get('right_thigh')!.GetDerivedPosition();

            const bodyOrientationRel = this.nodeMap.get('body')!.GetRotation();

            const bodyAngle = -this.spatialState.angle - this.spatialState.relBodyAngleNonquantized;
            let autoTouchOffsetRel = this.currentAnim.touchPos.Sub(hipJointPos);
            autoTouchOffsetRel = autoTouchOffsetRel.GetRotated2D(bodyAngle);

            // make this position shift dynamically, making it relative to the body instead of it being a static world position
            const bodyPosTouch = this.currentAnim.positions[this.currentAnim.touchFrame - smoothFrames];
            const bodyPosNow = this.currentAnim.positions[this.currentAnim.frameNum];
            autoTouchOffsetRel = autoTouchOffsetRel.Sub(bodyPosTouch.Sub(bodyPosNow).GetRotated2D(bodyAngle));

            // if ball is further away, stretch more. if close, bend knee and such
            const bendAngle = (1.0 - NormalizedClamp(autoTouchOffsetRel.GetLength(), 0.5, 1.0)) * 0.34 * pi;

            const insideFactor = 0.4; // todo: make var in anim? or autodetect, maybe?
            const hipTwist = Quaternion.FromAngleAxis(0.5 * pi, new Vector3(0, 0, -leftOrRightLeg * insideFactor));
            let defaultHipOrientation = Quaternion.FromAngleAxis(-0.03 * pi - bendAngle, new Vector3(1, 0, 0));
            defaultHipOrientation = hipTwist.Mul(defaultHipOrientation);
            const defaultKneeOrientation = Quaternion.FromAngleAxis(0.1 * pi + bendAngle * 2.2, new Vector3(1, 0, 0));
            const defaultAnkleOrientation = Quaternion.FromAngleAxis(0.4 * pi - bendAngle * 1.2, new Vector3(1, 0, 0));

            // calculate the desired forward/backward swing angle of the leg
            // first, convert z, y into y, x coords, so we can use Vector3's 2D functions
            const zy = new Vector3(autoTouchOffsetRel.coords[2], autoTouchOffsetRel.coords[1], 0.0);
            const angle_X = zy.GetAngle2D(new Vector3(-1, 0, 0));

            // now decide on the sideways sway angle
            const zx = new Vector3(autoTouchOffsetRel.coords[2], autoTouchOffsetRel.coords[0], 0.0);
            const angle_Y = zx.GetAngle2D(new Vector3(-1, 0, 0));

            // create rotation quaternions
            const sway_X = Quaternion.FromAngleAxis(angle_X, new Vector3(-1, 0, 0));
            const sway_Y = Quaternion.FromAngleAxis(angle_Y, new Vector3(0, 1, 0));

            // use em!
            defaultHipOrientation = sway_X.Mul(defaultHipOrientation).GetNormalized();
            defaultHipOrientation = sway_Y.Mul(defaultHipOrientation).GetNormalized();

            // overcorrect Z so we can rotate with the inverse of the body quaternion afterwards
            const quatZ = Quaternion.FromAngleAxis(bodyAngle, new Vector3(0, 0, -1));
            defaultHipOrientation = quatZ.Mul(defaultHipOrientation).GetNormalized();

            // finally, correct for body movements
            defaultHipOrientation = bodyOrientationRel.GetInverse().Mul(defaultHipOrientation).GetNormalized();

            // todo: if too far out of range, don't use (for 180 degree bugs and such)

            const bias = frameFactor * neededFactor * adaptLegToTouchPos_influence;
            if (leftOrRightLeg === -1) {
              this.SetOffset('left_thigh', bias, defaultHipOrientation);
              this.SetOffset('left_knee', bias, defaultKneeOrientation);
              this.SetOffset('left_ankle', bias, defaultAnkleOrientation);
            } else {
              this.SetOffset('right_thigh', bias, defaultHipOrientation);
              this.SetOffset('right_knee', bias, defaultKneeOrientation);
              this.SetOffset('right_ankle', bias, defaultAnkleOrientation);
            }

          }

        }

      }

    }

  }

  SelectRetainAnim(): void {
    const query = new CrudeSelectionQuery();
    query.byFunctionType = true;
    query.functionType = e_FunctionType.e_FunctionType_Movement;
    query.byIncomingVelocity = true;
    query.incomingVelocity = e_Velocity.e_Velocity_Idle;
    query.byOutgoingVelocity = true;
    query.outgoingVelocity = e_Velocity.e_Velocity_Idle;
    query.properties.Set('incoming_retain_state', 'right_elbow');
    query.properties.Set('outgoing_retain_state', 'right_elbow');

    const dataSet: DataSet = [];
    this.anims.CrudeSelection(dataSet, query);

    assert(dataSet.length !== 0);

    StableSortDataSet(dataSet, (a, b) => this.CompareMovementSimilarity(a, b));

    this.startAngle = FixAngle(new Vector3(0).Sub(this.startPos).GetAngle2D()); //0.5 * pi; (facing right)

    // PORT: fresh array instead of clear() (the old array may be shared, e.g. with the anim position cache)
    this.currentAnim.positions = [];
    this.currentAnim.anim = this.anims.GetAnim(dataSet[0]);
    this.currentAnim.id = dataSet[0];
    this.currentAnim.frameNum = 0;
    this.currentAnim.touchFrame = -1;
    this.currentAnim.fullActionSmuggle = new Vector3(0);
    this.currentAnim.actionSmuggle = new Vector3(0);
    this.currentAnim.actionSmuggleOffset = new Vector3(0);
    this.currentAnim.actionSmuggleSustain = new Vector3(0);
    this.currentAnim.actionSmuggleSustainOffset = new Vector3(0);
    this.currentAnim.movementSmuggle = new Vector3(0);
    this.currentAnim.movementSmuggleOffset = new Vector3(0);
    this.currentAnim.rotationSmuggle.begin = 0;
    this.currentAnim.rotationSmuggle.end = 0;
    this.currentAnim.rotationSmuggleOffset = 0;
    this.currentAnim.functionType = e_FunctionType.e_FunctionType_Movement;

    this.animApplyBuffer.anim = this.currentAnim.anim;
    this.animApplyBuffer.smooth = false;
    this.animApplyBuffer.position = this.startPos;
    this.animApplyBuffer.orientation = this.startAngle;
    this.animApplyBuffer.offsets = new Map(); // (C++ offsets.clear())
    this.buf_animApplyBuffer = this.animApplyBuffer.Clone();

    this.match.SetBallRetainer(this.CastPlayer());
  }

  override ResetSituation(focusPos: Vector3): void {
    super.ResetSituation(focusPos);
  }

  protected GetHasteFactor(considerOpponentProximity = true): number {
    let haste = 0.0;

    const mentalImage = this.currentMentalImage!;
    const playerMovementInfluence = 0.5; // because a player is quite moveable, take it less seriously
    const playerBallDistanceNow = mentalImage.GetBallPrediction(50).Get2D()
      .Sub(this.spatialState.position.Add(this.spatialState.movement.Mul(0.05).Mul(playerMovementInfluence))).GetLength();
    const playerBallDistanceFuture = mentalImage.GetBallPrediction(500).Get2D()
      .Sub(this.spatialState.position.Add(this.spatialState.movement.Mul(0.5).Mul(playerMovementInfluence))).GetLength();

    haste = NormalizedClamp(playerBallDistanceFuture - playerBallDistanceNow, 0.0, 1.0);

    if (haste <= 1.0 && considerOpponentProximity) {
      if (this.team.GetTeamPossessionAmount() < 2.0) haste += 1.0 - this.team.GetTeamPossessionAmount() * 0.5;
    }

    return clamp(haste, 0.0, 1.0);
  }

  /** returns false on no applicable anim found */
  protected override SelectAnim(command: PlayerCommand, localInterruptAnim: e_InterruptAnim, preferPassAndShot = false): boolean {
    assert(command.desiredDirection.coords[2] === 0.0);

    const match = this.match;
    const mentalImage = this.currentMentalImage!;
    const desiredFunctionType = command.desiredFunctionType;


    // optimizations

    if (desiredFunctionType !== e_FunctionType.e_FunctionType_Movement &&
        desiredFunctionType !== e_FunctionType.e_FunctionType_Trip &&
        desiredFunctionType !== e_FunctionType.e_FunctionType_Special &&
        desiredFunctionType !== e_FunctionType.e_FunctionType_Sliding) {
      if (mentalImage.GetBallPrediction(200).Get2D().Sub(this.spatialState.position).GetLength() > ballDistanceOptimizeThreshold) {
        return false;
      }
      const touchBallPrediction = mentalImage.GetBallPrediction(defaultTouchOffset_ms).Get2D();
      if (touchBallPrediction.Sub(this.spatialState.position).GetLength() > 2.0 &&
          touchBallPrediction.Sub(this.player.GetPosition().Add(this.player.GetMovement().Mul(defaultTouchOffset_ms * 0.001))).GetLength() >
          mentalImage.GetBallPrediction(0).Get2D().Sub(this.player.GetPosition()).GetLength()) { // ball moving away from player
        return false;
      }
    }

    // this stops these anims from happening when opp has touched the ball, deflecting the ball too far away
    if (desiredFunctionType !== e_FunctionType.e_FunctionType_Movement &&
        desiredFunctionType !== e_FunctionType.e_FunctionType_Trip &&
        desiredFunctionType !== e_FunctionType.e_FunctionType_Special &&
        desiredFunctionType !== e_FunctionType.e_FunctionType_Sliding &&
        desiredFunctionType !== e_FunctionType.e_FunctionType_Deflect && match.GetBallRetainer() !== this.player) {
      if (mentalImage.GetBallPrediction(1000).Sub(match.GetBall().Predict(1000)).GetLength() > 2.0) return false;
    }

    // /optimizations


    if (localInterruptAnim === e_InterruptAnim.e_InterruptAnim_ReQueue) {

      const focusDistance = match.GetDesignatedPossessionPlayer()!.GetPosition().Sub(this.spatialState.position).GetLength();

      const currentFunctionType = this.currentAnim.functionType;
      const currentFrameNum = this.currentAnim.frameNum;
      const currentTouchFrame = this.currentAnim.touchFrame;

      if (currentFunctionType !== e_FunctionType.e_FunctionType_Movement && desiredFunctionType === e_FunctionType.e_FunctionType_Movement) return false;
      if (currentFunctionType === e_FunctionType.e_FunctionType_Movement && desiredFunctionType === e_FunctionType.e_FunctionType_Movement && (this.CastPlayer().HasPossession() || focusDistance > 12.0)) return false;
      if (currentFunctionType === e_FunctionType.e_FunctionType_Movement && desiredFunctionType === e_FunctionType.e_FunctionType_Movement && currentFrameNum + minRemainingMovementReQueueFrames > this.currentAnim.anim.GetEffectiveFrameCount()) return false;
      if (currentFunctionType === e_FunctionType.e_FunctionType_Movement && desiredFunctionType === e_FunctionType.e_FunctionType_Movement && (!allowMovementReQueue || this.reQueueDelayFrames > 0)) return false;
      if (currentFunctionType === e_FunctionType.e_FunctionType_BallControl && desiredFunctionType === e_FunctionType.e_FunctionType_BallControl && (!allowBallControlReQueue || currentFrameNum > maxBallControlReQueueFrame || this.reQueueDelayFrames > 0)) return false;
      if (currentFunctionType === e_FunctionType.e_FunctionType_BallControl && desiredFunctionType === e_FunctionType.e_FunctionType_Trap) return false;
      if (currentFunctionType === e_FunctionType.e_FunctionType_Trap && desiredFunctionType === e_FunctionType.e_FunctionType_Trap && (!allowTrapReQueue || currentFrameNum + minRemainingTrapReQueueFrames > currentTouchFrame || this.reQueueDelayFrames > 0)) return false;
      if (currentFunctionType === e_FunctionType.e_FunctionType_Trap && desiredFunctionType === e_FunctionType.e_FunctionType_BallControl && (!allowTrapReQueue || currentFrameNum + minRemainingTrapReQueueFrames > currentTouchFrame || this.reQueueDelayFrames > 0)) return false;

      const desiredMovement = command.desiredDirection.Mul(command.desiredVelocityFloat);

      // too similar to what we are already trying to accomplish
      const originatingCommand = this.currentAnim.originatingCommand;
      if (originatingCommand.desiredFunctionType === desiredFunctionType &&
          originatingCommand.desiredDirection.Mul(originatingCommand.desiredVelocityFloat).Sub(desiredMovement).GetLength() < 1.5) {
        return false;
      }

      // requeue not needed?
      if ((currentFunctionType === e_FunctionType.e_FunctionType_Movement && desiredFunctionType === e_FunctionType.e_FunctionType_Movement) ||
          (currentFunctionType === e_FunctionType.e_FunctionType_BallControl && desiredFunctionType === e_FunctionType.e_FunctionType_BallControl) ||
          (currentFunctionType === e_FunctionType.e_FunctionType_Trap && desiredFunctionType === e_FunctionType.e_FunctionType_BallControl) ||
          (currentFunctionType === e_FunctionType.e_FunctionType_Trap && desiredFunctionType === e_FunctionType.e_FunctionType_Trap)) {

        // current change in momentum
        const plannedMomentumChange = this.currentAnim.outgoingMovement.Sub(this.currentAnim.incomingMovement);
        const desiredMomentumChange = desiredMovement.Sub(this.spatialState.movement);

        if ((desiredMomentumChange.GetDotProduct(plannedMomentumChange) > 0.0 && desiredMomentumChange.GetDistance(plannedMomentumChange) < 4.0) ||
            desiredMomentumChange.GetDotProduct(plannedMomentumChange) > 0.8 || desiredMomentumChange.GetDistance(plannedMomentumChange) < 2.0) {
          return false;
        }

      }

      // don't requeue movement to ballcontrol halfway movement anims, unless there's a serious change of movement desired
      const player = this.CastPlayer();
      if (currentFunctionType === e_FunctionType.e_FunctionType_Movement && desiredFunctionType === e_FunctionType.e_FunctionType_BallControl &&
          (match.GetActualTime_ms() - player.GetLastTouchTime_ms() < 600 && player.GetLastTouchType() === e_TouchType.e_TouchType_Intentional_Kicked) && player.HasPossession()) {
        const desiredMovementChange = this.spatialState.movement.Sub(desiredMovement).GetLength();
        if (desiredMovementChange < 1.0) return false;
      }

    }

    if (localInterruptAnim !== e_InterruptAnim.e_InterruptAnim_ReQueue || this.currentAnim.frameNum > 12) this.CalculateFactualSpatialState();

    assert(command.desiredLookAt.coords[2] === 0.0);


    // CREATE A CRUDE SET OF POTENTIAL ANIMATIONS

    const query = new CrudeSelectionQuery();

    query.byFunctionType = true;
    query.functionType = desiredFunctionType;

    query.byFoot = false;
    query.foot = this.spatialState.foot === e_Foot.e_Foot_Left ? e_Foot.e_Foot_Right : e_Foot.e_Foot_Left;

    // hax: long pass uses same anims as short pass
    if (query.functionType === e_FunctionType.e_FunctionType_LongPass) query.functionType = e_FunctionType.e_FunctionType_ShortPass;

    if (command.touchInfo.desiredPower !== 0.0) {
      query.byOutgoingBallDirection = true;
      query.outgoingBallDirection = command.touchInfo.desiredDirection.GetRotated2D(-this.spatialState.angle);
    }

    query.byIncomingVelocity = true;
    query.incomingVelocity = this.spatialState.enumVelocity;

    const queryFunctionType = query.functionType as e_FunctionType; // (cast: keeps the original's redundant LongPass check type-correct)

    if (queryFunctionType !== e_FunctionType.e_FunctionType_Movement && query.incomingVelocity === e_Velocity.e_Velocity_Dribble) query.incomingVelocity = e_Velocity.e_Velocity_Walk;

    query.incomingVelocity_Strict = false;
    if (queryFunctionType !== e_FunctionType.e_FunctionType_Movement && queryFunctionType !== e_FunctionType.e_FunctionType_BallControl) {
      query.incomingVelocity_ForceLinearity = false;
      if (queryFunctionType !== e_FunctionType.e_FunctionType_Deflect) {
        query.incomingVelocity_NoDribbleToSprint = true;
        if (queryFunctionType !== e_FunctionType.e_FunctionType_ShortPass && queryFunctionType !== e_FunctionType.e_FunctionType_LongPass &&
            queryFunctionType !== e_FunctionType.e_FunctionType_HighPass && queryFunctionType !== e_FunctionType.e_FunctionType_Shot) {
          query.incomingVelocity_ForceLinearity = true;
          query.incomingVelocity_NoDribbleToIdle = true;
        } else { // passes and such
          query.incomingVelocity_ForceLinearity = false;
          query.incomingVelocity_NoDribbleToIdle = false;
        }
      } else { // deflect
        query.incomingVelocity_NoDribbleToSprint = false;
        query.incomingVelocity_NoDribbleToIdle = false;
      }
    } else {
      query.incomingVelocity_Strict = true;
    }

    query.byIncomingBodyDirection = true;

    query.incomingBodyDirection = this.spatialState.relBodyDirectionVec;
    if (queryFunctionType !== e_FunctionType.e_FunctionType_Movement) {
      query.incomingBodyDirection_Strict = false;
      if (queryFunctionType !== e_FunctionType.e_FunctionType_Deflect) {
        if (queryFunctionType !== e_FunctionType.e_FunctionType_BallControl) {
          query.incomingBodyDirection_ForceLinearity = true;
        } else {
          query.incomingBodyDirection_ForceLinearity = false; // new, we want to be able to use ballcontrol anims as trap more often to stop ball from rolling past us
        }
      } else { // deflect
        query.incomingBodyDirection_ForceLinearity = false;
      }
    } else {
      query.incomingBodyDirection_Strict = true;
    }

    const currentOutgoingSpecialState = this.currentAnim.anim.GetVariable('outgoing_special_state');

    query.bySide = false;
    if (command.useDesiredLookAt && currentOutgoingSpecialState === '' && match.GetBallRetainer() !== this.CastPlayer()) {
      const playerLookAtVec = command.desiredLookAt.Sub(this.spatialState.position).GetNormalized(this.spatialState.directionVec);
      query.lookAtVecRel = playerLookAtVec.GetRotated2D(-this.spatialState.angle);
      query.bySide = true;
    }

    if (command.onlyDeflectAnimsThatPickupBall === true) {
      query.byPickupBall = true;
      query.pickupBall = true;
    }

    if (desiredFunctionType === e_FunctionType.e_FunctionType_Trap ||
        desiredFunctionType === e_FunctionType.e_FunctionType_Interfere ||
        desiredFunctionType === e_FunctionType.e_FunctionType_Deflect) {
      query.byIncomingBallDirection = true;
      query.incomingBallDirection = mentalImage.GetBallPrediction(180).Sub(mentalImage.GetBallPrediction(120)).GetRotated2D(-this.spatialState.angle).GetNormalized(new Vector3(0)); // todo: proper prediction time
    }

    if (this.CastPlayer().AllowLastDitch()) {
      query.allowLastDitchAnims = true;
    } else {
      query.allowLastDitchAnims = false;
    }

    if (desiredFunctionType === e_FunctionType.e_FunctionType_Trip) {
      query.byTripType = true;
      query.tripType = command.tripType;
    }

    query.properties.Set('incoming_special_state', currentOutgoingSpecialState);
    if (match.GetBallRetainer() === this.player) query.properties.Set('incoming_retain_state', this.currentAnim.anim.GetVariable('outgoing_retain_state'));
    if (command.useSpecialVar1) query.properties.Set('specialvar1', command.specialVar1);
    if (command.useSpecialVar2) query.properties.Set('specialvar2', command.specialVar2);

    if (currentOutgoingSpecialState !== '') query.incomingVelocity = e_Velocity.e_Velocity_Idle; // standing up anims always start out idle

    const dataSet: DataSet = [];
    this.anims.CrudeSelection(dataSet, query);
    if (dataSet.length === 0) {
      if (desiredFunctionType === e_FunctionType.e_FunctionType_Movement) {
        dataSet.push(this.GetIdleMovementAnimID()); // do with idle anim (should not happen too often, only after weird bumps when there's for example a need for a sprint anim at an impossible body angle, after a trip of whatever)
      } else return false;
    }

    if (command.useDesiredMovement) {

      const relDesiredDirection = command.desiredDirection.GetRotated2D(-this.spatialState.angle);
      const desiredAnimationVelocityFloat = command.desiredVelocityFloat;

      this.SetMovementSimilarityPredicate(relDesiredDirection, FloatToEnumVelocity(desiredAnimationVelocityFloat));
      this.SetBodyDirectionSimilarityPredicate(command.desiredLookAt);

      if (this.player.GetDebug() && spatialDebugPilons && desiredFunctionType !== e_FunctionType.e_FunctionType_Movement) {
        SetRedDebugPilon(this.spatialState.position.Add(command.desiredDirection.Mul(0.55 + command.desiredVelocityFloat * 0.5)));
      }

      if (desiredFunctionType === e_FunctionType.e_FunctionType_Movement) {
        // now strict-select from the remainder
        this._KeepBestDirectionAnims(dataSet, command, true);
        if (command.useDesiredLookAt) this._KeepBestBodyDirectionAnims(dataSet, command, true);

        if (this.player.GetDebug() && spatialDebugPilons) {
          if (command.useDesiredLookAt) SetYellowDebugPilon(command.desiredLookAt); else SetYellowDebugPilon(new Vector3(0, 0, -10));
          SetBlueDebugPilon(this.spatialState.position.Add(command.desiredDirection.Mul(0.6 + command.desiredVelocityFloat * 0.5)));
        }
      }

      else if (desiredFunctionType === e_FunctionType.e_FunctionType_BallControl) {
        let strict = true;
        if (this.CastPlayer().AllowLastDitch()) {
          strict = false;
        }
        const allowedBaseAngle = 0.0 * pi;
        const allowedVelocitySteps = 0; // last ditch anims are always allowed > 0 velocity steps, as long as strict is false
        if (command.useDesiredLookAt) this._KeepBestBodyDirectionAnims(dataSet, command, strict, allowedBaseAngle); // needed for idle outgoing velo, probably
        this._KeepBestDirectionAnims(dataSet, command, strict, allowedBaseAngle, allowedVelocitySteps);
      }

      else if (desiredFunctionType === e_FunctionType.e_FunctionType_Trap) {
        let strict = true;
        if (this.CastPlayer().AllowLastDitch(false) || this._HighOrBouncyBall()) strict = false;
        const allowedBaseAngle = 0.3 * pi;
        const allowedVelocitySteps = 2;
        const bestBallControlQuadrantID = -1;
        this._KeepBestDirectionAnims(dataSet, command, strict, allowedBaseAngle, allowedVelocitySteps, bestBallControlQuadrantID);
        if (command.useDesiredLookAt) this._KeepBestBodyDirectionAnims(dataSet, command, strict, allowedBaseAngle);

        // when too unlike command's desired movement, just don't go for it (and hope for another ballcontrol/trap anim to save us later on)
        if (!this._HighOrBouncyBall() && query.allowLastDitchAnims === false) {
          assert(dataSet.length !== 0);
          const desiredMovement = command.desiredDirection.Mul(command.desiredVelocityFloat);
          const bestWeGot = this.anims.GetAnim(dataSet[0]);
          const bestWeGotMovement = bestWeGot.GetOutgoingMovement().GetRotated2D(this.spatialState.angle);
          const currentDesiredDot = command.desiredDirection.GetDotProduct(this.spatialState.directionVec);

          let allowAnim = true;

          const angleDiff = Math.abs(bestWeGot.GetOutgoingDirection().GetRotated2D(this.spatialState.angle).GetAngle2D(command.desiredDirection));
          if (angleDiff > 0.375 * pi) { // so we accept at least either 000 or 135 deg anims, which are two common anim types that are often available
            allowAnim = false;
          }

          const desiredBestDiff = bestWeGotMovement.Sub(desiredMovement);
          if ((desiredBestDiff.GetLength() > walkVelocity + 0.5 && currentDesiredDot > 0.0) ||
              (desiredBestDiff.GetLength() > sprintVelocity + 0.5 && currentDesiredDot <= 0.0)) { // + margin
            allowAnim = false;
          }

          if (!allowAnim) {
            return false;
          }

        }

      }

      else if (desiredFunctionType === e_FunctionType.e_FunctionType_Interfere) {
        let strict = false;
        const allowedAngle = 0.3 * pi;
        const allowedVelocitySteps = 1;
        if (command.strictMovement === e_StrictMovement.e_StrictMovement_True) strict = true;

        this._KeepBestDirectionAnims(dataSet, command, strict, allowedAngle, allowedVelocitySteps);
        if (command.useDesiredLookAt) this._KeepBestBodyDirectionAnims(dataSet, command, strict, allowedAngle);
      }

    }

    this.SetNumericVariableSimilarityPredicate('priority', 0);
    StableSortDataSet(dataSet, (a, b) => this.CompareNumericVariable(a, b));

    let desiredIdleLevel = 0;
    if (!match.IsInPlay()) desiredIdleLevel = 2;
    if (match.IsInSetPiece()) desiredIdleLevel = 1;
    else if (match.GetBall().Predict(200).Sub(this.spatialState.position).GetLength() > 16.0) desiredIdleLevel = 1;
    this.SetNumericVariableSimilarityPredicate('idlelevel', desiredIdleLevel);
    StableSortDataSet(dataSet, (a, b) => this.CompareNumericVariable(a, b));

    this.SetFootSimilarityPredicate(this.spatialState.foot);
    StableSortDataSet(dataSet, (a, b) => this.CompareFootSimilarity(a, b));

    if (desiredFunctionType !== e_FunctionType.e_FunctionType_BallControl) {
      this.SetIncomingBodyDirectionSimilarityPredicate(this.spatialState.relBodyDirectionVec);
      StableSortDataSet(dataSet, (a, b) => this.CompareIncomingBodyDirectionSimilarity(a, b));
    }

    // moved down
    this.SetIncomingVelocitySimilarityPredicate(this.spatialState.enumVelocity);
    StableSortDataSet(dataSet, (a, b) => this.CompareIncomingVelocitySimilarity(a, b));

    // OLD METHOD
    if (command.useDesiredTripDirection) {
      const relDesiredTripDirection = command.desiredTripDirection.GetRotated2D(-this.spatialState.angle);
      this.SetTripDirectionSimilarityPredicate(relDesiredTripDirection);
      StableSortDataSet(dataSet, (a, b) => this.CompareTripDirectionSimilarity(a, b));
    }

    // OLD METHOD
    if (desiredFunctionType !== e_FunctionType.e_FunctionType_Movement) {
      StableSortDataSet(dataSet, (a, b) => this.CompareBaseanimSimilarity(a, b));
    }

    if (desiredFunctionType === e_FunctionType.e_FunctionType_Deflect) {
      StableSortDataSet(dataSet, (a, b) => this.CompareCatchOrDeflect(a, b));
    }

    let selectedAnimID = -1;
    const positions_tmp: Vector3[] = [];
    let touchFrame_tmp = -1;
    let radiusOffset_tmp = 0.0;
    let touchPos_tmp = new Vector3(0);
    let fullActionSmuggle_tmp = new Vector3(0);
    let actionSmuggle_tmp = new Vector3(0);
    let rotationSmuggle_tmp: radian = 0;

    if (dataSet.length === 0 && desiredFunctionType === e_FunctionType.e_FunctionType_Movement) {
      dataSet.push(this.GetIdleMovementAnimID()); // do with idle anim (should not happen too often, only after weird bumps when there's for example a need for a sprint anim at an impossible body angle, after a trip of whatever)
    }

    let desiredBodyDirectionRel = new Vector3(0, -1, 0);
    if (command.useDesiredLookAt) {
      desiredBodyDirectionRel = command.desiredLookAt.Sub(this.spatialState.position.Add(this.spatialState.movement.Mul(0.1)))
        .GetNormalized(new Vector3(0, -1, 0)).GetRotated2D(-this.spatialState.angle); // todo: this is a hax, fix that
    }

    if (desiredFunctionType === e_FunctionType.e_FunctionType_Movement ||
        desiredFunctionType === e_FunctionType.e_FunctionType_Trip ||
        desiredFunctionType === e_FunctionType.e_FunctionType_Special) {

      selectedAnimID = dataSet[0];
      const nextAnim = this.anims.GetAnim(selectedAnimID);
      const desiredMovement = command.desiredDirection.Mul(command.desiredVelocityFloat);
      if (command.desiredDirection.coords[2] !== 0.0) {
        console.debug(`desiredDirection: ${command.desiredDirection.toString()}, functiontype ${command.desiredFunctionType}`);
      }
      assert(desiredMovement.coords[2] === 0.0);
      rotationSmuggle_tmp = this.CalculatePhysicsVector(nextAnim, command.useDesiredMovement, desiredMovement, command.useDesiredLookAt, desiredBodyDirectionRel, positions_tmp).rotationOffset_ret;
    }
    else if (desiredFunctionType === e_FunctionType.e_FunctionType_BallControl) {
      if (this.NeedTouch(dataSet[0], command)) {
        const hasteFactor = this.GetHasteFactor(false);
        const best = this.GetBestCheatableAnimID(dataSet, command.useDesiredMovement, command.desiredDirection, command.desiredVelocityFloat, command.useDesiredLookAt, desiredBodyDirectionRel, positions_tmp, hasteFactor, localInterruptAnim, preferPassAndShot);
        selectedAnimID = best.result;
        touchFrame_tmp = best.animTouchFrame_ret;
        radiusOffset_tmp = best.radiusOffset_ret;
        touchPos_tmp = best.touchPos_ret;
        fullActionSmuggle_tmp = best.fullActionSmuggle_ret;
        actionSmuggle_tmp = best.actionSmuggle_ret;
        rotationSmuggle_tmp = best.rotationSmuggle_ret;
      }
    }
    else if (desiredFunctionType === e_FunctionType.e_FunctionType_Trap ||
             desiredFunctionType === e_FunctionType.e_FunctionType_Interfere ||
             desiredFunctionType === e_FunctionType.e_FunctionType_Deflect) {
      const hasteFactor = this.GetHasteFactor(false);
      const best = this.GetBestCheatableAnimID(dataSet, command.useDesiredMovement, command.desiredDirection, command.desiredVelocityFloat, command.useDesiredLookAt, desiredBodyDirectionRel, positions_tmp, hasteFactor, localInterruptAnim, preferPassAndShot);
      selectedAnimID = best.result;
      touchFrame_tmp = best.animTouchFrame_ret;
      radiusOffset_tmp = best.radiusOffset_ret;
      touchPos_tmp = best.touchPos_ret;
      fullActionSmuggle_tmp = best.fullActionSmuggle_ret;
      actionSmuggle_tmp = best.actionSmuggle_ret;
      rotationSmuggle_tmp = best.rotationSmuggle_ret;
    }
    else if (desiredFunctionType === e_FunctionType.e_FunctionType_ShortPass ||
             desiredFunctionType === e_FunctionType.e_FunctionType_LongPass ||
             desiredFunctionType === e_FunctionType.e_FunctionType_HighPass ||
             desiredFunctionType === e_FunctionType.e_FunctionType_Shot) {
      const hasteFactor = this.GetHasteFactor(false);
      const best = this.GetBestCheatableAnimID(dataSet, command.useDesiredMovement, command.desiredDirection, command.desiredVelocityFloat, command.useDesiredLookAt, desiredBodyDirectionRel, positions_tmp, hasteFactor, localInterruptAnim);
      selectedAnimID = best.result;
      touchFrame_tmp = best.animTouchFrame_ret;
      radiusOffset_tmp = best.radiusOffset_ret;
      touchPos_tmp = best.touchPos_ret;
      fullActionSmuggle_tmp = best.fullActionSmuggle_ret;
      actionSmuggle_tmp = best.actionSmuggle_ret;
      rotationSmuggle_tmp = best.rotationSmuggle_ret;
    }
    else if (desiredFunctionType === e_FunctionType.e_FunctionType_Sliding) {
      const hasteFactor = this.GetHasteFactor(false);
      const best = this.GetBestCheatableAnimID(dataSet, command.useDesiredMovement, command.desiredDirection, command.desiredVelocityFloat, command.useDesiredLookAt, desiredBodyDirectionRel, positions_tmp, hasteFactor, localInterruptAnim);
      selectedAnimID = best.result;
      touchFrame_tmp = best.animTouchFrame_ret;
      radiusOffset_tmp = best.radiusOffset_ret;
      touchPos_tmp = best.touchPos_ret;
      fullActionSmuggle_tmp = best.fullActionSmuggle_ret;
      actionSmuggle_tmp = best.actionSmuggle_ret;
      rotationSmuggle_tmp = best.rotationSmuggle_ret;
      if (selectedAnimID === -1) {
        if (dataSet.length > 0) {
          selectedAnimID = dataSet[0];
          const nextAnim = this.anims.GetAnim(selectedAnimID);
          const desiredMovement = command.desiredDirection.Mul(command.desiredVelocityFloat);
          assert(desiredMovement.coords[2] === 0.0);
          rotationSmuggle_tmp = this.CalculatePhysicsVector(nextAnim, command.useDesiredMovement, desiredMovement, command.useDesiredLookAt, desiredBodyDirectionRel, positions_tmp).rotationOffset_ret;
        }
      }
    }


    // check if we really want to requeue; if the anim we dug up is actually better than the current

    if (localInterruptAnim === e_InterruptAnim.e_InterruptAnim_ReQueue && selectedAnimID !== -1 && this.currentAnim.positions.length > 1 && positions_tmp.length > 1) {

      const selectedAnim = this.anims.GetAnim(selectedAnimID);
      const currentOutgoingVelocity = FloatToEnumVelocity(this.currentAnim.anim.GetOutgoingVelocity());

      // don't requeue to same quadrant
      if (this.currentAnim.functionType === desiredFunctionType &&

          ((currentOutgoingVelocity !== e_Velocity.e_Velocity_Idle &&
            this.currentAnim.anim.GetVariable('quadrant_id') === selectedAnim.GetVariable('quadrant_id'))
            ||
           ((currentOutgoingVelocity === e_Velocity.e_Velocity_Idle && FloatToEnumVelocity(selectedAnim.GetOutgoingVelocity()) === e_Velocity.e_Velocity_Idle) &&
            Math.abs(this.ForceIntoPreferredDirectionAngle(this.currentAnim.anim.GetOutgoingAngle()) - this.ForceIntoPreferredDirectionAngle(selectedAnim.GetOutgoingAngle())) < 0.06 * pi))
         ) {

        selectedAnimID = -1;
      }
    }


    // make it so

    if (selectedAnimID !== -1) {

      this.previousAnim.CopyFrom(this.currentAnim); // C++ *previousAnim = *currentAnim;

      const currentAnim = this.currentAnim;
      currentAnim.anim = this.anims.GetAnim(selectedAnimID);
      currentAnim.id = selectedAnimID;
      currentAnim.functionType = desiredFunctionType; //StringToFunctionType(currentAnim->anim->GetVariable("type"));
      currentAnim.frameNum = 0;
      currentAnim.touchFrame = touchFrame_tmp;
      currentAnim.originatingInterrupt = localInterruptAnim;
      currentAnim.radiusOffset = radiusOffset_tmp;
      currentAnim.touchPos = touchPos_tmp;
      const maxRotationSmoothingAngle = bodyRotationSmoothingMaxAngle * (currentAnim.functionType === e_FunctionType.e_FunctionType_Movement ? 1.0 : 0.5);
      currentAnim.rotationSmuggle.begin = clamp(
        ModulateIntoRange(-pi, pi, this.spatialState.relBodyAngleNonquantized - currentAnim.anim.GetIncomingBodyAngle()) * bodyRotationSmoothingFactor,
        -maxRotationSmoothingAngle,
        maxRotationSmoothingAngle,
      );
      currentAnim.rotationSmuggle.end = rotationSmuggle_tmp;
      currentAnim.rotationSmuggleOffset = 0;
      currentAnim.fullActionSmuggle = fullActionSmuggle_tmp;
      currentAnim.actionSmuggle = actionSmuggle_tmp;
      currentAnim.actionSmuggleOffset = new Vector3(0);
      currentAnim.actionSmuggleSustain = new Vector3(0); // calculated below
      currentAnim.actionSmuggleSustainOffset = new Vector3(0);
      currentAnim.movementSmuggle = new Vector3(0); // needs to be reset here, else the previous calc is used in upcoming 'calculatemovementsmuggle'
      currentAnim.movementSmuggleOffset = new Vector3(0);
      currentAnim.incomingMovement = this.spatialState.movement;
      currentAnim.outgoingMovement = this.CalculateOutgoingMovement(positions_tmp);
      currentAnim.positions = positions_tmp; // (C++ positions.assign(copy); positions_tmp is local, so no copy needed)
      currentAnim.positionOffset = new Vector3(0);
      currentAnim.originatingCommand = command.Clone();
      currentAnim.movementSmuggle = this.CalculateMovementSmuggle(command.desiredDirection, command.desiredVelocityFloat);
      currentAnim.movementSmuggleOffset = new Vector3(0);

      return true;
    }

    return false;
  }

  protected NeedTouch(animID: number, command: PlayerCommand): boolean {

    // when idle (and desiredvelo is idle as well), don't want to touch the ball every frame

    const anim = this.anims.GetAnim(animID);

    // PORT: faithful to the original's misplaced parenthesis, FloatToEnumVelocity(bool): the bool (0 or 1) always maps to
    // e_Velocity_Idle, so this check never returns
    if (FloatToEnumVelocity(anim.GetOutgoingVelocity() !== e_Velocity.e_Velocity_Idle ? 1 : 0) !== e_Velocity.e_Velocity_Idle) return true;
    if (command.desiredVelocityFloat > idleDribbleSwitch) return true;
    if (Math.abs(this.match.GetBall().GetMovement().GetLength()) > 2.0) return true;

    let animMovement = anim.GetOutgoingMovement().GetRotated2D(this.spatialState.angle).Mul(0.3).Add(this.spatialState.movement.Mul(0.7));
    // todo: fix this ugly and averagely functioning code :p
    const animVelo = animMovement.GetLength();
    animMovement = animMovement.GetNormalized(this.spatialState.directionVec);
    animMovement = animMovement.Mul(this.spatialState.movement.GetLength() * 0.8 + animVelo * 0.2);

    const mentalImage = this.currentMentalImage!;
    const ballMovement = mentalImage.GetBallPrediction(250).Get2D().Sub(mentalImage.GetBallPrediction(240).Get2D()).Mul(100);

    if (Math.abs(anim.GetOutgoingAngle()) > 0.125 * pi) return true;

    const distanceDeviation = animMovement.Sub(ballMovement).GetLength();
    if (distanceDeviation >= 2.0) return true;

    const velocityDeviation = animMovement.GetLength() - ballMovement.GetLength(); // negative == ball is faster
    if (velocityDeviation < -1.4 || velocityDeviation >= 0.7) return true;

    if (FloatToEnumVelocity(anim.GetOutgoingVelocity()) !== e_Velocity.e_Velocity_Idle) {
      const angleDeviation = animMovement.GetNormalized(this.spatialState.directionVec).GetDotProduct(ballMovement.GetNormalized(this.spatialState.directionVec));
      if (angleDeviation < 0.975) return true;
    }

    return false;
  }

  protected GetBodyBallDistanceAdvantage(
    anim: Animation,
    functionType: e_FunctionType,
    animTouchMovement: Vector3,
    touchMovement: Vector3,
    incomingMovement: Vector3,
    outgoingMovement: Vector3,
    outgoingAngle: radian,
    bodyPos: Vector3,
    FFO: Vector3,
    animBallPos2D: Vector3,
    actualBallPos2D: Vector3,
    ballMovement2D: Vector3,
    radiusFactor: number,
    radiusCheatDistance: number,
    decayPow: number,
    debug = false,
  ): number {

    assert(touchMovement.coords[2] === 0.0);
    assert(bodyPos.coords[2] === 0.0);

    const incomingVelocity = incomingMovement.GetLength();
    const outgoingVelocity = outgoingMovement.GetLength();
    const averageInOutVelocity = incomingMovement.Add(outgoingMovement).GetLength() * 0.5;

    const velocityChange = outgoingVelocity - incomingVelocity;
    const velocityChange_mps = velocityChange / (anim.GetFrameCount() * 0.01);


    const ffoBodyPos = bodyPos.Add(FFO.GetNormalized(0).Mul(0.1));
    const bodyAnimBallBonus = 1.0 - curve(NormalizedClamp(ffoBodyPos.Sub(animBallPos2D).GetLength(), 0.0, 0.7), 0.7); // less FFO feels better
    const bodyActualBallBonus = 1.0 - curve(NormalizedClamp(ffoBodyPos.Sub(actualBallPos2D).GetLength(), 0.0, 0.7), 0.4);
    const velocityBonus = 1.0 - NormalizedClamp(averageInOutVelocity, idleVelocity, sprintVelocity);
    const velocityChangeBonus = 1.0 - NormalizedClamp(velocityChange_mps / 20.0, -1.0, 1.0);


    let radius = radiusFactor;
    radius *= 1.0 +
              1.0 * bodyAnimBallBonus +
              0.6 * bodyActualBallBonus +
              0.8 * bodyAnimBallBonus * bodyActualBallBonus +
              0.0 * velocityChangeBonus +
              1.0 * velocityBonus;

    // more cheat for faster balls. rationale: with the current system, points in time are used as 'check if legal ball touch', while in reality, this is a continuum.
    // in other words, faster balls have an unrealistic disadvantage in this system. this tries to restore this balance. however; this widens the ball touch area, while
    // a better solution would be to actually somehow increase the number of checked points (or rather, to just check against the continuum instead of against points)

    const effectiveRadiusCheatDistance = radiusCheatDistance;

    let outgoingDirection: Vector3;
    if (FloatToEnumVelocity(outgoingMovement.GetLength()) === e_Velocity.e_Velocity_Idle) {
      outgoingDirection = up.GetRotated2D(outgoingAngle);
    } else {
      outgoingDirection = outgoingMovement.GetNormalized();
    }


    const behindVectorUnscaled = incomingMovement.Mul(0.1).Add(touchMovement.Mul(0.2)).Add(outgoingMovement.Mul(0.7)).Neg();
    let behindVector = behindVectorUnscaled.GetNormalized(0).Mul(Math.pow(NormalizedClamp(behindVectorUnscaled.GetLength(), 0, sprintVelocity), 0.5));

    // cornering with a more centered behindvector for 'richer' range
    let dot = up.GetDotProduct(outgoingDirection);
    dot = 0.5 + clamp(dot * 0.5 + 0.5, 0.0, 1.0) * 0.5;
    behindVector = behindVector.Mul(dot);

    let animToActualBall = actualBallPos2D.Sub(animBallPos2D);

    const deformArea = true;
    if (deformArea) {
      const straightAngleVectorUnscaled = incomingMovement;
      const straightAngleVector = straightAngleVectorUnscaled.GetNormalized(outgoingDirection);
      const toStraightAngle = up.GetAngle2D(straightAngleVector);

      // rotate animball to actualball vec into outgoing direction so we can do funky stuff with it
      animToActualBall = animToActualBall.GetRotated2D(toStraightAngle);

      // cheating to the side (lateral) (as seen from the outgoing direction vector) is harder at high velos (effectively changes cheat circle into ellipse)
      const lateralRadiusFactor = 0.6 - 0.3 * Math.pow(NormalizedClamp(straightAngleVectorUnscaled.GetLength(), idleVelocity, sprintVelocity), 0.7);
      animToActualBall = animToActualBall.WithCoord(0, animToActualBall.coords[0] / lateralRadiusFactor); // coords[0] is now the lateral component
      // make sure we stick with the same surface area (= pi * r ^ 2, so just take the sqrt of lateralradiusfactor, which is effectively a surface area multiplier)
      radius *= Math.pow(1.0 / lateralRadiusFactor, 0.5);

      // rotate back and act like nothing happened
      animToActualBall = animToActualBall.GetRotated2D(-toStraightAngle);
    }


    // do some magic

    const adaptedActualBallPos2D = animBallPos2D.Add(animToActualBall);

    const radiusCheatBehindBias = 0.6; // how much the radiuscheat heeds behindvec
    const behindCenter = animBallPos2D.Add(behindVector.Mul(radius + effectiveRadiusCheatDistance * radiusCheatBehindBias).Mul(cheatFactor));

    let result = 1.0;
    const allowedRadius = (radius + effectiveRadiusCheatDistance) * cheatFactor + cheatDistanceBonus;
    if (adaptedActualBallPos2D.GetDistance(behindCenter) > allowedRadius) {
      result = 0.0;
      this.stat_GetBodyBallDistanceAdvantage_RadiusDeny++;
    }

    if (debug && this.player.GetDebug() && anim.GetName().includes('180_decel.anim')) {
      const incomingDirectionRadius = incomingMovement.GetNormalized(outgoingDirection).Mul((radius + effectiveRadiusCheatDistance) * cheatFactor + cheatDistanceBonus);
      SetRedDebugPilon(this.spatialState.position.Add(behindCenter.Sub(incomingDirectionRadius).GetRotated2D(this.spatialState.angle)));
      SetYellowDebugPilon(this.spatialState.position.Add(behindCenter.Add(incomingDirectionRadius).GetRotated2D(this.spatialState.angle)));
      SetGreenDebugPilon(this.spatialState.position.Add(adaptedActualBallPos2D.GetRotated2D(this.spatialState.angle)));
    }

    return result;
  }

  /**
   * C++ signed int GetBestCheatableAnimID(..., std::vector<Vector3> &positions_ret, int &animTouchFrame_ret, float &radiusOffset_ret,
   * Vector3 &touchPos_ret, Vector3 &fullActionSmuggle_ret, Vector3 &actionSmuggle_ret, radian &rotationSmuggle_ret, float hasteFactor,
   * e_InterruptAnim localInterruptAnim, bool preferPassAndShot = false) const.
   * positions_ret is filled in place. The C++ function only wrote the other out-params when an anim was found (and skipped
   * rotationSmuggle_ret when someone else retains the ball); in those cases the returned fields hold the values the (only)
   * caller initialized them with: -1, 0, Vector3(0), Vector3(0), Vector3(0), 0.
   */
  protected GetBestCheatableAnimID(
    sortedDataSet: DataSet,
    useDesiredMovement: boolean,
    desiredDirection: Vector3,
    desiredVelocityFloat: number,
    useDesiredBodyDirection: boolean,
    desiredBodyDirectionRel: Vector3,
    positions_ret: Vector3[],
    hasteFactor: number,
    localInterruptAnim: e_InterruptAnim,
    preferPassAndShot = false,
  ): {
    result: number;
    animTouchFrame_ret: number;
    radiusOffset_ret: number;
    touchPos_ret: Vector3;
    fullActionSmuggle_ret: Vector3;
    actionSmuggle_ret: Vector3;
    rotationSmuggle_ret: radian;
  } {
    const match = this.match;
    const ballRetainer = match.GetBallRetainer();

    let animTouchFrame_ret = -1;
    let radiusOffset_ret = 0.0;
    let touchPos_ret = new Vector3(0);
    let fullActionSmuggle_ret = new Vector3(0);
    let actionSmuggle_ret = new Vector3(0);

    // never allow touchanims when someone else is holding the ball in his/her hands
    if (ballRetainer && ballRetainer !== this.player) {
      return { result: -1, animTouchFrame_ret, radiusOffset_ret, touchPos_ret, fullActionSmuggle_ret, actionSmuggle_ret, rotationSmuggle_ret: 0 };
    }
    const retainingBall = ballRetainer === this.player;

    // PORT: guard; the original dereferenced begin() of the (in practice never empty) data set
    if (sortedDataSet.length === 0) {
      return { result: -1, animTouchFrame_ret, radiusOffset_ret, touchPos_ret, fullActionSmuggle_ret, actionSmuggle_ret, rotationSmuggle_ret: 0 };
    }

    const mentalImage = this.currentMentalImage!;
    const ball: Ball = match.GetBall();
    const angle = this.spatialState.angle;
    const position = this.spatialState.position;
    const actualTime_ms = match.GetActualTime_ms();

    const incomingMovement = this.spatialState.movement.GetRotated2D(-angle);

    let bestAnimID = -1;
    let bestActionSmuggleVec2D = new Vector3(0);

    const desiredMovement = desiredDirection.Mul(desiredVelocityFloat);

    const playerHeight = this.player.GetPlayerData().GetHeight();

    const functionType = StringToFunctionType(this.anims.GetAnim(sortedDataSet[0]).GetAnimType());

    let rotationSmuggle_ret_tmp: radian = 0;
    let predictedAngle: radian = 0;
    let adaptedOutgoingMovement = new Vector3(0);

    let found = false;
    let iter = 0;
    while (iter < sortedDataSet.length && found === false) {

      const animID = sortedDataSet[iter];
      const anim = this.anims.GetAnim(animID);
      const isBase = anim.GetVariable('baseanim') === 'true';

      const origPositionCache: Vector3[] = match.GetAnimPositionCache(anim);

      assert(desiredMovement.coords[2] === 0.0);

      rotationSmuggle_ret_tmp = this.CalculatePhysicsVector(anim, useDesiredMovement, desiredMovement, useDesiredBodyDirection, desiredBodyDirectionRel, positions_ret).rotationOffset_ret;

      // anim space!
      predictedAngle = anim.GetOutgoingAngle() + rotationSmuggle_ret_tmp;
      predictedAngle = ModulateIntoRange(-pi, pi, predictedAngle);

      // iterate all possible touches of this anim
      let touchNum = 0;
      let animBallPos = new Vector3(0);
      let animTouchFrame = 0;

      const outgoingMovement = this.CalculateOutgoingMovement(positions_ret).GetRotated2D(-angle);
      adaptedOutgoingMovement = outgoingMovement; // may be changed into touchMovement later on, when an anim is found

      const frameCount = anim.GetEffectiveFrameCount();

      const footballExtension = anim.GetExtension('football') as FootballAnimationExtension;

      const totalTouches = footballExtension.GetTouchCount();
      const touchIDs: number[] = [];

      const defaultTouchFrame = atoi(anim.GetVariable('touchframe'));
      assert(defaultTouchFrame >= 0 && defaultTouchFrame < frameCount);

      // first the middle one down to the first
      for (let i = Math.trunc(totalTouches / 2); i > -1; i--) {
        touchIDs.push(i);
      }
      // then the 1-after-middle one and upwards
      for (let i = Math.trunc(totalTouches / 2) + 1; i < totalTouches; i++) {
        touchIDs.push(i);
      }

      while (touchNum < totalTouches && found === false) {

        const touch = footballExtension.GetTouch(touchIDs[touchNum], animBallPos, animTouchFrame);
        assert(touch.result);
        animBallPos = touch.position;
        animTouchFrame = touch.frame;

        // out of bounds?
        if (!retainingBall) {
          const absBallPos = ball.Predict(animTouchFrame * 10);
          if (Math.abs(absBallPos.coords[0]) > pitchHalfW + lineHalfW + 0.11 ||
              Math.abs(absBallPos.coords[1]) > pitchHalfH + lineHalfW + 0.11) {
            touchNum++;
            continue;
          }
        }

        const touchMovement = CalculateMovementAtFrame(positions_ret, animTouchFrame).GetRotated2D(-angle);
        const animTouchMovement = CalculateMovementAtFrame(origPositionCache, animTouchFrame); // already anim space so no: .GetRotated2D(-spatialState.angle);

        let ballPos = mentalImage.GetBallPrediction(animTouchFrame * 10);
        let ballMovement = mentalImage.GetBallPrediction(animTouchFrame * 10 + 10).Sub(ballPos).Mul(100.0);
        ballPos = ballPos.Sub(position).GetRotated2D(-angle);
        ballMovement = ballMovement.GetRotated2D(-angle);

        const touchFramePosition = positions_ret[animTouchFrame].GetRotated2D(-angle);
        const bodyPos = touchFramePosition.Get2D(); // (C++ bodyPos.coords[2] = 0)

        const keyFrame = anim.GetKeyFrame('player', animTouchFrame);
        const animBodyRot = keyFrame.orientation;
        const animBodyPos = keyFrame.position;

        const z = animBodyRot.GetAngles().Z;

        const animBallHeight = animBallPos.coords[2];
        if (allowPreTouchRotationSmuggle) {
          animBallPos = animBallPos.Sub(animBodyPos).GetRotated2D(rotationSmuggle_ret_tmp * (animTouchFrame / frameCount)).Add(touchFramePosition);
        } else {
          animBallPos = animBallPos.Sub(animBodyPos).Add(touchFramePosition);
        }
        animBallPos = animBallPos.WithCoord(2, animBallHeight * (playerHeight / defaultPlayerHeight));


        // now pick the ballPos from the previous 9ms that is closest to animBallPos. this is to emulate a continuous 'close enough?'-check instead of a 'single moment' check.
        if (useContinuousBallCheck) {
          const ballLine = new Line(ballPos.Sub(ballMovement.Mul(0.006)), ballPos.Add(ballMovement.Mul(0.003)));
          const u = clamp(ballLine.GetClosestToPoint(animBallPos), 0.0, 1.0);
          ballPos = ballLine.GetVertex(0).Add(ballLine.GetVertex(1).Sub(ballLine.GetVertex(0)).Mul(u));
        }

        const actionSmuggleVec3D = ballPos.Sub(animBallPos);
        const actionSmuggleVec2D = actionSmuggleVec3D.Get2D();


        // ball height

        let ballDistanceZ = Math.abs(actionSmuggleVec3D.coords[2]);

        ballDistanceZ *= 1.0 - clamp((animBallPos.coords[2] - 0.11) * 0.3, 0.0, 0.2); // higher balls == cheat more Z (else we would have to make 100000000 anims for high balls on different heights)
        ballDistanceZ *= 1.0 - clamp((ballPos.coords[2] - 0.11) * 0.4, 0.0, 0.3);
        // enforce maximum height though
        if (ballPos.coords[2] > 1.8 && ballPos.coords[2] > animBallPos.coords[2] + 0.12) ballDistanceZ *= 2.0;
        if (ballPos.coords[2] > 2.6 && ballPos.coords[2] > animBallPos.coords[2] + 0.08) ballDistanceZ *= 20.0;
        if (functionType === e_FunctionType.e_FunctionType_Deflect) ballDistanceZ *= 0.8;
        if (retainingBall) ballDistanceZ = 0.0;

        if (ballPos.coords[2] < 0.5 && isBase) ballDistanceZ = Math.max(ballDistanceZ - 0.15, 0.0); // low balls should be doable with ground level anims, doesn't look that bad :P

        if (ballDistanceZ < 0.22) {

          // default touch can be 'cheated' towards best, has biggest 'radius'
          let touchFrameAwkwardness = NormalizedClamp(Math.abs(defaultTouchFrame - animTouchFrame), 0.0, 4.0);
          touchFrameAwkwardness = Math.pow(touchFrameAwkwardness, 2.0) * 0.5;

          let touchFrameFactor = animTouchFrame / 24.0; // makes it 0.5 around the 'average touchframe' (educated guess average)
          touchFrameFactor = Math.pow(touchFrameFactor, 0.7); // advantage for anims that touch the ball earlier. rationale: more cheating, sure, but for a shorter period
          // even steeper falloff after 1.0
          if (touchFrameFactor > 1.0) touchFrameFactor = 1.0 + (touchFrameFactor - 1.0) * 0.5;

          const decayPow = 1.0;
          let radiusCheatOffset = 0.0;
          let radiusFactor = 0.3 * (1.0 - touchFrameAwkwardness);

          if (functionType === e_FunctionType.e_FunctionType_Deflect) { radiusFactor *= 1.8; radiusCheatOffset += 0.4; }

          if (functionType === e_FunctionType.e_FunctionType_Sliding) { radiusFactor *= 0.2; radiusCheatOffset = 0.0; } // prefer sliding without ball touch
          if (functionType === e_FunctionType.e_FunctionType_Interfere) { radiusFactor *= 1.4; radiusCheatOffset += 0.2; }

          if (functionType === e_FunctionType.e_FunctionType_ShortPass) { radiusFactor *= 1.3; radiusCheatOffset += 0.15; }
          if (functionType === e_FunctionType.e_FunctionType_LongPass) { radiusFactor *= 1.3; radiusCheatOffset += 0.15; }
          if (functionType === e_FunctionType.e_FunctionType_HighPass) { radiusFactor *= 1.3; radiusCheatOffset += 0.15; }
          if (functionType === e_FunctionType.e_FunctionType_Shot) { radiusFactor *= 1.3; radiusCheatOffset += 0.15; }

          if ((functionType === e_FunctionType.e_FunctionType_Trap || functionType === e_FunctionType.e_FunctionType_BallControl) && preferPassAndShot === true) {
            radiusFactor *= 0.3;
          }

          radiusCheatOffset *= 1.0 - touchFrameAwkwardness;

          const touchVelo = touchMovement.GetLength();

          let FFO = GetFrontOfFootOffsetRel(touchVelo, z, ballPos.coords[2]);
          if (FloatToEnumVelocity(touchVelo) === e_Velocity.e_Velocity_Idle) {
            //FFO.Rotate2D(z); // always towards y = -1, right? (hmmm not really)
          } else {
            FFO = FFO.GetRotated2D(FixAngle(touchMovement.GetNormalized(up).GetAngle2D()));
          }

          // just touched ball
          const lastTouchBias = curve(this.player.GetLastTouchBias(600, actualTime_ms + animTouchFrame * 10), 1.0);
          if (lastTouchBias > 0.0) {
            const factor = 1.0 - lastTouchBias * 0.97 * (1.0 - this.player.GetStat('technical_ballcontrol') * 0.1);
            radiusFactor *= factor;
            radiusCheatOffset *= factor;
          }


          const debug = false;

          const touchFramedRadiusFactor = radiusFactor * touchFrameFactor;
          const bodyBallDistanceAdvantage = this.GetBodyBallDistanceAdvantage(
            anim, functionType, animTouchMovement, touchMovement, incomingMovement, adaptedOutgoingMovement, predictedAngle, bodyPos, FFO,
            animBallPos.Get2D(), ballPos.Get2D(), ballMovement.Get2D(), touchFramedRadiusFactor, radiusCheatOffset, decayPow, debug,
          );

          if (bodyBallDistanceAdvantage >= 1.0 || retainingBall) {

            found = true;

            bestAnimID = animID;
            bestActionSmuggleVec2D = actionSmuggleVec2D;
            animTouchFrame_ret = animTouchFrame;
            radiusOffset_ret = 1000.0; //radiusOffset; todo? is this still in use?
          }

        }
        touchNum++;
      }
      iter++;
    }

    if (found) {

      touchPos_ret = mentalImage.GetBallPrediction(animTouchFrame_ret * 10);

      fullActionSmuggle_ret = bestActionSmuggleVec2D.GetRotated2D(angle);
      actionSmuggle_ret = fullActionSmuggle_ret;

      if (forceFullActionSmuggleDiscard) {

        actionSmuggle_ret = new Vector3(0);

      } else if (enableActionSmuggleDiscard) {

        // cheat discard distance (don't show some amount of cheat, like, a cheat-cheat :D CHEATCEPTION)
        let smuggleDistance = actionSmuggle_ret.GetLength();
        let adaptedCheatDiscardDistanceMultiplier = cheatDiscardDistanceMultiplier;
        if (functionType !== e_FunctionType.e_FunctionType_BallControl) adaptedCheatDiscardDistanceMultiplier *= 0.8;
        if (touchPos_ret.coords[2] > 0.5) adaptedCheatDiscardDistanceMultiplier *= 0.7;
        if (touchPos_ret.coords[2] > 1.0) adaptedCheatDiscardDistanceMultiplier *= 0.7;
        let cheatDiscardDistanceBonus = 0.0;
        if (functionType === e_FunctionType.e_FunctionType_Interfere) cheatDiscardDistanceBonus += 0.1; // don't break flow


        // smuggle, in this context, is how much we will move to the ball after the physics have been accounted for.
        // this is so it seems like we actually touch the ball. we can discard this smuggle somewhat though to make the physics look better.
        // it always is a trade-off between visually touching the ball and visually moving 'correctly', physics-wise.

        // method 1: always discard a part of the smuggle distance
        smuggleDistance = clamp(smuggleDistance - (cheatDiscardDistance + cheatDiscardDistanceBonus), 0.0, 100.0);
        smuggleDistance *= 1.0 - adaptedCheatDiscardDistanceMultiplier;

        smuggleDistance = Math.min(smuggleDistance, actionSmuggle_ret.GetLength() - maxSmuggleDiscardDistance);

        if (retainingBall) smuggleDistance = 0.0;
        actionSmuggle_ret = actionSmuggle_ret.GetNormalized(0).Mul(smuggleDistance);


        // lose forward-facing part of smuggle

        if (discardForwardSmuggle || discardSidewaysSmuggle) {

          const toStraightAngle = angle + predictedAngle;
          actionSmuggle_ret = actionSmuggle_ret.GetRotated2D(-toStraightAngle);

          if (discardForwardSmuggle) {
            const shortenForwardDistance = 0.02;
            let allowForwardDistance =
              0.25 *
              (1.0 - Math.pow(NormalizedClamp(adaptedOutgoingMovement.GetLength(), idleVelocity, sprintVelocity - 2.0), 0.6)) *
              (animTouchFrame_ret * 0.1);
            if (functionType !== e_FunctionType.e_FunctionType_BallControl && functionType !== e_FunctionType.e_FunctionType_Trap) allowForwardDistance += 0.1; // allow pass/shot/intefere anims and such to smuggle forwards more, since their follow-up-movement doesn't matter that much
            if (actionSmuggle_ret.coords[1] < 0.0) {
              actionSmuggle_ret = actionSmuggle_ret.WithCoord(1, clamp(actionSmuggle_ret.coords[1] + shortenForwardDistance, -allowForwardDistance, 0.0));
            }
          }
          if (discardSidewaysSmuggle) {
            actionSmuggle_ret = actionSmuggle_ret.WithCoord(0, actionSmuggle_ret.coords[0] * 0.7);
          }

          actionSmuggle_ret = actionSmuggle_ret.GetRotated2D(toStraightAngle);
        }

        // less chaos in micro battles
        actionSmuggle_ret = actionSmuggle_ret.Mul(0.7 + 0.3 * NormalizedClamp(this.CastPlayer().GetClosestOpponentDistance(), 0.6, 1.2));
      }

      assert(actionSmuggle_ret.coords[2] === 0.0);
    }

    return {
      result: bestAnimID,
      animTouchFrame_ret,
      radiusOffset_ret,
      touchPos_ret,
      fullActionSmuggle_ret,
      actionSmuggle_ret,
      rotationSmuggle_ret: rotationSmuggle_ret_tmp,
    };
  }

  protected CalculateMovementSmuggle(desiredDirection: Vector3, desiredVelocityFloat: number): Vector3 {

    if (!enableMovementSmuggle) return new Vector3(0);

    const match = this.match;
    const player = this.CastPlayer();
    const anim = this.currentAnim.anim;

    if (this.team.GetDesignatedTeamPossessionPlayer() !== this.player || match.GetDesignatedPossessionPlayer() !== this.player ||
        this.currentAnim.touchFrame !== -1 || (this.currentAnim.functionType === e_FunctionType.e_FunctionType_Trip && anim.GetVariable('triptype') !== '1') ||
        anim.GetVariable('incoming_special_state') !== '' || anim.GetVariable('outgoing_special_state') !== '' ||
        !match.IsInPlay() || match.IsInSetPiece() || match.GetBallRetainer()) return new Vector3(0);


    let toDesired: Vector3;
    const mentalImage = this.currentMentalImage!;


    // various stuff needed by all

    // (C++ unsigned int / int values: truncated)
    let timeToBall_ms = Math.trunc(player.GetTimeNeededToGetToBall_ms());
    if (player.GetDesiredTimeToBall_ms() > timeToBall_ms) {
      timeToBall_ms = Math.trunc(player.GetDesiredTimeToBall_ms());
    }
    const animTime_ms = anim.GetFrameCount() * 10;
    const futureTime_ms = Math.max(animTime_ms + defaultTouchOffset_ms, timeToBall_ms);


    const predictedOutgoingMovement = this.CalculateOutgoingMovement(this.currentAnim.positions);
    const { predictedPos, predictedAngle } = this.CalculatePredictedSituation();
    const ballPos = mentalImage.GetBallPrediction(futureTime_ms);
    const ballHeight = ballPos.coords[2];
    const ffo = GetFrontOfFootOffsetRel(predictedOutgoingMovement.GetLength(), anim.GetOutgoingBodyAngle(), ballHeight).GetRotated2D(predictedAngle);
    const desiredBallPos = predictedPos.Add(ffo);


    if (!player.HasPossession()) {

      // macro effect: consider a line going in the ball movement direction. consider the spot we want the ball at (in front of us) after this movement anim.
      // now calculate the shortest line between that line and that point. now move over that line from the point towards the line somewhat

      const ballMovementLine = new Line();
      ballMovementLine.SetVertex(0, mentalImage.GetBallPrediction(0).Get2D());
      ballMovementLine.SetVertex(1, mentalImage.GetBallPrediction(futureTime_ms).Get2D());
      if (ballMovementLine.GetLength() < 0.5) return new Vector3(0); // ball is slow or very close


      const u = ballMovementLine.GetClosestToPoint(desiredBallPos);
      const closestBallPos = ballMovementLine.GetVertex(0).Add(ballMovementLine.GetVertex(1).Sub(ballMovementLine.GetVertex(0)).Mul(u));

      toDesired = closestBallPos.Sub(desiredBallPos);

    } else { // if HasPossession

      toDesired = ballPos.Get2D().Sub(desiredBallPos);

    }


    let maxEffectTimeTreshold_ms = 250 + defaultTouchOffset_ms; // if the ball is this much longer 'farther away' than feasible, rather postpone effect until next anim (else we may overrun)
    if (FloatToEnumVelocity(anim.GetOutgoingVelocity()) === e_Velocity.e_Velocity_Idle) maxEffectTimeTreshold_ms = 2000; // no danger of overrunning
    const maxEffectVelocity = dribbleWalkSwitch;
    const maxSmuggleMPS = 1.6;

    if (futureTime_ms - (animTime_ms + defaultTouchOffset_ms) > maxEffectTimeTreshold_ms) return new Vector3(0);

    const toDesiredMovement = toDesired.Div(animTime_ms * 0.001);
    const resultingMovement = predictedOutgoingMovement.Add(toDesiredMovement);
    const predictedVelocity = predictedOutgoingMovement.GetLength();
    const resultingVelocity = resultingMovement.GetLength();
    if (resultingVelocity > predictedVelocity && resultingVelocity > maxEffectVelocity) return new Vector3(0);

    toDesired = toDesired.GetNormalizedMax(maxSmuggleMPS * (anim.GetEffectiveFrameCount() * 0.01));

    const removeDistance = 0.06; // remove part of the smuggle (allow staying this far away from ideal spot)
    toDesired = toDesired.GetNormalized(0).Mul(Math.max(0.0, toDesired.GetLength() - removeDistance));

    if (movementSmuggleDebugPilons && player.GetDebug()) {
      SetYellowDebugPilon(desiredBallPos);
      SetRedDebugPilon(ballPos.Get2D());
    }
    return toDesired;
  }

  protected GetBestPossibleTouch(desiredTouch: Vector3, functionType: e_FunctionType): Vector3 {

    const maxPowerShortPass = 30.0;
    const maxPowerHighPass = 42.0;
    let maxPowerBase = maxPowerShortPass;
    if (functionType === e_FunctionType.e_FunctionType_HighPass) maxPowerBase = maxPowerHighPass;

    let resultTouch = desiredTouch;

    const match = this.match;
    const ball: Ball = match.GetBall();


    // fetch vars

    let maxPowerFactor = atof(this.currentAnim.anim.GetVariable('touch_maxpowerfactor'));
    if (maxPowerFactor === 0.0) maxPowerFactor = 1.0;
    maxPowerFactor = maxPowerFactor * 0.7 + 0.3;


    // clamp to maximum possible power (from anim vars)

    let maxPower = maxPowerBase * maxPowerFactor * (1.0 - clamp(this.decayingPositionOffset.GetLength() * 2.5, 0.0, 0.25));
    maxPower += ball.GetMovement().GetLength() * 0.5; // can use some of current ballmomentum
    if (resultTouch.GetLength() > maxPower) {
      const missingPower = resultTouch.GetLength() - maxPower;
      resultTouch = resultTouch.GetNormalized(0).Mul(maxPower);
      resultTouch = resultTouch.WithCoord(2, resultTouch.coords[2] + clamp(missingPower, 0.0, 10.0) * 0.25);
    }


    // difficulty

    let difficultyFactor = atof(this.currentAnim.anim.GetVariable('touch_difficultyfactor'));

    // apply stats
    if (functionType === e_FunctionType.e_FunctionType_ShortPass ||
        functionType === e_FunctionType.e_FunctionType_LongPass) difficultyFactor *= 1.0 - this.CastPlayer().GetStat('technical_shortpass') * 0.5;
    if (functionType === e_FunctionType.e_FunctionType_HighPass) difficultyFactor *= 1.0 - this.CastPlayer().GetStat('technical_highpass') * 0.5;

    const { distanceFactor, heightFactor, ballMovementFactor } = GetDifficultyFactors(match, this.CastPlayer(), this.decayingPositionOffset);

    // difficult balls may go into a more random orientation, or, if the anim has a default outgoing direction, it may converge towards that (since it is the easiest direction for that anim)
    const randomRotation = distanceFactor * 0.15 + heightFactor * 0.15 + ballMovementFactor * 0.3 + difficultyFactor * 0.5;
    const animBallDirection = GetVectorFromString(this.currentAnim.anim.GetVariable('balldirection')).GetRotated2D(this.startAngle + this.currentAnim.rotationSmuggleOffset);
    if (animBallDirection.GetLength() > 0.01) {
      const bias = clamp(randomRotation * 1.5, 0.0, 1.0);
      const nativeTouch = animBallDirection.GetNormalized(resultTouch).Get2D().Mul(resultTouch.GetLength()).Add(resultTouch.Mul(new Vector3(0, 0, 1)));
      resultTouch = resultTouch.Mul(1.0 - bias).Add(nativeTouch.Mul(bias));
    } else {
      const rotation = random(-0.5 * pi, 0.5 * pi) * Math.min(randomRotation, 0.5);
      resultTouch = resultTouch.GetRotated2D(rotation);
    }

    // ball far away == less power
    resultTouch = resultTouch.Mul(1.0 - distanceFactor * 0.3);
    resultTouch = resultTouch.WithCoord(2, resultTouch.coords[2] + distanceFactor * 1.5); // try to correct (add power) by playing higher ball (== less ground friction)

    resultTouch = resultTouch.WithCoord(2, resultTouch.coords[2] + ball.GetMovement().coords[2] * heightFactor * 0.5 + heightFactor * 1.0);

    resultTouch = resultTouch.Mul(1.0 - ballMovementFactor).Add(ball.GetMovement().Mul(ballMovementFactor));

    resultTouch = resultTouch.WithCoord(2, resultTouch.coords[2] + difficultyFactor * 5.0 * random(0.2, 1.0));

    return resultTouch;
  }
}
