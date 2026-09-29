// Port of legacy/src/onthepitch/player/humanoid/animcollection.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).

import { Vector3, Quaternion } from '../../../../blunted/base/math/vector3';
import { ModulateIntoRange, NormalizedClamp, clamp, cround, curve, pi, type radian } from '../../../../blunted/base/math/bluntmath';
import { assert } from '../../../../blunted/base/assert';
import { Log, e_FatalError, e_Notice } from '../../../../blunted/base/log';
import { Properties } from '../../../../blunted/base/properties';
import { GetVectorFromString, atof, int_to_str, real_to_str } from '../../../../blunted/base/utils';
import { FileSystem } from '../../../../blunted/managers/filesystem';
import type { Node } from '../../../../blunted/scene/node';
import type { Geometry } from '../../../../blunted/scene/objects/geometry';
import type { Scene3D } from '../../../../blunted/scene/scene3d';
import { e_LocalMode, e_ObjectType } from '../../../../blunted/scene/spatial';
import { ObjectLoader } from '../../../../blunted/utils/objectloader';
import {
  dribbleVelocity,
  dribbleWalkSwitch,
  e_FunctionType,
  e_Side,
  e_Velocity,
  idleDribbleSwitch,
  idleVelocity,
  sprintVelocity,
  walkSprintSwitch,
  walkVelocity,
  type DataSet,
} from '../../../gamedefines';
import { GetVelocityID } from '../../../footballutils';
import { Verbose } from '../../../globals';
import { Animation, e_Foot, type KeyFrame, type NodeMap, type SortedIntMap } from '../../../utils/animation';
import { FootballAnimationExtension } from '../../../utils/animationextensions/footballanimationextension';

export enum e_DefString {
  e_DefString_Empty = 0,
  e_DefString_OutgoingSpecialState = 1,
  e_DefString_IncomingSpecialState = 2,
  e_DefString_SpecialVar1 = 3,
  e_DefString_SpecialVar2 = 4,
  e_DefString_Type = 5,
  e_DefString_Trap = 6,
  e_DefString_Deflect = 7,
  e_DefString_Interfere = 8,
  e_DefString_Trip = 9,
  e_DefString_ShortPass = 10,
  e_DefString_LongPass = 11,
  e_DefString_Shot = 12,
  e_DefString_Sliding = 13,
  e_DefString_Movement = 14,
  e_DefString_Special = 15,
  e_DefString_BallControl = 16,
  e_DefString_HighPass = 17,
  e_DefString_Catch = 18,
  e_DefString_OutgoingRetainState = 19,
  e_DefString_IncomingRetainState = 20,
  e_DefString_Size = 21,
}

export function FixAngle(angle: radian): radian {
  // convert engine angle into football angle (different base orientation: 'down' on y instead of 'right' on x)
  let newAngle = angle;
  newAngle += 0.5 * pi;
  return ModulateIntoRange(-pi, pi, newAngle);
}

export function RangeVelocity(velocity: number): number {
  let retVelocity = idleVelocity;
  if (velocity >= idleDribbleSwitch && velocity < dribbleWalkSwitch) retVelocity = dribbleVelocity;
  else if (velocity >= dribbleWalkSwitch && velocity < walkSprintSwitch) retVelocity = walkVelocity;
  else if (velocity >= walkSprintSwitch) retVelocity = sprintVelocity;
  return retVelocity;
}

export function ClampVelocity(velocity: number): number {
  if (velocity < 0) return 0;
  if (velocity > sprintVelocity) return sprintVelocity;
  return velocity;
}

export function FloorVelocity(velocity: number): number {
  let retVelocity = idleVelocity;
  if (velocity > 0 && velocity < dribbleVelocity) retVelocity = dribbleVelocity;
  else if (velocity <= walkVelocity) retVelocity = walkVelocity;
  else retVelocity = sprintVelocity;
  return retVelocity;
}

export function EnumToFloatVelocity(velocity: e_Velocity): number {
  switch (velocity) {
    case e_Velocity.e_Velocity_Idle:
      return idleVelocity;
    case e_Velocity.e_Velocity_Dribble:
      return dribbleVelocity;
    case e_Velocity.e_Velocity_Walk:
      return walkVelocity;
    case e_Velocity.e_Velocity_Sprint:
      return sprintVelocity;
  }
  return 0;
}

export function FloatToEnumVelocity(velocity: number): e_Velocity {
  const rangedVelocity = RangeVelocity(velocity);
  if (rangedVelocity === idleVelocity) return e_Velocity.e_Velocity_Idle;
  else if (rangedVelocity === dribbleVelocity) return e_Velocity.e_Velocity_Dribble;
  else if (rangedVelocity === walkVelocity) return e_Velocity.e_Velocity_Walk;
  else if (rangedVelocity === sprintVelocity) return e_Velocity.e_Velocity_Sprint;
  else return e_Velocity.e_Velocity_Idle;
}

/** C++ struct CrudeSelectionQuery (copied by value in C++: use Clone()) */
export class CrudeSelectionQuery {
  byFunctionType = false;
  /** PORT: uninitialized in the C++ constructor */
  functionType: e_FunctionType = e_FunctionType.e_FunctionType_None;

  byFoot = false;
  foot: e_Foot = e_Foot.e_Foot_Left;

  heedForcedFoot = false;
  strongFoot: e_Foot = e_Foot.e_Foot_Right;

  bySide = false;
  lookAtVecRel: Vector3 = new Vector3(0);

  allowLastDitchAnims = false;

  byIncomingVelocity = false;
  /** if true, allow no difference in velocity */
  incomingVelocity_Strict = false;
  incomingVelocity_NoDribbleToIdle = false;
  incomingVelocity_NoDribbleToSprint = false;
  incomingVelocity_ForceLinearity = false;
  incomingVelocity: e_Velocity = e_Velocity.e_Velocity_Idle;

  byOutgoingVelocity = false;
  outgoingVelocity: e_Velocity = e_Velocity.e_Velocity_Idle;

  byPickupBall = false;
  pickupBall = true;

  byIncomingBodyDirection = false;
  incomingBodyDirection: Vector3 = new Vector3(0);
  incomingBodyDirection_Strict = false;
  incomingBodyDirection_ForceLinearity = false;

  byIncomingBallDirection = false;
  incomingBallDirection: Vector3 = new Vector3(0);

  byOutgoingBallDirection = false;
  outgoingBallDirection: Vector3 = new Vector3(0);

  byTripType = false;
  tripType = 0;

  properties = new Properties();

  Clone(): CrudeSelectionQuery {
    const q = Object.assign(new CrudeSelectionQuery(), this);
    q.properties = this.properties.Clone();
    return q;
  }
}

/** C++ struct Quadrant */
export class Quadrant {
  id = 0;
  position: Vector3 = new Vector3(0);
  velocity: e_Velocity = e_Velocity.e_Velocity_Idle;
  angle: radian = 0;

  Clone(): Quadrant {
    return Object.assign(new Quadrant(), this);
  }
}

/** C++ FillNodeMap(targetNode, nodeMap): adds targetNode and all nodes below it to nodeMap, by name */
export function FillNodeMap(targetNode: Node, nodeMap: NodeMap): NodeMap {
  // std::map::insert: the first node with a name wins
  if (!nodeMap.has(targetNode.GetName())) nodeMap.set(targetNode.GetName(), targetNode);

  const gatherNodes: Node[] = [];
  targetNode.GetNodes(gatherNodes);
  for (let i = 0; i < gatherNodes.length; i++) {
    FillNodeMap(gatherNodes[i], nodeMap);
  }
  return nodeMap;
}

function GetAngle(directionID: number): radian {
  let angle = 0.0;
  switch (directionID) {
    case 0:
      angle = 0.0;
      break;
    case 1:
      angle = 0.25 * pi;
      break;
    case 2:
      angle = -0.25 * pi;
      break;
    case 3:
      angle = 0.5 * pi;
      break;
    case 4:
      angle = -0.5 * pi;
      break;
    case 5:
      angle = 0.75 * pi;
      break;
    case 6:
      angle = -0.75 * pi;
      break;
    case 7:
      angle = 0.99 * pi;
      break;
    case 8:
      angle = -0.99 * pi;
      break;
    default:
      break;
  }
  return angle;
}

const zAxis = new Vector3(0, 0, 1);
const downVector = new Vector3(0, -1, 0);

export function GenerateAutoAnims(templates: Animation[], autoAnims: Animation[]): Animation[] {
  const leanAmount = 0.001;
  const frameCount = 25;
  const margin = 0.01;

  for (let t1 = 0; t1 < templates.length; t1++) {
    for (let t2 = 0; t2 < templates.length; t2++) {
      const anim1 = templates[t1];
      const anim2 = templates[t2];

      for (let direction = 0; direction < 9; direction++) {
        const angle = GetAngle(direction);
        const incomingVelocityT1 = anim1.GetIncomingVelocity();
        const outgoingVelocityT2 = anim2.GetOutgoingVelocity();
        const incomingBodyAngleT1 = anim1.GetIncomingBodyAngle();
        const outgoingBodyAngleT2 = anim2.GetOutgoingBodyAngle();

        let legalAnim = true;

        const incomingVeloID = GetVelocityID(FloatToEnumVelocity(incomingVelocityT1));
        const outgoingVeloID = GetVelocityID(FloatToEnumVelocity(outgoingVelocityT2));
        const averageVeloFactor = NormalizedClamp(incomingVeloID + outgoingVeloID, 0, 6);

        // max acceleration
        const veloIDDiff = outgoingVeloID - incomingVeloID;
        if (veloIDDiff > 1) legalAnim = false;

        // max deceleration
        // use dot product to make sure "running 180 degrees" isn't considered "keeping the same velocity" and therefore legal.
        const dot = downVector.GetDotProduct(downVector.GetRotated2D(angle)); // todo: this is optimizable (simple angle -> dot)
        const veloIDDiff_dotted = Math.trunc(cround(outgoingVeloID * dot - incomingVeloID));
        if (veloIDDiff_dotted < -3) legalAnim = false;

        if (incomingVeloID === 3 && outgoingVeloID === 1 && (Math.abs(outgoingBodyAngleT2) > 0.25 * pi + margin || Math.abs(angle) > 0.25 * pi + margin)) legalAnim = false; // no sprint to dribble with backwards body angle

        // experimental block
        if (incomingVeloID > 0 && outgoingVeloID > 0 && Math.abs(angle) > 0.5 * pi + margin) legalAnim = false;

        if (incomingVeloID + outgoingVeloID > 5 && Math.abs(angle) > 0.25 * pi + margin) legalAnim = false; // sprint -> sprint
        if (incomingVeloID + outgoingVeloID > 4 && Math.abs(angle) > 0.25 * pi + margin) legalAnim = false; // walk -> sprint && sprint -> walk

        const bodyAngleDelta = ModulateIntoRange(-pi, pi, outgoingBodyAngleT2 - incomingBodyAngleT1);
        if (Math.abs(angle + bodyAngleDelta) > 1.0 * pi + margin) legalAnim = false; // don't rotate over 180 degrees (we've got an anim for that the shorter away around anyway)

        const animSpeedFactor = 1.0;

        if (legalAnim === true) {
          const gen = new Animation(templates[t1]);
          gen.SetName(
            'autogen [v' +
              int_to_str(GetVelocityID(FloatToEnumVelocity(incomingVelocityT1))) +
              ' b' +
              int_to_str((incomingBodyAngleT1 / pi) * 180) +
              '] => [v' +
              int_to_str(GetVelocityID(FloatToEnumVelocity(outgoingVelocityT2))) +
              ' b' +
              int_to_str((outgoingBodyAngleT2 / pi) * 180) +
              ' a' +
              int_to_str((angle / pi) * 180) +
              ']',
          );
          gen.SetVariable('priority', '1');

          const nodeAnimsT1 = anim1.GetNodeAnimations();
          const nodeAnimsT2 = anim2.GetNodeAnimations();

          for (let n = 0; n < nodeAnimsT1.length; n++) {
            gen.GetNodeAnimations()[n].animation.clear();

            const animationT1: SortedIntMap<KeyFrame> = nodeAnimsT1[n].animation;
            const animationT2: SortedIntMap<KeyFrame> = nodeAnimsT2[n].animation;

            let cumulativePosition = new Vector3(0);
            let prevFrame = 0;
            const outgoingMovement = anim2.GetOutgoingMovement().GetRotated2D(angle);

            let movementChangeMPS = outgoingMovement.Sub(anim1.GetIncomingMovement()).Mul(100.0 / frameCount);

            // COLLECT KEYFRAMES FOR THIS NODEANIM

            const keyFrames: number[] = []; // frames at which one of the two anims has a keyframe
            // first, add all keyframes, even if duplicate
            for (const frame of animationT1.frames) keyFrames.push(frame);
            for (const frame of animationT2.frames) keyFrames.push(frame);
            if (n === 0) {
              // make sure there's 2 position keyframes close to each other at the start and at the end, so we will have the right ingoing and outgoing velocities
              keyFrames.push(1);
              keyFrames.push(23);
              for (let i = 2; i < frameCount - 2; i += 4) keyFrames.push(i); // smoother
            }
            keyFrames.sort((a, b) => a - b);
            // delete duplicates (std::list::unique)
            const uniqueKeyFrames: number[] = [];
            for (const frame of keyFrames) {
              if (uniqueKeyFrames.length === 0 || uniqueKeyFrames[uniqueKeyFrames.length - 1] !== frame) uniqueKeyFrames.push(frame);
            }

            // ITERATE AND INTERPOLATE KEYFRAMES

            for (const frame of uniqueKeyFrames) {
              const targetFrame = frame * (1.0 / animSpeedFactor);

              const getOrientation = n === 0 ? false : true;
              const getPosition = n === 0 ? true : false;
              const valuesT1 = templates[t1].GetInterpolatedValues(animationT1, frame, getOrientation, getPosition);
              const valuesT2 = templates[t2].GetInterpolatedValues(animationT2, frame, getOrientation, getPosition);
              const orientationT1 = valuesT1.orientation;
              const orientationT2 = valuesT2.orientation;
              const positionT1 = valuesT1.position;
              const positionT2 = valuesT2.position;

              const origBias = clamp(frame - 1.0, 0.0, frameCount - 3.0) / (frameCount - 3.0); // version that ignores first and last 2 frames, so incoming/outgoing velo/angle will be correct
              let bias = origBias;
              bias = Math.pow(bias, 1.0 * (0.3 + 0.4 * averageVeloFactor + 0.3 * NormalizedClamp(movementChangeMPS.GetLength(), 0.0, 20.0)));
              bias = curve(bias, 0.7); // concentrate change in the middle of the anim
              let orientation = orientationT1.GetSlerped(bias, orientationT2);

              if (n === 1) {
                // body
                // body orientation
                const angleQuat = Quaternion.FromAngleAxis(angle * Math.pow(bias * 0.7 + origBias * 0.3, 1.0), zAxis);
                orientation = angleQuat.Mul(orientation);

                // leaning
                movementChangeMPS = movementChangeMPS.Mul(
                  0.5 + 0.5 * (anim1.GetIncomingMovement().Mul(1.0 - bias).Add(outgoingMovement.Mul(bias)).GetLength() / sprintVelocity),
                ); // high velo = more leaning into the wind and such :p
                const leanQuat = Quaternion.FromAngleAxis(
                  movementChangeMPS.GetLength() * leanAmount * (0.5 + 0.5 * Math.sin(origBias * pi)),
                  new Vector3(0, 1, 0).GetRotated2D(movementChangeMPS.GetNormalized(0).GetAngle2D()),
                );
                orientation = leanQuat.Mul(orientation);
              }

              let height = 0.0;
              if (n === 0) {
                // player
                cumulativePosition = cumulativePosition.Add(
                  anim1
                    .GetIncomingMovement()
                    .Mul((frame - prevFrame) * 0.01)
                    .Mul(1.0 - bias)
                    .Add(outgoingMovement.Mul((frame - prevFrame) * 0.01).Mul(bias)),
                );
                height = positionT1.coords[2] * (1.0 - bias) + positionT2.coords[2] * bias;
              }

              gen.SetKeyFrame(nodeAnimsT1[n].nodeName, Math.floor(targetFrame), orientation, cumulativePosition.Mul(1.0 / animSpeedFactor).Add(new Vector3(0, 0, height)));

              prevFrame = frame;
            }
          }

          gen.DirtyCache();

          assert(gen.GetIncomingVelocity() === anim1.GetIncomingVelocity());
          assert(gen.GetOutgoingVelocity() === anim2.GetOutgoingVelocity());

          autoAnims.push(gen);
        } // == legalAnim
      }
    }
  }

  Log(e_Notice, 'AnimCollection', 'GenerateAutoAnims', int_to_str(autoAnims.length) + ' autogenerated anims! huzzah!');
  return autoAnims;
}

/** adds touches around main touch; returns the touch frame (-1 if none) */
function AddExtraTouches(animation: Animation, _playerNode: Node, bodyParts: Geometry[], nodeMap: NodeMap): number {
  const touch = (animation.GetExtension('football') as FootballAnimationExtension).GetFirstTouch(new Vector3(0), -1);
  const animBallPos = touch.position;
  const animTouchFrame = touch.frame;
  if (touch.result) {
    // find out what body part the balltouchpos is closest to
    animation.Apply(nodeMap, animTouchFrame, 0, false);

    let closestBodyPart = bodyParts[0];
    let closestDistance = 100;
    for (let i = 0; i < bodyParts.length; i++) {
      const distance = animBallPos.Sub(bodyParts[i].GetDerivedPosition()).GetLength();
      if (distance < closestDistance) {
        closestDistance = distance;
        closestBodyPart = bodyParts[i];
      }
    }
    animation.SetVariable('touch_bodypart', closestBodyPart.GetName());

    // PORT: the C++ returned here ("XDEBUG disable this"); the code after that return (re-generating the
    // ball touches around the main touch from the body part positions) was unreachable and is not ported.
    return animTouchFrame;
  }

  return animTouchFrame; // default
}

/** C++ float CalculateAnimDifficulty(Animation *animation, float &absoluteDifficulty): result is the expected frame count */
export function CalculateAnimDifficulty(animation: Animation): { result: number; absoluteDifficulty: number } {
  const isTouch = (animation.GetExtension('football') as FootballAnimationExtension).GetFirstTouch().result;

  const bodyDirDifficulty = clamp(Math.abs(animation.GetIncomingBodyDirection().GetAngle2D(animation.GetOutgoingBodyDirection()) / pi), 0.0, 1.0);

  const directionDifficulty = clamp(Math.abs(downVector.GetAngle2D(animation.GetOutgoingDirection()) / pi), 0.0, 1.0);

  const veloChangeDifficulty = clamp(Math.abs(animation.GetIncomingVelocity() - animation.GetOutgoingVelocity()) / sprintVelocity, 0.0, 1.0);
  const accelDifficulty = clamp((animation.GetOutgoingVelocity() - animation.GetIncomingVelocity()) / sprintVelocity, 0.0, 1.0);
  const veloDifficulty = veloChangeDifficulty * 0.5 + accelDifficulty * 0.5; // decelerating is easier than accelerating

  const averageVelocity = clamp((animation.GetIncomingVelocity() + animation.GetOutgoingVelocity()) / (sprintVelocity * 2.0), 0.0, 1.0);
  const movementDifficulty =
    clamp(animation.GetIncomingMovement().Sub(animation.GetOutgoingMovement()).GetLength() / sprintVelocity, 0.0, 1.0) * Math.pow(averageVelocity, 2.0);

  const bodyDirDifficultyWeight = 0.5;
  const directionDifficultyWeight = 1.0;
  const veloDifficultyWeight = 1.0;
  const movementDifficultyWeight = 4.0;

  let result =
    bodyDirDifficulty * bodyDirDifficultyWeight +
    directionDifficulty * directionDifficultyWeight +
    veloDifficulty * veloDifficultyWeight +
    movementDifficulty * movementDifficultyWeight;

  result /= bodyDirDifficultyWeight + directionDifficultyWeight + veloDifficultyWeight + movementDifficultyWeight;

  let expectedFrameCount = 20 + result * 80;

  const absoluteDifficultyFactor = result; // towards 0.0 == easy .. towards 1.0 == hard

  // result must be in format 0 == current, 1 == much slower. ignore anims that should be speeded up (it's animators task to keep them at least fast enough == impose slowest possible)
  let absoluteDifficulty = clamp(absoluteDifficultyFactor, 0.0, 1.0);

  if (isTouch) {
    expectedFrameCount *= 1.1;
    expectedFrameCount += 4;
  }

  absoluteDifficulty *= 0.88;
  if (isTouch) absoluteDifficulty += 0.12;

  expectedFrameCount = clamp(expectedFrameCount * 1.0, 1, animation.GetEffectiveFrameCount() + 16);
  return { result: expectedFrameCount, absoluteDifficulty };
}

/** stretches animations without changing their velocities (unused by the game: the C++ call is commented out) */
export function Slowdown(animation: Animation, veloFactor: number, expectedFrameCount: number, debug = false): void {
  assert(veloFactor >= 0.1);
  assert(veloFactor <= 1.0);

  let insertedFrames = 0;
  let orientation = Quaternion.IDENTITY; // dud
  let power = 0; // dud
  let position = new Vector3(0);

  const targetFrameCount = Math.trunc(clamp(cround(expectedFrameCount), animation.GetEffectiveFrameCount(), 1000000)); // will not come out perfectly correct, because we can only add between frames (not before first/after last)

  if (targetFrameCount > animation.GetFrameCount()) {
    const insertsPerFrame = targetFrameCount / animation.GetFrameCount() - 1.0;

    let overflowCounter = insertsPerFrame; // when do we need to insert a frame?

    const originalIncomingVelocity = FloatToEnumVelocity(animation.GetIncomingVelocity());
    const originalOutgoingVelocity = FloatToEnumVelocity(animation.GetOutgoingVelocity());

    for (let frame = 1; frame < animation.GetFrameCount(); frame++) {
      while (overflowCounter >= 1.0) {
        animation.Shift(frame, 1);
        overflowCounter -= 1.0;

        frame++;
        insertedFrames++;
      }

      const currentShiftFactor = (frame + insertedFrames) / frame;

      // stretch position to retain proper velocity
      const keyFrame = animation.GetKeyFrame('player', frame);
      orientation = keyFrame.orientation;
      position = keyFrame.position;
      if (keyFrame.result) {
        position = new Vector3(position.coords[0] * currentShiftFactor, position.coords[1] * currentShiftFactor, position.coords[2]);
        animation.SetKeyFrame('player', frame, orientation, position);
      }
      const extension = animation.GetExtension('football');
      const footballKeyFrame = extension.GetKeyFrame(frame, orientation, position, power);
      orientation = footballKeyFrame.orientation;
      position = footballKeyFrame.position;
      power = footballKeyFrame.power;
      if (footballKeyFrame.result) {
        position = new Vector3(position.coords[0] * currentShiftFactor, position.coords[1] * currentShiftFactor, position.coords[2]);
        extension.SetKeyFrame(frame, orientation, position, power);
      }

      overflowCounter += insertsPerFrame;
    }

    if (debug) {
      if (FloatToEnumVelocity(animation.GetIncomingVelocity()) !== originalIncomingVelocity) {
        console.debug(`incoming: ${animation.GetName()}: ${EnumToFloatVelocity(originalIncomingVelocity)} to ${RangeVelocity(animation.GetIncomingVelocity())}`);
      }
      if (FloatToEnumVelocity(animation.GetOutgoingVelocity()) !== originalOutgoingVelocity) {
        console.debug(`outgoing: ${animation.GetName()}: ${EnumToFloatVelocity(originalOutgoingVelocity)} to ${RangeVelocity(animation.GetOutgoingVelocity())}`);
      }
    }
  }
}

/** unused by the game: the C++ call is commented out */
export function SmoothPositions(animation: Animation, convertAngledDribbleToWalk: boolean): void {
  let bias = 1.0;
  let exp = 1.0;

  const animType = animation.GetAnimType();
  const outVelo = animation.GetOutgoingVelocity();
  const inVelo = animation.GetIncomingVelocity();
  if (animType === 'movement') {
    bias = 0.5;
    exp = 0.8 + Math.pow(clamp(outVelo, 0, sprintVelocity) / sprintVelocity, 1.5) * 0.4 + +Math.pow(clamp(outVelo - inVelo, 0, sprintVelocity) / sprintVelocity, 1.3) * 0.4;
  } else if (animType === 'ballcontrol') {
    bias = 0.3;
    exp = 0.9 + Math.pow(clamp(outVelo, 0, sprintVelocity) / sprintVelocity, 1.5) * 0.5 + +Math.pow(clamp(outVelo - inVelo, 0, sprintVelocity) / sprintVelocity, 1.3) * 0.5;
  } else if (animType === 'trap') {
    bias = 0.3;
    exp = 0.9 + Math.pow(clamp(outVelo, 0, sprintVelocity) / sprintVelocity, 1.5) * 0.5 + +Math.pow(clamp(outVelo - inVelo, 0, sprintVelocity) / sprintVelocity, 1.3) * 0.5;
  } else if (animType === 'interfere') {
    bias = 0.3;
    exp = 0.7 + Math.pow(clamp(outVelo, 0, sprintVelocity) / sprintVelocity, 1.5) * 0.5 + +Math.pow(clamp(outVelo - inVelo, 0, sprintVelocity) / sprintVelocity, 1.3) * 0.5;
  } else return;

  const extension = animation.GetExtension('football');

  // backup previous positions
  const origPositions: Vector3[] = new Array<Vector3>(animation.GetFrameCount()).fill(new Vector3(0));
  for (let frame = 1; frame < animation.GetFrameCount(); frame++) {
    origPositions[frame] = animation.GetKeyFrame('player', frame).position;
  }

  let incoming = animation.GetIncomingMovement();
  let outgoing = animation.GetOutgoingMovement();

  if (convertAngledDribbleToWalk) {
    if (FloatToEnumVelocity(animation.GetIncomingVelocity()) === e_Velocity.e_Velocity_Dribble) {
      incoming = incoming.GetNormalized(0).Mul(walkVelocity);
      bias = 1.0;
    }
    if (FloatToEnumVelocity(animation.GetOutgoingVelocity()) === e_Velocity.e_Velocity_Dribble && Math.abs(animation.GetOutgoingAngle()) < 0.5 * pi) {
      outgoing = outgoing.GetNormalized(0).Mul(walkVelocity);
      bias = 1.0;
    }
  }

  let touchOrientation = Quaternion.IDENTITY; // dud
  let origTouchPosition = new Vector3(0);
  let power = 0; // dud

  let prevPosition = animation.GetKeyFrame('player', 0).position;

  for (let frame = 1; frame < animation.GetFrameCount(); frame++) {
    let frameBias = (frame - 1) / (animation.GetFrameCount() - 3); // first 2 and last 2 frames need to be bias 0 and 1, so our anim keeps having the original in- and outgoing movement
    frameBias = Math.pow(clamp(frameBias, 0.0, 1.0), exp);
    const movement = incoming.Mul(1 - frameBias).Add(outgoing.Mul(frameBias));

    const touch = extension.GetKeyFrame(frame, touchOrientation, origTouchPosition, power);
    touchOrientation = touch.orientation;
    origTouchPosition = touch.position;
    power = touch.power;

    const keyFrame = animation.GetKeyFrame('player', frame);
    const orientation = keyFrame.orientation;
    const origPosition = keyFrame.position;
    let smoothPosition = prevPosition.Add(movement.Mul(0.01));
    smoothPosition = smoothPosition.WithCoord(2, origPosition.coords[2]);
    const resultingPosition = smoothPosition.Mul(bias).Add(origPositions[frame].Mul(1.0 - bias));
    animation.SetKeyFrame('player', frame, orientation, resultingPosition);

    const resultingTouchPosition = origTouchPosition.Add(resultingPosition.Sub(origPosition));
    if (touch.result) extension.SetKeyFrame(frame, touchOrientation, resultingTouchPosition, power);

    prevPosition = smoothPosition;
  }
}

/** per-animation memo of parsed vector variables, for CrudeSelection (keyed by the source string, so it stays exact) */
class ParsedVectorVariable {
  source: string | null = null;
  value: Vector3 = Vector3.ZERO;
}

class AnimSelectionCache {
  incomingBallDirection = new ParsedVectorVariable();
  ballDirection = new ParsedVectorVariable();
}

function GetParsedVector(parsed: ParsedVectorVariable, source: string): Vector3 {
  if (parsed.source !== source) {
    parsed.source = source;
    parsed.value = GetVectorFromString(source);
  }
  return parsed.value;
}

export class AnimCollection {
  protected scene3D: Scene3D;

  protected animations: Animation[] = [];
  protected quadrants: Quadrant[] = [];

  protected defString: string[] = [];

  protected maxIncomingBallDirectionDeviation: radian;
  protected maxOutgoingBallDirectionDeviation: radian;

  /** PORT: CrudeSelection memo (parallel to animations) */
  protected selectionCache: AnimSelectionCache[] = [];

  /** scene3D for debugging pilon */
  constructor(scene3D: Scene3D) {
    this.scene3D = scene3D;

    this.defString[0] = '';
    this.defString[1] = 'outgoing_special_state';
    this.defString[2] = 'incoming_special_state';
    this.defString[3] = 'specialvar1';
    this.defString[4] = 'specialvar2';
    this.defString[5] = 'type';
    this.defString[6] = 'trap';
    this.defString[7] = 'deflect';
    this.defString[8] = 'interfere';
    this.defString[9] = 'trip';
    this.defString[10] = 'shortpass';
    this.defString[11] = 'longpass';
    this.defString[12] = 'shot';
    this.defString[13] = 'sliding';
    this.defString[14] = 'movement';
    this.defString[15] = 'special';
    this.defString[16] = 'ballcontrol';
    this.defString[17] = 'highpass';
    this.defString[18] = 'catch';
    this.defString[19] = 'outgoing_retain_state';
    this.defString[20] = 'incoming_retain_state';

    this.maxIncomingBallDirectionDeviation = 0.25 * pi;
    this.maxOutgoingBallDirectionDeviation = 0.25 * pi;

    // quadrants denote the quantized outgoing movement - there are only certain possibilities:
    // idle - dribble - walk - run, in combination with angles: 0 - 20 - 45 - 90 - 135 - 180 (and their negatives, where applicable)
    // so every anim falls into one of these quadrants.

    // idle
    const idleQuadrant = new Quadrant();
    idleQuadrant.id = 0;
    idleQuadrant.velocity = e_Velocity.e_Velocity_Idle;
    idleQuadrant.angle = 0;
    idleQuadrant.position = new Vector3(0, 0, 0);
    this.quadrants.push(idleQuadrant);

    let id = 1;
    for (let velocityID = 1; velocityID < 4; velocityID++) {
      let velocity = e_Velocity.e_Velocity_Idle;
      if (velocityID === 1) velocity = e_Velocity.e_Velocity_Dribble;
      else if (velocityID === 2) velocity = e_Velocity.e_Velocity_Walk;
      else if (velocityID === 3) velocity = e_Velocity.e_Velocity_Sprint;

      // PORT: angleID 10 left `angle` uninitialized in C++ (its assignment is commented out); in practice the
      // compiler kept the previous iteration's value (-135 degrees), which is what this reproduces.
      let angle: radian = 0;
      for (let angleID = 0; angleID < 11; angleID++) {
        if (angleID === 0) angle = (pi / 180.0) * 0.0;
        else if (angleID === 1) angle = (pi / 180.0) * 20.0;
        else if (angleID === 2) angle = (pi / 180.0) * 45.0;
        else if (angleID === 3) angle = (pi / 180.0) * 90.0;
        else if (angleID === 4) angle = (pi / 180.0) * 135.0;
        else if (angleID === 5) angle = (pi / 180.0) * 179.0;
        else if (angleID === 6) angle = (pi / 180.0) * -20.0;
        else if (angleID === 7) angle = (pi / 180.0) * -45.0;
        else if (angleID === 8) angle = (pi / 180.0) * -90.0;
        else if (angleID === 9) angle = (pi / 180.0) * -135.0;

        const quadrant = new Quadrant();
        quadrant.id = id;
        quadrant.velocity = velocity;
        quadrant.angle = angle;
        quadrant.position = downVector.GetRotated2D(angle).Mul(EnumToFloatVelocity(velocity));
        this.quadrants.push(quadrant);

        id++;
      }
    }
  }

  /** C++ destructor */
  Exit(): void {
    this.Clear();
  }

  Clear(): void {
    for (const animation of this.animations) animation.Exit();
    this.animations = [];
    this.selectionCache = [];
  }

  /** C++ Load(boost::filesystem::path directory), e.g. Load("media/animations") */
  Load(directory: string): void {
    // load utility player to get things like foot position in the frames around the balltouch etc.

    Log(e_Notice, 'AnimCollection', 'Load', 'Loading utility player');

    const loader = new ObjectLoader();
    const playerNode = loader.LoadObject('media/objects/players/player.object');
    playerNode.SetName('player');
    playerNode.SetLocalMode(e_LocalMode.e_LocalMode_Absolute);

    const bodyParts: Geometry[] = [];
    playerNode.GetObjects<Geometry>(e_ObjectType.e_ObjectType_Geometry, bodyParts, true);

    const nodeMap: NodeMap = new Map();
    FillNodeMap(playerNode, nodeMap);

    // auto generated anims

    Log(e_Notice, 'AnimCollection', 'Load', 'Parsing autogenerated animation template directory');

    // PORT: DirectoryParser::Parse(dir, "anim", files) -> the (sorted) asset manifest; C++ directory order was OS dependent
    let files = AnimCollection.ListAnimFiles(directory + '/templates');

    Log(e_Notice, 'AnimCollection', 'Load', 'Loading autogenerated animation templates');

    let templates: Animation[] = [];
    for (let i = 0; i < files.length; i++) {
      const animTemplate = new Animation();
      animTemplate.Load(files[i]);
      templates.push(animTemplate);
    }

    const autoAnims: Animation[] = [];
    GenerateAutoAnims(templates, autoAnims);
    for (const animTemplate of templates) animTemplate.Exit();
    templates = [];

    for (let i = 0; i < autoAnims.length; i++) {
      let animation = new Animation(autoAnims[i]);
      let extension = new FootballAnimationExtension(animation);
      animation.AddExtension('football', extension);
      animation.Mirror();
      this._PrepareAnim(animation, playerNode, bodyParts, nodeMap, false);

      animation = autoAnims[i];
      extension = new FootballAnimationExtension(animation);
      animation.AddExtension('football', extension);
      this._PrepareAnim(animation, playerNode, bodyParts, nodeMap, false);
    }

    // load all other animations

    Log(e_Notice, 'AnimCollection', 'Load', 'Parsing animation directory');

    files = AnimCollection.ListAnimFiles(directory);

    Log(e_Notice, 'AnimCollection', 'Load', 'Loading animations');

    const omitLuxuryAnims = true;

    for (let i = 0; i < files.length; i++) {
      if ((omitLuxuryAnims && files[i].indexOf('luxury') !== -1) || files[i].indexOf('templates') !== -1) {
        // ignoring
      } else {
        for (let mirror = 0; mirror < 2; mirror++) {
          const animation = new Animation();
          const extension = new FootballAnimationExtension(animation);
          animation.AddExtension('football', extension);
          animation.Load(files[i]);
          if (mirror === 1) animation.Mirror();

          this._PrepareAnim(animation, playerNode, bodyParts, nodeMap, false);
        }
      }
    }

    Log(e_Notice, 'AnimCollection', 'Load', 'Deleting player node template');

    playerNode.Exit();

    Log(e_Notice, 'AnimCollection', 'Load', 'Ready');
  }

  /** PORT: replaces DirectoryParser::Parse(directory, "anim", files, recurse = true) */
  protected static ListAnimFiles(directory: string): string[] {
    return FileSystem.ListFiles(directory, true).filter((file) => {
      const name = file.substring(file.lastIndexOf('/') + 1);
      const dot = name.lastIndexOf('.');
      return dot > 0 && name.substring(dot) === '.anim';
    });
  }

  GetAnimations(): Animation[] {
    return this.animations;
  }

  /** makes a crude selection to later refine; pushes the indices of the matching animations into dataSet */
  CrudeSelection(dataSet: DataSet, query: CrudeSelectionQuery): void {
    // PORT: loop-invariant query values are computed once, before the loop (the C++ recomputed them per anim)
    const fencedDirection = query.lookAtVecRel.GetRotated2D(pi);
    const queryIncomingBodyAngleFixedAbs = Math.abs(FixAngle(query.incomingBodyDirection.GetAngle2D()));
    const queryIncomingBodyAngleToDown = Math.abs(downVector.GetAngle2D(query.incomingBodyDirection));
    const checkIncomingBodyDirection = query.byIncomingBodyDirection === true && !(query.byIncomingVelocity === true && query.incomingVelocity === e_Velocity.e_Velocity_Idle);

    let adaptedIncomingBallDirection = Vector3.ZERO;
    const queryIncomingBallDirectionLength = query.incomingBallDirection.GetLength();
    if (query.byIncomingBallDirection === true && queryIncomingBallDirectionLength !== 0.0) {
      // decimate height diff
      adaptedIncomingBallDirection = query.incomingBallDirection.WithCoord(2, query.incomingBallDirection.coords[2] * 0.4).GetNormalized();
    }

    const queryOutgoingBallDirection2D = query.outgoingBallDirection.Get2D();
    const oc = queryOutgoingBallDirection2D.coords;
    const queryOutgoingBallDirection2DIsNull = Math.abs(oc[0]) < 0.000001 && Math.abs(oc[1]) < 0.000001 && Math.abs(oc[2]) < 0.000001;
    const queryOutgoingBallDirection2DNormalized = queryOutgoingBallDirection2DIsNull ? Vector3.ZERO : queryOutgoingBallDirection2D.GetNormalized();

    const queryIncomingSpecialState = query.properties.Get('incoming_special_state');
    const queryIncomingRetainState = query.properties.Get('incoming_retain_state');
    const querySpecialVar1 = atof(query.properties.Get('specialvar1'));
    const querySpecialVar2 = atof(query.properties.Get('specialvar2'));
    const queryIsDeflect = query.functionType === e_FunctionType.e_FunctionType_Deflect;
    const queryHasIncomingRetainState = queryIncomingRetainState !== '';

    const marginRadians = 0.06 * pi; // anims can deviate a few degrees from the desired (quantized) directions
    const deflectString = this.defString[e_DefString.e_DefString_Deflect];

    const animSize = this.animations.length;

    for (let i = 0; i < animSize; i++) {
      const animation = this.animations[i];
      const animType = animation.GetAnimType();

      let selectAnim = true;

      // select by TYPE

      if (selectAnim) {
        if (query.byFunctionType === true) {
          if (this._CheckFunctionType(animType, query.functionType) === false) selectAnim = false;
        }
      }

      // select by INCOMING VELOCITY

      if (selectAnim) {
        if (query.byIncomingVelocity === true) {
          const animIncomingVelocity = FloatToEnumVelocity(animation.GetIncomingVelocity());

          if (query.incomingVelocity_Strict === false) {
            selectAnim = true;
            if (query.incomingVelocity_NoDribbleToIdle) {
              if (animIncomingVelocity === e_Velocity.e_Velocity_Idle && query.incomingVelocity === e_Velocity.e_Velocity_Dribble) selectAnim = false;
            }
            if (animIncomingVelocity === e_Velocity.e_Velocity_Idle && query.incomingVelocity === e_Velocity.e_Velocity_Walk) selectAnim = false;
            if (animIncomingVelocity === e_Velocity.e_Velocity_Idle && query.incomingVelocity === e_Velocity.e_Velocity_Sprint) selectAnim = false;
            if (animIncomingVelocity === e_Velocity.e_Velocity_Dribble && query.incomingVelocity === e_Velocity.e_Velocity_Idle) selectAnim = false;
            if (animIncomingVelocity === e_Velocity.e_Velocity_Walk && query.incomingVelocity === e_Velocity.e_Velocity_Idle) selectAnim = false;
            if (animIncomingVelocity === e_Velocity.e_Velocity_Sprint && query.incomingVelocity === e_Velocity.e_Velocity_Idle) selectAnim = false;

            if (query.incomingVelocity_NoDribbleToSprint) {
              if (animIncomingVelocity === e_Velocity.e_Velocity_Sprint && query.incomingVelocity === e_Velocity.e_Velocity_Dribble) selectAnim = false;
            }

            if (query.incomingVelocity_ForceLinearity) {
              // disallow going from current -> slower/faster -> current; the complete section needs to be linear
              let animIncomingVelocityFloat = RangeVelocity(animation.GetIncomingVelocity());
              let animOutgoingVelocityFloat = RangeVelocity(animation.GetOutgoingVelocity());
              let queryVelocityFloat = EnumToFloatVelocity(query.incomingVelocity);

              // treat dribble and walk the same
              if (FloatToEnumVelocity(animIncomingVelocityFloat) === e_Velocity.e_Velocity_Dribble) animIncomingVelocityFloat = walkVelocity;
              if (FloatToEnumVelocity(animOutgoingVelocityFloat) === e_Velocity.e_Velocity_Dribble) animOutgoingVelocityFloat = walkVelocity;
              if (FloatToEnumVelocity(queryVelocityFloat) === e_Velocity.e_Velocity_Dribble) queryVelocityFloat = walkVelocity;

              if (animIncomingVelocityFloat > Math.max(queryVelocityFloat, animOutgoingVelocityFloat)) selectAnim = false;
              if (animIncomingVelocityFloat < Math.min(queryVelocityFloat, animOutgoingVelocityFloat)) selectAnim = false;
            }
          } else {
            // strict
            if (animIncomingVelocity !== query.incomingVelocity) selectAnim = false;
          }
        }
      }

      // select by OUTGOING VELOCITY

      if (selectAnim) {
        if (query.byOutgoingVelocity === true) {
          if (FloatToEnumVelocity(animation.GetOutgoingVelocity()) !== query.outgoingVelocity) selectAnim = false;
        }
      }

      // CULL WRONG ROTATIONAL SIDE

      if (selectAnim) {
        if (query.bySide === true) {
          const animIncomingDirection = animation.GetIncomingBodyDirection();

          // find out in what direction the anim rotates
          const animOutgoingDirection = animation.GetOutgoingDirection().GetRotated2D(animation.GetOutgoingBodyAngle());
          const animTurnAngle = animOutgoingDirection.GetAngle2D(animIncomingDirection);

          // anim should not pass through opposite (180 deg) of desired look angle (fencedDirection)

          if (Math.abs(animTurnAngle) > 0.06 * pi) {
            // threshold
            const animSide = animTurnAngle > 0 ? e_Side.e_Side_Left : e_Side.e_Side_Right;

            const animIncomingToFenceAngle = fencedDirection.GetAngle2D(animIncomingDirection);
            const queryIncomingToFenceAngle = fencedDirection.GetAngle2D(query.incomingBodyDirection);
            const fenceToOutgoingAngle = animOutgoingDirection.GetAngle2D(fencedDirection);

            const animIncomingToFenceSide = animIncomingToFenceAngle > 0 ? e_Side.e_Side_Left : e_Side.e_Side_Right;
            const queryIncomingToFenceSide = queryIncomingToFenceAngle > 0 ? e_Side.e_Side_Left : e_Side.e_Side_Right;
            const fenceToAnimOutgoingSide = fenceToOutgoingAngle > 0 ? e_Side.e_Side_Left : e_Side.e_Side_Right;

            // passes through fence! n000!
            if (animIncomingToFenceSide === animSide && fenceToAnimOutgoingSide === animSide && Math.abs(animIncomingToFenceAngle + fenceToOutgoingAngle) < pi) selectAnim = false;
            // (sic: the original adds the side enum, not the angle, here)
            if (queryIncomingToFenceSide === animSide && fenceToAnimOutgoingSide === animSide && Math.abs(queryIncomingToFenceSide + fenceToOutgoingAngle) < pi) selectAnim = false;
          }
        }
      }

      // select by RETAIN BALL

      if (selectAnim) {
        if (query.byPickupBall === true) {
          const outgoingRetainState = animation.GetVariable('outgoing_retain_state');
          if ((outgoingRetainState === '' && query.pickupBall === true) || (outgoingRetainState !== '' && query.pickupBall === false)) {
            selectAnim = false;
          }
        }
      }

      // select LAST DITCH ANIMS

      if (selectAnim) {
        if (query.allowLastDitchAnims === false) {
          if (animation.GetVariable('lastditch') === 'true') {
            selectAnim = false;
          }
        }
      }

      // select by INCOMING BODY ANGLE

      if (selectAnim) {
        if (checkIncomingBodyDirection) {
          if (FloatToEnumVelocity(animation.GetIncomingVelocity()) !== e_Velocity.e_Velocity_Idle) {
            const incomingBodyDir = animation.GetIncomingBodyDirection();

            if (selectAnim) {
              // disallow larger incoming than current
              if (Math.abs(FixAngle(incomingBodyDir.GetAngle2D())) > queryIncomingBodyAngleFixedAbs + marginRadians) selectAnim = false;
            }

            if (selectAnim) {
              // absolute outgoing body dir is body dir + outgoing dir
              const outgoingBodyDir = downVector.GetRotated2D(animation.GetOutgoingBodyAngle() + animation.GetOutgoingAngle());

              // this version is not just moar beautiful, but also allows for -135 to 135 deg and vice versa
              if (query.incomingBodyDirection_Strict === true) {
                if (Math.abs(incomingBodyDir.GetAngle2D(query.incomingBodyDirection)) > marginRadians) selectAnim = false;
              } else {
                if (Math.abs(incomingBodyDir.GetAngle2D(query.incomingBodyDirection)) > 0.5 * pi + marginRadians) selectAnim = false;
              }

              if (query.incomingBodyDirection_ForceLinearity) {
                // if anim incoming body dir == between (including) query incoming and anim outgoing dir, then this anim is legal (or rather: won't look idiotic)
                // how do we check this?
                // 1. if we look at the smallest angles between (anim incoming -> query incoming) and (anim incoming -> anim outgoing), one has to be positive, the other negative.
                // 2. the (absolute) angles added up have to be < pi radians. else, we could be on the 'other side' of the 'virtual half circle' and still have the former condition met

                const shortestAngle1 = incomingBodyDir.GetAngle2D(outgoingBodyDir);
                const shortestAngle2 = incomingBodyDir.GetAngle2D(query.incomingBodyDirection);
                if ((shortestAngle1 > marginRadians && shortestAngle2 > marginRadians) || (shortestAngle1 < -marginRadians && shortestAngle2 < -marginRadians)) {
                  selectAnim = false;
                }
                if (Math.abs(shortestAngle1) + Math.abs(shortestAngle2) > pi + marginRadians) selectAnim = false;
              }
            }
          } else {
            // incoming velocity idle
            // allow only same angle (which is moving anims with 0 outgoing body angle. since @ idle, that will become their only angle)
            if (query.incomingBodyDirection_Strict === true) {
              if (queryIncomingBodyAngleToDown > marginRadians) selectAnim = false;
            } else {
              if (queryIncomingBodyAngleToDown > 0.25 * pi + marginRadians) selectAnim = false;
            }
          }
        }
      }

      // select by INCOMING BALL DIRECTION

      if (selectAnim) {
        if (query.byIncomingBallDirection === true) {
          let animBallDirection = GetParsedVector(this.GetSelectionCache(i).incomingBallDirection, animation.GetVariable('incomingballdirection'));
          const animBallDirectionLength = animBallDirection.GetLength();
          if (animBallDirectionLength < 0.1) {
            Log(e_FatalError, 'AnimCollection', 'Crudeselection', 'Anim ' + animation.GetName() + ' missing incoming ball direction');
          }
          if (animBallDirectionLength !== 0.0 && queryIncomingBallDirectionLength !== 0.0) {
            // decimate height diff
            animBallDirection = animBallDirection.WithCoord(2, animBallDirection.coords[2] * 0.4).GetNormalized();

            const ballDirectionAngle = Math.abs(adaptedIncomingBallDirection.GetAngle2D(animBallDirection));
            let maxDeviation = Math.abs(atof(animation.GetVariable('incomingballdirection_maxdeviation')) * pi);
            if (maxDeviation === 0.0) {
              maxDeviation = this.maxIncomingBallDirectionDeviation;
              if (animType === deflectString) maxDeviation = 0.4 * pi;
            }
            if (ballDirectionAngle > maxDeviation) selectAnim = false;
          }
        }
      }

      // select by OUTGOING BALL DIRECTION

      if (selectAnim) {
        if (query.byOutgoingBallDirection === true) {
          let animBallDirection = GetParsedVector(this.GetSelectionCache(i).ballDirection, animation.GetVariable('balldirection'));
          animBallDirection = animBallDirection.GetNormalized(Vector3.ZERO);
          const queryDirection = queryOutgoingBallDirection2DIsNull ? animBallDirection : queryOutgoingBallDirection2DNormalized;
          const ballDirectionAngle = Math.abs(queryDirection.GetAngle2D(animBallDirection));
          let maxDeviation = Math.abs(atof(animation.GetVariable('outgoingballdirection_maxdeviation')) * pi);
          if (maxDeviation === 0.0) {
            maxDeviation = this.maxOutgoingBallDirectionDeviation;
          }
          if (ballDirectionAngle > maxDeviation) selectAnim = false;
        }
      }

      // select by PROPERTIES

      if (selectAnim) {
        if (queryIncomingSpecialState !== animation.GetVariable('incoming_special_state')) selectAnim = false;
        // hax: allow switching of hands (except for deflect anims) (in future, maybe make special case for 'both hands at the same time')
        const animIncomingRetainState = animation.GetVariable('incoming_retain_state');
        if ((queryIsDeflect || queryHasIncomingRetainState !== (animIncomingRetainState !== '')) && queryIncomingRetainState !== animIncomingRetainState) selectAnim = false;
        if (querySpecialVar1 !== atof(animation.GetVariable('specialvar1'))) selectAnim = false;
        if (querySpecialVar2 !== atof(animation.GetVariable('specialvar2'))) selectAnim = false;
      }

      // select by TRIP TYPE

      if (selectAnim) {
        if (query.byTripType === true) {
          if (Math.trunc(cround(atof(animation.GetVariable('triptype')))) !== query.tripType) selectAnim = false;
        }
      }

      // select by FORCED FOOT
      // todonow: unit test! not sure if working correctly

      if (selectAnim) {
        if (query.heedForcedFoot === true) {
          const forcedFoot = animation.GetVariable('forcedfoot');
          let which = 0;
          if (forcedFoot === 'strong') which = 1;
          else if (forcedFoot === 'weak') which = 2;
          if (which !== 0) {
            const touchFoot = animation.GetVariable('touchfoot');
            let animFoot = e_Foot.e_Foot_Right;
            if (touchFoot === 'left') animFoot = e_Foot.e_Foot_Left;

            // for mirrored anims that, therefore, don't start with right foot
            if (animation.GetCurrentFoot() === e_Foot.e_Foot_Left) {
              if (animFoot === e_Foot.e_Foot_Left) animFoot = e_Foot.e_Foot_Right;
              else animFoot = e_Foot.e_Foot_Left;
            }

            if (which === 1 && query.strongFoot !== animFoot) selectAnim = false;
            if (which === 2 && query.strongFoot === animFoot) selectAnim = false;
          }
        }
      }

      if (selectAnim) dataSet.push(i);
    }
  }

  GetAnim(index: number): Animation {
    return this.animations[index];
  }

  GetQuadrant(id: number): Quadrant {
    return this.quadrants[id];
  }

  GetQuadrantID(_animation: Animation | null, movement: Vector3, _angle: radian): number {
    // assign the animation it's rightful quadrant

    const adaptedMovement = movement.GetNormalized(0).Mul(RangeVelocity(movement.GetLength()));
    let quadrantID = 0;
    let shortestDistance = 100000.0;
    for (let i = 0; i < this.quadrants.length; i++) {
      const distance = adaptedMovement.GetDistance(this.quadrants[i].position);
      if (distance < shortestDistance) {
        shortestDistance = distance;
        quadrantID = this.quadrants[i].id;
      }
    }

    return quadrantID;
  }

  protected GetSelectionCache(index: number): AnimSelectionCache {
    let cache = this.selectionCache[index];
    if (cache === undefined) {
      cache = new AnimSelectionCache();
      this.selectionCache[index] = cache;
    }
    return cache;
  }

  protected _PrepareAnim(animation: Animation, playerNode: Node, bodyParts: Geometry[], nodeMap: NodeMap, _convertAngledDribbleToWalk = false): void {
    const isTouch = (animation.GetExtension('football') as FootballAnimationExtension).GetFirstTouch().result;
    const animType = animation.GetAnimType();
    if (Verbose()) {
      if (isTouch && (animType === 'movement' || animType === 'trip' || animType === 'special')) console.debug(`invalid ball touch for animtype: ${animation.GetName()}`);
      if (!isTouch && animType !== 'movement' && animType !== 'trip' && animType !== 'special') console.debug(`invalid ball touch for animtype: ${animation.GetName()}`);
    }

    const difficulty = CalculateAnimDifficulty(animation);
    animation.SetVariable('animdifficultyfactor', real_to_str(difficulty.absoluteDifficulty));

    const touchFrame = AddExtraTouches(animation, playerNode, bodyParts, nodeMap);
    animation.SetVariable('touchframe', int_to_str(touchFrame));

    // assign the animation its rightful quadrant

    const movement = animation.GetOutgoingMovement();
    const angle = animation.GetOutgoingAngle();
    const quadrantID = this.GetQuadrantID(animation, movement, angle);

    animation.SetVariable('quadrant_id', int_to_str(quadrantID));

    this.animations.push(animation);
  }

  protected _CheckFunctionType(functionType: string, queryFunctionType: e_FunctionType): boolean {
    let rightType = false;
    const defString = this.defString;

    switch (queryFunctionType) {
      case e_FunctionType.e_FunctionType_Movement:
        if (functionType === defString[e_DefString.e_DefString_Movement]) rightType = true;
        break;

      case e_FunctionType.e_FunctionType_BallControl:
        if (functionType === defString[e_DefString.e_DefString_BallControl]) rightType = true;
        break;

      case e_FunctionType.e_FunctionType_Trap:
        if (functionType === defString[e_DefString.e_DefString_Trap]) rightType = true;
        break;

      case e_FunctionType.e_FunctionType_ShortPass:
        if (functionType === defString[e_DefString.e_DefString_ShortPass]) rightType = true;
        break;

      case e_FunctionType.e_FunctionType_LongPass:
        if (functionType === defString[e_DefString.e_DefString_LongPass]) rightType = true;
        break;

      case e_FunctionType.e_FunctionType_HighPass:
        if (functionType === defString[e_DefString.e_DefString_HighPass]) rightType = true;
        break;

      case e_FunctionType.e_FunctionType_Shot:
        if (functionType === defString[e_DefString.e_DefString_Shot]) rightType = true;
        break;

      case e_FunctionType.e_FunctionType_Deflect:
        if (functionType === defString[e_DefString.e_DefString_Deflect]) rightType = true;
        break;

      case e_FunctionType.e_FunctionType_Catch:
        if (functionType === defString[e_DefString.e_DefString_Catch]) rightType = true;
        break;

      case e_FunctionType.e_FunctionType_Interfere:
        if (functionType === defString[e_DefString.e_DefString_Interfere]) rightType = true;
        break;

      case e_FunctionType.e_FunctionType_Trip:
        if (functionType === defString[e_DefString.e_DefString_Trip]) rightType = true;
        break;

      case e_FunctionType.e_FunctionType_Sliding:
        if (functionType === defString[e_DefString.e_DefString_Sliding]) rightType = true;
        break;

      case e_FunctionType.e_FunctionType_Special:
        if (functionType === defString[e_DefString.e_DefString_Special]) rightType = true;
        break;

      default:
        rightType = false;
        break;
    }

    return rightType;
  }
}
