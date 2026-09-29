// Port of legacy/src/onthepitch/AIsupport/AIfunctions.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).
//
// PORT: functions with C++ out-parameters return them (see docs/PORTING.md §3):
//   AI_GetBestDribbleMovement(...)  -> { desiredDirection, desiredVelocity }
//   AI_GetToBallMovement(...)       -> { result, bestDirection, bestVelocityFloat, bestLookAt }
//   AI_GetBallControlMovement(...)  -> { result, bestDirection, bestVelocityFloat, bestLookAt }
//   AI_GetAutoPass(...)             -> { resultingDirection, resultingPower }
//   AI_GetPass(...)                 -> { resultingDirection, resultingPower, targetPlayer }
// The two AI_CalculatePassingOdds overloads are merged (origin/target: Vector3 or PlayerImage).
//
// This is hot code (called for 22 players at 100Hz), so some vector math is written out in scalars; it computes
// exactly the same expressions as the original.

import { Vector3 } from '../../../blunted/base/math/vector3';
import { NormalizedClamp, clamp, cround, curve, pi, signSide, type radian } from '../../../blunted/base/math/bluntmath';
import { Line } from '../../../blunted/base/geometry/line';
import { assert } from '../../../blunted/base/assert';
import {
  ForceSpot,
  PassRating,
  PlayerImage,
  ballPredictionSize_ms,
  defaultTouchOffset_ms,
  distanceToVelocityMultiplier,
  dribbleVelocity,
  e_DecayType,
  e_FunctionType,
  e_MagnetType,
  e_PlayerRole,
  e_Velocity,
  goalHalfWidth,
  idleDribbleSwitch,
  idleVelocity,
  pitchHalfH,
  pitchHalfW,
  sprintVelocity,
  type PassRatings,
} from '../../gamedefines';
import { e_HIDeviceType } from '../../hid/ihidevice';
import { FloatToEnumVelocity, RangeVelocity } from '../player/humanoid/animcollection';
import type { MentalImage } from './mentalimage';
import type { Ball } from '../ball';
import type { Match } from '../match';
import type { Team } from '../team';
import type { Player } from '../player/player';
import type { HumanController } from '../player/controller/humancontroller';
import type { TeamTactics } from '../../data/teamdata';

// todo: do we need "match" stuff into MentalImage? especially GetPlayer, at the moment of writing that's the only method used here, so we could
// get rid of the match pointers.

export class TimeNeeded {
  /** C++ unsigned int */
  usual_ms = 0;
  /** C++ unsigned int */
  optimistic_ms = 0;
}

/** Vector3::GetLength() on components (lengths < 0.000001 are 0, like the original) */
function len3(x: number, y: number, z: number): number {
  const length = Math.sqrt(x * x + y * y + z * z);
  return length < 0.000001 ? 0 : length;
}

/** (a - b).GetLength() */
function dist3(a: Vector3, b: Vector3): number {
  const ac = a.coords;
  const bc = b.coords;
  return len3(ac[0] - bc[0], ac[1] - bc[1], ac[2] - bc[2]);
}

// convert formation position to formation position based on ball position
// deprecated
export function AI_GetAdaptedInitialPos(
  match: Match,
  initialPosition: Vector3,
  focusPoint: Vector3 = new Vector3(0, 0, -100.0),
  ballMagnetDistance = 50.0,
  ballMagnetDistancePow = 1.5,
): Vector3 {
  if (focusPoint.coords[2] === -100.0) focusPoint = match.GetBall().Predict(100).Get2D();
  let scaledFocusPoint = focusPoint;

  const width = 0.8;
  const depth = 0.4;

  if (scaledFocusPoint.coords[0] > pitchHalfW) scaledFocusPoint = scaledFocusPoint.WithCoord(0, pitchHalfW);
  if (scaledFocusPoint.coords[0] < -pitchHalfW) scaledFocusPoint = scaledFocusPoint.WithCoord(0, -pitchHalfW);
  if (scaledFocusPoint.coords[1] > pitchHalfH) scaledFocusPoint = scaledFocusPoint.WithCoord(1, pitchHalfH);
  if (scaledFocusPoint.coords[1] < -pitchHalfH) scaledFocusPoint = scaledFocusPoint.WithCoord(1, -pitchHalfH);
  scaledFocusPoint = scaledFocusPoint.Mul(new Vector3(1.0 / pitchHalfW, 1.0 / pitchHalfH, 0)); // -1 .. 1

  const boundedInitialPosition = new Vector3(
    clamp(initialPosition.coords[0], -1.0, 1.0),
    clamp(initialPosition.coords[1], -1.0, 1.0),
    initialPosition.coords[2],
  );

  let targetPos = boundedInitialPosition.Mul(new Vector3(depth, width, 0));
  const max = new Vector3(1.0 - depth, 1.0 - width, 0);
  targetPos = targetPos.Add(max.Mul(scaledFocusPoint));
  targetPos = targetPos.Mul(new Vector3(pitchHalfW, pitchHalfH, 0));

  const ballMagnetPos = focusPoint;
  let ballMagnetOffset = new Vector3(0);
  const ballDistance = ballMagnetPos.Sub(targetPos).GetLength();
  if (ballDistance < ballMagnetDistance) ballMagnetOffset = ballMagnetPos.Sub(targetPos).Mul(Math.pow((ballMagnetDistance - ballDistance) / ballMagnetDistance, ballMagnetDistancePow));
  targetPos = targetPos.Add(ballMagnetOffset);

  return targetPos;
}

/** microFocus: C++ const Vector3 & (callers passed a literal 0, so a number is accepted as Vector3(n)) */
export function AI_GetAdaptedFormationPosition(
  match: Match,
  player: Player,
  backXBound: number,
  frontXBound: number,
  lowYBound: number,
  highYBound: number,
  xFocus: number,
  xFocusStrength: number,
  yFocus: number,
  yFocusStrength: number,
  microFocus: Vector3 | number,
  microFocusStrength: number,
  midfieldFocus: number,
  midfieldFocusStrength: number,
  useDynamicFormationPosition = true,
): Vector3 {
  const team = player.GetTeam();
  const side = team.GetSide();

  let position: Vector3;

  if (useDynamicFormationPosition) {
    position = player.GetDynamicFormationEntry().position;
  } else {
    position = player.GetFormationEntry().position;
  }

  let px = position.coords[0];
  let py = position.coords[1];
  let pz = position.coords[2];

  // stretch midfield into defending or attack position
  if (midfieldFocusStrength > 0.0) {
    const midfieldPositionFactor = midfieldFocus * 2.0 - 1.0; // -1 .. 1

    // only for midfielders
    let stretchBias = clamp(1.0 - Math.abs(px * 1.2), 0.0, 1.0); // overstretch a bit so defenders/attackers are left alone (they usually aren't fully x = 0 or 1)
    stretchBias = curve(stretchBias, 1.0);

    stretchBias *= midfieldFocusStrength;
    px = px * (1.0 - stretchBias) + midfieldPositionFactor * stretchBias;
  }

  const xLength = frontXBound - backXBound;
  px = backXBound + (px * 0.5 + 0.5) * xLength;
  const yLength = highYBound - lowYBound;
  py = lowYBound + (py * -side * 0.5 + 0.5) * yLength;

  const pureX = px;
  const pureY = py;

  if (xFocusStrength > 0.0) {
    let bias = 1.0 - clamp(Math.abs(xFocus - px) / Math.abs(backXBound - frontXBound), 0.0, 1.0);
    bias = -Math.cos(bias * pi) * 0.5 + 0.5;
    bias = Math.pow(bias, 0.8);
    bias *= xFocusStrength;
    px = px * (1.0 - bias) + xFocus * bias;
  }

  if (yFocusStrength > 0.0) {
    const distance = clamp(Math.abs(yFocus - py) / Math.abs(highYBound - lowYBound), 0.0, 1.0);

    let bias = 1.0 - distance;
    bias *= 0.2 + (0.8 * Math.abs(yFocus)) / pitchHalfH;
    bias *= yFocusStrength;

    py = py * (1.0 - bias) + yFocus * bias;
  }

  // microfocus
  if (microFocusStrength > 0.0) {
    const mf = Vector3.From(microFocus).coords;

    const homogeneousYInfluenceBias = 0.2; // 1.0f == act as if everybody is on the same Y position (so, as if we're in 1D, with only X)
    const homogeneousYPositionBias = 0.4; // 1.0f == don't influence player's resulting Y position (so, as if we're in 1D, with only X)

    // this way, players are more strictly keeping to their positions
    // C++: ((microFocus - purePosition) * Vector3(1, 1.0f - homogeneousYInfluenceBias, 0)).GetLength() / 50.0f
    const distStatic = len3((mf[0] - pureX) * 1, (mf[1] - pureY) * (1.0 - homogeneousYInfluenceBias), 0) / 50.0;

    const dist = distStatic;

    if (dist < 1.0) {
      let microFocusBias = 1.0;

      // less serious when far away
      // we need this, because we use bias to vary between pos and microfocuspos. so for far away players, microfocuspos has way more influence since it's farther away.
      microFocusBias *= 1.0 - dist;

      // more of a binary choice to come over completely or not at all
      microFocusBias = curve(microFocusBias, 0.3);

      // extra short distance peak
      const peakLocation = 0.15;
      const peakWidth = 0.25;
      const peakHeight = 0.1;
      microFocusBias += (1.0 - NormalizedClamp(Math.abs(dist - peakLocation), 0.0, peakWidth)) * peakHeight;
      microFocusBias = clamp(microFocusBias, 0.0, 1.0);

      microFocusBias *= microFocusStrength;

      // C++: microFocus * Vector3(1, 1.0f - homogeneousYPositionBias, 1) + position * Vector3(0, homogeneousYPositionBias, 0)
      const mfpx = mf[0] * 1 + px * 0;
      const mfpy = mf[1] * (1.0 - homogeneousYPositionBias) + py * homogeneousYPositionBias;
      const mfpz = mf[2] * 1 + pz * 0;
      px = px * (1.0 - microFocusBias) + mfpx * microFocusBias;
      py = py * (1.0 - microFocusBias) + mfpy * microFocusBias;
      pz = pz * (1.0 - microFocusBias) + mfpz * microFocusBias;
    }
  }

  return new Vector3(px, py, pz);
}

/** C++ overloads merged: (origin, target) as positions, or as PlayerImages (which get their positions predicted first) */
export function AI_CalculatePassingOdds(
  match: Match,
  origin: Vector3 | PlayerImage,
  target: Vector3 | PlayerImage,
  opponentPlayerImages: readonly PlayerImage[],
): number {
  if (origin instanceof PlayerImage || target instanceof PlayerImage) {
    const thisPlayerImage = origin as PlayerImage;
    const targetPlayerImage = target as PlayerImage;

    // player position predictions (the C++ worked on by-value copies)
    const thisPosition = thisPlayerImage.position.Add(thisPlayerImage.directionVec.Mul(thisPlayerImage.velocity).Mul(0.1));
    const targetPosition = targetPlayerImage.position.Add(targetPlayerImage.directionVec.Mul(targetPlayerImage.velocity).Mul(0.5)); // situation in half a second

    const currentOdds = AI_CalculatePassingOdds(match, thisPosition, targetPosition, opponentPlayerImages);

    return currentOdds;
  }

  let currentOdds = 1.0;

  const oc = origin.coords;
  const tc = target.coords;

  // draw imaginary line between this and target player
  const targetDistance = len3(tc[0] - oc[0], tc[1] - oc[1], tc[2] - oc[2]);
  const checkCount = 1 + Math.trunc(Math.ceil(targetDistance * 1.0));

  // C++: (target - origin) * (1.0 / (float)checkCount) * 0.96; // * 0.96: we don't mind players standing behind target that much anyway
  const stepFactor = 1.0 / checkCount;
  const stepX = (tc[0] - oc[0]) * stepFactor * 0.96;
  const stepY = (tc[1] - oc[1]) * stepFactor * 0.96;
  const stepZ = (tc[2] - oc[2]) * stepFactor * 0.96;

  const oppCount = opponentPlayerImages.length;

  for (let i = 1; i < checkCount + 1; i++) {
    const ballX = oc[0] + stepX * i;
    const ballY = oc[1] + stepY * i;
    const ballZ = oc[2] + stepZ * i;

    const currentDistance = i * (targetDistance / checkCount);
    const maxOpponentDistance = 0.5 + currentDistance * 0.25; // at this distance, opponents start being a threat

    for (let opp = 0; opp < oppCount; opp++) {
      const op = opponentPlayerImages[opp].position.coords;
      const opponentDistance = len3(op[0] - ballX, op[1] - ballY, op[2] - ballZ);
      const odds = clamp(opponentDistance, 0, maxOpponentDistance) / maxOpponentDistance;
      if (odds < currentOdds) currentOdds = odds;
    }
  }

  currentOdds *= 1.0;

  return currentOdds;
}

/** C++ AI_GetPassRatings(..., PassRatings &passRatings): pushes into passRatings, then sorts it (ascending rating) */
export function AI_GetPassRatings(match: Match, thisPlayerID: number, mentalImage: MentalImage, opportunism: number, passRatings: PassRatings): PassRatings {
  const teamID = match.GetPlayer(thisPlayerID)!.GetTeamID();

  const thisPlayerImage = mentalImage.GetPlayerImage(thisPlayerID);

  const playerImages: PlayerImage[] = [];
  mentalImage.GetTeamPlayerImages(match.GetPlayer(thisPlayerID)!.GetTeamID(), thisPlayerID, playerImages);

  const opponentPlayerImages: PlayerImage[] = [];
  mentalImage.GetTeamPlayerImages(Math.abs(teamID - 1), -1, opponentPlayerImages);
  for (let i = 0; i < opponentPlayerImages.length; i++) {
    const img = opponentPlayerImages[i];
    img.position = img.position.Add(img.directionVec.Mul(img.velocity).Mul(0.3)); // situation in half a second
  }

  const side = match.GetPlayer(thisPlayerID)!.GetTeam().GetSide();
  const oppGoalPos = new Vector3(pitchHalfW * -side, 0, 0);
  const sideVec = new Vector3(side, 0, 0);

  for (let i = 0; i < playerImages.length; i++) {
    const targetPlayerImage = mentalImage.GetPlayerImage(playerImages[i].playerID);

    let bodyDirPenalty = thisPlayerImage.directionVec.GetDotProduct(targetPlayerImage.position.Sub(thisPlayerImage.position).GetNormalized(sideVec));
    bodyDirPenalty = clamp(bodyDirPenalty, -1.0, 0.0) + 1; // 0 .. 1
    bodyDirPenalty *= 0.7;
    bodyDirPenalty += 0.3; // 0.3 .. 1.0

    let odds = AI_CalculatePassingOdds(match, thisPlayerImage, targetPlayerImage, opponentPlayerImages);
    odds *= bodyDirPenalty;

    // distance to goal rating
    const goalDistance = clamp(dist3(oppGoalPos, thisPlayerImage.position), 8.0, 100.0) * 0.01; // ~= 0.18 .. 1.0
    const mateGoalDistance = clamp(dist3(oppGoalPos, playerImages[i].position), 8.0, 100.0) * 0.01; // ~= 0.18 .. 1.0
    const pos = clamp(0.5 + (goalDistance - mateGoalDistance) * 0.5, 0.3, 1.0);

    // situational rating
    const sit = AI_GetSituationRating(match, playerImages[i].playerID, mentalImage);

    const passRating = new PassRating(playerImages[i].playerID, Math.pow(odds, 0.8), Math.pow(pos, 0.7), Math.pow(sit, 0.6));
    passRating.CalculateRating(opportunism);

    passRatings.push(passRating);
  }

  passRatings.sort((a, b) => (a.LessThan(b) ? -1 : b.LessThan(a) ? 1 : 0));
  return passRatings;
}

export function AI_GetSituationRating(match: Match, thisPlayerID: number, mentalImage: MentalImage): number {
  let currentSituation = 1.0;
  const safeDistance = 8.0; // bigger == safer

  const thisPlayerImage = mentalImage.GetPlayerImage(thisPlayerID);

  const opponentPlayerImages: PlayerImage[] = [];
  mentalImage.GetTeamPlayerImages(Math.abs(match.GetPlayer(thisPlayerID)!.GetTeamID() - 1), -1, opponentPlayerImages);

  // player position predictions
  thisPlayerImage.position = thisPlayerImage.position.Add(thisPlayerImage.directionVec.Mul(thisPlayerImage.velocity).Mul(0.5)); // situation in half a second
  const tp = thisPlayerImage.position.coords;
  for (let i = 0; i < opponentPlayerImages.length; i++) {
    const img = opponentPlayerImages[i];
    img.position = img.position.Add(img.directionVec.Mul(img.velocity).Mul(0.5)); // situation in half a second
    const op = img.position.coords;
    let situation = clamp(len3(op[0] - tp[0], op[1] - tp[1], op[2] - tp[2]), 0, safeDistance) / safeDistance;

    situation = Math.pow(situation, 0.5);

    if (situation < currentSituation) currentSituation = situation;
  }

  // penalty for getting out of bounds
  let penalty = 0;
  const position = thisPlayerImage.position;
  // PORT: faithfully reproduces the original `fabs(position.coords[0] > 50)` (the comparison is inside fabs)
  if (position.coords[0] > 50) penalty += Math.abs(position.coords[0]) - 50;
  if (position.coords[1] > 32) penalty += Math.abs(position.coords[1]) - 32;
  currentSituation -= penalty;

  currentSituation = clamp(currentSituation, 0.0, 1.0);

  return currentSituation;
}

export function AI_CalculateFreeSpace(
  match: Match,
  mentalImage: MentalImage,
  teamID: number,
  focusPos: Vector3,
  safeDistance = 8.0,
  futureTime_sec = 0.3,
  ignoreKeeper = false,
): number {
  assert(mentalImage);

  let currentSituation = 0.0;

  const opponentPlayerImages: PlayerImage[] = [];
  mentalImage.GetTeamPlayerImages(Math.abs(teamID - 1), -1, opponentPlayerImages);

  const fc = focusPos.coords;
  const toFocusMaxLength = sprintVelocity * clamp(futureTime_sec - 0.2, 0.0, 1000.0);

  // player position predictions
  for (let i = 0; i < opponentPlayerImages.length; i++) {
    const img = opponentPlayerImages[i];
    if (ignoreKeeper === false || img.dynamicFormationEntry.role !== e_PlayerRole.e_PlayerRole_GK) {
      // resulting opp position
      // C++: position = position + movement * 0.2f; // slowness
      const ip = img.position.coords;
      const im = img.movement.coords;
      let ox = ip[0] + im[0] * 0.2;
      let oy = ip[1] + im[1] * 0.2;
      let oz = ip[2] + im[2] * 0.2;

      // C++: toFocusMovement = (focusPos - position).GetNormalized(0) * sprintVelocity * clamp(futureTime_sec - 0.2f, 0.0f, 1000.0f);
      const dx = fc[0] - ox;
      const dy = fc[1] - oy;
      const dz = fc[2] - oz;
      let tx = 0;
      let ty = 0;
      let tz = 0;
      if (!(Math.abs(dx) < 0.000001 && Math.abs(dy) < 0.000001 && Math.abs(dz) < 0.000001)) {
        const f = 1.0 / Math.sqrt(dx * dx + dy * dy + dz * dz);
        tx = dx * f * toFocusMaxLength;
        ty = dy * f * toFocusMaxLength;
        tz = dz * f * toFocusMaxLength;
      }
      if (len3(tx, ty, tz) > len3(dx, dy, dz)) {
        tx = dx;
        ty = dy;
        tz = dz;
      }
      ox += tx;
      oy += ty;
      oz += tz;
      img.position = new Vector3(ox, oy, oz);

      const situation = 1.0 - clamp(len3(ox - fc[0], oy - fc[1], oz - fc[2]), 0, safeDistance) / safeDistance;

      currentSituation += situation;
    }
  }

  return 1.0 - NormalizedClamp(currentSituation, 0.0, 2.5);
}

export function AI_GetOffsideLine(match: Match, mentalImage: MentalImage, teamID: number, futureSim_ms = 0): number {
  const side = match.GetTeam(teamID).GetSide();

  const opponentPlayerImages: PlayerImage[] = [];
  mentalImage.GetTeamPlayerImages(teamID, -1, opponentPlayerImages);

  let dudDeepestOpponent = 0;
  let deepestOpponentPosition = new Vector3(0);

  for (let i = 0; i < opponentPlayerImages.length; i++) {
    const img = opponentPlayerImages[i];
    img.position = img.position.WithCoord(0, img.position.coords[0] + img.movement.coords[0] * futureSim_ms * 0.001);

    // for offside
    if (img.position.coords[0] * side > opponentPlayerImages[dudDeepestOpponent].position.coords[0] * side) {
      dudDeepestOpponent = i;
    }
  }

  // offside: we are actually looking for the one-but-deepest opponent (association football rule! EAT THAT, PES6!! :P)
  for (let i = 0; i < opponentPlayerImages.length; i++) {
    if (opponentPlayerImages[i].position.coords[0] * side > deepestOpponentPosition.coords[0] * side && i !== dudDeepestOpponent) {
      deepestOpponentPosition = opponentPlayerImages[i].position;
    }
  }

  let offsideLine = deepestOpponentPosition.coords[0];
  const ballPrediction = mentalImage.GetBallPrediction(0);
  if (ballPrediction.coords[0] * side > offsideLine * side) {
    offsideLine = ballPrediction.coords[0];
  }
  if (offsideLine * side < 0) offsideLine = 0.01 * -side;
  offsideLine = clamp(offsideLine, -pitchHalfW, pitchHalfW);

  return offsideLine;
}

export function veloExpFactor(velo: number): number {
  return Math.pow(clamp(velo / sprintVelocity, 0.0, 1.0), 2.5) * 3.0;
}

/** C++ void AI_GetBestDribbleMovement(match, thisPlayerID, mentalImage, Vector3 &desiredDirection, float &desiredVelocity, teamTactics) */
export function AI_GetBestDribbleMovement(
  match: Match,
  thisPlayerID: number,
  mentalImage: MentalImage,
  teamTactics: TeamTactics,
): { desiredDirection: Vector3; desiredVelocity: number } {
  const player = match.GetPlayer(thisPlayerID)!;
  const myPos = player.GetPosition();
  const myMov = player.GetMovement();

  const offenseFactor =
    0.7 + teamTactics.userProperties.GetReal('dribble_offensiveness', 0.5) * 0.05 + AI_GetMindSet(player.GetDynamicFormationEntry().role) * 0.05;
  const powerMultiplier = 1.0; // should alter (average) resulting velocity

  const future_sec = 0.25;

  // PORT: the unused `thisPlayerImage = mentalImage->GetPlayerImage(thisPlayerID)` lookup is omitted (no side effects)

  const team = player.GetTeam();
  const side = team.GetSide();

  const opponentPlayerImages: PlayerImage[] = [];

  const opponents: Player[] = [];
  AI_GetClosestPlayers(match.GetTeam(Math.abs(team.GetID() - 1)), myPos, false, opponents, 5);
  for (let i = 0; i < opponents.length; i++) {
    opponentPlayerImages.push(mentalImage.GetPlayerImage(opponents[i].GetID()));
  }

  const nearBackline = NormalizedClamp(Math.abs(player.GetPosition().coords[0]) / pitchHalfW, 0.0, 1.0);
  let centerModifierInv = 1.0 - Math.pow(nearBackline, 2.0); // near the end of the pitch, we want to get inside again
  centerModifierInv *= 0.5; // stop going to the sides! wtf, todo, why does it prefer the sideline so much (probably because of no opponents :P)
  const oppGoalPos = new Vector3(-side * pitchHalfW, myPos.coords[1] * (1.0 - teamTactics.userProperties.GetReal('dribble_centermagnet', 0.5)) * centerModifierInv, 0);

  const forceField: ForceSpot[] = [];

  for (let i = 0; i < opponentPlayerImages.length; i++) {
    const oppImg = opponentPlayerImages[i];

    const spot = new ForceSpot();
    const oppPos = oppImg.position.Add(oppImg.movement.Mul(future_sec));
    spot.origin = oppPos;
    spot.magnetType = e_MagnetType.e_MagnetType_Repel;
    spot.decayType = e_DecayType.e_DecayType_Variable;
    spot.power = 2.0 * powerMultiplier;
    spot.scale = 10.0;
    spot.exp = 1.0;
    forceField.push(spot);

    // PORT: the e_DebugMode_AI debug overlay rectangle drawing is omitted (pure debug visualisation)
  }

  // sideline / backline
  {
    const spot = new ForceSpot();
    spot.origin = new Vector3(myPos.coords[0], (pitchHalfH + 5.0) * signSide(myPos.coords[1]), 0);
    spot.magnetType = e_MagnetType.e_MagnetType_Repel;
    spot.decayType = e_DecayType.e_DecayType_Variable;
    spot.power = 4.0 * powerMultiplier;
    spot.scale = 20.0;
    spot.exp = 0.7;
    forceField.push(spot);

    const spot2 = new ForceSpot();
    spot2.origin = new Vector3((pitchHalfW + 5.0) * signSide(myPos.coords[0]), myPos.coords[1], 0);
    spot2.magnetType = e_MagnetType.e_MagnetType_Repel;
    spot2.decayType = e_DecayType.e_DecayType_Variable;
    spot2.power = 4.0 * powerMultiplier;
    spot2.scale = 20.0;
    spot2.exp = 0.7;
    forceField.push(spot2);
  }

  // love for da goal
  {
    const spot = new ForceSpot();
    spot.origin = oppGoalPos;
    spot.magnetType = e_MagnetType.e_MagnetType_Attract;
    spot.decayType = e_DecayType.e_DecayType_Constant;
    spot.power = offenseFactor * powerMultiplier;
    forceField.push(spot);
  }

  const forceFieldMovement = AI_GetForceFieldMovement(forceField, myPos.Add(myMov.Mul(future_sec)), 1.0);

  const desiredDirection = forceFieldMovement.GetNormalized(player.GetDirectionVec());
  let desiredVelocity = clamp(forceFieldMovement.GetLength() * distanceToVelocityMultiplier, idleVelocity, sprintVelocity);
  desiredVelocity = RangeVelocity(desiredVelocity);

  return { desiredDirection, desiredVelocity };
}

export function AI_GetForceFieldMovement(forceField: readonly ForceSpot[], currentPos: Vector3, attractorDampingDistance = 10): Vector3 {
  // attractorDampingDistance: from this distance to attractor, dampen influence so we won't overshoot target

  let cumulVec = new Vector3(0);
  let cumulForce = 0.0;

  for (let i = 0; i < forceField.length; i++) {
    const forceSpot = forceField[i];

    let intensity: number;

    const distance = dist3(forceSpot.origin, currentPos);
    if (forceSpot.decayType === e_DecayType.e_DecayType_Constant) {
      intensity = 1.0;
    } else {
      intensity = clamp(1.0 - distance / forceSpot.scale, 0.0, 1.0);
      if (forceSpot.exp !== 1.0) intensity = Math.pow(intensity, forceSpot.exp);
    }
    if (intensity > 0.0) {
      let relativeOrigin = forceSpot.origin.Sub(currentPos).GetNormalized(0);
      if (forceSpot.magnetType === e_MagnetType.e_MagnetType_Repel) {
        relativeOrigin = relativeOrigin.Neg();
      } else {
        // attractors need damping
        if (distance < attractorDampingDistance) relativeOrigin = relativeOrigin.Mul(distance / attractorDampingDistance);
      }

      const force = forceSpot.power * intensity;

      cumulVec = cumulVec.Add(relativeOrigin.Mul(force));
      cumulForce += force;
    }
  }

  if (cumulForce === 0.0) return new Vector3(0);
  return cumulVec.Div(cumulForce).Mul(sprintVelocity);
}

export function AI_GetTimeNeededForDistance_ms(
  playerPos: Vector3,
  playerMovement: Vector3,
  targetPos: Vector3,
  maxVelocity: number = sprintVelocity,
  precise = false,
  maxTime_ms = -1,
  debug = false,
): TimeNeeded {
  const result = new TimeNeeded();

  let optimizeDist = 16.0;
  if (precise) optimizeDist = 48.0;

  const pp = playerPos.coords;
  const pm = playerMovement.coords;
  const tp = targetPos.coords;

  // C++ compares against (unsigned int)maxTime_ms
  const maxTimeUnsigned_ms = maxTime_ms >>> 0;

  const initialDist = len3(pp[0] - tp[0], pp[1] - tp[1], pp[2] - tp[2]);
  // C++: int(std::round((targetPos - (playerPos + playerMovement * 0.2f)).GetLength() / (maxVelocity * 0.75f) * 1000))
  const defaultOptimizedTime_ms =
    cround((len3(tp[0] - (pp[0] + pm[0] * 0.2), tp[1] - (pp[1] + pm[1] * 0.2), tp[2] - (pp[2] + pm[2] * 0.2)) / (maxVelocity * 0.75)) * 1000) >>> 0;
  if (initialDist > optimizeDist) {
    result.usual_ms = defaultOptimizedTime_ms;
    result.optimistic_ms = (result.usual_ms - 200) >>> 0; // unsigned int, as in the original
    return result;
  }

  // definitive best version of all versions
  // The One Version
  // or else..

  let cx = pp[0];
  let cy = pp[1];
  let cz = pp[2];

  const ffo = 0.1; // in front of foot offset (ideal ball position)
  if (len3(pm[0], pm[1], pm[2]) > idleDribbleSwitch) {
    // currentPos += currentMovement.GetNormalized() * ffo;
    const f = 1.0 / Math.sqrt(pm[0] * pm[0] + pm[1] * pm[1] + pm[2] * pm[2]);
    cx += pm[0] * f * ffo;
    cy += pm[1] * f * ffo;
    cz += pm[2] * f * ffo;
    // currentPos += currentMovement * 0.01f;
    cx += pm[0] * 0.01;
    cy += pm[1] * 0.01;
    cz += pm[2] * 0.01;
  } else {
    // currentPos += (targetPos - playerPos).GetNormalized(0) * ffo;
    const dx = tp[0] - pp[0];
    const dy = tp[1] - pp[1];
    const dz = tp[2] - pp[2];
    if (!(Math.abs(dx) < 0.000001 && Math.abs(dy) < 0.000001 && Math.abs(dz) < 0.000001)) {
      const f = 1.0 / Math.sqrt(dx * dx + dy * dy + dz * dz);
      cx += dx * f * ffo;
      cy += dy * f * ffo;
      cz += dz * f * ffo;
    }
  }

  let currentTime_ms = 0;
  const timeStep_ms = 10;
  const changeTime_ms = 700;
  let radius_usual = 0.28; // starting distance from our base position where we can reach balls (effectively: leg extension length)
  let radius_optimistic = 0.9;
  let resultingRadius_usual = radius_usual; // initial value > 0 because we don't want division by zero
  let foundOptimisticTime = false;

  const adaptedMaxVelocity = maxVelocity * 0.94; // don't use full maxvelocity, since the last part of that velo is very hard to attain (due to exponential air resistance)
  const hasMaxTime = maxTime_ms !== -1;

  while (true) {
    // =]

    const bias = clamp(currentTime_ms / changeTime_ms, 0.0, 1.0);

    if (bias >= 1.0) {
      // we can now simply calculate the time needed
      const targetDistance = len3(tp[0] - cx, tp[1] - cy, tp[2] - cz);
      const remainingDistance_usual = clamp(targetDistance - radius_usual, 0.0, 100000.0);
      result.usual_ms = Math.trunc(currentTime_ms + (remainingDistance_usual / adaptedMaxVelocity) * 1000);
      resultingRadius_usual = radius_usual + remainingDistance_usual;

      if (!foundOptimisticTime) {
        const remainingDistance_optimistic = clamp(targetDistance - radius_optimistic, 0.0, 100000.0);
        result.optimistic_ms = Math.trunc(currentTime_ms + (remainingDistance_optimistic / adaptedMaxVelocity) * 1000);
      }

      break;
    } else {
      // manual copy: this function is called a lot, so if we use the Vector3::operator*, it's creating a lot of temp vars.
      const mx = pm[0] * (1.0 - bias);
      const my = pm[1] * (1.0 - bias);

      cx += mx * timeStep_ms * 0.001;
      cy += my * timeStep_ms * 0.001;

      // within this radius, we can get to a ball
      radius_usual += adaptedMaxVelocity * bias * timeStep_ms * 0.001;
      radius_optimistic += adaptedMaxVelocity * bias * timeStep_ms * 0.001;

      const targetDistance = len3(tp[0] - cx, tp[1] - cy, tp[2] - cz);
      const outOfTime = hasMaxTime && currentTime_ms > maxTimeUnsigned_ms;
      if ((targetDistance < radius_optimistic || outOfTime) && !foundOptimisticTime) {
        result.optimistic_ms = currentTime_ms;
        foundOptimisticTime = true;
      }
      if (targetDistance < radius_usual || outOfTime) {
        resultingRadius_usual = radius_usual;
        result.usual_ms = currentTime_ms;
        break;
      }
    }

    currentTime_ms += timeStep_ms;
  }

  if (hasMaxTime && currentTime_ms > maxTimeUnsigned_ms) {
    result.usual_ms = Math.max(defaultOptimizedTime_ms, (currentTime_ms + 100) * 2);
    if (!foundOptimisticTime) result.optimistic_ms = result.usual_ms;
    return result;
  }

  // very, very close! just take distance as time, so we can still compare to other players properly
  if (result.usual_ms === 0) {
    result.usual_ms = cround(clamp(len3(tp[0] - pp[0], tp[1] - pp[1], tp[2] - pp[2]) / resultingRadius_usual, 0.0, 1.0) * 10);
    result.optimistic_ms = result.usual_ms;
  }

  return result;
}

/**
 * C++ unsigned int AI_GetToBallMovement(match, mentalImage, player, desiredDirection, desiredVelocityFloat,
 *                                       Vector3 &bestDirection, float &bestVelocityFloat, Vector3 &bestLookAt, float haste = 0.0f)
 */
export function AI_GetToBallMovement(
  match: Match,
  mentalImage: MentalImage,
  player: Player,
  desiredDirection: Vector3,
  desiredVelocityFloat: number,
  haste = 0.0,
): { result: number; bestDirection: Vector3; bestVelocityFloat: number; bestLookAt: Vector3 } {
  const playerPos = player.GetPosition();
  const playerMovement = player.GetMovement();
  const playerMaxVelocity = player.GetMaxVelocity();

  let movementWeight = 1.0;
  let timeWeight = 0.0;
  let perpendicularWeight = 0.1;
  const previousTargetWeight = 0.0;

  let adaptedDesiredDirection = desiredDirection;

  // precalc shortest distance to ball 'line' for perpendicularity rating (so we have a minimum value there)

  const ballPrediction0 = mentalImage.GetBallPrediction(0).Get2D();
  const ballPrediction1000 = mentalImage.GetBallPrediction(1000).Get2D();
  const ballLine = new Line(ballPrediction0, ballPrediction1000);
  const u = ballLine.GetClosestToPoint(playerPos); // (C++: GetDistanceToPoint(playerPos, u); only u is used)
  const playerBallShortestTargetPos = ballLine.GetVertex(0).Add(ballLine.GetVertex(1).Sub(ballLine.GetVertex(0)).Mul(u));

  // quantize input 8- or 16-way in relation to 'ball direction space'

  const ballSpaceDirection = ballPrediction0.Sub(ballPrediction1000).GetNormalized(adaptedDesiredDirection);
  const toBallSpaceAngle: radian = ballSpaceDirection.GetAngle2D();
  let adaptedDesiredDirectionBallSpace = adaptedDesiredDirection.GetRotated2D(-toBallSpaceAngle);

  const directions = 16;

  let angle: radian = adaptedDesiredDirectionBallSpace.GetAngle2D();
  angle /= pi * 2.0;
  angle = cround(angle * directions);
  angle /= directions;
  angle *= pi * 2.0;

  const bias = 1.0;
  adaptedDesiredDirectionBallSpace = adaptedDesiredDirectionBallSpace
    .Mul(1.0 - bias)
    .Add(new Vector3(1, 0, 0).GetRotated2D(angle).Mul(bias))
    .GetNormalized(adaptedDesiredDirectionBallSpace);

  adaptedDesiredDirection = adaptedDesiredDirectionBallSpace.GetRotated2D(toBallSpaceAngle);

  const desiredMovement = adaptedDesiredDirection.Mul(desiredVelocityFloat);

  if (haste > 0.0) {
    movementWeight = 0.0;
    timeWeight = 1.0;
    perpendicularWeight = 0.0;
  }

  // PossibleChoice
  let bestChoice_rating = -10000.0;
  let bestChoice_timeNeeded_ms = -10;
  let bestChoice_time_ms = -10;

  const timeNeededToGetToBall_ms = player.GetTimeNeededToGetToBall_ms();

  let startTime_ms = Math.trunc(clamp(timeNeededToGetToBall_ms, 40, ballPredictionSize_ms - 10));
  // we can't start optimized at a later moment, because that would mean we'd aim outside the pitch to start with
  const ballPrediction = mentalImage.GetBallPrediction(startTime_ms);
  if (Math.abs(ballPrediction.coords[0]) > pitchHalfW - 0.2 || Math.abs(ballPrediction.coords[1]) > pitchHalfH - 0.2) {
    startTime_ms = 80;
  }

  const previousDesiredTargetTime_ms = player.GetDesiredTimeToBall_ms();

  // PORT: the unused ffoLength (GetFrontOfFootOffsetRel) and desiredBallDot locals are omitted (pure, results unused)

  const ballMovementRough = mentalImage
    .GetBallPrediction(timeNeededToGetToBall_ms + 10)
    .Sub(mentalImage.GetBallPrediction(timeNeededToGetToBall_ms))
    .Get2D()
    .Mul(100.0);
  const ballDirectionRough = ballMovementRough.GetNormalized(adaptedDesiredDirection);

  // loop invariants
  const ppc = playerPos.coords;
  const dmc = desiredMovement.coords;
  const sbc = playerBallShortestTargetPos.coords;
  const brc = ballDirectionRough.coords;
  const addc = adaptedDesiredDirection.coords;
  // --- rate similarity to player's previous preferred target
  let previousTargetRating = 0.0;
  if (previousDesiredTargetTime_ms >= timeNeededToGetToBall_ms) {
    previousTargetRating = 1.0 - Math.abs(previousDesiredTargetTime_ms - timeNeededToGetToBall_ms) / 500.0;
  }

  let timeStep = 1;

  for (let time_ms = startTime_ms; time_ms < ballPredictionSize_ms; time_ms += 10 * timeStep) {
    let forced = false;

    let targetPos = mentalImage.GetBallPrediction(time_ms);
    if (Math.abs(targetPos.coords[0]) > pitchHalfW - 0.2 || Math.abs(targetPos.coords[1]) > pitchHalfH - 0.2) {
      forced = true;
    }
    if (!forced) if (targetPos.coords[2] >= 1.0) continue; // unattainable
    targetPos = targetPos.Get2D();

    const timeNeeded = AI_GetTimeNeededForDistance_ms(playerPos, playerMovement, targetPos, playerMaxVelocity, true, time_ms);
    const timeNeeded_ms = timeNeeded.usual_ms;

    // if ball is going to be too far away anyway, optimize by skipping 'frames'
    // C++: (signed int)(timeNeeded_ms - time_ms) on unsigned ints
    timeStep = Math.min(Math.max(Math.trunc(cround(((timeNeeded_ms - time_ms) | 0) * 0.05)) - 5, 1), 10);

    if (timeNeeded_ms <= time_ms) {
      const tc = targetPos.coords;
      // (targetPos - playerPos)
      const tdx = tc[0] - ppc[0];
      const tdy = tc[1] - ppc[1];
      const tdz = tc[2] - ppc[2];
      // (targetPos - playerPos).GetNormalized(0)
      let nx = 0;
      let ny = 0;
      let nz = 0;
      if (!(Math.abs(tdx) < 0.000001 && Math.abs(tdy) < 0.000001 && Math.abs(tdz) < 0.000001)) {
        const f = 1.0 / Math.sqrt(tdx * tdx + tdy * tdy + tdz * tdz);
        nx = tdx * f;
        ny = tdy * f;
        nz = tdz * f;
      }

      const dot = nx * brc[0] + ny * brc[1] + nz * brc[2];
      const justInTimeFactor = clamp(timeNeededToGetToBall_ms / time_ms, 0.0, 1.0); // lower == more time to spare
      if (justInTimeFactor < 0.35) forced = true; // takes too long relative to how long it could take
      if (dot > 0.0) forced = true; // too shallow angle, just go to ball already

      // --- heed desired direction

      const targetDistance = len3(tdx, tdy, tdz);
      const targetVelocity = clamp(targetDistance * distanceToVelocityMultiplier, idleVelocity, sprintVelocity);
      const tmx = nx * targetVelocity;
      const tmy = ny * targetVelocity;
      const tmz = nz * targetVelocity;
      let movementRating = 1.0 - NormalizedClamp(len3(dmc[0] - tmx, dmc[1] - tmy, dmc[2] - tmz), 0.0, sprintVelocity); // > sprintvelocity will often get us farther from where we want to go to
      // targetMovement.GetNormalized(adaptedDesiredDirection)
      let tnx: number;
      let tny: number;
      let tnz: number;
      if (Math.abs(tmx) < 0.000001 && Math.abs(tmy) < 0.000001 && Math.abs(tmz) < 0.000001) {
        tnx = addc[0];
        tny = addc[1];
        tnz = addc[2];
      } else {
        const f = 1.0 / Math.sqrt(tmx * tmx + tmy * tmy + tmz * tmz);
        tnx = tmx * f;
        tny = tmy * f;
        tnz = tmz * f;
      }
      const directionRating =
        1.0 - NormalizedClamp(Math.abs(adaptedDesiredDirection.GetAngle2D(new Vector3(tnx, tny, tnz))), 0.0, 0.5 * pi); // > 0.5f * pi will often only get us farther from where we want to go to
      movementRating = movementRating * 0.4 + directionRating * 0.6; // directionrating omits velocity and therefore has another quality

      // --- less time is better?

      const timeRating = 1.0 - NormalizedClamp(time_ms, 0, 5000);

      // --- rate perpendicularity targetmovement to ballmovement vector

      const perpendicularRating = 1.0 - NormalizedClamp(len3(sbc[0] - tc[0], sbc[1] - tc[1], sbc[2] - tc[2]), 0, 2.0 * sprintVelocity);

      const rating =
        movementRating * movementWeight +
        timeRating * timeWeight +
        perpendicularRating * perpendicularWeight +
        previousTargetRating * previousTargetWeight;

      if (rating > bestChoice_rating || (forced && bestChoice_time_ms === -10)) {
        bestChoice_rating = rating;
        bestChoice_time_ms = time_ms;
        bestChoice_timeNeeded_ms = timeNeeded_ms;
      }
    } // timeNeeded_ms <= time_ms

    if (forced) {
      if (bestChoice_time_ms === -10) {
        // this happens if timeNeeded_ms > time_ms
        bestChoice_time_ms = time_ms;
        bestChoice_timeNeeded_ms = time_ms; // just fake it - get as close as possible
      }
      break;
    }
  }

  if (bestChoice_time_ms === -10) {
    bestChoice_time_ms = ballPredictionSize_ms - 10;
    bestChoice_timeNeeded_ms = ballPredictionSize_ms - 10;
  }

  const targetPos = mentalImage.GetBallPrediction(bestChoice_time_ms).Get2D();
  const bestDirection = targetPos.Sub(playerPos).GetNormalized(player.GetDirectionVec());

  // velocity

  // PORT: the unused bestVelocityRelaxed / bestVelocityASAP alternatives are omitted
  const bestVelocityTimeBased = clamp((bestChoice_timeNeeded_ms / bestChoice_time_ms) * playerMaxVelocity, idleVelocity, sprintVelocity);

  // simple version
  let bestVelocityFloat = bestVelocityTimeBased;
  // stick to current velo, to prevent switching back and forth
  if (bestChoice_time_ms > 250) bestVelocityFloat = bestVelocityFloat * 0.97 + player.GetFloatVelocity() * 0.03;

  // lookat dir

  const lookAtBall = mentalImage.GetBallPrediction(20).Get2D().Sub(playerPos).GetNormalized(adaptedDesiredDirection);
  const lookAtDirection = bestDirection;
  let lookAtDesiredDir: Vector3;
  // if we're close to target, allow looking in desired direction more. if we are farther away, we don't want to walk backwards yet, it makes no sense.
  if (bestChoice_time_ms < 100) {
    // these were desiredDirection first, instead of adapted
    lookAtDesiredDir = adaptedDesiredDirection;
  } else {
    if (FloatToEnumVelocity(bestVelocityFloat) !== e_Velocity.e_Velocity_Idle) {
      lookAtDesiredDir = adaptedDesiredDirection.GetClamped2D(lookAtBall, lookAtDirection);
    } else {
      lookAtDesiredDir = adaptedDesiredDirection;
    }
  }

  // combine!
  const bestLookAt = playerPos.Add(lookAtBall.GetRotated2D(clamp(lookAtDesiredDir.GetAngle2D(lookAtBall) * 1.0, -0.25 * pi, 0.25 * pi)).Mul(10.0));

  return { result: bestChoice_time_ms, bestDirection, bestVelocityFloat, bestLookAt };
}

/**
 * C++ unsigned int AI_GetBallControlMovement(mentalImage, player, desiredDirection, desiredVelocityFloat,
 *                                            Vector3 &bestDirection, float &bestVelocityFloat, Vector3 &bestLookAt)
 */
export function AI_GetBallControlMovement(
  mentalImage: MentalImage,
  player: Player,
  desiredDirection: Vector3,
  desiredVelocityFloat: number,
): { result: number; bestDirection: Vector3; bestVelocityFloat: number; bestLookAt: Vector3 } {
  const desiredTimeToBall_ms = 250 + defaultTouchOffset_ms;

  const toBallMovement = mentalImage.GetBallPrediction(desiredTimeToBall_ms).Get2D().Sub(player.GetPosition());
  const toBallDistance = toBallMovement.GetLength();

  // this should get rid of short distance artifacts
  const manualDirectionStartDistanceThreshold = 0.2;
  const manualDirectionEndDistanceThreshold = 0.4;
  let autoDirectionBias = 1.0;
  if (toBallDistance < manualDirectionEndDistanceThreshold) {
    autoDirectionBias = Math.pow(NormalizedClamp(toBallDistance, manualDirectionStartDistanceThreshold, manualDirectionEndDistanceThreshold), 0.5);
  }

  const autoDirection = toBallMovement.GetNormalized(player.GetDirectionVec());
  const manualDirection = player.GetDirectionVec();

  let bestDirection = autoDirection.Mul(autoDirectionBias).Add(manualDirection.Mul(1.0 - autoDirectionBias));
  bestDirection = bestDirection.GetNormalized(player.GetDirectionVec());

  // look direction
  const bestLookDirection = bestDirection;

  const toBallVelocity = toBallDistance * distanceToVelocityMultiplier;
  let bestVelocityFloat = toBallVelocity;

  if (bestVelocityFloat < dribbleVelocity) {
    // don't quantize low velos
  } else {
    const clampedDesiredVelocityFloat = clamp(desiredVelocityFloat, bestVelocityFloat, bestVelocityFloat + 8.0);
    bestVelocityFloat = clampedDesiredVelocityFloat;
    if (RangeVelocity(bestVelocityFloat) < bestVelocityFloat) bestVelocityFloat = bestVelocityFloat * 0.9 + RangeVelocity(bestVelocityFloat) * 0.1;
    if (RangeVelocity(bestVelocityFloat) > bestVelocityFloat) bestVelocityFloat = bestVelocityFloat * 0.1 + RangeVelocity(bestVelocityFloat) * 0.9;
  }

  const bestLookAt = player.GetPosition().Add(bestLookDirection.Mul(10.0));

  return { result: player.GetTimeNeededToGetToBall_ms(), bestDirection, bestVelocityFloat, bestLookAt };
}

export function AI_HasPossession(ball: Ball, player: Player): boolean {
  const playerMovement = player.GetMovement();

  const ballPos = ball.Predict(0);

  // premature optimization ;)
  if (dist3(player.GetPosition(), ballPos) > 5.0) return false;

  if (Math.abs(ballPos.coords[2]) > 0.5) return false;

  let distanceOK = true;
  const radius = 1.0;
  const center = player.GetPosition().Add(player.GetMovement().Mul(0.05)).Add(player.GetDirectionVec().Mul(0.1)); //was: 0.05f
  if (dist3(ballPos.Get2D(), center) > radius) distanceOK = false;

  let movementOK = true;
  const ballMovement3D = ball.Predict(10).Sub(ballPos).Mul(100.0);
  if (dist3(ballMovement3D, playerMovement) > 6.0) movementOK = false;

  if (distanceOK && movementOK) return true;
  else return false;
}

export function AI_GetTeamPossessionFactor(match: Match, team: Team): number {
  const t1 = team.GetTimeNeededToGetToBall_ms();
  const t2 = match.GetTeam(Math.abs(team.GetID() - 1)).GetTimeNeededToGetToBall_ms();
  const amount = t2 - t1;

  let factor = amount / 5000.0; // ~ -1 .. 1
  factor = clamp(factor * 0.5 + 0.5, 0.0, 1.0); // 0 .. 1

  return factor;
}

export function AI_GetClosestPlayer(team: Team, position: Vector3, onlyAIControlled: boolean, except: Player | null = null): Player | null {
  const players = team.GetAllPlayers();

  let closestDistance = 10000;
  let closestPlayer: Player | null = null;

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (p.IsActive() && p !== except) {
      const distance = dist3(p.GetPosition(), position);
      if (distance < closestDistance) {
        if (!onlyAIControlled || !team.IsHumanControlled(p.GetID())) {
          closestDistance = distance;
          closestPlayer = p;
        }
      }
    }
  }

  return closestPlayer;
}

/** C++ void AI_GetClosestPlayers(team, position, onlyAIControlled, std::vector<Player*> &result, playerCount = 3): pushes into result (closest first) */
export function AI_GetClosestPlayers(team: Team, position: Vector3, onlyAIControlled: boolean, result: Player[], playerCount = 3): Player[] {
  const players = team.GetAllPlayers();
  // C++ std::multimap<float, Player*>: sorted by distance, equal distances in insertion order (Array.sort is stable)
  const tmpResult: { distance: number; player: Player }[] = [];

  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (p.IsActive()) {
      const distance = dist3(p.GetPosition(), position);
      if (!onlyAIControlled || (onlyAIControlled && !team.IsHumanControlled(p.GetID()))) {
        tmpResult.push({ distance, player: p });
      }
    }
  }

  tmpResult.sort((a, b) => (a.distance < b.distance ? -1 : b.distance < a.distance ? 1 : 0));

  for (let i = 0; i < playerCount && i < tmpResult.length; i++) {
    result.push(tmpResult[i].player);
  }

  return result;
}

export function AI_GetBestSwitchTargetPlayer(match: Match, team: Team, desiredMovement: Vector3): Player | null {
  const side = team.GetSide();

  // find most interesting position on pitch

  const actionPosition = match.GetDesignatedPossessionPlayer().GetPosition().Mul(0.5).Add(match.GetBall().Predict(100).Get2D().Mul(0.5));

  let defensePosition = actionPosition.Mul(new Vector3(1.0, 0.8, 0.0)).Add(new Vector3(side * 4.0, 0.0, 0.0));
  const offensePosition = actionPosition.Mul(new Vector3(1.0, 0.8, 0.0)).Add(new Vector3(-side * 8.0, 0.0, 0.0));

  // experiment: also take team possession player into account, try to pick one near
  defensePosition = defensePosition.Mul(0.8).Add(team.GetDesignatedTeamPossessionPlayer().GetPosition().Mul(0.2));

  let offenseBias = team.GetFadingTeamPossessionAmount() - 0.5;
  offenseBias = offenseBias * 0.2 + clamp(team.GetTeamPossessionAmount() - 0.5, 0.0, 1.0) * 0.8; // more direct, more urgent
  offenseBias = clamp((offenseBias - 0.5) * 2.0 + 0.5, 0.0, 1.0); // make more binary
  offenseBias = clamp(Math.pow(offenseBias, 1.5), 0.0, 1.0); // tend towards defensive

  const resultingPosition = defensePosition.Mul(1.0 - offenseBias).Add(offensePosition.Mul(offenseBias));

  assert(offenseBias >= 0.0 && offenseBias <= 1.0);

  // get sorted list of closest players

  const teamPlayers: Player[] = [];
  AI_GetClosestPlayers(team, resultingPosition, true, teamPlayers, 8);
  for (let i = 0; i < teamPlayers.length; ) {
    if (teamPlayers[i].GetFormationEntry().role === e_PlayerRole.e_PlayerRole_GK) {
      teamPlayers.splice(i, 1);
    } else {
      i++;
    }
  }

  if (teamPlayers.length === 0) return null;

  // in case of defending, we ideally need someone who is closer to our goal than the opponent

  let bestPlayerIndex = 0; // closest player - sorted first in teamplayers array
  const tooLateDistance = 1.0;

  const designated = match.GetDesignatedPossessionPlayer();
  if (designated.GetTeamID() !== team.GetID()) {
    const opp = designated;
    const goalPos = new Vector3(side * pitchHalfW, 0.0, 0.0);
    const oppGoalDist = dist3(goalPos, opp.GetPosition().Add(opp.GetMovement().Mul(0.5)));
    for (let i = 0; i < teamPlayers.length; i++) {
      const mateGoalDist = dist3(goalPos, teamPlayers[i].GetPosition().Add(teamPlayers[i].GetMovement().Mul(0.5)));
      if (mateGoalDist < oppGoalDist + tooLateDistance + clamp(oppGoalDist * 0.1, 0.0, 3.0)) {
        // doesn't matter much when opp is still far away from goal
        bestPlayerIndex = i;
        break;
      }
    }
  }

  return teamPlayers[bestPlayerIndex];
}

/** C++ void AI_GetAutoPass(passType, vector, Vector3 &resultingDirection, float &resultingPower) */
export function AI_GetAutoPass(passType: e_FunctionType, vector: Vector3): { resultingDirection: Vector3; resultingPower: number } {
  let heightOffset = 0.11;
  let powerFactor = 1.8;
  let distanceExp = 1.4;
  if (passType === e_FunctionType.e_FunctionType_HighPass) {
    heightOffset = 0.45 - NormalizedClamp(vector.GetLength(), 0.0, 60.0) * 0.15;
    powerFactor = 1.15;
    distanceExp = 1.4;
  }
  const resultingDirection = vector.GetNormalized(0).Add(new Vector3(0, 0, heightOffset)).GetNormalized(0);
  const resultingPower = Math.pow(NormalizedClamp(vector.GetLength(), 0.0, 60.0), distanceExp) * powerFactor;
  return { resultingDirection, resultingPower };
}

/**
 * C++ void AI_GetPass(player, passType, inputDirection, inputPower, autoDirectionBias, autoPowerBias,
 *                     Vector3 &resultingDirection, float &resultingPower, Player *&targetPlayer, Player *forcedTargetPlayer = 0)
 */
export function AI_GetPass(
  player: Player,
  passType: e_FunctionType,
  inputDirection: Vector3,
  inputPower: number,
  autoDirectionBias: number,
  autoPowerBias: number,
  forcedTargetPlayer: Player | null = null,
): { resultingDirection: Vector3; resultingPower: number; targetPlayer: Player } {
  let resultingDirection: Vector3;
  let resultingPower: number;
  let targetPlayer: Player;

  // cheat for digital input

  let fullAutoDirection = false;
  let fullAutoPower = false;
  const externalController = player.GetExternalController();
  if (externalController) {
    if ((externalController as HumanController).GetHIDevice().GetDeviceType() === e_HIDeviceType.e_HIDeviceType_Keyboard) {
      fullAutoDirection = true;
    }
  }

  let adaptedAutoDirectionBias = autoDirectionBias;
  let adaptedAutoPowerBias = autoPowerBias;

  assert(forcedTargetPlayer !== player);

  // find out what player we intend to play to

  let playerPos = player.GetPosition().Add(player.GetMovement().GetNormalized(0).Mul(0.2)); // + ffo. don't need movement for future stuff, since getpass is recalled at moment of passing, for refinement
  if (player.TouchAnim()) {
    playerPos = player.GetTouchPos().Get2D();
  }
  const manualTarget = playerPos.Add(inputDirection.Mul(clamp(inputPower * 60.0, 1.0, 100.0)));

  const players: Player[] = [];
  player.GetTeam().GetActivePlayers(players);

  if (players.length < 2) {
    resultingDirection = player.GetDirectionVec();
    resultingPower = 1.0;
    targetPlayer = player;
    fullAutoDirection = false;
    fullAutoPower = false;
    adaptedAutoDirectionBias = 0.0;
    adaptedAutoPowerBias = 0.0;
  }

  let bestTargetPlayer = player;
  let autoTarget = manualTarget;

  if (forcedTargetPlayer) {
    bestTargetPlayer = forcedTargetPlayer;

    let passDuration = 0.3 + dist3(forcedTargetPlayer.GetPosition(), playerPos) * 0.05; // educated guess
    passDuration = Math.pow(clamp(passDuration, 0.0, 1.0), 0.7) * 0.7; // after this time, the player is supposed to have been able to stop

    autoTarget = forcedTargetPlayer.GetPosition().Add(forcedTargetPlayer.GetMovement().Mul(passDuration)); // correct for pass duration
  } else {
    let bestRating = 10000;
    autoTarget = playerPos;

    for (let i = 0; i < players.length; i++) {
      if (players[i] !== player) {
        let passDuration = 0.3 + dist3(players[i].GetPosition(), playerPos) * 0.05; // educated guess
        passDuration = Math.pow(clamp(passDuration, 0.0, 1.0), 0.7) * 0.7; // after this time, the player is supposed to have been able to stop

        const targetPos = players[i].GetPosition().Add(players[i].GetMovement().Mul(passDuration)); // correct for pass duration
        // rate
        // pow() this so small differences matter more - from some point on, it just doesn't really matter that much anymore
        const distanceRating = Math.pow(NormalizedClamp(dist3(targetPos, manualTarget), 0.0, 70.0), 0.8) * 0.8;
        const angleRating = Math.abs(targetPos.Sub(playerPos).GetNormalized(0).GetAngle2D(inputDirection) / (1.0 * pi)) * 1.0;
        if (distanceRating + angleRating < bestRating) {
          bestRating = distanceRating + angleRating;
          bestTargetPlayer = players[i];
          autoTarget = targetPos;
        }
      }
    }
  }

  targetPlayer = bestTargetPlayer;
  assert(targetPlayer);

  let autoTargetRel = autoTarget.Sub(playerPos);
  let manualTargetRel = manualTarget.Sub(playerPos);

  if (forcedTargetPlayer || (fullAutoDirection && fullAutoPower)) {
    adaptedAutoDirectionBias = 1.0;
    adaptedAutoPowerBias = 1.0;
  } else {
    // only help when at least somewhat close to target
    const maxAllowedDistance = 50.0;
    const distanceFactor = 1.0 - Math.pow(clamp(autoTargetRel.Sub(manualTargetRel).GetLength() / maxAllowedDistance, 0.0, 1.0), 1.5);
    // extra help with power on close targets (because people can only physicaly press the pass button so short)
    const proximityBonus = Math.pow(1.0 - NormalizedClamp(dist3(playerPos, autoTarget), 0.0, 12.0), 0.5);

    if (fullAutoDirection) {
      adaptedAutoDirectionBias = 1.0;
    } else {
      adaptedAutoDirectionBias *= distanceFactor;
      adaptedAutoDirectionBias = Math.pow(adaptedAutoDirectionBias, 1.0 - proximityBonus * 0.9);
    }
    if (fullAutoPower) {
      adaptedAutoPowerBias = 1.0;
    } else {
      adaptedAutoPowerBias *= distanceFactor;
      adaptedAutoPowerBias = clamp(adaptedAutoPowerBias * (1.0 + proximityBonus), 0.0, 1.0);
    }
  }

  if (passType === e_FunctionType.e_FunctionType_LongPass) {
    const targetDistance = autoTargetRel.GetLength() * adaptedAutoDirectionBias + manualTargetRel.GetLength() * (1.0 - adaptedAutoDirectionBias);
    const offset = new Vector3(-player.GetTeam().GetSide() * targetDistance * 0.2, 0, 0);
    autoTargetRel = autoTargetRel.Add(offset);
    manualTargetRel = manualTargetRel.Add(offset);
  }
  let resultingTargetRel = autoTargetRel
    .GetNormalized(0)
    .Mul(adaptedAutoDirectionBias)
    .Add(manualTargetRel.GetNormalized(0).Mul(1.0 - adaptedAutoDirectionBias))
    .GetNormalized(manualTarget);
  resultingTargetRel = resultingTargetRel.Mul(autoTargetRel.GetLength() * adaptedAutoPowerBias + manualTargetRel.GetLength() * (1.0 - adaptedAutoPowerBias));

  ({ resultingDirection, resultingPower } = AI_GetAutoPass(passType, resultingTargetRel));

  return { resultingDirection, resultingPower, targetPlayer };
}

/** this is to get a 'rough' idea of where to shoot, so we can pick the proper animation. exact direction will be tweaked later on. */
export function AI_GetShotDirection(player: Player, inputDirection: Vector3, autoDirectionBias = 1.0): Vector3 {
  const manualDirection = inputDirection;

  const side = player.GetTeam().GetSide();
  let goalPos = new Vector3(side * -pitchHalfW, 0, 0);
  const futurePos = player.GetPosition().Add(player.GetMovement().Mul(0.12));
  const toGoal = goalPos.Sub(futurePos).GetNormalized(0);
  // if inputDirection ~== toGoal, it is considered as aiming 'through the middle'. so, get the deviation from inputDirection to toGoal, and make 90 degrees the maximum
  const relAngle: radian = toGoal.GetAngle2D(inputDirection);
  let sideFactor = clamp(relAngle / pi / 0.5, -1.0, 1.0);
  // more attenuation towards the sides
  sideFactor = Math.pow(Math.abs(sideFactor), 0.7) * signSide(sideFactor);

  goalPos = goalPos.WithCoord(1, sideFactor * goalHalfWidth * 0.9 * side);
  const autoDirection = goalPos.Sub(futurePos).GetNormalized(0);

  return manualDirection.Mul(1.0 - autoDirectionBias).Add(autoDirection.Mul(autoDirectionBias)).GetNormalized(inputDirection);
}

// get the offensiveness of a role
export function AI_GetMindSet(role: e_PlayerRole): number {
  let mindSet = 0.5;

  if (role === e_PlayerRole.e_PlayerRole_GK) mindSet = 0.0;

  if (role === e_PlayerRole.e_PlayerRole_CB) mindSet = 0.0;

  if (role === e_PlayerRole.e_PlayerRole_LB || role === e_PlayerRole.e_PlayerRole_RB) mindSet = 0.25;

  if (role === e_PlayerRole.e_PlayerRole_DM) mindSet = 0.25;

  if (role === e_PlayerRole.e_PlayerRole_LM || role === e_PlayerRole.e_PlayerRole_CM || role === e_PlayerRole.e_PlayerRole_RM) mindSet = 0.5;

  if (role === e_PlayerRole.e_PlayerRole_AM) mindSet = 0.75;

  if (role === e_PlayerRole.e_PlayerRole_CF) mindSet = 1.0;

  return mindSet;
}
