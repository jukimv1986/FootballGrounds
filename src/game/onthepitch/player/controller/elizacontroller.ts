// Port of legacy/src/onthepitch/player/controller/elizacontroller.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).

import { Vector3 } from '../../../../blunted/base/math/vector3';
import { NormalizedClamp, clamp, curve, pi, random, signSide } from '../../../../blunted/base/math/bluntmath';
import { Line } from '../../../../blunted/base/geometry/line';
import { assert } from '../../../../blunted/base/assert';
import {
  ForceSpot,
  PlayerCommand,
  distanceToVelocityMultiplier,
  dribbleVelocity,
  e_DecayType,
  e_FunctionType,
  e_MagnetType,
  e_PlayerRole,
  e_SetPiece,
  idleVelocity,
  pitchHalfH,
  pitchHalfW,
  sprintVelocity,
  walkVelocity,
  type PlayerCommandQueue,
  type PlayerImage,
} from '../../../gamedefines';
import type { Match } from '../../match';
import type { MentalImage } from '../../AIsupport/mentalimage';
import {
  AI_GetBallControlMovement,
  AI_GetBestDribbleMovement,
  AI_GetClosestPlayer,
  AI_GetClosestPlayers,
  AI_GetForceFieldMovement,
  AI_GetMindSet,
  AI_GetOffsideLine,
  AI_GetPass,
} from '../../AIsupport/AIfunctions';
import type { Player } from '../player';
import { ClampVelocity, RangeVelocity } from '../humanoid/animcollection';
import { NeedDefendingMovement } from '../humanoid/humanoid_utils';
import { PlayerController } from './playercontroller';
import type { Strategy } from './strategies/strategy';
import { DefaultDefenseStrategy } from './strategies/offtheball/default_def';
import { DefaultMidfieldStrategy } from './strategies/offtheball/default_mid';
import { DefaultOffenseStrategy } from './strategies/offtheball/default_off';
import { GoalieDefaultStrategy } from './strategies/offtheball/goalie_default';

/** for optimization: first calculate everything but passrating, since that one is slow to calculate. cull results before rating pass freedom */
export class PreRating {
  candidateID = 0;

  /** how close to goal are we? */
  offenseRating = 0;
  /** how far away from possession player are we? */
  distanceRating = 0;
  /** prefer continuing in our currect direction */
  movementRating = 0;
  /** prefer movement to our formation position */
  formationRating = 0;
  /** 0 == offside, 1 == not offside */
  offsideRating = 0;

  totalRating = 0;
}

/** strict-weak-ordering "less than" */
export function PreRatingSortFunc(a: PreRating, b: PreRating): boolean {
  return a.totalRating > b.totalRating;
}

/** strict-weak-ordering "less than" */
export function SortPlayersDeepestFirst(a: Player, b: Player): boolean {
  return a.GetPosition().coords[0] * a.GetTeam().GetSide() < b.GetPosition().coords[0] * b.GetTeam().GetSide();
}

// the support position candidates: 1 + 3 per angle step. C++ accumulated the angle in a float, which yields 13 steps
// (the last one at ~2pi, duplicating the first) instead of the 12 a double accumulation gives: emulate that.
const supportCandidateDirections: Vector3[] = (() => {
  const dirs: Vector3[] = [];
  const fpi = Math.fround(pi);
  const twoPi = Math.fround(2 * fpi);
  const step = Math.fround(twoPi / 12.0);
  for (let rad = 0; rad < twoPi; rad = Math.fround(rad + step)) {
    dirs.push(new Vector3(Math.cos(rad), Math.sin(rad), 0));
  }
  return dirs;
})();

export class ElizaController extends PlayerController {
  protected defenseStrategy!: Strategy;
  protected midfieldStrategy!: Strategy;
  protected offenseStrategy!: Strategy;
  protected goalieStrategy!: Strategy;

  protected lastDesiredDirection = new Vector3(0);
  protected lastDesiredVelocity = 0;

  constructor(match: Match) {
    super(match);
  }

  override RequestCommand(commandQueue: PlayerCommandQueue): void {
    this.lastSwitchTimeDuration_ms = 0;
    this.lastSwitchTime_ms = 0;

    const castPlayer = this.CastPlayer();
    const player = this.player;
    const match = this.match;
    const team = this.team;

    castPlayer.SetDesiredTimeToBall_ms(0);

    this._CalculateSituation();

    this._Preprocess(); // calculate some variables

    const mentalImage = this._mentalImage!;

    // input

    let rawInputDirection = player.GetDirectionVec();
    let rawInputVelocityFloat = idleVelocity;
    let manualMovementDirection = player.GetDirectionVec();
    let manualMovementVelocityFloat = idleVelocity;

    let manualMovement = false;
    let extraHaste = false;

    const role = castPlayer.GetFormationEntry().role;

    // celebrate good times come on!

    if (!match.IsInPlay() && match.IsGoalScored()) {
      this._AddCelebration(commandQueue);
      return;
    }

    // look at referee
    else if (
      !match.IsInPlay() &&
      match.GetReferee().GetBuffer().active === true &&
      (match.GetReferee().GetCurrentFoulType() === 2 || match.GetReferee().GetCurrentFoulType() === 3) &&
      // (C++ unsigned arithmetic: actual time - 1000 wraps around below 1000ms)
      (match.GetActualTime_ms() < 1000 || match.GetReferee().GetBuffer().stopTime < match.GetActualTime_ms() - 1000) &&
      match.GetReferee().GetBuffer().prepareTime > match.GetActualTime_ms()
    ) {
      // look at referee
      const command = new PlayerCommand();
      command.desiredFunctionType = e_FunctionType.e_FunctionType_Movement;
      command.useDesiredMovement = true;
      command.useDesiredLookAt = true;
      command.desiredDirection = castPlayer.GetDirectionVec();
      assert(command.desiredDirection.coords[2] === 0.0);
      command.desiredVelocityFloat = idleVelocity;
      command.desiredLookAt = match.GetOfficials().GetReferee().GetPosition();
      commandQueue.push(command);

      return;
    }

    // stand still
    else if (!match.IsInPlay()) {
      // this whole if/then/else structure is ugly and unclear

      const command = new PlayerCommand();
      command.desiredFunctionType = e_FunctionType.e_FunctionType_Movement;
      command.useDesiredMovement = true;
      if (match.GetBallRetainer() === player) {
        command.desiredDirection = new Vector3(0).Sub(player.GetPosition()).GetNormalized(player.GetDirectionVec());
      } else {
        command.desiredDirection = player.GetDirectionVec();
      }
      command.desiredVelocityFloat = idleVelocity;
      if (!match.IsInSetPiece()) {
        command.desiredDirection = player
          .GetDirectionVec()
          .Mul(0.6)
          .Add(new Vector3(0).Sub(player.GetPosition()).GetNormalized(player.GetDirectionVec()).Mul(0.4))
          .GetNormalized(player.GetDirectionVec());
        command.desiredVelocityFloat = ClampVelocity(player.GetFloatVelocity() * 0.95 - random(0.0, 3.2));
      }
      command.useDesiredLookAt = true;
      command.desiredLookAt = player.GetPosition().Add(match.GetBall().Predict(0).Get2D().Sub(player.GetPosition()).GetNormalized(command.desiredDirection).Mul(10.0));
      commandQueue.push(command);

      return;
    }

    // set piece taking
    else if ((match.IsInSetPiece() && team.GetController().GetPieceTaker() === player) || match.GetBallRetainer() === player) {
      const actionCommand = new PlayerCommand();
      const setPieceType = team.GetController().GetSetPieceType();

      if (setPieceType === e_SetPiece.e_SetPiece_Penalty) {
        actionCommand.desiredFunctionType = e_FunctionType.e_FunctionType_Shot;
        actionCommand.useDesiredMovement = false;
        actionCommand.useDesiredLookAt = false;
        actionCommand.touchInfo.desiredDirection = new Vector3(-team.GetSide() * pitchHalfW, random(-5, 5), 0).Sub(castPlayer.GetPosition()).GetNormalized(new Vector3(-team.GetSide(), 0, 0));
        actionCommand.touchInfo.desiredPower = random(0.4, 1.0);
        commandQueue.push(actionCommand);
      } else {
        actionCommand.desiredFunctionType = e_FunctionType.e_FunctionType_ShortPass;
        actionCommand.useDesiredMovement = false;
        actionCommand.useDesiredLookAt = false;
        actionCommand.touchInfo.inputDirection = player.GetDirectionVec();
        actionCommand.touchInfo.inputPower = 0.5;
        actionCommand.touchInfo.autoDirectionBias = 1.0;
        actionCommand.touchInfo.autoPowerBias = 1.0;

        actionCommand.touchInfo.forcedTargetPlayer = null;

        let desiredTargetPosition = new Vector3(0);
        let doCommand = true;

        if (setPieceType === e_SetPiece.e_SetPiece_GoalKick) {
          if (random(0.0, 1.0) > 0.4 && team.GetHumanGamerCount() === 0) {
            actionCommand.desiredFunctionType = e_FunctionType.e_FunctionType_HighPass;
            desiredTargetPosition = new Vector3(pitchHalfW * -team.GetSide() * 0.2, random(-pitchHalfH, pitchHalfH), 0.0);
          } else {
            actionCommand.desiredFunctionType = e_FunctionType.e_FunctionType_ShortPass;
            desiredTargetPosition = new Vector3(player.GetPosition().coords[0] * 0.9, random(-pitchHalfH, pitchHalfH), 0.0);
          }
        } else if (setPieceType === e_SetPiece.e_SetPiece_KickOff) {
          actionCommand.desiredFunctionType = e_FunctionType.e_FunctionType_ShortPass;
          desiredTargetPosition = player.GetPosition().Add(player.GetDirectionVec().Mul(1.0));
        } else if (setPieceType === e_SetPiece.e_SetPiece_FreeKick) {
          if (random(0.0, 1.0) > 0.5) {
            actionCommand.desiredFunctionType = e_FunctionType.e_FunctionType_HighPass;
            desiredTargetPosition = new Vector3(pitchHalfW * -team.GetSide(), random(-10.0, 10.0), 0.0);
          } else {
            actionCommand.desiredFunctionType = e_FunctionType.e_FunctionType_ShortPass;
            desiredTargetPosition = player.GetPosition().Add(new Vector3(-team.GetSide() * 10.0, random(-10.0, 10.0), 0.0));
          }
        } else if (setPieceType === e_SetPiece.e_SetPiece_Corner) {
          if (random(0.0, 1.0) > 0.3) {
            actionCommand.desiredFunctionType = e_FunctionType.e_FunctionType_HighPass;
            const x = pitchHalfW * -team.GetSide() * (0.99 - random(0.0, 0.12));
            desiredTargetPosition = new Vector3(x, random(-10.0, 10.0), 0.0);
          } else {
            actionCommand.desiredFunctionType = e_FunctionType.e_FunctionType_ShortPass;
            desiredTargetPosition = new Vector3(pitchHalfW * -team.GetSide() * 0.8, player.GetPosition().coords[1] * 0.8, 0.0);
          }
        } else if (setPieceType === e_SetPiece.e_SetPiece_ThrowIn) {
          actionCommand.desiredFunctionType = e_FunctionType.e_FunctionType_ShortPass;
          desiredTargetPosition = player.GetPosition(); // closest to player
        } else if (match.GetBallRetainer() === player) {
          // keeper fetched ball, probably
          actionCommand.desiredFunctionType = e_FunctionType.e_FunctionType_HighPass;
          desiredTargetPosition = new Vector3(pitchHalfW * team.GetSide(), random(-pitchHalfH, pitchHalfH), 0.0);
          const targetPlayer = AI_GetClosestPlayer(team, desiredTargetPosition, false, castPlayer);

          if (targetPlayer) {
            // check if this player is away from opponents, before throwing ball to him
            const closestOpp = AI_GetClosestPlayer(match.GetTeam(Math.abs(team.GetID() - 1)), targetPlayer.GetPosition(), false);
            if (closestOpp) {
              if (closestOpp.GetPosition().Add(closestOpp.GetMovement().Mul(0.1)).Sub(targetPlayer.GetPosition()).GetLength() > 10.0 || castPlayer.GetPossessionDuration_ms() > 4000) {
                // last touch bias is maximum so he won't hold forever
                actionCommand.touchInfo.forcedTargetPlayer = targetPlayer;
              } else {
                doCommand = false;
              }
            }
          }
        }

        if (doCommand) {
          if (actionCommand.touchInfo.forcedTargetPlayer === null) actionCommand.touchInfo.forcedTargetPlayer = AI_GetClosestPlayer(team, desiredTargetPosition, false, castPlayer);
          const touchInfo = actionCommand.touchInfo;
          const pass = AI_GetPass(castPlayer, actionCommand.desiredFunctionType, touchInfo.inputDirection, touchInfo.inputPower, touchInfo.autoDirectionBias, touchInfo.autoPowerBias, touchInfo.forcedTargetPlayer);
          touchInfo.desiredDirection = pass.resultingDirection;
          touchInfo.desiredPower = pass.resultingPower;
          touchInfo.targetPlayer = pass.targetPlayer;
          commandQueue.push(actionCommand);
        }
      }

      // remember, we are still in the 'set piece / ballretainer' if{}

      if (match.GetBallRetainer() !== player) {
        // must be set piece taker, then
        const command = new PlayerCommand();
        command.desiredFunctionType = e_FunctionType.e_FunctionType_Movement;
        command.useDesiredMovement = true;
        command.useDesiredLookAt = true;

        const movement = AI_GetBallControlMovement(mentalImage, castPlayer, player.GetDirectionVec(), walkVelocity);
        command.desiredDirection = movement.bestDirection;
        command.desiredVelocityFloat = movement.bestVelocityFloat;
        command.desiredLookAt = movement.bestLookAt;
        assert(command.desiredDirection.coords[2] === 0.0);

        commandQueue.push(command);
        return;
      } else {
        // must be ball retainer
        const command = new PlayerCommand();
        command.desiredFunctionType = e_FunctionType.e_FunctionType_Movement;
        command.useDesiredMovement = true;
        command.desiredDirection =
          actionCommand.touchInfo.desiredDirection.GetLength() > 0.0
            ? actionCommand.touchInfo.desiredDirection.Get2D().GetNormalized(player.GetDirectionVec())
            : new Vector3(0).Sub(player.GetPosition()).GetNormalized(player.GetDirectionVec());
        command.desiredVelocityFloat = idleVelocity;
        command.useDesiredLookAt = true;
        command.desiredLookAt = player.GetPosition().Add(command.desiredDirection.Mul(10.0));
        commandQueue.push(command);
        return;
      }
    }

    // default strategies for defensively, midfielders and offensively positioned players
    else if (match.IsInPlay() && !match.IsInSetPiece() && match.GetBallRetainer() !== player && match.GetDesignatedPossessionPlayer() !== player && role !== e_PlayerRole.e_PlayerRole_GK) {
      if (role === e_PlayerRole.e_PlayerRole_LB || role === e_PlayerRole.e_PlayerRole_CB || role === e_PlayerRole.e_PlayerRole_RB) {
        ({ direction: rawInputDirection, velocity: rawInputVelocityFloat } = this.defenseStrategy.RequestInput(mentalImage));
      } else if (
        role === e_PlayerRole.e_PlayerRole_DM ||
        role === e_PlayerRole.e_PlayerRole_LM ||
        role === e_PlayerRole.e_PlayerRole_CM ||
        role === e_PlayerRole.e_PlayerRole_RM ||
        role === e_PlayerRole.e_PlayerRole_AM
      ) {
        ({ direction: rawInputDirection, velocity: rawInputVelocityFloat } = this.midfieldStrategy.RequestInput(mentalImage));
      } else if (role === e_PlayerRole.e_PlayerRole_CF) {
        ({ direction: rawInputDirection, velocity: rawInputVelocityFloat } = this.offenseStrategy.RequestInput(mentalImage));
      }
    }

    // dribble, pass, etcetera
    else if (match.IsInPlay() && !match.IsInSetPiece() && match.GetDesignatedPossessionPlayer() === player && team.GetHumanGamerCount() === 0 && role !== e_PlayerRole.e_PlayerRole_GK) {
      if (castPlayer.GetTimeNeededToGetToBall_ms() < 1000) {
        ({ rawInputDirection, rawInputVelocity: rawInputVelocityFloat } = this.GetOnTheBallCommands(commandQueue, rawInputVelocityFloat));
      }
      extraHaste = false; // todo: extra haste when touch anim is queued?
    } else if (match.IsInPlay() && !match.IsInSetPiece() && role === e_PlayerRole.e_PlayerRole_GK) {
      // keeper's mental image for deflections is near-instant; let's just call it premonition ;)
      const keeperMentalImage = mentalImage;
      const goalieStrategy = this.goalieStrategy as GoalieDefaultStrategy;
      goalieStrategy.CalculateIfBallIsBoundForGoal(keeperMentalImage);
      const boundForGoal = goalieStrategy.IsBallBoundForGoal();
      if (boundForGoal) manualMovement = true;
      if (castPlayer !== match.GetDesignatedPossessionPlayer()) manualMovement = true;
      ({ direction: manualMovementDirection, velocity: manualMovementVelocityFloat } = this.goalieStrategy.RequestInput(keeperMentalImage));

      if (!this.hasUniquePossession || this.possessionAmount < 3.4) {
        let onlyPickupAnims = false;
        if (!boundForGoal && this.possessionAmount > 1.3) onlyPickupAnims = true;
        this._KeeperDeflectCommand(commandQueue, onlyPickupAnims);
      }

      if (castPlayer.GetTimeNeededToGetToBall_ms() < 1000 && match.GetDesignatedPossessionPlayer() === player) {
        ({ rawInputDirection, rawInputVelocity: rawInputVelocityFloat } = this.GetOnTheBallCommands(commandQueue, rawInputVelocityFloat));
      }
    }

    let forceMagnet = false;

    // team pressure
    if (
      match.IsInPlay() &&
      !match.IsInSetPiece() &&
      team.GetController().GetEndApplyTeamPressure_ms() > match.GetActualTime_ms() &&
      team.GetController().GetTeamPressurePlayer() === player &&
      !this.teamHasBestPossession &&
      match.GetDesignatedPossessionPlayer() !== player &&
      role !== e_PlayerRole.e_PlayerRole_GK
    ) {
      forceMagnet = true;
    }

    this._SetInput(rawInputDirection, rawInputVelocityFloat);
    if (rawInputDirection.GetLength() !== 0) this.lastDesiredDirection = rawInputDirection;
    else this.lastDesiredDirection = player.GetDirectionVec();
    this.lastDesiredVelocity = rawInputVelocityFloat;

    if (match.IsInPlay() && !match.IsInSetPiece()) {
      // ball control?
      this._BallControlCommand(commandQueue, false, false, false); // last param true == enable sticky run direction.

      // trap?
      this._TrapCommand(commandQueue);

      // interfere?
      const byAnyMeans = false;
      this._InterfereCommand(commandQueue, byAnyMeans);

      // sliding?
      this._SlidingCommand(commandQueue);
    }

    // movement
    if (!manualMovement && match.IsInPlay() && !match.IsInSetPiece()) {
      const oppTeam = match.GetTeam(Math.abs(team.GetID() - 1));
      const opp = oppTeam.GetDesignatedTeamPossessionPlayer();

      if (castPlayer !== match.GetDesignatedPossessionPlayer()) {
        const mindSet = AI_GetMindSet(castPlayer.GetDynamicFormationEntry().role);
        let huntDistanceThreshold = 10.0 + (1.0 - mindSet) * 10.0; // 10 + .. * 10
        huntDistanceThreshold *= 0.5 * castPlayer.GetFatigueFactorInv() + 0.5 * (1.0 - NormalizedClamp(castPlayer.GetAverageVelocity(10), idleVelocity, sprintVelocity));
        huntDistanceThreshold *= 0.3 + this.GetMatch().GetMatchDifficulty() * 0.7;

        if (forceMagnet) {
          // make sure the movement command magnets get the best input (which is then used as 'hint' for the 'toball' functions)

          this.inputDirection = new Vector3(team.GetSide() * pitchHalfW, 0, 0).Sub(castPlayer.GetPosition());
          this.inputVelocityFloat = idleVelocity;
          this.inputDirection = this.inputDirection.GetNormalized(castPlayer.GetDirectionVec());
        } else if (
          !this.teamHasBestPossession &&
          castPlayer.GetManMarkingID() === -1 &&
          opp.GetPosition().Add(opp.GetMovement().Mul(0.12)).Sub(castPlayer.GetPosition().Add(castPlayer.GetMovement().Mul(0.04))).GetLength() < huntDistanceThreshold
        ) {
          // defend player

          if (player === team.GetDesignatedTeamPossessionPlayer() && this.possessionAmount > 0.8) {
            forceMagnet = true; // don't give up battles too easily
            extraHaste = true;
          }

          // or, defend an opponent, if we don't have anything better to do anyway

          const huntingPlayersNum = 2; // remember, this includes players with man marking id that are not controlled by this hunting code
          const closestPlayers: Player[] = [];
          AI_GetClosestPlayers(team, opp.GetPosition().Add(opp.GetMovement().Mul(0.1)), false, closestPlayers, huntingPlayersNum);
          let close = false;
          for (let i = 0; i < closestPlayers.length; i++) {
            if (closestPlayers[i] === player) {
              close = true;
              break;
            }
          }

          if (close) {
            // more 'hunting' method
            const defendPosition = this.GetDefendPosition(opp);
            if (NeedDefendingMovement(team.GetSide(), player.GetPosition(), defendPosition)) {
              this.inputDirection = defendPosition.Sub(castPlayer.GetPosition()).GetNormalized(this.inputDirection);
              this.inputVelocityFloat = clamp(defendPosition.Sub(castPlayer.GetPosition()).GetLength() * distanceToVelocityMultiplier, 0.0, sprintVelocity);
              forceMagnet = true; // more aggressive!
            }
          } // close
        } // else (!forceMagnet)
      } // !designated

      this.inputVelocityFloat = RangeVelocity(this.inputVelocityFloat); // emulate controller quantization

      this._MovementCommand(commandQueue, forceMagnet, extraHaste);
    } else {
      // keeper?

      const command = new PlayerCommand();
      command.desiredFunctionType = e_FunctionType.e_FunctionType_Movement;
      command.useDesiredMovement = true;
      command.desiredDirection = manualMovementDirection;
      assert(command.desiredDirection.coords[2] === 0.0);
      command.desiredVelocityFloat = manualMovementVelocityFloat;
      command.useDesiredLookAt = true;
      command.desiredLookAt = player.GetPosition().Add(mentalImage.GetBallPrediction(40).Get2D().Sub(player.GetPosition()).GetNormalized(0).Mul(10.0));
      commandQueue.push(command);
    }
  }

  override Process(): void {
    super.Process();
  }

  override GetDirection(): Vector3 {
    return this.lastDesiredDirection;
  }

  override GetFloatVelocity(): number {
    return this.lastDesiredVelocity;
  }

  LoadStrategies(): void {
    this.defenseStrategy = new DefaultDefenseStrategy(this);
    this.midfieldStrategy = new DefaultMidfieldStrategy(this);
    this.offenseStrategy = new DefaultOffenseStrategy(this);
    this.goalieStrategy = new GoalieDefaultStrategy(this);
  }

  GetLazyVelocity(desiredVelocityFloat: number): number {
    const castPlayer = this.CastPlayer();

    // input is unclamped! use large values (less lazy, apparently we are more off-position)
    let adaptedDesiredVelocityFloat = desiredVelocityFloat;
    // don't use full overflow though
    if (adaptedDesiredVelocityFloat > sprintVelocity) adaptedDesiredVelocityFloat = sprintVelocity + (adaptedDesiredVelocityFloat - sprintVelocity) * 0.1;

    const startLazinessDistance = 20.0 * (castPlayer.GetFatigueFactorInv() * 0.8 + 0.2);
    const endLazinessDistance = 65.0 * (castPlayer.GetFatigueFactorInv() * 0.5 + 0.5);

    const oppPos = this.match.GetTeam(Math.abs(this.team.GetID() - 1)).GetDesignatedTeamPossessionPlayer().GetPosition();
    const actionDistance = this.player.GetPosition().Sub(oppPos).GetLength();
    const teamPossession = clamp(this.GetFadingTeamPossessionAmount() - 0.5, 0.0, 1.0);
    const mindSet = AI_GetMindSet(castPlayer.GetDynamicFormationEntry().role);

    // if mindSet is high (offensive), be lazy when teamPossession is low. and the other way round for defenders.
    // (midfielders are always half-lazy by role this way; pow() them a bit if this is undesired; this will of course wear them out more than backs and strikers)
    const lazinessByRole = mindSet + teamPossession * (1.0 - mindSet * 2.0);
    const lazinessByPosition = NormalizedClamp(actionDistance, startLazinessDistance, endLazinessDistance);

    const lazyFactor = lazinessByPosition * (0.5 + lazinessByRole * 0.5);
    let resultingVelocityFloat = adaptedDesiredVelocityFloat * (1.0 - lazyFactor);

    let clampToDribble = false;
    if (desiredVelocityFloat >= dribbleVelocity) clampToDribble = true; // no standing still when initially undesired; it would get us further and further away from our desired position *edit: no longer true with the unclamped input
    if (clampToDribble && resultingVelocityFloat < dribbleVelocity) resultingVelocityFloat = dribbleVelocity;

    // short term fatigue/work rate shortage ;)
    // does not heed dribble clamp above, as to simulate players having to stop to catch their breath
    let breathLeftFactor = 1.0 - NormalizedClamp(castPlayer.GetAverageVelocity(10), idleVelocity, sprintVelocity);
    const workRate = castPlayer.GetStat('mental_workrate');
    breathLeftFactor = Math.pow(breathLeftFactor, 0.8 - workRate * 0.2);
    breathLeftFactor = clamp(breathLeftFactor * 1.2, 0.0, 1.0); // make sure beginning of sprint is full speed
    breathLeftFactor = breathLeftFactor * lazyFactor + 1.0 * (1.0 - lazyFactor); // sometimes, we really need to force it
    resultingVelocityFloat = Math.min(resultingVelocityFloat, sprintVelocity * breathLeftFactor);

    return resultingVelocityFloat;
  }

  GetSupportPosition(mentalImage: MentalImage, basePosition: Vector3): Vector3 {
    const castPlayer = this.CastPlayer();
    const player = this.player;
    const team = this.team;

    const ballPrediction100 = mentalImage.GetBallPrediction(100).Get2D();

    const offenseWeight = 0.8 + AI_GetMindSet(castPlayer.GetDynamicFormationEntry().role) * clamp((this.GetFadingTeamPossessionAmount() - 0.5) * 2.0, 0.0, 1.0);
    const distanceWeight = 1.0;
    const passWeight = 0.8;
    const movementWeight = 1.5;
    const formationWeight = 1.6 + clamp(castPlayer.GetPosition().Sub(ballPrediction100).GetLength() / 30.0, 0.0, 1.0);
    const offsideWeight = 10.0;

    const playerPos = player.GetPosition().Add(player.GetMovement().Mul(0.1)); // + physics slowness

    // get closest opponents

    const opponents: Player[] = [];
    const opponentImages: PlayerImage[] = [];
    AI_GetClosestPlayers(this.match.GetTeam(Math.abs(team.GetID() - 1)), playerPos, false, opponents, 4);
    for (let i = 0; i < opponents.length; i++) {
      const oppImage = mentalImage.GetPlayerImage(opponents[i].GetID()).Clone();
      oppImage.position = oppImage.position.Add(oppImage.movement.Mul(0.15));
      opponentImages.push(oppImage);
    }

    // add candidate positions

    const candidatePositions: Vector3[] = [];
    candidatePositions.push(playerPos);
    for (let d = 0; d < supportCandidateDirections.length; d++) {
      const pos = supportCandidateDirections[d];
      candidatePositions.push(playerPos.Add(pos.Mul(dribbleVelocity)));
      candidatePositions.push(playerPos.Add(pos.Mul(walkVelocity)));
      candidatePositions.push(playerPos.Add(pos.Mul(sprintVelocity)));
    }

    // rate candidates

    const goalPos = new Vector3(-team.GetSide() * pitchHalfW, playerPos.coords[1] * 0.8, 0); // y element is because goal is wider than 0
    const goalDistance = Math.abs(goalPos.Sub(playerPos).GetLength() - 5.0); // and not all too close
    const ballDistance = playerPos.Sub(ballPrediction100).GetLength();
    const formationDistance = basePosition.Sub(playerPos).GetLength();
    const offside = AI_GetOffsideLine(this.match, mentalImage, Math.abs(team.GetID() - 1));
    const playerMovement = player.GetMovement();

    let passRating: number; // are opponents blocking pass space to this position?

    let bestRating = 0;
    let bestCandidate = 0;

    const preRatings: PreRating[] = [];

    for (let i = 0; i < candidatePositions.length; i++) {
      const candidate = candidatePositions[i];
      if (Math.abs(candidate.coords[0]) < pitchHalfW && Math.abs(candidate.coords[1]) < pitchHalfH) {
        const preRating = new PreRating();
        preRating.candidateID = i;

        // offense rating
        preRating.offenseRating = clamp(((goalDistance - Math.abs(goalPos.Sub(candidate).GetLength() - 5.0)) / sprintVelocity) * 0.5 + 0.5, 0.0, 1.0);

        // distance rating
        let candidateBallDistance = candidate.Sub(ballPrediction100).GetLength();
        const desiredBallDistance = 10.0;
        // too close is bad as well..
        if (candidateBallDistance < desiredBallDistance) candidateBallDistance = desiredBallDistance + Math.abs(candidateBallDistance - desiredBallDistance);
        const candidateBallVsBallDistance = ballDistance - candidateBallDistance;

        preRating.distanceRating = clamp((candidateBallVsBallDistance / sprintVelocity) * 0.5 + 0.5, 0.0, 1.0);

        // movement rating
        preRating.movementRating = 1.0 - clamp(playerMovement.Sub(candidate.Sub(playerPos)).GetLength() / (2 * sprintVelocity), 0.0, 1.0);

        // formation rating
        preRating.formationRating = clamp(((formationDistance - basePosition.Sub(candidate).GetLength()) / sprintVelocity) * 0.5 + 0.5, 0.0, 1.0);

        // offside rating
        let isOffside = false;
        if (candidate.coords[0] * -team.GetSide() >= offside * -team.GetSide()) isOffside = true;
        preRating.offsideRating = isOffside ? 0.0 : 1.0;

        preRating.totalRating =
          preRating.offenseRating * offenseWeight +
          preRating.distanceRating * distanceWeight +
          preRating.movementRating * movementWeight +
          preRating.formationRating * formationWeight +
          preRating.offsideRating * offsideWeight;

        // small bonus for 'current position'
        if (i === 0) preRating.totalRating += 0.1;

        preRatings.push(preRating);
      }
    }

    preRatings.sort((a, b) => (PreRatingSortFunc(a, b) ? -1 : PreRatingSortFunc(b, a) ? 1 : 0));

    const ballPrediction240 = mentalImage.GetBallPrediction(240).Get2D();
    const ratedCount = Math.trunc(preRatings.length / 3);
    for (let i = 0; i < ratedCount; i++) {
      const preRating = preRatings[i];
      const candidateID = preRating.candidateID;
      const candidate = candidatePositions[candidateID];

      // pass rating
      passRating = 1.0;
      const checkPosition = candidate.Add(ballPrediction240.Sub(candidate).GetNormalized(0).Mul(2.0));
      for (let o = 0; o < opponentImages.length; o++) {
        const oppDist = Math.pow(clamp(opponentImages[o].position.Sub(checkPosition).GetLength() / 8.0, 0.0, 1.0), 1.2); // 0 .. 1 == worst, best
        if (oppDist < passRating) passRating = oppDist;
      }

      // total rating
      const totalRating = preRating.totalRating + passRating * passWeight;
      if (totalRating > bestRating) {
        bestRating = totalRating;
        bestCandidate = candidateID;
      }
    }

    const result = candidatePositions[bestCandidate];

    return result;
  }

  GetSupportPosition_ForceField(mentalImage: MentalImage, basePosition: Vector3, makeRun = false): Vector3 {
    const castPlayer = this.CastPlayer();
    const player = this.player;
    const team = this.team;
    const match = this.match;
    const side = team.GetSide();

    const designatedPlayer = team.GetDesignatedTeamPossessionPlayer();

    const currentPos = player.GetPosition().Add(castPlayer.GetMovement().Mul(0.1)); //basePosition;
    const mainManPos = designatedPlayer.GetPosition().Add(designatedPlayer.GetMovement().Mul(0.1));

    const forceField: ForceSpot[] = [];

    // support position

    const dynamicMindSet = AI_GetMindSet(castPlayer.GetDynamicFormationEntry().role);

    const forceNoOffside = true;

    const basePositionWeight = 0.7;
    const overallWeight = 1.0;
    let opponentRepelWeight = 0.3 * overallWeight;
    const teammateRepelWeight = 0.4 * overallWeight;
    const ballRepelWeight = 1.0 * overallWeight;
    const runWeight = 1.0 * overallWeight;
    const flockToPossessionPlayerWeight = 0.45 * overallWeight;

    const webScale = 0.75;

    switch (castPlayer.GetDynamicFormationEntry().role) {
      case e_PlayerRole.e_PlayerRole_CB:
      case e_PlayerRole.e_PlayerRole_LB:
      case e_PlayerRole.e_PlayerRole_RB:
        opponentRepelWeight *= 2.2;
        break;
      case e_PlayerRole.e_PlayerRole_DM:
        opponentRepelWeight *= 2.0;
        break;
      case e_PlayerRole.e_PlayerRole_CM:
      case e_PlayerRole.e_PlayerRole_LM:
      case e_PlayerRole.e_PlayerRole_RM:
        opponentRepelWeight *= 1.6;
        break;
      case e_PlayerRole.e_PlayerRole_AM:
        opponentRepelWeight *= 1.2;
        break;
      case e_PlayerRole.e_PlayerRole_CF:
        opponentRepelWeight *= 1.0;
        break;
      default:
        break;
    }

    const offsideX = AI_GetOffsideLine(match, this._mentalImage!, Math.abs(team.GetID() - 1), 240);
    const adaptedMakeRun = makeRun;

    // actual base position
    {
      const spot = new ForceSpot();
      spot.origin = basePosition;

      // let left and right flank flow forwards and backwards every period_sec seconds, for some dynamics
      // except for one close player, who should always run forward for support
      const forwardSupportPlayer = team.GetController().GetForwardSupportPlayer();
      if (player === forwardSupportPlayer) {
        spot.origin = spot.origin.WithCoord(0, spot.origin.coords[0] + -side * (0.3 + 0.7 * dynamicMindSet) * 12.0);
      } else {
        // lane version
        let amount = 22.0;
        const laneY = -signSide(mainManPos.coords[1]) * 8.0;
        amount *= curve(1.0 - NormalizedClamp(Math.abs(laneY - currentPos.coords[1]), 0.0, 30.0), 1.0);
        const delta = -side * Math.pow(dynamicMindSet, 1.5) * amount;
        spot.origin = spot.origin.WithCoord(0, spot.origin.coords[0] + delta);
      }

      spot.magnetType = e_MagnetType.e_MagnetType_Attract;
      spot.decayType = e_DecayType.e_DecayType_Constant;
      spot.power = 1.0 * basePositionWeight;
      // the farther away from this position, the more we are attracted to it
      spot.power *= 0.3 + 0.7 * NormalizedClamp(spot.origin.Sub(currentPos).GetLength(), 0.0, 20.0);
      forceField.push(spot);
    }

    if (adaptedMakeRun) {
      const spot = new ForceSpot();
      spot.origin = new Vector3(-side * pitchHalfW, currentPos.coords[1] * 0.5, 0.0);
      spot.magnetType = e_MagnetType.e_MagnetType_Attract;
      spot.decayType = e_DecayType.e_DecayType_Constant;
      spot.power = 2.0 * runWeight;
      forceField.push(spot);
    }

    // stay away from opponents
    const opponents: Player[] = [];
    // (sic: the C++ adds 0.7 to every coordinate here)
    AI_GetClosestPlayers(match.GetTeam(Math.abs(team.GetID() - 1)), mainManPos.Mul(0.3).Add(currentPos).Add(0.7), false, opponents, 3);
    for (let i = 0; i < opponents.length; i++) {
      const oppImg = mentalImage.GetPlayerImage(opponents[i].GetID());
      const spot = new ForceSpot();
      const oppPos = oppImg.position.Add(oppImg.movement.Mul(0.1));
      spot.origin = oppPos.Add(oppPos.Sub(mainManPos).GetNormalized(0).Mul(2.0)); // anti-magnet behind opponent, because the pass-way must be cleared
      spot.magnetType = e_MagnetType.e_MagnetType_Repel;
      spot.decayType = e_DecayType.e_DecayType_Variable;
      spot.power = 1.0 * opponentRepelWeight;
      spot.scale = 5.0;
      if (adaptedMakeRun) {
        spot.scale = 2.0;
        spot.power *= 0.5;
      }
      spot.exp = 0.7;
      forceField.push(spot);
    }

    // stay away from teammates
    if (team.GetFadingTeamPossessionAmount() >= 1.02) {
      const players: Player[] = [];
      AI_GetClosestPlayers(team, currentPos, false, players, 6);
      for (let i = 0; i < players.length; i++) {
        if (players[i] !== castPlayer) {
          const mateImg = mentalImage.GetPlayerImage(players[i].GetID());
          const spot = new ForceSpot();
          spot.origin = mateImg.position.Add(mateImg.movement.Mul(0.1));
          spot.magnetType = e_MagnetType.e_MagnetType_Repel;
          spot.decayType = e_DecayType.e_DecayType_Variable;
          spot.power = 1.0 * teammateRepelWeight;
          spot.scale = 14.0 * webScale;
          spot.exp = 1.0;
          forceField.push(spot);
        }
      }
    }

    // stay away from ball (to not get in the way of passes and possessionplayer)
    if (castPlayer !== designatedPlayer && team.GetFadingTeamPossessionAmount() >= 1.06) {
      const ballPredictionTimes_ms = [200, 350, 500, 650];
      for (let t = 0; t < ballPredictionTimes_ms.length; t++) {
        const spot = new ForceSpot();
        spot.magnetType = e_MagnetType.e_MagnetType_Repel;
        spot.decayType = e_DecayType.e_DecayType_Variable;
        spot.power = 1.0 * ballRepelWeight;
        spot.scale = 2.0;
        spot.exp = 0.5;
        spot.origin = mentalImage.GetBallPrediction(ballPredictionTimes_ms[t]).Get2D();
        forceField.push(spot);
      }
    }

    if (castPlayer !== designatedPlayer) {
      // attract to teammate in possession
      {
        const spot = new ForceSpot();
        spot.origin = mainManPos;
        spot.magnetType = e_MagnetType.e_MagnetType_Attract;
        spot.decayType = e_DecayType.e_DecayType_Variable;
        spot.power = 1.0 * flockToPossessionPlayerWeight;
        spot.scale = 28.0 * webScale;
        spot.exp = 1.0;
        forceField.push(spot);
      }

      // ..yet not too close
      {
        const spot = new ForceSpot();
        spot.origin = mainManPos;
        spot.magnetType = e_MagnetType.e_MagnetType_Repel;
        spot.decayType = e_DecayType.e_DecayType_Variable;
        spot.power = 1.0 * flockToPossessionPlayerWeight;
        spot.scale = 16.0 * webScale;
        spot.exp = 1.0;
        forceField.push(spot);
      }
    }

    let forceFieldPosition = currentPos.Add(AI_GetForceFieldMovement(forceField, currentPos, 7));

    const margin = 0.08;
    if (forceNoOffside) {
      if (forceFieldPosition.coords[0] * -side > offsideX * -side - margin) forceFieldPosition = forceFieldPosition.WithCoord(0, offsideX - margin * -side);
    }

    forceFieldPosition = new Vector3(clamp(forceFieldPosition.coords[0], -pitchHalfW, pitchHalfW), clamp(forceFieldPosition.coords[1], -pitchHalfH, pitchHalfH), forceFieldPosition.coords[2]);

    return forceFieldPosition;
  }

  override Reset(): void {
    this.lastDesiredDirection = new Vector3(0);
    this.lastDesiredVelocity = 0;
  }

  /**
   * C++ GetOnTheBallCommands(commandQueue, Vector3 &rawInputDirection, float &rawInputVelocity): rawInputDirection is
   * output only, rawInputVelocity is in/out (read as the shot velocity modifier); both new values are returned.
   */
  protected GetOnTheBallCommands(commandQueue: PlayerCommandQueue, rawInputVelocity: number): { rawInputDirection: Vector3; rawInputVelocity: number } {
    const castPlayer = this.CastPlayer();
    const player = this.player;
    const team = this.team;
    const match = this.match;
    const mentalImage = this._mentalImage!;
    const side = team.GetSide();

    let oneTouchIsHard = 0.0;
    const movementDiff = NormalizedClamp(match.GetBall().GetMovement().Sub(castPlayer.GetMovement()).GetLength(), 0.0, 10.0);
    oneTouchIsHard = movementDiff - castPlayer.GetStat('technical_shortpass') * movementDiff * 0.8;

    const opponentPlayerImages: PlayerImage[] = [];
    mentalImage.GetTeamPlayerImages(Math.abs(team.GetID() - 1), -1, opponentPlayerImages);

    // DECIDE WHAT TO DO

    const mindSet = AI_GetMindSet(castPlayer.GetDynamicFormationEntry().role);

    const longPossessionFactor = Math.pow(NormalizedClamp(castPlayer.GetPossessionDuration_ms(), 0, 5000), 2.0);

    // first selection
    const forwardSpaceWeight = 0.4;
    const spaceWeight = 0.3;
    const forwardWeight = 2.0 + mindSet * 6.0;

    const totalWeight1 = forwardSpaceWeight + spaceWeight + forwardWeight;
    const tacticalImprovementThreshold = 0.06 * (1.0 - mindSet); // only go on with pass selection if recipient has this much tactical advantage over current player

    // second selection
    const tacticalDiffWeight = 1.0 + Math.pow(mindSet, 2.0) * 10.0;
    const passWeight = 1.0;
    const passMinimum = 0.2 * (1.0 - mindSet) - longPossessionFactor * 0.1;

    const totalWeight2 = tacticalDiffWeight + passWeight;

    // name says it all
    const passThreshold = 0.1 - longPossessionFactor * 0.05;

    // self rating
    const sit = castPlayer.GetTacticalSituation();
    let tacticalRating = sit.forwardSpaceRating * forwardSpaceWeight + sit.spaceRating * spaceWeight + sit.forwardRating * forwardWeight;

    tacticalRating /= totalWeight1;

    // collect pass target candidates
    const mates: Player[] = [];
    team.GetActivePlayers(mates);

    // C++ struct MateRating bestMateRating
    let bestTotalRating = 0.0;
    let bestMatePlayer: Player | null = null;
    let bestMatePassRating = 0.0;
    let bestMatePassType = e_FunctionType.e_FunctionType_ShortPass;
    for (let i = 0; i < mates.length; i++) {
      const mate = mates[i];
      if (mate !== castPlayer) {
        const mateSit = mate.GetTacticalSituation();

        let mateTacticalRating = mateSit.forwardSpaceRating * forwardSpaceWeight + mateSit.spaceRating * spaceWeight + mateSit.forwardRating * forwardWeight;

        mateTacticalRating /= totalWeight1;
        if (mate.GetFormationEntry().role === e_PlayerRole.e_PlayerRole_GK) mateTacticalRating *= 0.7; // don't like playing back to goalie

        if (mateTacticalRating > tacticalRating + tacticalImprovementThreshold) {
          const tacticalDiffRating = mateTacticalRating - tacticalRating;

          let passRating: number;
          let passType: e_FunctionType;
          const passingOddsShort = this._GetPassingOdds(mate, e_FunctionType.e_FunctionType_ShortPass, opponentPlayerImages);
          const passingOddsLong = this._GetPassingOdds(mate, e_FunctionType.e_FunctionType_LongPass, opponentPlayerImages);
          const passingOddsHigh = this._GetPassingOdds(mate, e_FunctionType.e_FunctionType_HighPass, opponentPlayerImages);
          if (passingOddsShort >= passingOddsLong && passingOddsShort >= passingOddsHigh) {
            passRating = passingOddsShort;
            passType = e_FunctionType.e_FunctionType_ShortPass;
          } else if (passingOddsLong >= passingOddsHigh) {
            passRating = passingOddsLong;
            passType = e_FunctionType.e_FunctionType_LongPass;
          } else {
            passRating = passingOddsHigh;
            passType = e_FunctionType.e_FunctionType_HighPass;
          }

          let totalRating = tacticalDiffRating * tacticalDiffWeight + passRating * passWeight - oneTouchIsHard;

          totalRating /= totalWeight2;

          if (totalRating > bestTotalRating && totalRating > passThreshold && passRating > passMinimum) {
            bestTotalRating = totalRating;
            bestMatePlayer = mate;
            bestMatePassRating = passRating;
            bestMatePassType = passType;
          }
        }
      } // !self
    }

    // panic
    if (mindSet < 0.25) {
      const panicProneness = 1.0 - mindSet * 2.0;
      const goalCloseness = 1.0 - NormalizedClamp(castPlayer.GetPosition().Sub(new Vector3(pitchHalfW * castPlayer.GetTeam().GetSide(), 0, 0)).GetLength(), 2.0, 16.0);
      if (castPlayer.GetDynamicFormationEntry().role !== e_PlayerRole.e_PlayerRole_GK) {
        if ((bestMatePlayer === null || bestMatePassRating < panicProneness * goalCloseness) && this.possessionAmount < 0.9 + panicProneness * goalCloseness * 0.8) {
          this._AddPanicPass(commandQueue);
        }
      } else {
        // keeper
        if (this.possessionAmount < 3.0) {
          this._AddPanicPass(commandQueue);
        }
      }
    }

    if (bestMatePlayer !== null) {
      this._AddPass(commandQueue, bestMatePlayer, bestMatePassType);
    }

    // shoot?
    const goalDist = NormalizedClamp(new Vector3(pitchHalfW * -side, 0, 0).Sub(player.GetPosition()).GetLength(), 0.0, 32.0);
    let idealShotPosFactor = 1.0 - NormalizedClamp(new Vector3((pitchHalfW - 7.0) * -side, 0, 0).Sub(player.GetPosition()).GetLength(), 0.0, 16.0);
    idealShotPosFactor = curve(idealShotPosFactor, 1.0);
    if (idealShotPosFactor > 0.1) {
      const odds1 = this._GetPassingOdds(new Vector3((pitchHalfW + 1.0) * -side, -3.6, 0), e_FunctionType.e_FunctionType_Shot, opponentPlayerImages, 3.0);
      const odds2 = this._GetPassingOdds(new Vector3((pitchHalfW + 1.0) * -side, 0.0, 0), e_FunctionType.e_FunctionType_Shot, opponentPlayerImages, 3.0);
      const odds3 = this._GetPassingOdds(new Vector3((pitchHalfW + 1.0) * -side, 3.6, 0), e_FunctionType.e_FunctionType_Shot, opponentPlayerImages, 3.0);
      let odds = odds2;
      let y = 0.0;
      if (odds1 > odds) {
        odds = odds1;
        y = -3.5;
      }
      if (odds3 > odds) {
        odds = odds3;
        y = 3.5;
      }

      odds = Math.pow(odds, 0.5);

      if (odds + random(0.0, 0.5) > 0.5) {
        const command = new PlayerCommand();
        command.desiredFunctionType = e_FunctionType.e_FunctionType_Shot;
        command.useDesiredMovement = false;
        command.useDesiredLookAt = false;
        command.desiredVelocityFloat = rawInputVelocity; // this is so we can use sprint/dribble buttons as shot modifiers
        const shotStat = player.GetStat('technical_shot');
        const shotY = y + random(-1.0 + shotStat, 1.0 - shotStat);
        command.touchInfo.desiredDirection = new Vector3((pitchHalfW + 1.0) * -side, shotY, 0)
          .Sub(castPlayer.GetPosition().Add(castPlayer.GetMovement().Mul(0.2)))
          .GetNormalized(new Vector3(-side, 0, 0));
        command.touchInfo.desiredDirection = command.touchInfo.desiredDirection
          .Mul(0.7)
          .Add(castPlayer.GetDirectionVec().Neg().Mul(castPlayer.GetFloatVelocity() / sprintVelocity).Mul(0.3))
          .GetNormalized();
        command.touchInfo.autoDirectionBias = 1.0;
        command.touchInfo.desiredPower = random(0.7 * (0.6 + goalDist * 0.4), 1.0 * (0.6 + goalDist * 0.4));
        commandQueue.push(command);
      }
    }

    const dribble = AI_GetBestDribbleMovement(match, player.GetID(), mentalImage, team.GetTeamData().GetTactics());
    return { rawInputDirection: dribble.desiredDirection, rawInputVelocity: dribble.desiredVelocity };
  }

  protected _AddPass(commandQueue: PlayerCommandQueue, target: Player, passType: e_FunctionType): void {
    const command = new PlayerCommand();
    command.desiredFunctionType = passType;
    command.useDesiredMovement = false;
    command.useDesiredLookAt = false;
    command.touchInfo.targetPlayer = null;
    command.touchInfo.forcedTargetPlayer = target;
    command.touchInfo.inputDirection = new Vector3(0);
    command.touchInfo.inputPower = 0;
    command.touchInfo.autoDirectionBias = 1.0;
    command.touchInfo.autoPowerBias = 1.0;
    const touchInfo = command.touchInfo;
    const pass = AI_GetPass(this.CastPlayer(), passType, touchInfo.inputDirection, touchInfo.inputPower, touchInfo.autoDirectionBias, touchInfo.autoPowerBias, touchInfo.forcedTargetPlayer);
    touchInfo.desiredDirection = pass.resultingDirection;
    touchInfo.desiredPower = pass.resultingPower;
    touchInfo.targetPlayer = pass.targetPlayer;
    commandQueue.push(command);
  }

  protected _AddPanicPass(commandQueue: PlayerCommandQueue): void {
    const player = this.player;
    const yside = signSide(player.GetDirectionVec().coords[1]); // > 0 ? 1 : -1;
    let sensibleAwayDir = player
      .GetDirectionVec()
      .Mul(new Vector3(0.8, 1.0, 0.0))
      .GetNormalized()
      .Add(new Vector3(-this.team.GetSide() * 0.7, yside * 0.5, 0))
      .GetNormalized(0)
      .Add(new Vector3(0, 0, 0.3));
    sensibleAwayDir = sensibleAwayDir.GetNormalized(player.GetDirectionVec());

    const command = new PlayerCommand();
    command.useDesiredMovement = false;
    command.useDesiredLookAt = false;

    command.touchInfo.inputDirection = sensibleAwayDir;
    command.touchInfo.desiredDirection = sensibleAwayDir;
    command.touchInfo.autoDirectionBias = 0.0;
    command.touchInfo.autoPowerBias = 0.0;

    // (C++ pushes copies of the same command, modified in between)
    command.desiredFunctionType = e_FunctionType.e_FunctionType_HighPass;
    command.touchInfo.inputPower = 0.7;
    command.touchInfo.desiredPower = 0.7;
    commandQueue.push(command.Clone());

    command.desiredFunctionType = e_FunctionType.e_FunctionType_Shot;
    command.touchInfo.inputPower = 0.6;
    command.touchInfo.desiredPower = 0.6;
    commandQueue.push(command.Clone());

    command.desiredFunctionType = e_FunctionType.e_FunctionType_LongPass;
    command.touchInfo.inputPower = 0.8;
    command.touchInfo.desiredPower = 0.8;
    commandQueue.push(command);
  }

  /** C++ overloads _GetPassingOdds(Player *targetPlayer, ...) and _GetPassingOdds(const Vector3 &target, ...) */
  protected _GetPassingOdds(target: Player | Vector3, passType: e_FunctionType, opponentPlayerImages: readonly PlayerImage[], ballVelocityMultiplier = 1.0): number {
    if (!(target instanceof Vector3)) {
      const targetPlayer = target;
      const initialTargetDistance = targetPlayer.GetPosition().Sub(this.player.GetPosition()).GetLength();
      if (passType === e_FunctionType.e_FunctionType_HighPass && initialTargetDistance < 10.0) return 0.0;
      const estimatedTime_sec = 0.7 + initialTargetDistance * 0.03;

      let targetPos = targetPlayer.GetPosition().Add(targetPlayer.GetMovement().Mul(clamp(estimatedTime_sec, 0.0, 0.5))); // time needed to brake
      if (passType === e_FunctionType.e_FunctionType_LongPass) targetPos = targetPos.Add(new Vector3(-this.team.GetSide() * initialTargetDistance * 0.2, 0, 0));

      return this._GetPassingOdds(targetPos, passType, opponentPlayerImages, ballVelocityMultiplier);
    }

    const secondScale = 1.0; // how many seconds of range to measure danger in

    const origin = this.player.GetPosition().Add(this.player.GetMovement().Mul(0.12));

    // draw imaginary line between this and target player
    const line = new Line(origin, target);

    let danger = 0.0;
    for (let opp = 0; opp < opponentPlayerImages.length; opp++) {
      const oppImage = opponentPlayerImages[opp];
      const oppPos = oppImage.position.Add(oppImage.movement.Mul(0.2)); // + time needed to brake
      const { distance: oppDistance, u } = line.GetDistanceToPoint(oppPos); // u: % of line opp is closest to (0 .. 1)

      if (u >= 0.0 && u <= 1.0 + 0.2) {
        // opp is dangerous in the first place
        if ((passType === e_FunctionType.e_FunctionType_HighPass && (u < 0.2 || u > 0.65)) || passType !== e_FunctionType.e_FunctionType_HighPass) {
          const clampedU = clamp(u, 0.0, 1.0);
          const intersect = origin.Mul(1.0 - clampedU).Add(target.Mul(clampedU)); // where opp is most likely to intercept ball

          const oppToIntersect_sec = (oppDistance + 1.0) / sprintVelocity; // add some distance to correct for acceleration

          const originToBallPos = intersect.Sub(origin);
          const penaltyTime = passType === e_FunctionType.e_FunctionType_HighPass && u > 0.5 ? 2.5 : 0.0; // trapping high balls takes time
          let ballToIntersect_sec = 0.7 + originToBallPos.GetLength() * u * 0.03 + penaltyTime;
          ballToIntersect_sec *= 1.0 / ballVelocityMultiplier;

          danger += clamp(ballToIntersect_sec - oppToIntersect_sec + secondScale * 0.5, 0.0, secondScale); // add some seconds because 0 seconds doesn't mean 0 danger
        }
      }
    }

    if (passType === e_FunctionType.e_FunctionType_HighPass) danger += 0.4; // just don't prefer high passing when low passing is applicable as well

    danger = NormalizedClamp(danger, 0.0, secondScale); // 1 super dangerous dude is basically the same as 100% danger
    const odds = 1.0 - danger;

    return odds;
  }

  protected _AddCelebration(commandQueue: PlayerCommandQueue): void {
    const player = this.player;
    const team = this.team;
    const match = this.match;

    const xSide = match.GetBall().Predict(0).Get2D().coords[0] > 0 ? 1 : -1;
    let ySide = team.GetSide();
    const lastTouchPlayer = team.GetLastTouchPlayer();
    if (lastTouchPlayer) ySide = lastTouchPlayer.GetPosition().coords[1] > 0 ? 1 : -1;
    let celebrationPosition = new Vector3(pitchHalfW * xSide, pitchHalfH * ySide, 0);

    let desiredDirection = celebrationPosition.Sub(player.GetPosition()).GetNormalized();
    let desiredVelocityFloat = ClampVelocity(celebrationPosition.Sub(player.GetPosition()).GetLength() / 4.0);
    let desiredLookAt = player.GetPosition().Add(player.GetDirectionVec().Mul(1000));

    let celebrationType = 1;
    if (match.GetLastGoalTeamID() !== team.GetID()) {
      celebrationType = 2;
      desiredVelocityFloat = idleVelocity;
    } else {
      celebrationType = 1;
    }

    let madeGoal = 1;
    if (celebrationType === 1) {
      if (lastTouchPlayer === player) {
        madeGoal = 2;
        desiredVelocityFloat = sprintVelocity;
      } else {
        madeGoal = 1;
        if (lastTouchPlayer !== null) {
          if (lastTouchPlayer.GetPosition().Sub(player.GetPosition()).GetLength() < 20) {
            celebrationPosition = lastTouchPlayer.GetPosition();
            desiredDirection = lastTouchPlayer.GetPosition().Mul(0.5).Add(celebrationPosition.Mul(0.5)).Sub(player.GetPosition()).GetNormalized();
            desiredVelocityFloat = ClampVelocity(lastTouchPlayer.GetPosition().Sub(player.GetPosition()).GetLength() / 2.0);
          } else {
            desiredVelocityFloat = idleVelocity;
          }
          desiredLookAt = player.GetPosition().Add(lastTouchPlayer.GetDirectionVec().Mul(100));
        }
      }
    }

    // celebration

    const sinceStop_ms = match.GetActualTime_ms() - match.GetReferee().GetBuffer().stopTime;
    if (sinceStop_ms > 2000 && sinceStop_ms < 4000) {
      const command = new PlayerCommand();
      command.desiredFunctionType = e_FunctionType.e_FunctionType_Special;
      command.useSpecialVar1 = true;
      command.specialVar1 = celebrationType;
      command.useSpecialVar2 = true;
      command.specialVar2 = madeGoal;
      command.useDesiredMovement = false;
      command.useDesiredLookAt = false;
      commandQueue.push(command);
    }

    // movement

    {
      const command = new PlayerCommand();
      command.desiredFunctionType = e_FunctionType.e_FunctionType_Movement;
      command.useDesiredMovement = true;
      command.desiredDirection = desiredDirection;
      command.desiredVelocityFloat = desiredVelocityFloat;
      command.useDesiredLookAt = true;
      command.desiredLookAt = desiredLookAt;
      commandQueue.push(command);
    }
  }
}
