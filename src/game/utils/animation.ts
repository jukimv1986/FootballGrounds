// Port of legacy/src/utils/animation.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).

import { Vector3, Quaternion } from '../../blunted/base/math/vector3';
import { ModulateIntoRange, NormalizedClamp, clamp, cround, curve, is_odd, pi, signSide, type radian } from '../../blunted/base/math/bluntmath';
import { assert } from '../../blunted/base/assert';
import { GetStringFromVector, GetVectorFromString, atof, atoi, int_to_str, real_to_str, tokenize } from '../../blunted/base/utils';
import { FileSystem, file_to_vector } from '../../blunted/managers/filesystem';
import { XMLLoader, XMLTree } from '../../blunted/utils/xmlloader';
import type { Node } from '../../blunted/scene/node';
import type { AnimationExtension } from './animationextensions/animationextension';

// todo: make default orientation changeable
function FixAngle(angle: radian, modulateIntoRange = true): radian {
  // convert engine angle into football angle (different base orientation: 'down' on y instead of 'right' on x)
  let newAngle = angle;
  newAngle += 0.5 * pi;
  if (modulateIntoRange) newAngle = ModulateIntoRange(-pi, pi, newAngle);
  return newAngle;
}

/**
 * Replacement for std::map<int, V>: keys are kept sorted ascending, so iteration order matches the
 * C++ map. `frames` and `values` are parallel arrays (read them directly in hot loops, do not
 * modify them; use set/insert/delete/clear).
 */
export class SortedIntMap<V> {
  readonly frames: number[] = [];
  readonly values: V[] = [];

  get size(): number {
    return this.frames.length;
  }

  empty(): boolean {
    return this.frames.length === 0;
  }

  /** index of the first key >= key (std::map::lower_bound) */
  LowerBound(key: number): number {
    const frames = this.frames;
    let lo = 0;
    let hi = frames.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (frames[mid] < key) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** index of key, or -1 */
  IndexOf(key: number): number {
    const i = this.LowerBound(key);
    return i < this.frames.length && this.frames[i] === key ? i : -1;
  }

  has(key: number): boolean {
    return this.IndexOf(key) !== -1;
  }

  get(key: number): V | undefined {
    const i = this.IndexOf(key);
    return i === -1 ? undefined : this.values[i];
  }

  /** map[key] = value (inserts or replaces) */
  set(key: number, value: V): void {
    const i = this.LowerBound(key);
    if (i < this.frames.length && this.frames[i] === key) {
      this.values[i] = value;
    } else {
      this.frames.splice(i, 0, key);
      this.values.splice(i, 0, value);
    }
  }

  /** std::map::insert: does nothing if the key already exists; returns whether it was inserted */
  insert(key: number, value: V): boolean {
    const i = this.LowerBound(key);
    if (i < this.frames.length && this.frames[i] === key) return false;
    this.frames.splice(i, 0, key);
    this.values.splice(i, 0, value);
    return true;
  }

  delete(key: number): boolean {
    const i = this.IndexOf(key);
    if (i === -1) return false;
    this.frames.splice(i, 1);
    this.values.splice(i, 1);
    return true;
  }

  clear(): void {
    this.frames.length = 0;
    this.values.length = 0;
  }

  firstKey(): number {
    return this.frames[0];
  }

  lastKey(): number {
    return this.frames[this.frames.length - 1];
  }

  /** replaces the contents with those of another map (C++ map assignment `a = b`, values shared) */
  Assign(src: SortedIntMap<V>): void {
    this.frames.length = 0;
    this.values.length = 0;
    for (let i = 0; i < src.frames.length; i++) {
      this.frames.push(src.frames[i]);
      this.values.push(src.values[i]);
    }
  }

  Clone(cloneValue: (value: V) => V): SortedIntMap<V> {
    const copy = new SortedIntMap<V>();
    for (let i = 0; i < this.frames.length; i++) {
      copy.frames.push(this.frames[i]);
      copy.values.push(cloneValue(this.values[i]));
    }
    return copy;
  }

  *[Symbol.iterator](): IterableIterator<[number, V]> {
    for (let i = 0; i < this.frames.length; i++) yield [this.frames[i], this.values[i]];
  }
}

/** C++ struct KeyFrame (copied by value in C++: use Clone()) */
export class KeyFrame {
  orientation: Quaternion = Quaternion.IDENTITY;
  position: Vector3 = new Vector3(0);

  Clone(): KeyFrame {
    const k = new KeyFrame();
    k.orientation = this.orientation;
    k.position = this.position;
    return k;
  }
}

export class WeighedKey {
  keyFrame = new KeyFrame();
  influence = 0; // [0..1]
  frame = 0;
}

export class NodeAnimation {
  nodeName = '';
  /** std::map<int, KeyFrame>: frame, angles */
  animation = new SortedIntMap<KeyFrame>();

  /** C++ copy constructor (deep copies the keyframes) */
  Clone(): NodeAnimation {
    const n = new NodeAnimation();
    n.nodeName = this.nodeName;
    n.animation = this.animation.Clone((k) => k.Clone());
    return n;
  }
}

export enum e_Foot {
  e_Foot_Left,
  e_Foot_Right,
}

export class BiasedOffset {
  bias = 0.0; // 0 .. 1
  orientation: Quaternion = Quaternion.IDENTITY;
  isRelative = false;

  Clone(): BiasedOffset {
    const b = new BiasedOffset();
    b.bias = this.bias;
    b.orientation = this.orientation;
    b.isRelative = this.isRelative;
    return b;
  }
}

/** C++ static emptyOffsets (default for Apply) */
export const emptyOffsets: Map<string, BiasedOffset> = new Map();

export class MovementHistoryEntry {
  nodeName = '';
  position: Vector3 = new Vector3(0);
  orientation: Quaternion = Quaternion.IDENTITY;
  timeDiff_ms = 0;

  Clone(): MovementHistoryEntry {
    const m = new MovementHistoryEntry();
    m.nodeName = this.nodeName;
    m.position = this.position;
    m.orientation = this.orientation;
    m.timeDiff_ms = this.timeDiff_ms;
    return m;
  }
}

export type MovementHistory = MovementHistoryEntry[];

/** C++ std::map<const std::string, boost::intrusive_ptr<Node>> */
export type NodeMap = Map<string, Node>;

function CloneXMLTree(src: XMLTree): XMLTree {
  const tree = new XMLTree();
  tree.value = src.value;
  for (const [tag, child] of src.children) tree.children.push([tag, CloneXMLTree(child)]);
  return tree;
}

const zAxis = new Vector3(0, 0, 1);
const downVector = new Vector3(0, -1, 0);

// usage
//
// rules:
//   - first node inserted (by using SetKeyFrame) should be root node of the animated object (for optimization purposes)

export class Animation {
  protected nodeAnimations: NodeAnimation[] = [];
  protected frameCount = 0;
  protected name = '';

  /** std::map<std::string, shared_ptr<AnimationExtension>> */
  protected extensions = new Map<string, AnimationExtension>();

  protected customData: XMLTree | null = null;
  protected variableCache = new Map<string, string>();

  // this hack only applies to humanoids
  // it's which foot is moving first in this anim
  protected currentFoot: e_Foot = e_Foot.e_Foot_Right;

  protected cache_translation_dirty = true;
  protected cache_translation: Vector3 = new Vector3(0);
  protected cache_incomingMovement_dirty = true;
  protected cache_incomingMovement: Vector3 = new Vector3(0);
  protected cache_incomingVelocity_dirty = true;
  protected cache_incomingVelocity = 0;
  protected cache_outgoingDirection_dirty = true;
  protected cache_outgoingDirection: Vector3 = new Vector3(0);
  protected cache_outgoingMovement_dirty = true;
  protected cache_outgoingMovement: Vector3 = new Vector3(0);
  protected cache_rangedOutgoingMovement_dirty = true;
  protected cache_rangedOutgoingMovement: Vector3 = new Vector3(0);
  protected cache_outgoingVelocity_dirty = true;
  protected cache_outgoingVelocity = 0;
  protected cache_angle_dirty = true;
  protected cache_angle: radian = 0;
  protected cache_incomingBodyAngle_dirty = true;
  protected cache_incomingBodyAngle: radian = 0;
  protected cache_outgoingBodyAngle_dirty = true;
  protected cache_outgoingBodyAngle: radian = 0;
  protected cache_incomingBodyDirection_dirty = true;
  protected cache_incomingBodyDirection: Vector3 = new Vector3(0);
  protected cache_outgoingBodyDirection_dirty = true;
  protected cache_outgoingBodyDirection: Vector3 = new Vector3(0);

  protected cache_AnimType = '';

  /**
   * C++ Animation() and Animation(const Animation &src).
   * attention! the copy does not deep copy extensions! (shallow copy, like the original)
   */
  constructor(src?: Animation) {
    if (!src) {
      this.frameCount = 0;
      // all humanoid movies are supposed to have a moving right foot at first (unless mirrored)
      this.currentFoot = e_Foot.e_Foot_Right;
      this.DirtyCache();
      return;
    }

    for (let i = 0; i < src.nodeAnimations.length; i++) {
      this.nodeAnimations.push(src.nodeAnimations[i].Clone());
    }

    this.frameCount = src.frameCount;
    this.name = src.name;

    // attention! shallow copy!
    this.extensions = new Map(src.extensions);

    this.customData = src.customData ? CloneXMLTree(src.customData) : null;

    this.variableCache = new Map(src.variableCache);

    this.currentFoot = src.currentFoot;

    this.cache_translation_dirty = src.cache_translation_dirty;
    this.cache_translation = src.cache_translation;
    this.cache_incomingMovement_dirty = src.cache_incomingMovement_dirty;
    this.cache_incomingMovement = src.cache_incomingMovement;
    this.cache_incomingVelocity_dirty = src.cache_incomingVelocity_dirty;
    this.cache_incomingVelocity = src.cache_incomingVelocity;
    this.cache_outgoingDirection_dirty = src.cache_outgoingDirection_dirty;
    this.cache_outgoingDirection = src.cache_outgoingDirection;
    this.cache_outgoingMovement_dirty = src.cache_outgoingMovement_dirty;
    this.cache_outgoingMovement = src.cache_outgoingMovement;
    this.cache_rangedOutgoingMovement_dirty = src.cache_rangedOutgoingMovement_dirty;
    this.cache_rangedOutgoingMovement = src.cache_rangedOutgoingMovement;
    this.cache_outgoingVelocity_dirty = src.cache_outgoingVelocity_dirty;
    this.cache_outgoingVelocity = src.cache_outgoingVelocity;
    this.cache_angle_dirty = src.cache_angle_dirty;
    this.cache_angle = src.cache_angle;
    this.cache_incomingBodyAngle_dirty = src.cache_incomingBodyAngle_dirty;
    this.cache_incomingBodyAngle = src.cache_incomingBodyAngle;
    this.cache_outgoingBodyAngle_dirty = src.cache_outgoingBodyAngle_dirty;
    this.cache_outgoingBodyAngle = src.cache_outgoingBodyAngle;
    this.cache_incomingBodyDirection_dirty = src.cache_incomingBodyDirection_dirty;
    this.cache_incomingBodyDirection = src.cache_incomingBodyDirection;
    this.cache_outgoingBodyDirection_dirty = src.cache_outgoingBodyDirection_dirty;
    this.cache_outgoingBodyDirection = src.cache_outgoingBodyDirection;

    this.cache_AnimType = src.cache_AnimType;
  }

  /** C++ destructor */
  Exit(): void {
    this.Reset();
  }

  DirtyCache(): void {
    // hee hee
    this.cache_translation_dirty = true;
    this.cache_incomingMovement_dirty = true;
    this.cache_incomingVelocity_dirty = true;
    this.cache_outgoingDirection_dirty = true;
    this.cache_outgoingMovement_dirty = true;
    this.cache_rangedOutgoingMovement_dirty = true;
    this.cache_outgoingVelocity_dirty = true;
    this.cache_angle_dirty = true;
    this.cache_incomingBodyAngle_dirty = true;
    this.cache_outgoingBodyAngle_dirty = true;
    this.cache_incomingBodyDirection_dirty = true;
    this.cache_outgoingBodyDirection_dirty = true;
  }

  GetFrameCount(): number {
    return this.frameCount;
  }

  GetEffectiveFrameCount(): number {
    return this.GetFrameCount() - 1;
  }

  /**
   * C++ bool GetKeyFrame(nodeName, frame, Quaternion &orientation, Vector3 &position, getOrientation, getPosition).
   * result: whether there is an actual keyframe at this frame; orientation/position are interpolated.
   */
  GetKeyFrame(nodeName: string, frame: number, getOrientation = true, getPosition = true): { result: boolean; orientation: Quaternion; position: Vector3 } {
    const animSize = this.nodeAnimations.length;
    for (let i = 0; i < animSize; i++) {
      const nodeAnimation = this.nodeAnimations[i];
      if (nodeAnimation.nodeName === nodeName) {
        const values = this.GetInterpolatedValues(nodeAnimation.animation, frame, getOrientation, getPosition);
        return { result: nodeAnimation.animation.has(frame), orientation: values.orientation, position: values.position };
      }
    }
    // PORT: the C++ left the caller's out-values untouched here
    return { result: false, orientation: Quaternion.IDENTITY, position: Vector3.ZERO };
  }

  SetKeyFrame(nodeName: string, frame: number, orientation: Quaternion, position: Vector3 = new Vector3(0, 0, 0)): void {
    if (frame >= this.frameCount) this.frameCount = frame + 1;

    let nodeAnimation: NodeAnimation | null = null;

    // find node
    const animSize = this.nodeAnimations.length;
    for (let i = 0; i < animSize; i++) {
      if (this.nodeAnimations[i].nodeName === nodeName) {
        nodeAnimation = this.nodeAnimations[i];
        break;
      }
    }

    // node doesn't exist yet?
    if (nodeAnimation === null) {
      nodeAnimation = new NodeAnimation();
      nodeAnimation.nodeName = nodeName;
      this.nodeAnimations.push(nodeAnimation);
    }

    // find frame
    const keyFrameExisting = nodeAnimation.animation.get(frame);
    if (keyFrameExisting !== undefined) {
      // change
      keyFrameExisting.orientation = orientation;
      keyFrameExisting.position = position;
    } else {
      // insert
      const keyFrame = new KeyFrame();
      keyFrame.orientation = orientation;
      keyFrame.position = position;
      nodeAnimation.animation.insert(frame, keyFrame);
    }

    this.DirtyCache();
  }

  DeleteKeyFrame(nodeName: string, frame: number): void {
    // iterate nodes
    const animSize = this.nodeAnimations.length;
    for (let i = 0; i < animSize; i++) {
      const nodeAnimation = this.nodeAnimations[i];
      if (nodeAnimation.nodeName === nodeName) {
        // find frame
        if (nodeAnimation.animation.delete(frame)) break;
        console.error('ERROR! keyframe does not exist');
      }
    }

    this.DirtyCache();
  }

  /**
   * C++ GetInterpolatedValues(animation, frame, Quaternion &orientation, Vector3 &position, getOrientation, getPosition).
   * PORT: the C++ collected the (at most 2) relevant keys by scanning the map; this finds the same keys
   * (the last key before `frame` and the first key at/after it) with a binary search, without allocating.
   */
  GetInterpolatedValues(animation: SortedIntMap<KeyFrame>, frame: number, getOrientation = true, getPosition = true): { orientation: Quaternion; position: Vector3 } {
    let position: Vector3 = Vector3.ZERO;
    let orientation: Quaternion = Quaternion.IDENTITY;

    const frames = animation.frames;
    const keyFrames = animation.values;
    const size = frames.length;

    if (frame > 0 && frame < this.GetFrameCount()) {
      // weighed keys: either 1 keyframe (before/after/at our current frame) or 2, on both sides of (or 1 at) our keyframe.
      const index = animation.LowerBound(frame);
      const hasBefore = index > 0;
      const hasAfter = index < size;

      if (hasBefore && hasAfter) {
        // calculate their influence
        const key0 = index - 1;
        const key1 = index;

        // distance between keyframes and current frame
        const distance = frames[key1] - frames[key0];
        const distance1 = frame - frames[key0];
        const distance2 = frames[key1] - frame;
        const ratio1 = 1 - (distance1 * 1.0) / (distance * 1.0);
        const ratio2 = 1 - (distance2 * 1.0) / (distance * 1.0);

        const relPosition = frame - frames[key0];
        const bias = (relPosition * 1.0) / (distance * 1.0);

        if (getOrientation) {
          orientation = keyFrames[key0].orientation.GetSlerped(bias, keyFrames[key1].orientation);
        }
        if (getPosition) {
          position = keyFrames[key0].position.Mul(ratio1).Add(keyFrames[key1].position.Mul(ratio2));
        }
      } else if (hasBefore || hasAfter) {
        // one key: influence 1
        const key = hasBefore ? index - 1 : index;
        if (getOrientation) orientation = keyFrames[key].orientation;
        if (getPosition) position = keyFrames[key].position;
      }
      // (no keys at all: the C++ would crash here)
    } else if (frame >= this.GetFrameCount()) {
      // extrapolate beyond animation
      // remember, weighed keys are in reverse order here!

      // get last 2 keyframes
      if (size === 0) return { orientation, position }; // should not happen
      if (size === 1) {
        if (getOrientation) orientation = keyFrames[0].orientation;
        if (getPosition) position = keyFrames[0].position;
        return { orientation, position };
      }
      const key0 = size - 1;
      const key1 = size - 2;

      // extrapolate
      const dist1 = frames[key0] - frames[key1];
      const dist2 = frame - frames[key0];
      const bias = 1 + (1 / dist1) * dist2;
      // extrapolation through hax: bias > 1 doesn't really give proper results. however, it works for small angles so FUFUUFUUUU XD
      // (use slerp instead of lerp - lerp can't extrapolate at all)
      if (getOrientation) orientation = keyFrames[key1].orientation.GetSlerped(bias, keyFrames[key0].orientation);
      if (getPosition) position = keyFrames[key1].position.Mul(1 - bias).Add(keyFrames[key0].position.Mul(bias));
    } else if (frame <= 0) {
      // extrapolate before animation
      // for now, just return first key
      if (size > 0) {
        if (getOrientation) orientation = keyFrames[0].orientation;
        if (getPosition) position = keyFrames[0].position;
      }
    }

    return { orientation, position };
  }

  ConvertToStartFacingForwardIfIdle(): void {
    const incomingBodyAngle = this.GetIncomingBodyAngle();

    // only applies to anims starting out idle
    if (this.GetIncomingVelocity() >= 1.8) return;

    // rotate player pos
    const player = this.nodeAnimations[0].animation.values;
    for (let i = 0; i < player.length; i++) {
      player[i].position = player[i].position.GetRotated2D(-incomingBodyAngle);
    }

    // rotate body dir
    const body = this.nodeAnimations[1].animation.values;
    for (let i = 0; i < body.length; i++) {
      let rotation = Quaternion.IDENTITY;
      const zRot = Quaternion.FromAngleAxis(-incomingBodyAngle, zAxis);
      rotation = zRot.Mul(rotation);
      body[i].orientation = rotation.Mul(body[i].orientation);
    }

    for (const extension of this.GetSortedExtensions()) {
      extension.Rotate2D(-incomingBodyAngle);
    }

    // variables
    const newBallDirVec = this.GetVariable('balldirection') !== '' ? GetVectorFromString(this.GetVariable('balldirection')).GetRotated2D(-incomingBodyAngle) : new Vector3(0);
    const newIncomingBallDirVec = this.GetVariable('incomingballdirection') !== '' ? GetVectorFromString(this.GetVariable('incomingballdirection')).GetRotated2D(-incomingBodyAngle) : new Vector3(0);
    const newBumpDirVec = this.GetVariable('bumpdirection') !== '' ? GetVectorFromString(this.GetVariable('bumpdirection')).GetRotated2D(-incomingBodyAngle) : new Vector3(0);
    this.SetVariable('balldirection', GetStringFromVector(newBallDirVec));
    this.SetVariable('incomingballdirection', GetStringFromVector(newIncomingBallDirVec));
    this.SetVariable('bumpdirection', GetStringFromVector(newBumpDirVec));

    this.DirtyCache();
  }

  Invert(): void {
    // simple keyframe-to-keyframe version
    const animSize = this.nodeAnimations.length;
    for (let i = 0; i < animSize; i++) {
      const keyFrames = this.nodeAnimations[i].animation.values;
      for (let k = 0; k < keyFrames.length; k++) {
        const { X: x, Y: y, Z: z } = keyFrames[k].orientation.GetAngles();
        const rotX = Quaternion.FromAngleAxis(-x, new Vector3(1, 0, 0));
        const rotY = Quaternion.FromAngleAxis(-y, new Vector3(0, 1, 0));
        const rotZ = Quaternion.FromAngleAxis(-z, new Vector3(0, 0, 1));
        keyFrames[k].orientation = rotX.Mul(rotY).Mul(rotZ);
      }
    }
  }

  /**
   * C++ Apply(nodeMap, frame, timeOffset_ms, smooth, smoothFactor, basePos, baseRot, offsets, movementHistory*, timeDiff_ms, noPos, updateSpatial).
   * Sets the rotations (and the "player" node position) of the nodes in nodeMap to this animation's
   * pose at `frame` (+ timeOffset_ms / 10 frames).
   */
  Apply(
    nodeMap: NodeMap,
    frame: number,
    timeOffset_ms = 0,
    smooth = true,
    smoothFactor = 1.0,
    basePos: Vector3 = new Vector3(0),
    baseRot: radian = 0,
    offsets: Map<string, BiasedOffset> = emptyOffsets,
    movementHistory: MovementHistory | null = null,
    timeDiff_ms = 10,
    noPos = false,
    updateSpatial = true,
  ): void {
    // simple keyframe-to-keyframe version

    // new, interpolated
    // PORT: loop-invariant values hoisted out of the node loop
    let bias = 0.5;
    if (timeOffset_ms !== -1) bias = clamp(timeOffset_ms / 10.0, 0.0, 1.0);
    // PORT: the C++ `if (smooth && 1 == 2)` smoothFrames block is dead code; smoothFrames stays 0
    const smoothFrames = 0;
    let rotZ: Quaternion | null = null;
    const beginBias = Math.pow(curve(1.0 - NormalizedClamp(frame, 0, 8), 1.0), 0.5);
    const currentBias = 0.0 + beginBias * smoothFactor * 0.5;

    const animSize = this.nodeAnimations.length;
    for (let i = 0; i < animSize; i++) {
      const nodeAnimation = this.nodeAnimations[i];
      const nodeName = nodeAnimation.nodeName;

      const pre = this.GetInterpolatedValues(nodeAnimation.animation, frame - smoothFrames);
      const post = this.GetInterpolatedValues(nodeAnimation.animation, frame + 1 + smoothFrames);
      const orientation_pre = pre.orientation.GetSameNeighborhood(post.orientation).quat;
      let orientation = orientation_pre.GetLerped(bias, post.orientation).GetNormalized();
      let position = pre.position.Mul(1.0 - bias).Add(post.position.Mul(bias));

      const node = nodeMap.get(nodeName) as Node;
      assert(node !== undefined, `Animation::Apply: node ${nodeName} not in node map`);

      const isPlayer = nodeName === 'player';
      if (isPlayer) {
        if (noPos) {
          position = new Vector3(0, 0, position.coords[2]);
        } else {
          position = position.GetRotated2D(baseRot);
        }
      }
      if (nodeName === 'body') {
        if (rotZ === null) rotZ = Quaternion.FromAngleAxis(baseRot, zAxis);
        orientation = rotZ.Mul(orientation);
        orientation = orientation.GetNormalized();
      }

      // offset
      const offset = offsets.get(nodeName);
      if (offset !== undefined) {
        offset.orientation = offset.orientation.GetSameNeighborhood(orientation).quat;
        if (offset.isRelative) {
          orientation = orientation.GetLerped(offset.bias, offset.orientation.Mul(orientation)).GetNormalized();
        } else {
          orientation = orientation.GetLerped(offset.bias, offset.orientation).GetNormalized();
        }
      }

      // SMOOTHING

      if (smooth) {
        // needed for smoothing - keep track of old limb positions/movements so we can extrapolate those and use that for rotation change limit calculations

        assert(movementHistory);
        const history = movementHistory as MovementHistory;
        let movementHistoryEntry: MovementHistoryEntry | null = null;

        for (let n = 0; n < history.length; n++) {
          if (history[n].nodeName === nodeName) {
            movementHistoryEntry = history[n];
          }
        }
        if (movementHistoryEntry === null) {
          // not in movementhistory yet; add
          const newEntry = new MovementHistoryEntry();
          newEntry.nodeName = nodeName;
          newEntry.position = position;
          newEntry.orientation = orientation;
          newEntry.timeDiff_ms = 10;
          history.push(newEntry);
          movementHistoryEntry = newEntry;
        }

        if (!isPlayer) {
          const previousOrientation = movementHistoryEntry.orientation;
          let currentOrientation = node.GetRotation();
          currentOrientation = currentOrientation.GetSameNeighborhood(previousOrientation).quat;

          if (timeDiff_ms > 0) {
            // PORT: only the 'simple method' is ported: the C++ hardcoded `bool simpleMethod = true`, the other branch is dead code

            orientation = orientation.GetSlerped(currentBias, currentOrientation).GetNormalized();

            // maximum rotational velocity
            const neighborhood = orientation.GetSameNeighborhood(currentOrientation);
            orientation = neighborhood.quat;
            const dot = neighborhood.dot;
            const angle_per_second = (2.0 * Math.acos(clamp(dot, -1.0, 1.0))) / (timeDiff_ms * 0.001);
            let maxAngle_per_second = 7.5 * pi; //5.5f * pi;
            if (nodeName === 'left_elbow') maxAngle_per_second *= 1.2;
            else if (nodeName === 'right_elbow') maxAngle_per_second *= 1.2;
            else if (nodeName === 'left_knee') maxAngle_per_second *= 1.2;
            else if (nodeName === 'right_knee') maxAngle_per_second *= 1.2;
            else if (nodeName === 'left_ankle') maxAngle_per_second *= 1.6;
            else if (nodeName === 'right_ankle') maxAngle_per_second *= 1.6;
            maxAngle_per_second = (0.3 + 0.7 * (1.0 - beginBias)) * maxAngle_per_second;
            if (angle_per_second > maxAngle_per_second) {
              const allowFraction = maxAngle_per_second / angle_per_second;
              const desiredRotation = currentOrientation.GetRotationTo(orientation).GetNormalized();
              orientation = desiredRotation.GetRotationMultipliedBy(allowFraction).Mul(currentOrientation).GetNormalized();
            }
          } // timeDiff_ms > 0

          movementHistoryEntry.orientation = currentOrientation;
          movementHistoryEntry.timeDiff_ms = timeDiff_ms;
        } else {
          const currentPosition = node.GetPosition();

          if (timeDiff_ms > 0 && beginBias > 0.01) {
            // PORT: the C++ computed a `currentMovement` here that was only used by commented-out code

            // smooth
            position = position.WithCoord(2, position.coords[2] * (1.0 - currentBias) + currentPosition.coords[2] * currentBias);

            // old version, use for now, until new version above is finished

            let maxMetersPerSec = 2.8; //1.8f
            if (this.GetVariable('outgoing_special_state') !== '') maxMetersPerSec = 6.0;
            const allowedDistance = maxMetersPerSec * (timeDiff_ms * 0.001);

            let newZ = position.coords[2] + basePos.coords[2];
            const desiredDistance = Math.abs(newZ - currentPosition.coords[2]);

            let zBias = 1.0;
            if (desiredDistance > allowedDistance) zBias = allowedDistance / desiredDistance;

            newZ = (newZ * zBias + currentPosition.coords[2] * (1.0 - zBias)) * beginBias + newZ * (1.0 - beginBias); // dual biasses ^_^ works like this: currentPosition influence only effective when beginbias > 0

            // /old version

            // only height
            position = position.Get2D().Add(new Vector3(0, 0, newZ));
          }

          movementHistoryEntry.position = currentPosition;
          movementHistoryEntry.timeDiff_ms = timeDiff_ms;
        }
      } // smoothing

      if (!isPlayer) {
        const currentOrientation = node.GetRotation();
        orientation = orientation.GetSameNeighborhood(currentOrientation).quat;
        node.SetRotation(orientation, false);
      } else {
        node.SetPosition(position.Add(basePos), false);
      }
    }

    // PORT: C++ called RecursiveUpdateSpatialData() on the root node here when updateSpatial was set;
    // the port's scene graph recomputes derived transforms lazily, so `updateSpatial` has nothing to do.
  }

  /** todo: offset does not yet work (only +1 and -1) */
  Shift(fromFrame: number, offset: number): void {
    if (offset === 1) {
      let somethingShifted = false;
      const animSize = this.nodeAnimations.length;
      for (let i = 0; i < animSize; i++) {
        const nodeAnimation = this.nodeAnimations[i];
        const newAnimation = new SortedIntMap<KeyFrame>();
        for (let k = 0; k < nodeAnimation.animation.frames.length; k++) {
          const keyFrame = nodeAnimation.animation.values[k];
          let frameNum = nodeAnimation.animation.frames[k];
          if (frameNum >= fromFrame) {
            frameNum++; // shift
            somethingShifted = true;
          }
          newAnimation.insert(frameNum, keyFrame);
        }
        nodeAnimation.animation = newAnimation;
      }

      if (somethingShifted) {
        this.frameCount++;
        this.DirtyCache();
      }
    }

    if (offset === -1) {
      let somethingShifted = false;
      const animSize = this.nodeAnimations.length;
      for (let i = 0; i < animSize; i++) {
        const nodeAnimation = this.nodeAnimations[i];
        const newAnimation = new SortedIntMap<KeyFrame>();
        for (let k = 0; k < nodeAnimation.animation.frames.length; k++) {
          const keyFrame = nodeAnimation.animation.values[k];
          let frameNum = nodeAnimation.animation.frames[k];
          if (frameNum !== fromFrame) {
            if (frameNum > fromFrame) {
              frameNum--; // shift
              somethingShifted = true;
            }
            newAnimation.insert(frameNum, keyFrame);
          }
        }
        nodeAnimation.animation = newAnimation;
      }

      if (somethingShifted) {
        this.frameCount--;
        this.DirtyCache();
      }
    }

    for (const extension of this.GetSortedExtensions()) {
      extension.Shift(fromFrame, offset);
    }
  }

  /** returns end position - start position */
  GetTranslation(): Vector3 {
    if (this.cache_translation_dirty) {
      const player = this.nodeAnimations[0].animation.values;
      this.cache_translation = player[player.length - 1].position.Sub(player[0].position);
      this.cache_translation = this.cache_translation.WithCoord(2, 0);
      this.cache_translation_dirty = false;
    }
    return this.cache_translation;
  }

  GetIncomingMovement(): Vector3 {
    // todo: check if correct with idle incoming velo + weird incoming body rot
    if (this.cache_incomingMovement_dirty) {
      const player = this.nodeAnimations[0].animation;
      if (player.size > 1) {
        this.cache_incomingMovement = player.values[1].position
          .Sub(player.values[0].position)
          .Div(player.frames[1] - player.frames[0] * 1.0)
          .Mul(100);
        this.cache_incomingMovement = this.cache_incomingMovement.WithCoord(2, 0);
      } else {
        this.cache_incomingMovement = new Vector3(0);
      }
      this.cache_incomingMovement_dirty = false;
    }
    return this.cache_incomingMovement;
  }

  GetIncomingVelocity(): number {
    if (this.cache_incomingVelocity_dirty) {
      const player = this.nodeAnimations[0].animation;
      if (player.size > 1) {
        let result = player.values[1].position
          .Sub(player.values[0].position)
          .Div(player.frames[1] - player.frames[0] * 1.0)
          .Mul(100);
        result = result.WithCoord(2, 0);
        this.cache_incomingVelocity = result.GetLength();
        if (this.cache_incomingVelocity < 1.8) this.cache_incomingVelocity = 0;
        else if (this.cache_incomingVelocity >= 1.8 && this.cache_incomingVelocity < 4.2) this.cache_incomingVelocity = 3.5;
        else if (this.cache_incomingVelocity >= 4.2 && this.cache_incomingVelocity < 6.0) this.cache_incomingVelocity = 5.0;
        else if (this.cache_incomingVelocity >= 6.0) this.cache_incomingVelocity = 7.0;
      } else {
        this.cache_incomingVelocity = 0;
      }
      this.cache_incomingVelocity_dirty = false;
    }
    return this.cache_incomingVelocity;
  }

  GetOutgoingMovement(): Vector3 {
    if (this.cache_outgoingMovement_dirty) {
      const player = this.nodeAnimations[0].animation;
      if (player.size > 1) {
        const last = player.size - 1;
        this.cache_outgoingMovement = player.values[last].position
          .Sub(player.values[last - 1].position)
          .Div(player.frames[last] - player.frames[last - 1] * 1.0)
          .Mul(100);
        this.cache_outgoingMovement = this.cache_outgoingMovement.WithCoord(2, 0);
      } else {
        this.cache_outgoingMovement = new Vector3(0);
      }

      this.cache_outgoingMovement_dirty = false;
    }
    return this.cache_outgoingMovement;
  }

  GetRangedOutgoingMovement(): Vector3 {
    if (this.cache_rangedOutgoingMovement_dirty || this.cache_outgoingVelocity_dirty || this.cache_angle_dirty) {
      if (this.nodeAnimations[0].animation.size > 1) {
        this.cache_rangedOutgoingMovement = new Vector3(0, -this.GetOutgoingVelocity(), 0).GetRotated2D(this.GetOutgoingAngle());
      } else {
        this.cache_rangedOutgoingMovement = new Vector3(0);
      }

      this.cache_rangedOutgoingMovement_dirty = false;
    }
    return this.cache_rangedOutgoingMovement;
  }

  GetOutgoingDirection(): Vector3 {
    if (this.cache_outgoingDirection_dirty || this.cache_angle_dirty) {
      this.cache_outgoingDirection = downVector.GetRotated2D(this.GetOutgoingAngle());
      this.cache_outgoingDirection_dirty = false;
    }
    return this.cache_outgoingDirection;
  }

  GetIncomingBodyDirection(): Vector3 {
    if (this.cache_incomingBodyDirection_dirty || this.cache_incomingBodyAngle_dirty) {
      this.cache_incomingBodyDirection = downVector.GetRotated2D(this.GetIncomingBodyAngle());
      this.cache_incomingBodyDirection_dirty = false;
    }
    return this.cache_incomingBodyDirection;
  }

  GetOutgoingBodyDirection(): Vector3 {
    if (this.cache_outgoingBodyDirection_dirty || this.cache_outgoingBodyAngle_dirty) {
      this.cache_outgoingBodyDirection = downVector.GetRotated2D(this.GetOutgoingBodyAngle());
      this.cache_outgoingBodyDirection_dirty = false;
    }
    return this.cache_outgoingBodyDirection;
  }

  GetOutgoingVelocity(): number {
    if (this.cache_outgoingVelocity_dirty) {
      const player = this.nodeAnimations[0].animation;
      if (player.size > 1) {
        const last = player.size - 1;
        let result = player.values[last].position
          .Sub(player.values[last - 1].position)
          .Div(player.frames[last] - player.frames[last - 1] * 1.0)
          .Mul(100);
        result = result.WithCoord(2, 0);
        this.cache_outgoingVelocity = result.GetLength();
        if (this.cache_outgoingVelocity < 1.8) this.cache_outgoingVelocity = 0.0;
        else if (this.cache_outgoingVelocity >= 1.8 && this.cache_outgoingVelocity < 4.2) this.cache_outgoingVelocity = 3.5;
        else if (this.cache_outgoingVelocity >= 4.2 && this.cache_outgoingVelocity < 6.0) this.cache_outgoingVelocity = 5.0;
        else if (this.cache_outgoingVelocity >= 6.0) this.cache_outgoingVelocity = 7.0;
      } else {
        this.cache_outgoingVelocity = 0;
      }
      this.cache_outgoingVelocity_dirty = false;
    }
    return this.cache_outgoingVelocity;
  }

  GetOutgoingAngle(): radian {
    if (this.cache_angle_dirty || this.cache_outgoingVelocity_dirty) {
      if (this.GetOutgoingVelocity() >= 1.8) {
        // full player rotation - last move
        const player = this.nodeAnimations[0].animation.values;
        const lastMoveVector = player[player.length - 1].position.Sub(player[player.length - 2].position);
        this.cache_angle = FixAngle(lastMoveVector.GetAngle2D(), true);

        // if angle is close to 180 degrees, we can't be sure if we want 180 or -180 deg. use body angle as hint.
        if (this.cache_angle < -0.95 * pi || this.cache_angle > 0.95 * pi) {
          const body = this.nodeAnimations[1].animation.values;
          const z = body[body.length - 1].orientation.GetAngles().Z;
          if (signSide(this.cache_angle) !== signSide(z)) {
            this.cache_angle = pi * 0.99 * signSide(z);
          } else {
            this.cache_angle = clamp(this.cache_angle, -0.99 * pi, 0.99 * pi); // also do this if the side is already correct: we want to be a little away from pi, else vectors based on this don't have a clear sidedness
          }
        }
      } else {
        if (this.nodeAnimations[1].animation.size > 0) {
          // body rotation
          const body = this.nodeAnimations[1].animation.values;
          this.cache_angle = body[body.length - 1].orientation.GetAngles().Z;

          this.cache_angle = ModulateIntoRange(-pi, pi, this.cache_angle);
        } else {
          this.cache_angle = 0;
        }
      }

      this.cache_angle_dirty = false;
    }
    return this.cache_angle;
  }

  GetIncomingBodyAngle(): radian {
    if (this.cache_incomingBodyAngle_dirty) {
      if (this.nodeAnimations[1].animation.size > 0) {
        // body rotation
        this.cache_incomingBodyAngle = this.nodeAnimations[1].animation.values[0].orientation.GetAngles().Z;

        this.cache_incomingBodyAngle = ModulateIntoRange(-pi, pi, this.cache_incomingBodyAngle);
      } else {
        this.cache_incomingBodyAngle = 0;
      }

      this.cache_incomingBodyAngle_dirty = false;
    }
    return this.cache_incomingBodyAngle;
  }

  GetOutgoingBodyAngle(): radian {
    if (this.cache_outgoingBodyAngle_dirty || this.cache_angle_dirty || this.cache_outgoingVelocity_dirty) {
      if (this.GetOutgoingVelocity() >= 1.8) {
        if (this.nodeAnimations[1].animation.size > 0) {
          // body rotation
          const body = this.nodeAnimations[1].animation.values;
          this.cache_outgoingBodyAngle = body[body.length - 1].orientation.GetAngles().Z;

          this.cache_outgoingBodyAngle -= this.GetOutgoingAngle();

          this.cache_outgoingBodyAngle = ModulateIntoRange(-pi, pi, this.cache_outgoingBodyAngle);
        } else {
          this.cache_outgoingBodyAngle = 0;
        }
      } else {
        this.cache_outgoingBodyAngle = 0;
      }

      this.cache_outgoingBodyAngle_dirty = false;
    }
    return this.cache_outgoingBodyAngle;
  }

  GetCurrentFoot(): e_Foot {
    return this.currentFoot;
  }

  GetOutgoingFoot(): e_Foot {
    const foot = this.GetVariable('steps');
    const curFoot = this.GetCurrentFoot();
    let steps = 1;
    if (foot !== '') {
      steps = atoi(foot);
    }
    if (is_odd(steps)) {
      if (curFoot === e_Foot.e_Foot_Left) {
        return e_Foot.e_Foot_Right;
      } else {
        return e_Foot.e_Foot_Left;
      }
    } else {
      if (curFoot === e_Foot.e_Foot_Right) {
        return e_Foot.e_Foot_Right;
      } else {
        return e_Foot.e_Foot_Left;
      }
    }
  }

  Reset(): void {
    this.customData = null;
    this.variableCache.clear();
    this.nodeAnimations = [];
    this.extensions.clear();
    this.frameCount = 0;

    this.DirtyCache();
  }

  LoadData(file: string[][]): void {
    for (let line = 0; line < file.length; line++) {
      const tokens = file[line];
      let key = 1;
      while (key < tokens.length) {
        const frame = Math.trunc(cround(atoi(tokens[key]) * 1.0));
        let orientation = Quaternion.IDENTITY;

        if (line !== 0) {
          // limbs, only rotations
          orientation = new Quaternion(atof(tokens[key + 1]), atof(tokens[key + 2]), atof(tokens[key + 3]), atof(tokens[key + 4]));

          key += 5;
        }

        let position = new Vector3(0);

        if (line === 0) {
          // player, only position
          position = new Vector3(atof(tokens[key + 1]), atof(tokens[key + 2]), atof(tokens[key + 3]));

          key += 4;
        }

        this.SetKeyFrame(tokens[0], frame, orientation, position);
      }
    }
  }

  Load(filename: string): void {
    this.name = filename;

    const file = file_to_vector(filename);

    const tokenizedFile: string[][] = [];
    let lastLine = 0;
    for (let i = 0; i < file.length; i++) {
      const tokenizedLine: string[] = [];
      tokenize(file[i], tokenizedLine, ',');
      // PORT: an empty line made the C++ throw (tokenizedLine.at(0)); it is skipped here
      if (tokenizedLine.length > 0) {
        if (tokenizedLine[0] === 'extension' || tokenizedLine[0].substring(0, 1) === '<') break;
        tokenizedFile.push(tokenizedLine);
      }
      lastLine = i + 1;
    }

    this.LoadData(tokenizedFile);

    // cache extension data
    const tokenizedLines: string[][] = [];

    for (let i = lastLine; i < file.length; i++) {
      const tokenizedLine: string[] = [];
      tokenize(file[i], tokenizedLine, ',');
      if (tokenizedLine.length > 0) {
        if (tokenizedLine[0] === 'extension') {
          tokenizedLines.push(tokenizedLine);
        } else {
          break;
        }
      }
      lastLine = i + 1;
    }

    // additional xml data
    let xmlData = '';
    for (let i = lastLine; i < file.length; i++) {
      xmlData += file[i];
    }
    const xmlLoader = new XMLLoader();
    const customData = xmlLoader.Load(xmlData);
    this.customData = customData;

    // load extension data
    for (let i = 0; i < tokenizedLines.length; i++) {
      const extension = this.extensions.get(tokenizedLines[i][1]);
      if (extension !== undefined) extension.Load(tokenizedLines[i]);
    }

    for (const varName of ['bumpdirection', 'balldirection', 'incomingballdirection']) {
      const tree = customData.Find(varName);
      if (tree !== undefined) {
        let direction = GetVectorFromString(tree.value);
        if (direction.GetLength() > 0) direction = direction.GetNormalized();
        tree.value = real_to_str(direction.coords[0]) + ',' + real_to_str(direction.coords[1]) + ',' + real_to_str(direction.coords[2]);
      }
    }

    // create variable cache
    for (const [varName, tree] of customData.children) {
      // std::map::insert: the first of equal keys wins
      if (!this.variableCache.has(varName)) this.variableCache.set(varName, tree.value);
    }

    this.cache_AnimType = this.variableCache.get('type') ?? '';

    this.ConvertToStartFacingForwardIfIdle();
  }

  /** PORT: the C++ wrote the file to disk; here it is stored in the in-memory FileSystem and the text is returned */
  Save(filename: string): string {
    const fileData: string[] = [];
    for (let i = 0; i < this.nodeAnimations.length; i++) {
      const nodeAnimation = this.nodeAnimations[i];
      let line = nodeAnimation.nodeName + ',';
      for (const [frame, keyFrame] of nodeAnimation.animation) {
        line += int_to_str(frame) + ','; // frame number
        if (nodeAnimation.nodeName !== 'player') {
          line += real_to_str(keyFrame.orientation.elements[0]) + ','; // X element
          line += real_to_str(keyFrame.orientation.elements[1]) + ','; // Y element
          line += real_to_str(keyFrame.orientation.elements[2]) + ','; // Z element
          line += real_to_str(keyFrame.orientation.elements[3]) + ','; // W element
        } else {
          line += real_to_str(keyFrame.position.coords[0]) + ','; // X pos
          line += real_to_str(keyFrame.position.coords[1]) + ','; // Y pos
          line += real_to_str(keyFrame.position.coords[2]) + ','; // Z pos
        }
      }
      line = line.substring(0, line.length - 1);
      fileData.push(line);
    }

    let text = '';
    for (let i = 0; i < fileData.length; i++) {
      text += fileData[i] + '\n';
    }

    for (const extension of this.GetSortedExtensions()) {
      text += extension.Save();
    }

    const loader = new XMLLoader();
    if (this.customData) text += loader.GetSource(this.customData);

    FileSystem.PutText(filename, text);
    return text;
  }

  Mirror(): void {
    this.name += '_mirror';
    this.currentFoot = this.currentFoot === e_Foot.e_Foot_Right ? e_Foot.e_Foot_Left : e_Foot.e_Foot_Right;

    for (let i = 0; i < this.nodeAnimations.length; i++) {
      if (this.nodeAnimations[i].nodeName.substring(0, 4) === 'left') {
        // find counterpart
        const needle = 'right' + this.nodeAnimations[i].nodeName.substring(4);

        for (let j = 0; j < this.nodeAnimations.length; j++) {
          if (this.nodeAnimations[j].nodeName === needle) {
            // swap
            const tmp = this.nodeAnimations[i].animation;
            this.nodeAnimations[i].animation = this.nodeAnimations[j].animation;
            this.nodeAnimations[j].animation = tmp;
            break;
          }
        }
      }
    }

    for (let i = 0; i < this.nodeAnimations.length; i++) {
      const keyFrames = this.nodeAnimations[i].animation.values;
      for (let k = 0; k < keyFrames.length; k++) {
        const keyFrame = keyFrames[k];
        if (i === 0) {
          keyFrame.position = keyFrame.position.WithCoord(0, -keyFrame.position.coords[0]);
        } else {
          const e = keyFrame.orientation.elements;
          keyFrame.orientation = new Quaternion(e[0], -e[1], -e[2], e[3]);
        }
      }
    }

    // extensions!
    for (const extension of this.GetSortedExtensions()) {
      extension.Mirror();
    }

    // variables
    for (const [varName, varData] of this.variableCache) {
      if (varData.substring(0, 4) === 'left') {
        this.variableCache.set(varName, 'right' + varData.substring(4));
      } else if (varData.substring(0, 5) === 'right') {
        this.variableCache.set(varName, 'left' + varData.substring(5));
      }
    }

    const mirrorVec = new Vector3(-1, 1, 1);
    const newBallDirVec = this.GetVariable('balldirection') !== '' ? GetVectorFromString(this.GetVariable('balldirection')).Mul(mirrorVec) : new Vector3(0);
    const newIncomingBallDirVec = this.GetVariable('incomingballdirection') !== '' ? GetVectorFromString(this.GetVariable('incomingballdirection')).Mul(mirrorVec) : new Vector3(0);
    const newBumpDirVec = this.GetVariable('bumpdirection') !== '' ? GetVectorFromString(this.GetVariable('bumpdirection')).Mul(mirrorVec) : new Vector3(0);
    this.SetVariable('balldirection', GetStringFromVector(newBallDirVec));
    this.SetVariable('incomingballdirection', GetStringFromVector(newIncomingBallDirVec));
    this.SetVariable('bumpdirection', GetStringFromVector(newBumpDirVec));

    this.DirtyCache();
  }

  GetName(): string {
    return this.name;
  }

  SetName(name: string): void {
    this.name = name;
  }

  AddExtension(name: string, extension: AnimationExtension): void {
    // std::map::insert: does not replace an existing extension
    if (!this.extensions.has(name)) this.extensions.set(name, extension);
  }

  /** callers cast like the C++ static_pointer_cast: `anim.GetExtension('football') as FootballAnimationExtension` */
  GetExtension(name: string): AnimationExtension {
    return this.extensions.get(name) as AnimationExtension;
  }

  /** returns '' when the variable does not exist */
  GetVariable(name: string): string {
    const value = this.variableCache.get(name);
    return value === undefined ? '' : value;
  }

  SetVariable(name: string, value: string): void {
    if (this.customData) {
      const tree = this.customData.Find(name);
      if (tree !== undefined) {
        tree.value = value;
      }
    }

    // flat list for speed, i guess, i should start documenting stuff earlier
    this.variableCache.set(name, value);
  }

  GetAnimType(): string {
    return this.cache_AnimType;
  }

  GetCustomData(): XMLTree | null {
    return this.customData;
  }

  /** quick edit hax (exaggerate everything); unused by the game */
  Hax(): void {
    for (let i = 0; i < this.nodeAnimations.length; i++) {
      const line = this.nodeAnimations[i].nodeName;
      if (line !== 'body') {
        const keyFrames = this.nodeAnimations[i].animation.values;
        for (let k = 0; k < keyFrames.length; k++) {
          const angles = keyFrames[k].orientation.GetAngles();
          let rotXa = angles.X;
          let rotYa = angles.Y;
          const rotZa = angles.Z;

          rotXa *= 1.1;
          rotYa *= 1.1;

          const rotX = Quaternion.FromAngleAxis(rotXa, new Vector3(1, 0, 0));
          const rotY = Quaternion.FromAngleAxis(rotYa, new Vector3(0, 1, 0));
          const rotZ = Quaternion.FromAngleAxis(rotZa, new Vector3(0, 0, 1));
          keyFrames[k].orientation = rotX.Mul(rotY).Mul(rotZ);
        }
      }
    }
  }

  GetNodeAnimations(): NodeAnimation[] {
    return this.nodeAnimations;
  }

  GetExtensions(): Map<string, AnimationExtension> {
    return this.extensions;
  }

  /** extensions in std::map (key) order */
  protected GetSortedExtensions(): AnimationExtension[] {
    if (this.extensions.size <= 1) return [...this.extensions.values()];
    return [...this.extensions.keys()].sort().map((key) => this.extensions.get(key) as AnimationExtension);
  }
}
