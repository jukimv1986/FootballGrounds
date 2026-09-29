// Port of legacy/src/onthepitch/player/controller/playercontroller.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).

import { Vector3 } from '../../../../blunted/base/math/vector3';
import { NormalizedClamp, clamp, curve, pi } from '../../../../blunted/base/math/bluntmath';
import { Line } from '../../../../blunted/base/geometry/line';
import { assert } from '../../../../blunted/base/assert';
import {
  PlayerCommand,
  ballDistanceOptimizeThreshold,
  distanceToVelocityMultiplier,
  dribbleWalkSwitch,
  e_FunctionType,
  e_PlayerCommandModifier,
  e_PlayerRole,
  e_StrictMovement,
  e_TouchType,
  e_Velocity,
  idleDribbleSwitch,
  idleVelocity,
  pitchHalfH,
  pitchHalfW,
  quantizeDirection,
  sprintVelocity,
  walkSprintSwitch,
  walkVelocity,
  type PlayerCommandQueue,
} from '../../../gamedefines';
import { GetQuantizedDirectionBias, QuantizeDirection } from '../../../footballutils';
import type { Match } from '../../match';
import type { Team } from '../../team';
import type { MentalImage } from '../../AIsupport/mentalimage';
import { AI_GetBallControlMovement, AI_GetToBallMovement } from '../../AIsupport/AIfunctions';
import type { Player } from '../player';
import type { PlayerBase } from '../playerbase';
import { FloatToEnumVelocity } from '../humanoid/animcollection';
import { IController } from './icontroller';

export abstract class PlayerController extends IController {
  protected inputDirection = new Vector3(0, -1, 0);
  protected inputVelocityFloat = 0;

  protected _oppPlayer: Player | null = null;
  protected _timeNeeded_ms = 0;
  protected _mentalImage: MentalImage | null = null;

  // only really useful for human gamers, after switching player
  protected lastSwitchTime_ms = -10000;
  protected lastSwitchTimeDuration_ms = 0;

  protected team!: Team;
  protected oppTeam!: Team;

  protected hasPossession = false;
  protected hasUniquePossession = false;
  protected teamHasPossession = false;
  protected teamHasUniquePossession = false;
  protected oppTeamHasPossession = false;
  protected oppTeamHasUniquePossession = false;
  protected hasBestPossession = false;
  protected teamHasBestPossession = false;
  protected possessionAmount = 0.9;
  protected teamPossessionAmount = 1.0;
  protected fadingTeamPossessionAmount = 1.0;
  protected timeNeededToGetToBall = 100;
  protected oppTimeNeededToGetToBall = 100;
  protected hasBestChanceOfPossession = false;

  constructor(match: Match) {
    super(match);
    // C++: the virtual Reset() call in this constructor resolves to PlayerController::Reset
    PlayerController.prototype.Reset.call(this);
  }

  override Process(): void {
    let reactionTime_ms = this.GetReactionTime_ms();
    if (this.match.GetLastTouchPlayer() === this.CastPlayer() && this.CastPlayer().GetLastTouchType() !== e_TouchType.e_TouchType_Accidental) reactionTime_ms = 0;
    // instant knowledge 'cheat' (aka. teamplay; players know what their teammates will do. maybe make dynamic based on some teamplay stat in the future)

    this._mentalImage = this.match.GetMentalImage(reactionTime_ms);
  }

  override SetPlayer(player: PlayerBase): void {
    super.SetPlayer(player);
    this.team = this.CastPlayer().GetTeam();
    this.oppTeam = this.match.GetTeam(Math.abs(this.team.GetID() - 1));
    assert(this.oppTeam);
  }

  CastPlayer(): Player {
    return this.player as Player;
  }

  GetTeam(): Team {
    return this.team;
  }

  GetOppTeam(): Team {
    return this.oppTeam;
  }

  GetMentalImage(): MentalImage | null {
    return this._mentalImage;
  }

  override GetReactionTime_ms(): number {
    let reactionTime_ms = super.GetReactionTime_ms();
    if (this.team.GetHumanGamerCount() === 0) reactionTime_ms = Math.trunc(reactionTime_ms + (1.0 - this.GetMatch().GetMatchDifficulty()) * 100); // C++: int += float
    return reactionTime_ms;
  }

  GetLastSwitchBias(): number {
    if (!this.match.IsInPlay() || this.match.IsInSetPiece()) this.lastSwitchTime_ms = -10000;
    if (this.lastSwitchTimeDuration_ms > 0) return 1.0 - clamp((this.match.GetActualTime_ms() - this.lastSwitchTime_ms) / this.lastSwitchTimeDuration_ms, 0.0, 1.0);
    return 0.0;
  }

  GetFadingTeamPossessionAmount(): number {
    return this.fadingTeamPossessionAmount;
  }

  /** PORT: C++ modified desiredPosition (Vector3 &) in place; returns the new desiredPosition instead */
  AddDefensiveComponent(desiredPosition: Vector3, bias: number, forcedOppID = -1): Vector3 {
    let opponentID: number;
    if (forcedOppID === -1) opponentID = this.CastPlayer().GetManMarkingID();
    else opponentID = forcedOppID;

    if (this.match.IsInPlay() && !this.match.IsInSetPiece() && this.CastPlayer().GetFormationEntry().role !== e_PlayerRole.e_PlayerRole_GK) {
      if (opponentID !== -1) {
        let defendPosition = desiredPosition;

        const possessionPlayerShootThreshold = 24.0; // distance at which opp must be marked tightly
        const genericOpponentShootThreshold = 8.0; // distance at which opp must be marked tightly
        const minDistance = 0.4; // distance 'in front' of opp - how far from opp we defend as minimum
        const bufferDistance = 4.0; // we want to be at least this distance closer to shooting point than opp

        // calculate some basic vars
        const side = this.team.GetSide();
        const opp = this.match.GetTeam(Math.abs(this.team.GetID() - 1)).GetPlayer(opponentID)!;
        const oppImage = this.match.GetMentalImage(this.GetReactionTime_ms()).GetPlayerImage(opp.GetID());
        const oppPos = oppImage.position.Add(oppImage.movement.Mul(0.5));

        let shootThreshold = genericOpponentShootThreshold;
        if (opp === this.match.GetDesignatedPossessionPlayer()) {
          shootThreshold = possessionPlayerShootThreshold;
        }

        const goalPos = new Vector3(pitchHalfW * side, 0, 0);

        // calculate how close the opponent is to the goal/shooting treshold
        const oppToGoalDistance = goalPos.Sub(oppPos).GetLength();
        let oppToThresholdDistance = clamp(oppToGoalDistance - shootThreshold, minDistance, pitchHalfW);
        let shootingPoint = oppPos.Add(goalPos.Sub(oppPos).GetNormalized(0).Mul(oppToThresholdDistance));

        // if shootingPoint.coords[0] exceeds offside trap line, alter oppToThresholdDistance in such a way, that it results in the shootingPoint being at least offsideTrapX distance away from goal (unless player is closer already)
        const offsideTrapX = this.team.GetController().GetOffsideTrapX();
        if (shootingPoint.coords[0] * side > offsideTrapX * side) {
          const oppToGoalLine = new Line();
          oppToGoalLine.SetVertex(0, oppPos);
          oppToGoalLine.SetVertex(1, goalPos);
          const offsideLine = new Line();
          offsideLine.SetVertex(0, new Vector3(offsideTrapX, -pitchHalfH, 0));
          offsideLine.SetVertex(1, new Vector3(offsideTrapX, pitchHalfH, 0));
          shootingPoint = oppToGoalLine.GetIntersectionPoint(offsideLine);
          oppToThresholdDistance = shootingPoint.Sub(oppPos).GetLength();
        }

        // now we want to keep the distance to shootingPoint smaller than the opponent's.
        const meToThreshold = shootingPoint.Sub(desiredPosition);
        const meToThresholdDistance = meToThreshold.GetLength();

        const slackedDistance = meToThresholdDistance - (oppToThresholdDistance - bufferDistance);
        if (slackedDistance > 0.0) {
          defendPosition = desiredPosition.Add(meToThreshold.GetNormalized(0).Mul(clamp(slackedDistance, 0.0, meToThresholdDistance)));
        }

        // if we are too late, don't run straight towards the shootingPoint, but instead, more towards our goal
        const actualPos = this.CastPlayer().GetPosition().Add(this.CastPlayer().GetMovement().Mul(0.14));
        const actualToThresholdDistance = shootingPoint.Sub(actualPos).GetLength();
        const actualSlackedDistance = actualToThresholdDistance - oppToThresholdDistance;
        if (actualSlackedDistance > 0.0) {
          defendPosition = defendPosition.Add(goalPos.Sub(defendPosition).GetNormalized(0).Mul(actualSlackedDistance * 0.7));
        }

        desiredPosition = desiredPosition.Mul(1.0 - bias).Add(defendPosition.Mul(bias));
      }
    }

    return desiredPosition;
  }

  GetDefendPosition(opp: Player, distance = 0.0): Vector3 {
    const oppImage = this._mentalImage!.GetPlayerImage(opp.GetID());

    // find the position on the opp -> goal line where we want to go to intercept. this point is the same distance away from opp as it is from us.
    // to find this point:
    // 1) create a line AB between us and op
    // 2) create another line CD perpendicular to AB, that intersects the middle point of AB
    // 3) find the intersection point of CD with the original opp to goal line. if this intersection point is between opp and goal, it's our target. (if not, we're too late, just run to goal :p)

    const goalPos = new Vector3(pitchHalfW * this.team.GetSide(), 0, 0);
    const oppPosition = oppImage.position; // lol @ varname
    const oppToGoal = goalPos.Sub(oppPosition);

    const oppToGoalLine = new Line();
    oppToGoalLine.SetVertex(0, oppPosition);
    oppToGoalLine.SetVertex(1, goalPos);
    // 1
    const meToOppLine = new Line();
    meToOppLine.SetVertex(0, this.player.GetPosition());
    meToOppLine.SetVertex(1, oppPosition);
    const midPoint = meToOppLine.GetVertex(0).Mul(0.5).Add(meToOppLine.GetVertex(1).Mul(0.5));
    // 2
    const midToOppPerpendicularLine = new Line();
    midToOppPerpendicularLine.SetVertex(0, midPoint);
    midToOppPerpendicularLine.SetVertex(1, midPoint.Add(meToOppLine.GetVertex(0).Sub(midPoint).GetRotated2D(0.5 * pi)));
    // 3
    let { u } = oppToGoalLine.GetIntersectionPointU(midToOppPerpendicularLine);

    u = clamp(u, 0.0, 1.0);
    let target = oppToGoalLine.GetVertex(0).Add(oppToGoalLine.GetVertex(1).Sub(oppToGoalLine.GetVertex(0)).Mul(u));

    const oppToGoalNormalized = oppToGoal.GetNormalized(0);
    target = target.Add(oppToGoalNormalized.Mul(sprintVelocity * 0.1).Add(oppImage.movement.Mul(0.14)).Add(oppToGoalNormalized.Mul(distance)));

    return target;
  }

  override Reset(): void {
    this.lastSwitchTimeDuration_ms = 0;
    this.lastSwitchTime_ms = -10000;
    this._mentalImage = null;
    this.inputDirection = new Vector3(0, -1, 0);
    this.inputVelocityFloat = 0;

    this.hasPossession = false;
    this.hasUniquePossession = false;
    this.teamHasPossession = false;
    this.teamHasUniquePossession = false;
    this.oppTeamHasPossession = false;
    this.oppTeamHasUniquePossession = false;
    this.hasBestChanceOfPossession = false;
    this.teamHasBestPossession = false;
    this.possessionAmount = 0.9;
    this.teamPossessionAmount = 1.0;
    this.fadingTeamPossessionAmount = 1.0;
    this.timeNeededToGetToBall = 100;
    this.oppTimeNeededToGetToBall = 100;
    this.hasBestPossession = false;
  }

  protected OppBetweenBallAndMeDot(): number {
    const opp = this.match.GetTeam(Math.abs(this.team.GetID() - 1)).GetDesignatedTeamPossessionPlayer();
    const oppFuturePos = opp.GetPosition().Add(opp.GetMovement().Mul(0.1));
    const MeToOpp = oppFuturePos.Sub(this.CastPlayer().GetPosition().Add(this.CastPlayer().GetMovement().Mul(0.1)));
    const oppToBall = this._mentalImage!.GetBallPrediction(100).Get2D().Sub(oppFuturePos);
    const dot = MeToOpp.GetNormalized(0).GetDotProduct(oppToBall.GetNormalized(0));

    // if dot nears 1, it means opp is somewhat between ball and me
    return dot;
  }

  protected CouldWinABallDuelLikeliness(): number {
    // uses the OppBetweenBallAndMeDot to check for correct angle, but also checks ball distance from opp
    const dot = this.OppBetweenBallAndMeDot() * 0.5 + 0.5;
    return 1.0 - dot;
  }

  protected _Preprocess(): void {
    this._oppPlayer = this.match.GetPlayer(this.match.GetTeam(Math.abs(this.team.GetID() - 1)).GetBestPossessionPlayerID());
    this._timeNeeded_ms = this.CastPlayer().GetTimeNeededToGetToBall_ms(); // needed for synced version - if we would ask on the spot and compare to opp, opp may already have calculated a new one while ours has not been processed yet
  }

  protected _SetInput(inputDirection: Vector3, inputVelocityFloat: number): void {
    this.inputDirection = inputDirection;
    this.inputVelocityFloat = inputVelocityFloat;
  }

  protected _KeeperDeflectCommand(commandQueue: PlayerCommandQueue, onlyPickupAnims = false): void {
    if (this.CastPlayer().GetFormationEntry().role !== e_PlayerRole.e_PlayerRole_GK) return;
    const ball = this.match.GetBall();
    if (ball.Predict(400).GetDistance(this.player.GetPosition()) > ballDistanceOptimizeThreshold + 10.0) return;

    // can't use hands if teammate intentionally kicked ball to us
    if (
      this.match.GetLastTouchTeamID() === this.team.GetID() &&
      this.match.GetLastTouchPlayer() !== this.CastPlayer() &&
      this.match.GetLastTouchTeamID(e_TouchType.e_TouchType_Intentional_Kicked) === this.team.GetID()
    )
      return;

    if (this.match.GetBallRetainer() !== null) return;

    // can't use hands outside of keeper's 16 yard box (todo: make precise, probably in humanoid.cpp's getbestcheatableanim)
    const ballPos160 = ball.Predict(160);
    if (Math.abs(ballPos160.coords[1]) > 20.05) return;
    if (ballPos160.coords[0] * -this.team.GetSide() > -pitchHalfW + 16.4) return;

    const command = new PlayerCommand();
    command.desiredFunctionType = e_FunctionType.e_FunctionType_Deflect;
    command.useDesiredMovement = false;
    command.useDesiredLookAt = false;
    if (onlyPickupAnims) command.onlyDeflectAnimsThatPickupBall = true;
    commandQueue.push(command);
  }

  protected _SetPieceCommand(commandQueue: PlayerCommandQueue): void {
    // do not allow running away :p
    const command = new PlayerCommand();
    command.desiredFunctionType = e_FunctionType.e_FunctionType_Movement;
    command.useDesiredMovement = true;
    command.useDesiredLookAt = true;
    command.desiredDirection = this.CastPlayer().GetDirectionVec();
    command.desiredVelocityFloat = idleVelocity;
    if (this.match.GetBallRetainer() === this.player) {
      command.desiredLookAt = this.player.GetPosition().Add(this.inputDirection.Mul(10.0));
    } else {
      command.desiredLookAt = this.match.GetBall().Predict(0).Get2D();
    }
    commandQueue.push(command);
  }

  protected _BallControlCommand(commandQueue: PlayerCommandQueue, idleTurnToOpponentGoal = false, knockOn = false, stickyRunDirection = false, keepCurrentBodyDirection = false): void {
    const ball = this.match.GetBall();
    if (ball.Predict(200).GetDistance(this.player.GetPosition()) > ballDistanceOptimizeThreshold) return;
    if (this.match.GetBallRetainer() !== null) return;

    const castPlayer = this.CastPlayer();

    if (!castPlayer.HasPossession() && !castPlayer.AllowLastDitch()) {
      const strictnessInv = 3.0;
      if (Math.abs(ball.GetMovement().coords[2]) > 5.0 * strictnessInv) return;
      if (ball.GetMovement().Get2D().Sub(castPlayer.GetMovement()).GetLength() > 5.0 * strictnessInv) return;
    }

    if (
      this.match.GetDesignatedPossessionPlayer() === this.player ||
      (this.team.GetDesignatedTeamPossessionPlayer() === this.player && this.CouldWinABallDuelLikeliness() >= 0.25)
    ) {
      const command = new PlayerCommand();
      command.desiredFunctionType = e_FunctionType.e_FunctionType_BallControl;
      command.useDesiredMovement = true;
      command.desiredDirection = this.inputDirection;
      if (quantizeDirection) command.desiredDirection = QuantizeDirection(command.desiredDirection, GetQuantizedDirectionBias());
      command.desiredVelocityFloat = this.inputVelocityFloat;

      if (FloatToEnumVelocity(command.desiredVelocityFloat) === e_Velocity.e_Velocity_Idle && idleTurnToOpponentGoal) {
        command.desiredDirection = new Vector3(-this.team.GetSide(), 0, 0);
      }

      if (knockOn) command.modifier |= e_PlayerCommandModifier.e_PlayerCommandModifier_KnockOn;

      if (
        this.hasPossession &&
        this.hasBestPossession &&
        command.desiredVelocityFloat > walkSprintSwitch &&
        castPlayer.GetFloatVelocity() > dribbleWalkSwitch &&
        stickyRunDirection
      ) {
        const angle = command.desiredDirection.GetAngle2D(castPlayer.GetDirectionVec());
        if (Math.abs(angle) > 0.125 * pi && Math.abs(angle) < 0.7 * pi) {
          if (angle > 0) command.desiredDirection = castPlayer.GetDirectionVec().GetRotated2D(0.125 * pi);
          if (angle < 0) command.desiredDirection = castPlayer.GetDirectionVec().GetRotated2D(0.125 * -pi);
        }
      }

      command.useDesiredLookAt = true;
      if (
        keepCurrentBodyDirection &&
        (castPlayer.GetEnumVelocity() === e_Velocity.e_Velocity_Walk || castPlayer.GetEnumVelocity() === e_Velocity.e_Velocity_Dribble) &&
        FloatToEnumVelocity(command.desiredVelocityFloat) === e_Velocity.e_Velocity_Dribble
      ) {
        // sidestep dribble and such tricks! (not implemented yet, methinks)
        command.desiredVelocityFloat = walkVelocity;
        command.desiredLookAt = castPlayer.GetPosition().Add(castPlayer.GetDirectionVec().Mul(10.0));
      } else {
        command.desiredLookAt = castPlayer.GetPosition().Add(castPlayer.GetMovement().Mul(0.2)).Add(command.desiredDirection.Mul(10.0));
      }

      commandQueue.push(command);
    }
  }

  protected _TrapCommand(commandQueue: PlayerCommandQueue, idleTurnToOpponentGoal = false, knockOn = false): void {
    const ball = this.match.GetBall();
    if (ball.GetMovement().Get2D().GetLength() < 2.0) return;

    if (ball.Predict(200).GetDistance(this.player.GetPosition()) > ballDistanceOptimizeThreshold) return;
    if (this.match.GetBallRetainer() !== null) return;

    const castPlayer = this.CastPlayer();

    if (
      !this.hasPossession &&
      (this.match.GetDesignatedPossessionPlayer() === this.player ||
        (this.team.GetDesignatedTeamPossessionPlayer() === this.player &&
          castPlayer.GetTimeNeededToGetToBall_optimistic_ms() < 1000 &&
          this.oppTimeNeededToGetToBall > 400 &&
          !this.oppTeamHasPossession &&
          this.CouldWinABallDuelLikeliness() >= 0.5))
    ) {
      // opp time was 500 ms

      const command = new PlayerCommand();
      command.desiredFunctionType = e_FunctionType.e_FunctionType_Trap;
      command.useDesiredMovement = true;
      command.desiredDirection = this.inputDirection;
      if (quantizeDirection) command.desiredDirection = QuantizeDirection(command.desiredDirection, GetQuantizedDirectionBias());

      command.desiredVelocityFloat = this.inputVelocityFloat;
      if (castPlayer.GetFormationEntry().role === e_PlayerRole.e_PlayerRole_GK && !this.team.IsHumanControlled(this.player.GetID())) {
        command.desiredDirection = new Vector3(-this.team.GetSide(), 0, 0);
        command.desiredVelocityFloat = idleVelocity;
      }

      if (FloatToEnumVelocity(command.desiredVelocityFloat) === e_Velocity.e_Velocity_Idle && idleTurnToOpponentGoal) {
        command.desiredDirection = new Vector3(-this.team.GetSide(), 0, 0);
      }

      if (knockOn) {
        command.modifier |= e_PlayerCommandModifier.e_PlayerCommandModifier_KnockOn;
      }

      command.useDesiredLookAt = true;
      command.desiredLookAt = castPlayer.GetPosition().Add(castPlayer.GetMovement().Mul(0.3)).Add(command.desiredDirection.Mul(10.0));

      commandQueue.push(command);
    }
  }

  protected _InterfereCommand(commandQueue: PlayerCommandQueue, byAnyMeans = false): void {
    if (this.match.GetBall().Predict(200).GetDistance(this.player.GetPosition()) > ballDistanceOptimizeThreshold) return;
    if (this.match.GetBallRetainer() !== null) return;

    if (!this.teamHasBestPossession) {
      if (!byAnyMeans) {
        // if dot nears 1, it means opp is somewhat between ball and me
        if (this.CouldWinABallDuelLikeliness() < 0.2) return;
      }

      const command = new PlayerCommand();
      command.desiredFunctionType = e_FunctionType.e_FunctionType_Interfere;
      command.useDesiredMovement = true;

      command.strictMovement = e_StrictMovement.e_StrictMovement_True;
      if (byAnyMeans) {
        command.strictMovement = e_StrictMovement.e_StrictMovement_False;
      }
      command.desiredDirection = this.inputDirection;
      command.desiredVelocityFloat = this.inputVelocityFloat;
      commandQueue.push(command);
    }
  }

  protected _SlidingCommand(commandQueue: PlayerCommandQueue): void {
    if (this.team.GetHumanGamerCount() !== 0) return;
    if (this.match.GetBallRetainer() !== null) return;
    if (this.CouldWinABallDuelLikeliness() < 0.7) return;

    if (!this.teamHasBestPossession && this.possessionAmount < 0.6 && this.match.GetDesignatedPossessionPlayer() !== this.player && this.oppTeamHasPossession) {
      const oppPlayer = this._oppPlayer!;
      const ballPos = this.match.GetMentalImage(20).GetBallPrediction(200);
      const playerPos = this.player.GetPosition().Add(this.player.GetMovement().Mul(0.2));

      const ballDist = playerPos.Sub(ballPos).GetLength();
      if (
        (ballDist > 0.7 && ballDist < 1.6 && this.oppTimeNeededToGetToBall > 260) ||
        (ballDist > 0.6 && ballDist < 1.8 && oppPlayer.GetCurrentFunctionType() === e_FunctionType.e_FunctionType_Shot && oppPlayer.TouchPending())
      ) {
        // no opp in the way?
        const command = new PlayerCommand();
        command.desiredFunctionType = e_FunctionType.e_FunctionType_Sliding;
        command.useDesiredMovement = true;
        command.desiredDirection = ballPos.Get2D().Add(oppPlayer.GetMovement().Mul(0.2)).Sub(playerPos).GetNormalized(new Vector3(-this.team.GetSide(), 0, 0));
        command.desiredVelocityFloat = sprintVelocity;
        command.useDesiredLookAt = true;
        command.desiredLookAt = this.CastPlayer().GetPosition().Add(this.CastPlayer().GetMovement().Mul(0.1)).Add(command.desiredDirection.Mul(10.0));
        commandQueue.push(command);
      }
    }
  }

  protected _MovementCommand(commandQueue: PlayerCommandQueue, forceMagnet = false, extraHaste = false): void {
    const defaultLookAtTime_ms = 40;

    const mentalImage = this._mentalImage!;
    const castPlayer = this.CastPlayer();
    const player = this.player;
    const playerPos = player.GetPosition();

    let quantizedInputDirection = this.inputDirection;
    if (quantizeDirection) quantizedInputDirection = QuantizeDirection(quantizedInputDirection, GetQuantizedDirectionBias());

    const command = new PlayerCommand();
    command.desiredFunctionType = e_FunctionType.e_FunctionType_Movement;
    command.useDesiredMovement = true;
    command.useDesiredLookAt = true;

    // defaults
    const manualDirection = quantizedInputDirection;
    const manualVelocityFloat = this.inputVelocityFloat;

    let defaultLookDirection = manualDirection;
    const desiredVeloFactor = 1.0 - Math.pow(NormalizedClamp(Math.min(this.inputVelocityFloat, player.GetFloatVelocity()), idleDribbleSwitch, sprintVelocity), 0.5) * 0.3;
    let focusPos = mentalImage.GetBallPrediction(defaultLookAtTime_ms).Get2D();
    focusPos = focusPos.Add(player.GetDirectionVec().Mul(0.5)); // to keep looking forward if ball is very close
    const toFocusAngle = focusPos.Sub(playerPos).GetNormalized(manualDirection).GetAngle2D(manualDirection);
    defaultLookDirection = manualDirection.GetRotated2D(toFocusAngle * Math.pow(desiredVeloFactor, 0.7));

    command.desiredDirection = manualDirection;
    command.desiredVelocityFloat = manualVelocityFloat;

    let autoDirection = command.desiredDirection;
    let autoVelocityFloat = command.desiredVelocityFloat;
    let autoLookDirection = defaultLookDirection;

    const adaptedPossessionAmount = this.possessionAmount;

    castPlayer.SetDesiredTimeToBall_ms(0);

    let autoBias = 0.0;

    // decide what type of magnet is to be used

    const inputDirIsOwnHalfFactor = NormalizedClamp(this.inputDirection.GetDotProduct(new Vector3(this.team.GetSide(), 0, 0)), -1.0, 1.0);

    const designatedPossessionPlayer = this.match.GetDesignatedPossessionPlayer();
    const isDesignatedTeamPossessionPlayer = this.team.GetDesignatedTeamPossessionPlayer() === player;
    const lastTouchBias = castPlayer.GetLastTouchBias(2000);

    if (this.match.GetBallRetainer() === player) {
      autoBias = 0.0;
    } else if (
      forceMagnet ||
      designatedPossessionPlayer === player ||
      (lastTouchBias > 0.01 && this.possessionAmount > 0.5 && isDesignatedTeamPossessionPlayer) ||
      (!this.oppTeamHasPossession && this.possessionAmount > 0.5 && isDesignatedTeamPossessionPlayer) ||
      (this.possessionAmount > 0.99 && isDesignatedTeamPossessionPlayer) || // for air balls and such, where multiple players are as likely to get to the ball first
      (this.hasBestPossession && isDesignatedTeamPossessionPlayer)
    ) {
      // this is constructed inefficiently (double teamplayer thing) on purpose, for clarity.

      // WE ARE THE MAN OF THE MOMENT! WOOHOO

      if (this.hasBestPossession) {
        const result = AI_GetBallControlMovement(mentalImage, castPlayer, quantizedInputDirection, this.inputVelocityFloat);
        autoDirection = result.bestDirection;
        autoVelocityFloat = result.bestVelocityFloat;
        const autoLookAt = result.bestLookAt; // dud
        castPlayer.SetDesiredTimeToBall_ms(result.result);
        autoLookDirection = autoLookAt.Sub(playerPos).GetNormalized(0);
        autoBias = 1.0;
      } else {
        // !hasPossession

        let haste = 0.0;
        if (extraHaste || forceMagnet) {
          haste = 1.0;
        } else {
          const thresholdPossessionAmountForHaste = 1.1; // 2.0f - AI_GetMindSet(CastPlayer()->GetFormationEntry().role) * 2.0f; // attacking players may want to gamble on the defenders missing the ball
          if (adaptedPossessionAmount < thresholdPossessionAmountForHaste) haste = 1.0;
        }

        const result = AI_GetToBallMovement(this.match, mentalImage, castPlayer, quantizedInputDirection, this.inputVelocityFloat, haste);
        autoDirection = result.bestDirection;
        autoVelocityFloat = result.bestVelocityFloat;
        const autoLookAt = result.bestLookAt; // dud
        castPlayer.SetDesiredTimeToBall_ms(result.result);
        // todo: leave to auto dir? (for now, yes)
        autoLookDirection = autoLookAt.Sub(playerPos).GetNormalized(0);
        autoBias = 1.0;

        if (designatedPossessionPlayer !== player) {
          let sameDirFactor = 1.0 - clamp(Math.abs(autoDirection.GetAngle2D(manualDirection)) / pi, 0.0, 1.0);
          sameDirFactor = sameDirFactor * 0.5 + 0.5; // todo: can't fully trust this; it just isn't a 100% indication of the player's intentions. just use this hax for now
          autoBias = 0.0;
          if (lastTouchBias > 0.01) {
            if (castPlayer.GetTimeNeededToGetToBall_ms() < 1700) autoBias = Math.pow(lastTouchBias, 0.4) * Math.pow(sameDirFactor, 0.5);
          }
          if (!this.oppTeamHasPossession) {
            if (this.team.IsHumanControlled(player.GetID())) {
              let magnetBias = Math.max(curve(sameDirFactor, 0.8), Math.pow(this.GetLastSwitchBias(), 0.5)); // needed for when we get passed a ball while we are not the designated player. we want to at least try to get there.
              magnetBias *= 1.0 - inputDirIsOwnHalfFactor; // if we run for our own half, don't accidentally magnet somewhere
              // assumes possessionAmount > 0.5f (see 'if' clause above)

              autoBias = clamp(Math.pow((Math.max(this.possessionAmount, 0.5) - 0.5) * 2.0, 0.5) * magnetBias, autoBias, 1.0);
            }
          }
          if (forceMagnet) {
            autoBias = 1.0;
          }
        }
      }
    } else if (designatedPossessionPlayer!.GetTeamID() !== this.team.GetID()) {
      // OTHER TEAM IS IN BALL CONTROL, DEM BASTERDS

      if (isDesignatedTeamPossessionPlayer) {
        // WE ARE THE BEST OUR TEAM HAS GOT, CHOOSE OUR ACTIONS WISELY

        // if we aren't the designated possession player, we don't ever want to just run straight to the ball like that.
        // we want some combination of manual movement, defensive movement, and to-ball movement.

        // virtual action area in front of opponent
        const oppImage = mentalImage.GetPlayerImage(this._oppPlayer!.GetID());
        const oppPos = oppImage.position.Add(oppImage.movement.Mul(0.14)).Add(oppImage.directionVec.Mul(0.6));
        const oppToGoalDirection = new Vector3(pitchHalfW * this.team.GetSide(), 0, 0).Sub(oppPos).GetNormalized(0);
        const actionRadius = 5.0;
        const focusPosition = oppPos.Add(oppToGoalDirection.Mul(actionRadius * 0.7));
        const actionBias = 1.0 - curve(NormalizedClamp(playerPos.Sub(focusPosition).GetLength(), 0.0, actionRadius), 0.7);

        // if we're close to the focus position, go do more defending or ballhuntin' (as opposed to manual movement)
        if (this.team.IsHumanControlled(player.GetID())) autoBias = actionBias * 0.0 + this.GetLastSwitchBias() * 0.3;
        else autoBias = actionBias * 0.0; // not sure what would be a proper value here. needs more testing

        autoBias *= 1.0 - inputDirIsOwnHalfFactor; // if we want to run back to more defensive positions, don't autobias

        // now decide on what auto direction to use, if applicable
        // when farther away from ball/opp, get towards ball/opp, when already close, mimic opponent's movement (sort of an auto 'man marking' thing)
        if (autoBias > 0.0) {
          const playerOppDistance = oppPos.Sub(playerPos).GetLength();
          const manMarkingBias = Math.pow(1.0 - curve(NormalizedClamp(playerOppDistance, 0.0, 7.0), 0.7), 1.2);

          const autoDirection_manMarking = oppImage.movement.GetNormalized(this.inputDirection);
          const autoVelocityFloat_manMarking = oppImage.velocity;
          const autoLookDirection_manMarking = mentalImage.GetBallPrediction(defaultLookAtTime_ms).Get2D().Sub(playerPos).GetNormalized(0);

          const huntTarget = oppPos.Add(oppToGoalDirection.Mul(playerOppDistance * 0.3));
          const huntMovement = huntTarget.Sub(playerPos);
          const autoDirection_hunt = huntMovement.GetNormalized(this.inputDirection);
          const autoVelocityFloat_hunt = clamp(huntMovement.GetLength() * distanceToVelocityMultiplier, idleVelocity, sprintVelocity);
          const autoLookDirection_hunt = mentalImage.GetBallPrediction(defaultLookAtTime_ms).Get2D().Sub(playerPos).GetNormalized(0);

          autoDirection = autoDirection_manMarking.Mul(manMarkingBias).Add(autoDirection_hunt.Mul(1.0 - manMarkingBias)).GetNormalized(this.inputDirection);
          autoVelocityFloat = clamp(autoVelocityFloat_manMarking * manMarkingBias + autoVelocityFloat_hunt * (1.0 - manMarkingBias), idleVelocity, sprintVelocity);
          autoLookDirection = autoLookDirection_manMarking.Mul(manMarkingBias).Add(autoLookDirection_hunt.Mul(1.0 - manMarkingBias)).GetNormalized(0);
        }
      }
    }

    {
      const autoMovement = autoDirection.Mul(autoVelocityFloat);
      const manualMovement = manualDirection.Mul(manualVelocityFloat);
      const resultingMovement = manualMovement.Mul(1.0 - autoBias).Add(autoMovement.Mul(autoBias));
      command.desiredDirection = resultingMovement.GetNormalized(quantizedInputDirection);
      command.desiredVelocityFloat = clamp(resultingMovement.GetLength(), idleVelocity, sprintVelocity);

      if (command.desiredVelocityFloat < idleDribbleSwitch) command.desiredDirection = autoLookDirection;

      const resultLookDirection = autoLookDirection;
      command.desiredLookAt = playerPos.Add(resultLookDirection.Mul(10.0));
    }

    commandQueue.push(command);
  }

  protected _CalculateSituation(): void {
    const castPlayer = this.CastPlayer();
    const oppTeam = this.match.GetTeam(Math.abs(this.team.GetID() - 1));
    this.hasPossession = castPlayer.HasPossession();
    this.hasUniquePossession = castPlayer.HasUniquePossession();
    this.teamHasPossession = this.team.HasPossession();
    this.teamHasUniquePossession = this.team.HasUniquePossession();
    this.oppTeamHasPossession = oppTeam.HasPossession();
    this.oppTeamHasUniquePossession = oppTeam.HasUniquePossession();
    this.hasBestChanceOfPossession = this.team.GetDesignatedTeamPossessionPlayer() === this.player;
    this.teamHasBestPossession = this.match.GetBestPossessionTeamID() === this.team.GetID();
    this.possessionAmount = (oppTeam.GetTimeNeededToGetToBall_ms() + 200) / (this._timeNeeded_ms + 200);
    this.teamPossessionAmount = this.team.GetTeamPossessionAmount();
    this.fadingTeamPossessionAmount = this.team.GetFadingTeamPossessionAmount();

    // when ball is close, don't fade possession bias (so we can take immediate action)
    if (this.hasBestChanceOfPossession) {
      const distanceBias = Math.pow(NormalizedClamp(this.match.GetBall().Predict(300).Get2D().Sub(this.player.GetPosition()).GetLength(), 2.0, 14.0), 2.0);
      this.fadingTeamPossessionAmount = this.fadingTeamPossessionAmount * distanceBias + this.teamPossessionAmount * (1.0 - distanceBias);
    }

    this.timeNeededToGetToBall = Math.trunc(this._timeNeeded_ms);
    this.oppTimeNeededToGetToBall = oppTeam.GetTimeNeededToGetToBall_ms();
    this.hasBestPossession = this.hasPossession && this.possessionAmount >= 1.0;
  }
}
