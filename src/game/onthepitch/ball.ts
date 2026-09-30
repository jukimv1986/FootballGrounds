// Port of legacy/src/onthepitch/ball.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).

import { Vector3, Quaternion } from '../../blunted/base/math/vector3';
import { clamp, NormalizedClamp, pi, random, signSide, type radian } from '../../blunted/base/math/bluntmath';
import { Log, e_Notice } from '../../blunted/base/log';
import { ResourceManagerPool } from '../../blunted/managers/resourcemanagerpool';
import type { Node } from '../../blunted/scene/node';
import type { Geometry } from '../../blunted/scene/objects/geometry';
import { Sound } from '../../blunted/scene/objects/sound';
import type { Scene3D } from '../../blunted/scene/scene3d';
import { e_ObjectType } from '../../blunted/scene/spatial';
import { ObjectLoader } from '../../blunted/utils/objectloader';
import { TemporalSmoother } from '../footballutils';
import { ballHistorySize_ms, ballPredictionSize_ms, goalDepth, goalHalfWidth, goalHeight, pitchHalfW } from '../gamedefines';
import { EnvironmentManager, GetConfiguration, GetScene3D, IsReleaseVersion } from '../globals';
import { SDLK_BACKSPACE, UserEventManager } from '../hid/usereventmanager';
import type { Match } from './match';

const VECTOR_UP = new Vector3(0, 0, 1);
const AXIS_X_NEG = new Vector3(-1, 0, 0);
const AXIS_Y = new Vector3(0, 1, 0);
const AXIS_Z = new Vector3(0, 0, 1);
const XZ = new Vector3(1, 0, 1);

/** Vector3(x, y, z).GetLength() */
function Length3(x: number, y: number, z: number): number {
  let length = Math.sqrt(x * x + y * y + z * z);
  if (length < 0.000001) length = 0;
  return length;
}

/** the 'is null' test of Vector3.GetNormalized(ifNull) */
function IsNull3(x: number, y: number, z: number): boolean {
  return Math.abs(x) < 0.000001 && Math.abs(y) < 0.000001 && Math.abs(z) < 0.000001;
}

export class BallSpatialInfo {
  momentum: Vector3;
  rotation_ms: Quaternion;

  constructor(momentum: Vector3, rotation_ms: Quaternion) {
    this.momentum = momentum;
    this.rotation_ms = rotation_ms;
  }
}

export class Ball {
  protected scene3D: Scene3D;

  protected ballNode: Node;
  protected ball: Geometry;
  protected sound: Sound;
  protected goalpostsound: Sound;

  protected momentum = new Vector3(0);
  protected rotation_ms = Quaternion.IDENTITY;

  protected predictions: Vector3[] = Array.from({ length: ballPredictionSize_ms / 10 }, () => new Vector3(0));
  protected orientPrediction = Quaternion.IDENTITY;

  protected ballPosHistory: Vector3[] = [];
  protected previousMomentum = new Vector3(0);
  protected previousPosition = new Vector3(0);

  protected positionBuffer = new Vector3(0);
  protected orientationBuffer = Quaternion.IDENTITY;
  protected buf_positionBuffer = new TemporalSmoother<Vector3>(new Vector3(0));
  protected buf_orientationBuffer = new TemporalSmoother<Quaternion>(Quaternion.IDENTITY);

  protected fetchedbuf_positionBuffer = new Vector3(0);
  protected fetchedbuf_orientationBuffer = Quaternion.IDENTITY;

  protected match: Match;

  protected bounce: number;
  protected linearBounce: number;
  protected drag: number;
  protected friction: number;
  protected linearFriction: number;
  protected gravity: number;
  protected grassHeight: number;

  protected ballTouchesNet: boolean;

  constructor(match: Match) {
    this.match = match;

    this.bounce = 0.62; // 1 = full bounce, 0 = no bounce
    this.linearBounce = 0.06; // bigger = more brake force
    this.drag = 0.015; //previously 0.025f; // bigger = more
    this.friction = 0.04; // bigger = more
    this.linearFriction = 1.6; // bigger = more, arbitrary scale
    this.gravity = -9.81;
    this.grassHeight = 0.025;

    this.ballTouchesNet = false;

    this.scene3D = GetScene3D();

    Log(e_Notice, 'Ball', 'Ball', 'Loading ball object');

    const loader = new ObjectLoader();
    this.ballNode = loader.LoadObject('media/objects/balls/generic.object');
    match.GetDynamicNode().AddNode(this.ballNode);

    const children: Geometry[] = [];
    this.ballNode.GetObjects<Geometry>(e_ObjectType.e_ObjectType_Geometry, children);
    this.ball = children[0];

    Log(e_Notice, 'Ball', 'Ball', 'Loading ball sounds');

    // ball sound

    let soundBufferRes = ResourceManagerPool.GetInstance().FetchSoundBuffer('media/sounds/ballsound.wav');
    this.sound = new Sound('ballsound');
    this.sound.SetSoundBuffer(soundBufferRes);
    this.sound.SetGain(0.7 * GetConfiguration().GetReal('audio_volume', 0.5));
    this.sound.SetLoop(false);
    this.scene3D.AddObject(this.sound);

    // goal post sound

    soundBufferRes = ResourceManagerPool.GetInstance().FetchSoundBuffer('media/sounds/goalpost.wav');
    this.goalpostsound = new Sound('goalpostsound');
    this.goalpostsound.SetSoundBuffer(soundBufferRes);
    this.goalpostsound.SetGain(0.7 * GetConfiguration().GetReal('audio_volume', 0.5));
    this.goalpostsound.SetLoop(false);
    this.scene3D.AddObject(this.goalpostsound);

    this.CalculatePrediction();
  }

  /** C++ destructor */
  Exit(): void {
    this.match.GetDynamicNode().DeleteNode(this.ballNode);
    this.scene3D.DeleteObject(this.sound);
    this.scene3D.DeleteObject(this.goalpostsound);
  }

  GetBallGeom(): Geometry {
    return this.ball;
  }

  Predict(predictTime_ms: number): Vector3 {
    // C++: unsigned int index = predictTime_ms (so negative times wrap around to 'too large')
    let index = Math.trunc(predictTime_ms);
    if (index < 0 || index >= ballPredictionSize_ms) index = ballPredictionSize_ms - 10;
    index = Math.trunc(index / 10);
    return this.predictions[index];
  }

  /** C++ GetPredictionArray(Vector3 *target): copies the predictions into target */
  GetPredictionArray(target: Vector3[]): void {
    for (let i = 0; i < ballPredictionSize_ms / 10; i++) target[i] = this.predictions[i];
  }

  GetMovement(): Vector3 {
    // meters / sec
    return this.momentum;
  }

  Touch(target: Vector3): void {
    if (this.positionBuffer.coords[2] < 0.11) this.positionBuffer = this.positionBuffer.WithCoord(2, 0.11);

    this.SetMomentum(target);

    // recalculate prediction
    this.CalculatePrediction();
    this.match.UpdateLatestMentalImageBallPredictions();

    this.match.GetTeam(0).UpdatePossessionStats();
    this.match.GetTeam(1).UpdatePossessionStats();
  }

  SetPosition(target: Vector3): void {
    this.positionBuffer = target;
    this.momentum = new Vector3(0);
    this.SetRotation(0, 0, 0, 1.0);
    this.ballPosHistory = [];
    this.previousMomentum = this.momentum;
    this.previousPosition = this.positionBuffer;
  }

  SetMomentum(target: Vector3): void {
    this.momentum = target;
    this.CalculatePrediction();
  }

  /** radians per second for each axis. C++ overloads SetRotation(x, y, z, bias = 1) and SetRotation(const Vector3 &rot, bias = 1) */
  SetRotation(x: radian, y: radian, z: radian, bias?: number): void;
  SetRotation(rot: Vector3, bias?: number): void;
  SetRotation(xOrRot: radian | Vector3, yOrBias?: number, z?: radian, bias?: number): void {
    let x: number;
    let y: number;
    let zz: number;
    let b: number;
    if (typeof xOrRot === 'number') {
      x = xOrRot;
      y = yOrBias as number;
      zz = z as number;
      b = bias ?? 1.0;
    } else {
      x = xOrRot.coords[0];
      y = xOrRot.coords[1];
      zz = xOrRot.coords[2];
      b = yOrBias ?? 1.0;
    }

    const rotX = Quaternion.FromAngleAxis(clamp(x * 0.001, -pi * 0.49, pi * 0.49), AXIS_X_NEG);
    const rotY = Quaternion.FromAngleAxis(clamp(y * 0.001, -pi * 0.49, pi * 0.49), AXIS_Y);
    const rotZ = Quaternion.FromAngleAxis(clamp(zz * 0.001, -pi * 0.49, pi * 0.49), AXIS_Z);

    const tmpRotation_ms = rotX.Mul(rotY).Mul(rotZ);
    this.rotation_ms = this.rotation_ms.GetSlerped(b, tmpRotation_ms);

    this.CalculatePrediction();
  }

  /**
   * returns momentum in 10ms
   *
   * PORT: this is the hottest physics path (300 sub steps per call, called several times per 10ms
   * step), so position and momentum are kept in scalars instead of immutable Vector3s. Every
   * expression mirrors the Vector3 operation of the original (including the GetLength/GetNormalized
   * near-zero rules), in the same evaluation order.
   */
  CalculatePrediction(): BallSpatialInfo {
    let newMomentum = new Vector3(0);
    let newRotation_ms = Quaternion.IDENTITY;

    // fill predictions

    // nextPos
    let px = this.positionBuffer.coords[0];
    let py = this.positionBuffer.coords[1];
    let pz = this.positionBuffer.coords[2];
    let nextOrientation = this.orientationBuffer;
    // momentumPredict
    let mx = this.momentum.coords[0];
    let my = this.momentum.coords[1];
    let mz = this.momentum.coords[2];
    let rotationPredict_ms = this.rotation_ms;

    this.predictions[0] = this.positionBuffer;

    const drag_enabled = true;
    const groundFriction_enabled = true;
    const woodwork_enabled = true;
    const netting_enabled = true;
    const groundRotationEffects_enabled = true;
    const swerve_enabled = true;

    let timeStep = 0.01; //0.001f; // seconds
    const autoDegrade_timeStep = false;

    let firstTime = true;

    this.ballTouchesNet = false;

    const bounce = this.bounce;
    const linearBounce = this.linearBounce;
    const drag = this.drag;
    const friction = this.friction;
    const linearFriction = this.linearFriction;
    const gravity = this.gravity;
    const grassHeight = this.grassHeight;

    for (let predictTime_ms = Math.trunc(timeStep * 1000.0); predictTime_ms < ballPredictionSize_ms; predictTime_ms += Math.trunc(timeStep * 1000.0)) {
      let frictionFactor = 0.0;

      // gravity

      // vz = vz0 + g * t
      mz = mz + gravity * timeStep;

      // air resistance

      const momentumVelo = Length3(mx, my, mz);
      const momentumVeloDragged = momentumVelo - drag * Math.pow(momentumVelo, 2.0) * timeStep;
      if (drag_enabled) {
        // momentumPredict = momentumPredict.GetNormalized(0) * momentumVeloDragged
        if (IsNull3(mx, my, mz)) {
          mx = 0 * momentumVeloDragged;
          my = 0 * momentumVeloDragged;
          mz = 0 * momentumVeloDragged;
        } else {
          const f = 1.0 / Math.sqrt(mx * mx + my * my + mz * mz);
          mx = mx * f * momentumVeloDragged;
          my = my * f * momentumVeloDragged;
          mz = mz * f * momentumVeloDragged;
        }
      }

      const ballBottom = pz - 0.11;
      let grassInfluenceBias = clamp(1.0 - ballBottom / grassHeight, 0.0, 1.0); // 0 == no friction, 1 == all friction
      // todo: seems to cause 'feedback' on multibump (1st bump: ball gets lots of rotation. second bump: rotation makes ball accelerate too much)
      grassInfluenceBias = Math.pow(grassInfluenceBias, 0.7); // at half grass height, there's already a bigger amount of friction than 50%

      // bounce

      if (pz < 0.11) {
        if (mz < 0.0) {
          frictionFactor = NormalizedClamp(-mz - 0.5, 0.0, 12.0); // when the ball is slammed into the ground, there's gonna be more friction. only set it here so it is only done once (on impact)
          mz = -mz * bounce;
          mz = Math.max(mz - linearBounce, 0.0); // linear bounce
        }

        pz = 0.11;
      }

      // ground friction

      if (pz < 0.11 + grassHeight && groundFriction_enabled) {
        const adaptedFriction = friction * grassInfluenceBias;

        // v(t) = v(0) * (k ^ t)

        // xy = momentumPredict.Get2D()
        const velo = Length3(mx, my, 0);

        let newVelo = velo - adaptedFriction * Math.pow(velo, 2.0) * timeStep;

        // linear friction
        newVelo = clamp(newVelo - linearFriction * grassInfluenceBias * timeStep, 0.0, 100000.0);

        // xy.Normalize(Vector3(0)); xy *= newVelo;
        if (IsNull3(mx, my, 0)) {
          mx = 0 * newVelo;
          my = 0 * newVelo;
        } else {
          const f = 1.0 / Math.sqrt(mx * mx + my * my + 0 * 0);
          mx = mx * f * newVelo;
          my = my * f * newVelo;
        }
      }

      let netAbsorbInv = 0.95;
      const powFactor = 2.6;
      const powerFac = 1.8; // lol varnames
      const postAbsorbInv = 0.8;
      const ballRadius = 0.11;
      const postRadius = 0.07;

      netAbsorbInv = Math.pow(netAbsorbInv, timeStep * 100.0);

      // woodwork (first sub step only, so plain Vector3 code)

      if (firstTime && woodwork_enabled) {
        let nextPos = new Vector3(px, py, pz);
        let momentumPredict = new Vector3(mx, my, mz);
        let woodwork = false;

        // posts

        if (
          nextPos.coords[2] < goalHeight + ballRadius + postRadius &&
          nextPos.Get2D().GetAbsolute().Sub(new Vector3(pitchHalfW, goalHalfWidth, 0)).GetLength() < ballRadius + postRadius
        ) {
          let normal: Vector3;

          if (nextPos.coords[0] < 0) {
            // left side of pitch
            if (nextPos.coords[1] < 0) {
              // 'lower' side of pitch
              normal = nextPos.Get2D().Sub(new Vector3(-pitchHalfW, -goalHalfWidth, 0)).GetNormalized(new Vector3(1, 0, 0));
              const nextPosZ = nextPos.coords[2];
              nextPos = new Vector3(-pitchHalfW, -goalHalfWidth, 0).Add(normal.Mul(postRadius + ballRadius));
              nextPos = nextPos.WithCoord(2, nextPosZ);
              woodwork = true;
            } else {
              // 'upper' side of pitch
              normal = nextPos.Get2D().Sub(new Vector3(-pitchHalfW, goalHalfWidth, 0)).GetNormalized(new Vector3(1, 0, 0));
              const nextPosZ = nextPos.coords[2];
              nextPos = new Vector3(-pitchHalfW, goalHalfWidth, 0).Add(normal.Mul(postRadius + ballRadius));
              nextPos = nextPos.WithCoord(2, nextPosZ);
              woodwork = true;
            }
          } else {
            // right side of pitch
            if (nextPos.coords[1] < 0) {
              // 'lower' side of pitch
              normal = nextPos.Get2D().Sub(new Vector3(pitchHalfW, -goalHalfWidth, 0)).GetNormalized(new Vector3(-1, 0, 0));
              const nextPosZ = nextPos.coords[2];
              nextPos = new Vector3(pitchHalfW, -goalHalfWidth, 0).Add(normal.Mul(postRadius + ballRadius));
              nextPos = nextPos.WithCoord(2, nextPosZ);
              woodwork = true;
            } else {
              // 'upper' side of pitch
              normal = nextPos.Get2D().Sub(new Vector3(pitchHalfW, goalHalfWidth, 0)).GetNormalized(new Vector3(-1, 0, 0));
              const nextPosZ = nextPos.coords[2];
              nextPos = new Vector3(pitchHalfW, goalHalfWidth, 0).Add(normal.Mul(postRadius + ballRadius));
              nextPos = nextPos.WithCoord(2, nextPosZ);
              woodwork = true;
            }
          }

          momentumPredict = momentumPredict
            .Get2D()
            .GetNormalized(normal)
            .Add(normal.Mul(1.1))
            .GetNormalized()
            .Mul(momentumPredict.Get2D().GetLength() * postAbsorbInv)
            .Add(VECTOR_UP.Mul(momentumPredict.coords[2]));
        }

        // crossbar

        const nextPosXZ = nextPos.Mul(XZ);
        if (
          nextPosXZ.GetAbsolute().Sub(new Vector3(pitchHalfW, 0, goalHeight)).GetLength() < ballRadius + postRadius &&
          Math.abs(nextPos.coords[1]) < goalHalfWidth + ballRadius + postRadius
        ) {
          let normal: Vector3;

          if (nextPos.coords[0] < 0) {
            // left side of pitch
            normal = nextPosXZ.Sub(new Vector3(-pitchHalfW, 0, goalHeight)).GetNormalized(new Vector3(0, 0, 1));
            const nextPosY = nextPos.coords[1];
            nextPos = new Vector3(-pitchHalfW, 0, goalHeight).Add(normal.Mul(postRadius + ballRadius));
            nextPos = nextPos.WithCoord(1, nextPosY);
            woodwork = true;
          } else {
            // right side of pitch
            normal = nextPosXZ.Sub(new Vector3(pitchHalfW, 0, goalHeight)).GetNormalized(new Vector3(0, 0, -1));
            const nextPosY = nextPos.coords[1];
            nextPos = new Vector3(pitchHalfW, 0, goalHeight).Add(normal.Mul(postRadius + ballRadius));
            nextPos = nextPos.WithCoord(1, nextPosY);
            woodwork = true;
          }

          const momentumPredictXZ = momentumPredict.Mul(XZ);
          momentumPredict = momentumPredictXZ
            .GetNormalized(normal)
            .Add(normal.Mul(1.1))
            .GetNormalized()
            .Mul(momentumPredictXZ.GetLength() * postAbsorbInv)
            .Add(AXIS_Y.Mul(momentumPredict.coords[1]));
        }

        if (woodwork) {
          this.goalpostsound.SetGain(clamp(momentumPredict.GetLength() * 0.05, 0.01, 1.0) * 0.5 * GetConfiguration().GetReal('audio_volume', 0.5));
          this.goalpostsound.Poke();
        }

        px = nextPos.coords[0];
        py = nextPos.coords[1];
        pz = nextPos.coords[2];
        mx = momentumPredict.coords[0];
        my = momentumPredict.coords[1];
        mz = momentumPredict.coords[2];
      }

      // netting

      if (predictTime_ms <= 10 && netting_enabled) {
        const ballIsInGoal = this.match.IsBallInGoal();
        const inGoal = ballIsInGoal ? 1 : -1;

        const behindBackline = Math.abs(px) > pitchHalfW + 0.11;
        const beforeGoalBack = Math.abs(px) < pitchHalfW + goalDepth - 0.11;
        const belowGoalHeight = pz < goalHeight + 0.11;
        const betweenGoalWidth = Math.abs(py) < goalHalfWidth - 0.11;

        // side netting

        if (ballIsInGoal && !betweenGoalWidth && behindBackline) {
          let netDist = Math.abs(Math.abs(py) - goalHalfWidth);
          netDist = clamp(netDist, 0, 1);
          const power = Math.pow(netDist, powFactor) * -signSide(py) * inGoal;

          // net is stuck to woodwork so lay off there
          const woodworkTensionBiasInv = clamp((Math.abs(mx) - pitchHalfW) * 2.0, 0.0, 1.0);
          const adaptedPowerFac = powerFac + (1.0 - woodworkTensionBiasInv) * 3.0;

          my = my * netAbsorbInv + power * adaptedPowerFac * (100 * timeStep);

          if (predictTime_ms === 10) this.ballTouchesNet = true;
        }

        // rear netting

        if (ballIsInGoal && !beforeGoalBack && behindBackline) {
          let netDist = Math.abs(Math.abs(px) - (pitchHalfW + goalDepth));
          netDist = clamp(netDist, 0, 1);
          const power = Math.pow(netDist, powFactor) * -signSide(px) * inGoal;
          mx = mx * netAbsorbInv + power * powerFac * (100 * timeStep);

          if (predictTime_ms === 10) this.ballTouchesNet = true;
        }

        // top netting

        if (ballIsInGoal && !belowGoalHeight && behindBackline) {
          // todo: from above. so hard to code. wow.
          let netDist = Math.abs(Math.abs(pz) - goalHeight);
          netDist = clamp(netDist, 0, 1);
          const power = Math.pow(netDist, powFactor) * -inGoal;

          // net is stuck to woodwork so lay off there
          const woodworkTensionBiasInv = clamp((Math.abs(mx) - pitchHalfW) * 2.0, 0.0, 1.0);
          const adaptedPowerFac = powerFac + (1.0 - woodworkTensionBiasInv) * 3.0;

          mz = mz * netAbsorbInv + power * adaptedPowerFac * (100 * timeStep);

          if (predictTime_ms === 10) this.ballTouchesNet = true;
        }
      } // </goal collisions>

      // calculate rotation

      if (pz < 0.11 + grassHeight && groundRotationEffects_enabled) {
        // rewrite idea: find out difference in ball velo / roll velo and then change both ball velo and rot (instead of having these 2 seperate sections)

        // ground friction induced rotation

        // x movement causes roll over y axis.. so this is correct ;)
        const radius = 0.11;
        const xR = my / radius;
        const yR = mx / radius;

        // clamp, because we can not rotate faster than this or the maths don't know what direction to rotate into anymore
        const rotX = Quaternion.FromAngleAxis(clamp(xR * 0.001, -pi * 0.49, pi * 0.49), AXIS_X_NEG);
        const rotY = Quaternion.FromAngleAxis(clamp(yR * 0.001, -pi * 0.49, pi * 0.49), AXIS_Y);

        const groundRot = rotX.Mul(rotY);

        let oldToNewRotation = rotationPredict_ms.GetRotationTo(groundRot).GetNormalized();
        const rotationChangePerSecond = Math.abs(oldToNewRotation.GetRotationAngle(Quaternion.IDENTITY)) * 1000.0;

        let maxRotationChangePerSecond = 1.0 * pi * grassInfluenceBias;
        // ball slams into ground; see origin of frictionFactor variable for more clarity. this happens only once per bounce
        // this works here because the 'if' statement is always true when frictionFactor > 0, because when then happens, nextPos.coords[2] has been set to ballRadius anyway
        if (frictionFactor > 0.0) {
          maxRotationChangePerSecond += 4.0 * pi;
        }
        let factor = 1.0;
        if (rotationChangePerSecond > maxRotationChangePerSecond) {
          factor = maxRotationChangePerSecond / rotationChangePerSecond;
        }
        if (factor < 1.0) {
          oldToNewRotation = oldToNewRotation.GetRotationMultipliedBy(factor);
        }

        const newRotationPredict_ms = oldToNewRotation.Mul(rotationPredict_ms);

        // rotation induced ground friction

        const angles = rotationPredict_ms.GetAngles();
        const x = -angles.X;
        const y = angles.Y;

        // how fast the ball would move if we took 100% of its rotational velo
        const ballRotationMomentum0 = y * radius * 1000.0;
        const ballRotationMomentum1 = x * radius * 1000.0;

        // mix (not sure if mathematically correct, i think so, but maybe check out on a rainy sunday once)
        let rotBias = 0.01; // lower == ball is lighter. higher == pitch/ball contact seems more 'rubbery'
        rotBias *= grassInfluenceBias;

        // ball slams into ground; see origin of frictionFactor variable for more clarity. this happens only once per bounce
        // this works here because the 'if' statement is always true when frictionFactor > 0, because when then happens, nextPos.coords[2] has been set to ballRadius anyway
        if (frictionFactor > 0.0) {
          rotBias += 0.5 * frictionFactor;
        }
        rotBias = clamp(rotBias, 0.0, 1.0);
        mx = mx * (1.0 - rotBias) + ballRotationMomentum0 * rotBias;
        my = my * (1.0 - rotBias) + ballRotationMomentum1 * rotBias;

        // finally, add the previously calculated ground friction induced rotation
        rotationPredict_ms = newRotationPredict_ms;
      }

      // PORT: the C++ called rotationPredict_ms.GetAngles() for the swerve and again (unchanged
      // rotation) for the orientation step below; computed once here
      const rotationAngles = rotationPredict_ms.GetAngles();

      // magnus effect (swerve)

      if (swerve_enabled) {
        const rotVecX = rotationAngles.X * 10.0;
        const rotVecY = rotationAngles.Y * 10.0;
        const rotVecZ = rotationAngles.Z * 10.0;

        // magnus effect has a strength curve that goes down after a certain velocity
        let swerveAmount = NormalizedClamp(Length3(mx, my, mz), 0.0, 70.0);
        // http://www.wolframalpha.com/input/?i=sin%28x+*+pi+*+0.7%29+^+2.2+from+x+%3D+0+to+1
        // <bazkie_drunk> ^ tnx, past myself, that's very convenient!
        swerveAmount = Math.pow(Math.sin(swerveAmount * pi * 0.94), 2.6);

        // adaptedMomentumPredict = momentumPredict.GetNormalized(0) * swerveAmount * 30.0f
        const adaptedFactor = swerveAmount * 30.0;
        let ax: number;
        let ay: number;
        let az: number;
        if (IsNull3(mx, my, mz)) {
          ax = 0 * adaptedFactor;
          ay = 0 * adaptedFactor;
          az = 0 * adaptedFactor;
        } else {
          const f = 1.0 / Math.sqrt(mx * mx + my * my + mz * mz);
          ax = mx * f * adaptedFactor;
          ay = my * f * adaptedFactor;
          az = mz * f * adaptedFactor;
        }

        // swerve = adaptedMomentumPredict.GetCrossProduct(-rotVec) * 1.0
        const nrx = -rotVecX;
        const nry = -rotVecY;
        const nrz = -rotVecZ;
        const sx = (ay * nrz - az * nry) * 1.0;
        const sy = (az * nrx - ax * nrz) * 1.0;
        const sz = (ax * nry - ay * nrx) * 1.0;

        mx = mx + sx * timeStep;
        my = my + sy * timeStep;
        mz = mz + sz * timeStep;
      }

      // predict next ms

      px = px + mx * timeStep;
      py = py + my * timeStep;
      pz = pz + mz * timeStep;

      const rotationFactor = timeStep / 0.001;
      const rotationPredictTimeStepped = Quaternion.FromAngles(rotationAngles.X * rotationFactor, rotationAngles.Y * rotationFactor, rotationAngles.Z * rotationFactor);

      nextOrientation = rotationPredictTimeStepped.Mul(nextOrientation);

      if (predictTime_ms % 10 === 0) {
        if (autoDegrade_timeStep) {
          if (predictTime_ms === 100) timeStep = 0.005;
          if (predictTime_ms === 200) timeStep = 0.01;
        }

        this.predictions[predictTime_ms / 10] = new Vector3(px, py, pz);
      }

      if (predictTime_ms === 10) {
        newMomentum = new Vector3(mx, my, mz);
        newRotation_ms = rotationPredict_ms;
        this.orientPrediction = nextOrientation;
      }

      firstTime = false;
    }

    return new BallSpatialInfo(newMomentum, newRotation_ms);
  }

  GetPositionBuffer(): Vector3 {
    return this.buf_positionBuffer.GetValue(EnvironmentManager.GetInstance().GetTime_ms());
  }

  BallTouchesNet(): boolean {
    return this.ballTouchesNet;
  }

  GetAveragePosition(duration_ms: number): Vector3 {
    let total = 0;
    let averageVec = new Vector3(0);
    for (let i = this.ballPosHistory.length - 1; i >= 0; i--) {
      averageVec = averageVec.Add(this.ballPosHistory[i]);
      total++;
      if (total * 10 > duration_ms) break;
    }
    if (total > 0) averageVec = averageVec.Div(total);
    else averageVec = this.Predict(0);
    return averageVec;
  }

  TriggerBallTouchSound(gain: number): void {
    const finalGain = gain * 0.6 * GetConfiguration().GetReal('audio_volume', 0.5);
    if (finalGain > 0.01) {
      this.sound.SetPitch(0.9 + random(0.0, 0.2));
      this.sound.SetGain(finalGain);
      this.sound.Poke();
    }
  }

  Process(): void {
    if (!IsReleaseVersion() && UserEventManager.GetInstance().GetKeyboardState(SDLK_BACKSPACE)) {
      const player = this.match.GetTeam(0).GetDesignatedTeamPossessionPlayer();
      this.positionBuffer = player.GetPosition().Add(player.GetDirectionVec().Mul(0.25)).Add(player.GetMovement().Mul(0.06)).Add(new Vector3(0, 0, 0.2));
      this.SetMomentum(player.GetMovement().Mul(1.2));
      this.SetRotation(0, 0, 0);
    }

    const spatialInfo = this.CalculatePrediction();
    this.momentum = spatialInfo.momentum;
    this.rotation_ms = spatialInfo.rotation_ms;

    this.positionBuffer = this.Predict(10);
    this.orientationBuffer = this.orientPrediction;

    this.ballPosHistory.push(this.positionBuffer);
    if (this.ballPosHistory.length > ballHistorySize_ms) this.ballPosHistory.shift();

    this.previousMomentum = this.momentum;
    this.previousPosition = this.positionBuffer;
  }

  PreparePutBuffers(snapshotTime_ms: number): void {
    this.buf_positionBuffer.SetValue(this.positionBuffer, snapshotTime_ms);
    this.buf_orientationBuffer.SetValue(this.orientationBuffer, snapshotTime_ms);
  }

  FetchPutBuffers(putTime_ms: number): void {
    this.fetchedbuf_positionBuffer = this.buf_positionBuffer.GetValue(putTime_ms);
    this.fetchedbuf_orientationBuffer = this.buf_orientationBuffer.GetValue(putTime_ms);
  }

  Put(): void {
    this.ball.SetPosition(this.fetchedbuf_positionBuffer, false);
    this.ball.SetRotation(this.fetchedbuf_orientationBuffer, false);
  }

  ResetSituation(focusPos: Vector3): void {
    this.momentum = new Vector3(0);
    this.rotation_ms = Quaternion.IDENTITY;
    const restPos = focusPos.Add(new Vector3(0, 0, 0.11));
    for (let i = 0; i < ballPredictionSize_ms / 10; i++) {
      this.predictions[i] = restPos;
    }
    this.orientPrediction = Quaternion.IDENTITY;
    this.ballPosHistory = [];
    this.previousMomentum = new Vector3(0);
    this.previousPosition = restPos;
    this.positionBuffer = restPos;
    this.orientationBuffer = Quaternion.IDENTITY;
    this.ballTouchesNet = false;
  }
}
