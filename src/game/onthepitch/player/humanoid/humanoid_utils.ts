// Port of legacy/src/onthepitch/player/humanoid/humanoid_utils.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).
//
// Out-parameters follow docs/PORTING.md: GetDifficultyFactors returns { distanceFactor, heightFactor, ballMovementFactor },
// GetBallControlVector/GetTrapVector return { result, xRot, yRot } and GetShotVector returns { result, xRot, yRot, zRot }.

import { assert } from '../../../../blunted/base/assert';
import { NormalizedClamp, clamp, curve, pi, random, signSide, type radian } from '../../../../blunted/base/math/bluntmath';
import { Vector3 } from '../../../../blunted/base/math/vector3';
import { atof } from '../../../../blunted/base/utils';
import {
  defaultTouchOffset_ms,
  dribbleVelocity,
  dribbleWalkSwitch,
  e_TouchType,
  e_Velocity,
  idleDribbleSwitch,
  idleVelocity,
  sprintVelocity,
  walkSprintSwitch,
  walkVelocity,
} from '../../../gamedefines';
import type { Ball } from '../../ball';
import type { Match } from '../../match';
import type { Player } from '../player';
import { FloatToEnumVelocity } from './animcollection';
import type { Anim, SpatialState } from './humanoidbase';

export function GetTouchTypeForBodyPart(bodypartname: string): e_TouchType {
  if (bodypartname.includes('foot') || bodypartname.includes('lowerleg')) {
    return e_TouchType.e_TouchType_Intentional_Kicked;
  } else {
    return e_TouchType.e_TouchType_Intentional_Nonkicked;
  }
}

export function CalculateTimeNeededToChangeMovement_ms(currentMovement: Vector3, desiredMovement: Vector3): number {
  // this function is quick 'n dirty, just how i like it
  // just don't expect exact results

  // (int time_ms: float -> int conversions truncate)
  let time_ms = Math.trunc(NormalizedClamp(desiredMovement.Sub(currentMovement).GetLength(), idleVelocity, sprintVelocity * 2.0) * 1000);

  const currentVeloFactor = 1.0 - NormalizedClamp(currentMovement.GetLength(), idleVelocity, sprintVelocity);
  time_ms = Math.trunc(time_ms * (1.0 + currentVeloFactor));

  return time_ms;
}

export function CalculateBiasForFastCornering(currentMovement: Vector3, desiredMovement: Vector3, veloPow = 1.0, bias = 1.0): number {
  const angle = desiredMovement.GetNormalized(currentMovement).GetAngle2D(currentMovement);
  // wolfram alpha: sin(x - 0.5 * pi) * 0.5 + 0.5 | from x = 0.0 to pi
  // this one is better for anim selection, else 135 anim is never used (since 135 @ idle is worse than 90 @ dribble then - with this one, 90 @ idle will be preferred (which will allow 135 @ idle as well))
  const currentMovementBias = Math.sin(Math.abs(angle) - 0.5 * pi) * 0.5 + 0.5;

  // effect is less pronounced at low velocities
  const velocityBias = Math.pow(clamp(currentMovement.GetLength() / (sprintVelocity - 0.5), 0.0, 1.0), veloPow);

  const totalBrakeBias = velocityBias * currentMovementBias * bias;

  return totalBrakeBias;
}

export function CalculateMovementAtFrame(positions: readonly Vector3[], frameNum: number, smoothFrames = 0): Vector3 {
  // PORT: C++ took `unsigned int frameNum`; callers passing a float got it truncated at the call site
  frameNum = Math.trunc(frameNum);

  assert(frameNum < positions.length);

  // special case: want the exit movement to be unsmoothed, for we don't want the wrong quantized velocity and such
  if (frameNum === positions.length - 1) {
    return positions[positions.length - 1].Sub(positions[positions.length - 2]).Get2D().Mul(100.0);
  }
  // special case: if we want the movement at frame 0, we can't get -1 to 0, we need to get 0 to 1 instead
  if (frameNum === 0) {
    return positions[1].Sub(positions[0]).Get2D().Mul(100.0);
  }

  let totalMovement = new Vector3(0);
  let count = 0;
  for (let frame = frameNum - smoothFrames; frame <= frameNum + smoothFrames; frame++) {
    if (frame > 0 && frame < positions.length) { // was: frame > 1 (i think that was a bug)
      totalMovement = totalMovement.Add(positions[frame].Sub(positions[frame - 1]).Get2D().Mul(100.0));
      count++;
    }
  }
  if (count > 0) {
    totalMovement = totalMovement.Div(count);
  }

  return totalMovement;
}

/** offset where ball should usually be touched */
export function GetFrontOfFootOffsetRel(velocity: number, bodyAngleRel: radian, height: number): Vector3 {
  const fullDistanceFactor = 1.0;
  const distance = 0.34 + velocity * defaultTouchOffset_ms * 0.001 * fullDistanceFactor; // must be > 0 (for upcoming dotproduct)

  const ffo = new Vector3(0, -distance * 0.8, 0);

  let bodyAngle = bodyAngleRel;
  if (velocity < idleDribbleSwitch) bodyAngle = 0;
  const angled = new Vector3(0, -distance * 0.2, 0).GetRotated2D(bodyAngle);

  return ffo.Add(angled).Mul(1.0 - clamp((height - 0.11) / 4.0, 0.0, 0.5));
}

export function NeedDefendingMovement(mySide: number, position: Vector3, target: Vector3): boolean {
  // only move if absolutely necessary
  let howDeepIsTarget = Math.max((target.coords[0] - position.coords[0]) * -mySide, 0.0);
  const howWideIsTarget = Math.abs(target.coords[1] - position.coords[1]);
  howDeepIsTarget -= 0.5; // some buffer to account for reaction time
  if (howWideIsTarget > howDeepIsTarget * 0.8) {
    return true;
  } else {
    return false;
  }
}

export function StretchSprintTo(inputVelocity: number, inputSpaceMaxVelocity: number, targetMaxVelocity: number): number {
  assert(targetMaxVelocity > walkSprintSwitch);

  if (inputVelocity < walkSprintSwitch) return inputVelocity;

  const howMuchSprintage = inputVelocity - walkSprintSwitch;

  const oldLength = inputSpaceMaxVelocity - walkSprintSwitch;
  const newLength = targetMaxVelocity - walkSprintSwitch;

  const toNewFactor = newLength / oldLength;

  const resultSprintage = howMuchSprintage * toNewFactor;

  return walkSprintSwitch + resultSprintage;
}

/** C++ void GetDifficultyFactors(match, player, positionOffset, float &distanceFactor, float &heightFactor, float &ballMovementFactor) */
export function GetDifficultyFactors(
  match: Match,
  player: Player,
  positionOffset: Vector3,
): { distanceFactor: number; heightFactor: number; ballMovementFactor: number } {
  const ball: Ball = match.GetBall();

  let distanceFactor = 0.0; // how far ball bounces off feet
  let heightFactor = 0.0; // how high ball bounces off feet
  let ballMovementFactor = 0.0; // how much of the current ball movement is maintained
  // being pushed is tough
  const positionOffsetPenalty = NormalizedClamp(positionOffset.GetLength(), 0.0, 0.1) * 2.0; // was: 7.0f
  // fast balls are harder
  const ballBodyVeloPenalty = Math.pow(NormalizedClamp(player.GetMovement().Sub(ball.GetMovement()).GetLength(), 10.0, 50.0), 1.5) * 5.0;
  // balls farther away from body are harder
  const fartherAwayPenalty =
    Math.pow(NormalizedClamp(player.GetPosition().Add(player.GetDirectionVec().Mul(0.2)).Sub(ball.Predict(0).Get2D()).GetLength(), 0.7, 1.3), 2.0) * 2.0;

  distanceFactor += positionOffsetPenalty * 2.0;
  distanceFactor += ballBodyVeloPenalty;
  distanceFactor += fartherAwayPenalty * 4.0;

  heightFactor += positionOffsetPenalty * 0.5;
  heightFactor += ballBodyVeloPenalty * 2.0;
  heightFactor += fartherAwayPenalty;

  // make intercepting passes harder
  if (match.GetLastTouchTeamID() !== player.GetTeam().GetID()) {
    const lastTouchPlayer: Player | null = match.GetTeam(Math.abs(player.GetTeam().GetID() - 1)).GetLastTouchPlayer();
    if (lastTouchPlayer) {
      // (C++ int decay_ms parameter: the float argument is truncated)
      const lastTouchBiasPenalty = Math.pow(lastTouchPlayer.GetLastTouchBias(Math.trunc(1000 - player.GetStat('physical_reaction') * 500)), 0.6) * 5.0;
      distanceFactor += lastTouchBiasPenalty;
      heightFactor += lastTouchBiasPenalty;
      ballMovementFactor += lastTouchBiasPenalty * 0.1;
    }
  }
  ballMovementFactor = clamp(ballMovementFactor, 0.0, 0.9);

  const skillPenaltyMultiplier = (1.0 - player.GetStat('technical_ballcontrol') * 0.5) * random(0.5, 1.0);
  distanceFactor *= skillPenaltyMultiplier;
  heightFactor *= skillPenaltyMultiplier;
  ballMovementFactor *= skillPenaltyMultiplier;
  distanceFactor = clamp(distanceFactor, 0.0, 1.0);
  heightFactor = clamp(heightFactor, 0.0, 1.0);
  ballMovementFactor = clamp(ballMovementFactor, 0.0, 1.0);

  return { distanceFactor, heightFactor, ballMovementFactor };
}

/** C++ Vector3 GetBallControlVector(..., radian &xRot, radian &yRot, float ffoOffset = 0.0f) */
export function GetBallControlVector(
  ball: Ball,
  player: Player,
  nextStartPos: Vector3,
  nextStartAngle: radian,
  nextBodyAngle: radian,
  outgoingMovement: Vector3,
  currentAnim: Anim,
  frameNum: number,
  spatialState: SpatialState,
  positionOffset: Vector3,
  ffoOffset = 0.0,
): { result: Vector3; xRot: radian; yRot: radian } {
  const command = currentAnim.originatingCommand;
  const animOutgoingVelocity = currentAnim.anim.GetOutgoingVelocity();

  // part of the resulting direction is physics, the other part is anim/controller. so originatingBias is only applied on the (1.0 - physicsBias) part of the result
  let physicsBias = 0.7;
  if (!player.HasPossession()) {
    physicsBias = 0.9;
  }

  if (FloatToEnumVelocity(animOutgoingVelocity) === e_Velocity.e_Velocity_Idle) physicsBias = 1.0;

  const explosivenessFactor = 0.6;
  let maximumOverdrive_mps = 1.0 * explosivenessFactor;
  if (command.desiredVelocityFloat < dribbleWalkSwitch) maximumOverdrive_mps = 0.0;
  if (command.desiredVelocityFloat > walkSprintSwitch) maximumOverdrive_mps = 2.0 * explosivenessFactor;
  const nextStartDirection = new Vector3(0, -1, 0).GetRotated2D(nextStartAngle);
  const dotFactor1 = spatialState.directionVec.GetDotProduct(command.desiredDirection) * 0.5 + 0.5; // inv deviation from the current direction
  const dotFactor2 = nextStartDirection.GetDotProduct(command.desiredDirection) * 0.5 + 0.5; // inv deviation from the direction we wanted
  const dotFactor = Math.min(dotFactor1, dotFactor2);
  maximumOverdrive_mps *= dotFactor;

  if (FloatToEnumVelocity(animOutgoingVelocity) === e_Velocity.e_Velocity_Idle) maximumOverdrive_mps = 0.0;

  const originatingBias = 0.7;

  // using just controller velo
  let desiredMovement = command.desiredDirection.Mul(
    command.desiredVelocityFloat * originatingBias + player.GetController().GetFloatVelocity() * (1.0 - originatingBias),
  );

  // hold velo to max player velo - else slow players will kick the ball too far away, which is sad
  if (desiredMovement.GetLength() > walkSprintSwitch) {
    desiredMovement = desiredMovement.GetNormalized(0).Mul(StretchSprintTo(desiredMovement.GetLength(), sprintVelocity, player.GetMaxVelocity()));
  }

  // don't want to go below physics velo, else we will run over ball and stuff like that
  // don't want to go over physics velo too much either, else ball will be so far away!
  const velocity = clamp(desiredMovement.GetLength(), outgoingMovement.GetLength(), outgoingMovement.GetLength() + maximumOverdrive_mps);
  desiredMovement = desiredMovement.GetNormalized(nextStartDirection).Mul(velocity);
  const physicsMovement = nextStartDirection.Mul(velocity);

  const desiredVelocity = desiredMovement.GetLength();
  const physicsVelocity = physicsMovement.GetLength();

  const ballPos = ball.Predict(0);
  const FFOsrc = GetFrontOfFootOffsetRel(physicsVelocity, nextBodyAngle - spatialState.angle, ballPos.coords[2]);
  const annoyanceVeloFactor = curve(NormalizedClamp(animOutgoingVelocity, idleVelocity, sprintVelocity), 0.7); // do not apply effect to low velo's; makes it too chaotic
  const opponentAnnoyanceFactor =
    (1.0 - NormalizedClamp(player.GetClosestOpponentDistance(), 0.5, 1.5)) *
    (1.0 - (player.GetStat('mental_calmness') * 0.5 + player.GetStat('physical_balance') * 0.3)) *
    annoyanceVeloFactor;
  // positionOffset is already in ffoOffset (though only for trap atm)
  let FFO = new Vector3(0, -1, 0).GetRotated2D(nextBodyAngle).Mul(FFOsrc.GetLength() + ffoOffset + opponentAnnoyanceFactor * 3.0);
  const heightFFOOffset = NormalizedClamp(ballPos.coords[2], 0.5, 1.0) * 0.5; // bounce high balls off body - else they keep colliding inside body and stuff like that
  FFO = FFO.Add(FFOsrc.Mul(heightFFOOffset).Mul(0.5).Add(player.GetBodyDirectionVec().Mul(heightFFOOffset).Mul(0.5)));

  let desiredPlannedBallPos = nextStartPos;
  let physicsPlannedBallPos = nextStartPos;

  // we actually want the ball to be further away than our next position - after all, we want to hit it again a few steps later
  // how many seconds later do we want to be able to hit it again? (remember: this is minus ffo time and current anim time)
  const desiredDelayTime = Math.pow(NormalizedClamp(desiredVelocity, 0.0, sprintVelocity), 2.0) * 0.6 + 0.25;
  const physicsDelayTime = Math.pow(NormalizedClamp(physicsVelocity, 0.0, sprintVelocity), 2.0) * 0.6 + 0.25;
  desiredPlannedBallPos = desiredPlannedBallPos.Add(desiredMovement.Mul(desiredDelayTime).Add(FFO));
  physicsPlannedBallPos = physicsPlannedBallPos.Add(physicsMovement.Mul(physicsDelayTime).Add(FFO));

  const plannedBallPos = physicsPlannedBallPos.Mul(physicsBias).Add(desiredPlannedBallPos.Mul(1.0 - physicsBias));
  const toPlannedBall = plannedBallPos.Sub(ballPos.Get2D());

  let timeToGo = (currentAnim.anim.GetEffectiveFrameCount() - frameNum) * 10 * 0.001;
  timeToGo += physicsDelayTime * physicsBias + desiredDelayTime * (1.0 - physicsBias);
  timeToGo += defaultTouchOffset_ms * 0.001; // time into next anim where we want to hit the ball

  let divisor = timeToGo * (0.38 + 0.02 * player.GetStat('technical_dribble')); // higher == closer
  divisor *= 1.1;

  // to get the ball to the planned position in timeToGo seconds, we need to do some pow() magic, since the ball also slows down faster at higher ball velos
  const power = Math.pow(toPlannedBall.GetLength() / divisor, 0.7);
  const direction = toPlannedBall.GetNormalized(new Vector3(0, -1, 0).GetRotated2D(nextBodyAngle));

  const height = clamp(0.1 + 1.5 * Math.pow(power / 10.0, 1.6), 0.0, 1.5); // power ~= 0 to 10

  let powerMultiplier = 1.2 - player.GetStat('technical_ballcontrol') * 0.03; // 1.24 .. * 0.1
  const veloBias = NormalizedClamp(velocity, walkVelocity, sprintVelocity - 0.8); // this multiplier only applies to high velocities
  powerMultiplier = 1.0 * (1.0 - veloBias) + powerMultiplier * veloBias;

  const touchVec = direction.Mul(power).Mul(powerMultiplier).Add(new Vector3(0, 0, height));

  const backspinFactor = 30.0;
  const velo = touchVec.GetLength();
  const veloFactor = Math.pow(NormalizedClamp(touchVec.GetLength(), 0.0, 10.0), 0.7); // extra around walk velocity
  const rotDir = FFO.GetNormalized(0).Mul(0.6).Add(touchVec.GetNormalized(0).Mul(0.4)).GetNormalized(0);
  const xRot = rotDir.coords[1] * (2 * pi * velo - backspinFactor * veloFactor);
  const yRot = rotDir.coords[0] * (2 * pi * velo - backspinFactor * veloFactor);

  return { result: touchVec, xRot, yRot };
}

/** C++ Vector3 GetTrapVector(..., radian &xRot, radian &yRot) */
export function GetTrapVector(
  match: Match,
  player: Player,
  nextStartPos: Vector3,
  nextStartAngle: radian,
  nextBodyAngle: radian,
  outgoingMovement: Vector3,
  currentAnim: Anim,
  frameNum: number,
  spatialState: SpatialState,
  positionOffset: Vector3,
): { result: Vector3; xRot: radian; yRot: radian } {
  const ball: Ball = match.GetBall();

  // distanceFactor: how far ball bounces off feet
  // heightFactor: how high ball bounces off feet
  // ballMovementFactor: how much of the current ball movement is maintained
  const { distanceFactor, heightFactor, ballMovementFactor } = GetDifficultyFactors(match, player, positionOffset);

  // base vector to start with
  const ballControlResult = GetBallControlVector(
    ball, player, nextStartPos, nextStartAngle, nextBodyAngle, outgoingMovement, currentAnim, frameNum, spatialState, positionOffset, distanceFactor,
  );
  let ballControl = ballControlResult.result;

  const ballMovement = ball.GetMovement();
  ballControl = ballControl.WithCoord(2, ballControl.coords[2] + ballMovement.coords[2] * heightFactor * 1.0 + heightFactor * 4.0);

  return {
    result: ballControl.Mul(1.0 - ballMovementFactor).Add(ballMovement.Mul(ballMovementFactor)),
    xRot: ballControlResult.xRot,
    yRot: ballControlResult.yRot,
  };
}

/** C++ Vector3 GetShotVector(..., radian &xRot, radian &yRot, radian &zRot, float autoDirectionBias = 0.0f) */
export function GetShotVector(
  match: Match,
  player: Player,
  nextStartPos: Vector3,
  nextStartAngle: radian,
  nextBodyAngle: radian,
  outgoingMovement: Vector3,
  currentAnim: Anim,
  frameNum: number,
  spatialState: SpatialState,
  positionOffset: Vector3,
  autoDirectionBias = 0.0,
): { result: Vector3; xRot: radian; yRot: radian; zRot: radian } {
  const ball: Ball = match.GetBall();
  const touchInfo = currentAnim.originatingCommand.touchInfo;

  const origPositionCache: Vector3[] = match.GetAnimPositionCache(currentAnim.anim);
  const touchMovement = CalculateMovementAtFrame(origPositionCache, currentAnim.frameNum).GetRotated2D(spatialState.angle); // spatialState.movement isn't reliable because of smuggles and such
  let touchDirection = touchMovement.GetNormalized(spatialState.directionVec);
  const touchVelocity = touchMovement.GetLength();
  if (FloatToEnumVelocity(touchVelocity) === e_Velocity.e_Velocity_Idle) touchDirection = spatialState.directionVec;

  // previous: float directionFactor = touchDirection.GetDotProduct(currentAnim->originatingCommand.touchInfo.desiredDirection) * 0.5f + 0.5f;
  // ideal angle is ~36 degrees == 0.2 * pi
  const idealAngle = 0.2 * pi;
  const angle1 = Math.abs(touchDirection.GetAngle2D(touchInfo.desiredDirection.GetRotated2D(-idealAngle)));
  const angle2 = Math.abs(touchDirection.GetAngle2D(touchInfo.desiredDirection.GetRotated2D(idealAngle)));
  const angle = Math.min(angle1, angle2);
  let directionFactor = clamp(angle / pi, 0.0, 1.0);
  directionFactor = curve(1.0 - directionFactor, 0.8);


  // calculate power. take desired power as maximum, and subtract based on player/ball movement and such

  const playerDirDesiredDirPowerFactor = Math.pow(directionFactor, 0.8); // shooting sideways is still pretty easy to power up

  const playerVelocityPowerFactor = Math.pow(NormalizedClamp(touchVelocity, 0.0, sprintVelocity), 0.3); // >= walk velo is optimum

  const positionOffsetPowerFactor = 1.0 - NormalizedClamp(positionOffset.GetLength(), 0.0, 0.1);

  let powerFactor =
    1.0 *
    (0.7 + playerDirDesiredDirPowerFactor * 0.3) *
    (0.7 + playerVelocityPowerFactor * 0.3) *
    (0.4 + positionOffsetPowerFactor * 0.6);
  powerFactor = clamp(powerFactor, 0.0, 1.0);

  const adaptedDesiredPower = 45.0 * (0.7 + Math.pow(touchInfo.desiredPower, 0.5) * 0.3);

  let animMaxPowerFactor = atof(currentAnim.anim.GetVariable('touch_maxpowerfactor'));
  if (animMaxPowerFactor === 0.0) animMaxPowerFactor = 1.0;

  let power = clamp(powerFactor * adaptedDesiredPower, 0.0, (32.0 + player.GetStat('physical_shotpower') * 13.0) * (0.2 + animMaxPowerFactor * 0.8));

  // add this after previous stat-clamp, because using the current ball movement is like an added (power) bonus that everybody profits from, even sucky players
  let playerMovBallMovPowerFactor = touchMovement.Sub(ball.GetMovement()).GetLength();
  playerMovBallMovPowerFactor = NormalizedClamp(playerMovBallMovPowerFactor, 0.0, 10.0);

  power *= 1.0 + playerMovBallMovPowerFactor * 0.2;


  // calculate difficulty, based on factors like desired power, player/ball movement, skill, positionoffset etcetera

  const playerDirDesiredDirEasinessFactor = Math.pow(directionFactor, 0.8); // shooting sideways is still pretty easy to aim

  const playerVelocityEasinessFactor = 1.0 - NormalizedClamp(Math.abs(touchVelocity - dribbleVelocity), 0.0, 4.0); // dribble velo is optimum

  const positionOffsetEasinessFactor = 1.0 - NormalizedClamp(positionOffset.GetLength(), 0.0, 0.1);

  // (the original first assigns (touchMovement - ballMovement).GetLength() and immediately overwrites it)
  const playerMovBallMovEasinessFactor = 1.0 - playerMovBallMovPowerFactor * (0.5 - player.GetStat('technical_volley') * 0.3);

  let powerEasinessFactor = 1.0 - NormalizedClamp(power, 30.0, 100.0);
  powerEasinessFactor = curve(powerEasinessFactor, 1.0);

  const easinessFactor =
    1.0 *
    (0.4 + playerDirDesiredDirEasinessFactor * 0.6) *
    (0.7 + playerVelocityEasinessFactor * 0.3) *
    (0.3 + positionOffsetEasinessFactor * 0.7) *
    (0.6 + playerMovBallMovEasinessFactor * 0.4) *
    (0.6 + powerEasinessFactor * 0.4);
  const difficultyFactor = clamp(1.0 - easinessFactor, 0.0, 1.0);


  // best case result

  const desiredHeight = 0.05;
  const desiredShot = touchInfo.desiredDirection.Get2D().Add(new Vector3(0, 0, desiredHeight)).GetNormalized().Mul(power);


  // worst case result

  let worstCaseDirection = touchInfo.desiredDirection.Get2D();

  // direction lag
  const laggyDirectionBias = difficultyFactor * 0.8;
  worstCaseDirection = touchDirection.Mul(laggyDirectionBias).Add(worstCaseDirection.Mul(1.0 - laggyDirectionBias)).GetNormalized(0);

  // random dir
  const randomX = random(-1, 1);
  const randomY = random(-1, 1);
  const randomZ = random(-1, 1);
  worstCaseDirection = worstCaseDirection.Add(new Vector3(randomX, randomY, randomZ).Mul(0.5).Mul(difficultyFactor));
  worstCaseDirection = worstCaseDirection.GetNormalized();

  const worstCaseHeight = curve(Math.pow(difficultyFactor, 0.7), 0.7) * 0.7;

  const worstCasePower = power * (1.0 - Math.pow(difficultyFactor, 0.7) * 0.5);

  const worstCaseShot = worstCaseDirection.Add(new Vector3(0, 0, worstCaseHeight)).GetNormalized().Mul(worstCasePower);


  // actual result

  let worstCaseFactor = random(0.0, 1.0);
  worstCaseFactor = Math.pow(worstCaseFactor, player.GetStat('technical_shot') * 0.7);

  let shot = desiredShot.Mul(1.0 - worstCaseFactor).Add(worstCaseShot.Mul(worstCaseFactor));


  // add a little curve

  const randomCurveFactor = 0.3 + worstCaseFactor * 0.7;
  const plannedCurveFactor = 0.7; // todo: use curve as actual planned thing, not random :p

  // forward/backward 'curve'
  const xRot = -touchInfo.desiredDirection.coords[1] * 20.0 + random(-20, 20) * randomCurveFactor;
  const yRot = -touchInfo.desiredDirection.coords[0] * 20.0 + random(-20, 20) * randomCurveFactor;

  // lateral curve
  let bodyTouchAngle = spatialState.bodyDirectionVec.GetAngle2D(shot) / pi;
  if (Math.abs(bodyTouchAngle) > 0.5) bodyTouchAngle = (1.0 - Math.abs(bodyTouchAngle)) * signSide(bodyTouchAngle);
  bodyTouchAngle *= 2.0;
  const amount = bodyTouchAngle * 0.25;
  shot = shot.GetRotated2D(amount * (0.4 + 0.6 * NormalizedClamp(shot.GetLength(), 0.0, 70.0)));
  const zRot = amount * -420 + random(-20, 20) * plannedCurveFactor;

  return { result: shot, xRot, yRot, zRot };
}
