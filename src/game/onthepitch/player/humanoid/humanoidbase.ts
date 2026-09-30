// Port of legacy/src/onthepitch/player/humanoid/humanoidbase.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).
//
// The core of the player animation/movement system: selects motion captured animations, applies
// them to the joint node hierarchy, computes the resulting movement ("smuggling" the animation
// towards desired directions) and CPU-skins the full body mesh from the joints.

import { Quaternion, Vector3 } from '../../../../blunted/base/math/vector3';
import { ModulateIntoRange, NormalizedClamp, clamp, curve, pi, random, signSide, type radian } from '../../../../blunted/base/math/bluntmath';
import { assert } from '../../../../blunted/base/assert';
import { Log, e_FatalError } from '../../../../blunted/base/log';
import { GetVectorFromString, atof, atoi, int_to_str, real_to_str } from '../../../../blunted/base/utils';
import { ResourceManagerPool } from '../../../../blunted/managers/resourcemanagerpool';
import { Node } from '../../../../blunted/scene/node';
import { Geometry } from '../../../../blunted/scene/objects/geometry';
import { e_LocalMode_Absolute } from '../../../../blunted/scene/spatial';
import type { Scene3D } from '../../../../blunted/scene/scene3d';
import { GetTriangleMeshElementCount, type GeometryData, type MaterializedTriangleMesh } from '../../../../blunted/scene/resources/geometrydata';
import type { Resource } from '../../../../blunted/scene/resources/resource';
import type { Surface } from '../../../../blunted/scene/resources/surface';
import {
  Float32Key,
  PlayerCommand,
  _default_AccelerationFactor,
  _default_AgilityFactor,
  animSprintVelocity,
  defaultPlayerHeight,
  defaultTouchOffset_ms,
  dribbleVelocity,
  dribbleWalkSwitch,
  e_FunctionType,
  e_Velocity,
  idleDribbleSwitch,
  idleVelocity,
  sprintVelocity,
  walkSprintSwitch,
  walkVelocity,
  type DataSet,
  type PlayerCommandQueue,
} from '../../../gamedefines';
import { EnvironmentManager, GetConfiguration, GetScene3D, Verbose } from '../../../globals';
import { GetVelocityID, TemporalSmoother } from '../../../footballutils';
import { Animation, BiasedOffset, e_Foot, type MovementHistory, type NodeMap } from '../../../utils/animation';
import {
  CrudeSelectionQuery,
  EnumToFloatVelocity,
  FillNodeMap,
  FixAngle,
  FloatToEnumVelocity,
  RangeVelocity,
  type AnimCollection,
} from './animcollection';
import { CalculateBiasForFastCornering, CalculateMovementAtFrame, StretchSprintTo } from './humanoid_utils';
import type { PlayerBase } from '../playerbase';
import type { Match } from '../../match';
import type { MentalImage } from '../../AIsupport/mentalimage';

/** C++ typedef std::map<const std::string, boost::intrusive_ptr<Node> > NodeMap (defined in utils/animation.ts) */
export type { NodeMap };

export class Joint {
  node!: Node;
  position = new Vector3(0);
  orientation = Quaternion.IDENTITY;
  origPos = new Vector3(0);

  Clone(): Joint {
    return Object.assign(new Joint(), this);
  }
}

export class WeightedBone {
  jointID = 0;
  weight = 0;

  Clone(): WeightedBone {
    return Object.assign(new WeightedBone(), this);
  }
}

export class WeightedVertex {
  vertexID = 0;
  bones: WeightedBone[] = [];

  Clone(): WeightedVertex {
    const c = new WeightedVertex();
    c.vertexID = this.vertexID;
    c.bones = this.bones.map((b) => b.Clone());
    return c;
  }
}

/** C++ struct { float *data; int size; } */
export class FloatArray {
  data: Float32Array = new Float32Array(0);
  size = 0;

  /** like the C++ struct copy, the copy shares the data pointer */
  Clone(): FloatArray {
    return Object.assign(new FloatArray(), this);
  }
}

export enum e_InterruptAnim {
  e_InterruptAnim_None,
  e_InterruptAnim_Switch,
  e_InterruptAnim_Sliding,
  e_InterruptAnim_Bump,
  e_InterruptAnim_Trip,
  e_InterruptAnim_Cheat,
  e_InterruptAnim_Cancel,
  e_InterruptAnim_ReQueue,
}

export class RotationSmuggle {
  begin: radian = 0;
  end: radian = 0;

  /** C++ operator = (const float &value): sets both begin and end */
  Set(value: number): void {
    this.begin = value;
    this.end = value;
  }

  Clone(): RotationSmuggle {
    return Object.assign(new RotationSmuggle(), this);
  }
}

/** C++ copies this struct by value (`*previousAnim = *currentAnim`): use Clone() / CopyFrom() */
export class Anim {
  anim!: Animation;
  id = 0;
  frameNum = 0;

  functionType: e_FunctionType = e_FunctionType.e_FunctionType_None;

  originatingInterrupt: e_InterruptAnim = e_InterruptAnim.e_InterruptAnim_None;

  fullActionSmuggle = new Vector3(0); // without cheatdiscarddistance
  actionSmuggle = new Vector3(0);
  actionSmuggleOffset = new Vector3(0);
  actionSmuggleSustain = new Vector3(0);
  actionSmuggleSustainOffset = new Vector3(0);
  movementSmuggle = new Vector3(0);
  movementSmuggleOffset = new Vector3(0);
  rotationSmuggle = new RotationSmuggle();
  rotationSmuggleOffset: radian = 0;
  touchFrame = -1;
  radiusOffset = 0.0;
  touchPos = new Vector3(0);

  incomingMovement = new Vector3(0);
  outgoingMovement = new Vector3(0);

  positionOffset = new Vector3(0);

  originatingCommand = new PlayerCommand();

  positions: Vector3[] = [];

  /** C++ `*this = src` (struct assignment): deep copies src into this object */
  CopyFrom(src: Anim): void {
    this.anim = src.anim;
    this.id = src.id;
    this.frameNum = src.frameNum;
    this.functionType = src.functionType;
    this.originatingInterrupt = src.originatingInterrupt;
    this.fullActionSmuggle = src.fullActionSmuggle;
    this.actionSmuggle = src.actionSmuggle;
    this.actionSmuggleOffset = src.actionSmuggleOffset;
    this.actionSmuggleSustain = src.actionSmuggleSustain;
    this.actionSmuggleSustainOffset = src.actionSmuggleSustainOffset;
    this.movementSmuggle = src.movementSmuggle;
    this.movementSmuggleOffset = src.movementSmuggleOffset;
    this.rotationSmuggle = src.rotationSmuggle.Clone();
    this.rotationSmuggleOffset = src.rotationSmuggleOffset;
    this.touchFrame = src.touchFrame;
    this.radiusOffset = src.radiusOffset;
    this.touchPos = src.touchPos;
    this.incomingMovement = src.incomingMovement;
    this.outgoingMovement = src.outgoingMovement;
    this.positionOffset = src.positionOffset;
    this.originatingCommand = src.originatingCommand.Clone();
    this.positions = src.positions.slice();
  }

  Clone(): Anim {
    const c = new Anim();
    c.CopyFrom(this);
    return c;
  }
}

export class IdealAnimDescription {
  foot: e_Foot = e_Foot.e_Foot_Left;
  incomingVelocityFloat = 0.0;
  outgoingMovementRel = new Vector3(0, 0, 0);
  incomingBodyDirectionRel = new Vector3(0, -1, 0);
  desiredLookAtAbs = new Vector3(0, 0, 0);
  baseAnim = false;

  Clone(): IdealAnimDescription {
    return Object.assign(new IdealAnimDescription(), this);
  }
}

function CloneOffsets(offsets: Map<string, BiasedOffset>): Map<string, BiasedOffset> {
  const copy = new Map<string, BiasedOffset>();
  for (const [name, offset] of offsets) copy.set(name, offset.Clone());
  return copy;
}

/** C++ copies this struct by value: use Clone() */
export class AnimApplyBuffer {
  anim!: Animation;
  frameNum = 0;
  snapshotTime_ms = 0;
  smooth = true;
  smoothFactor = 0.5;
  noPos = false;
  position = new Vector3(0);
  orientation: radian = 0;
  offsets = new Map<string, BiasedOffset>();

  Clone(): AnimApplyBuffer {
    const c = new AnimApplyBuffer();
    c.anim = this.anim;
    c.frameNum = this.frameNum;
    c.snapshotTime_ms = this.snapshotTime_ms;
    c.smooth = this.smooth;
    c.smoothFactor = this.smoothFactor;
    c.noPos = this.noPos;
    c.position = this.position;
    c.orientation = this.orientation;
    c.offsets = CloneOffsets(this.offsets);
    return c;
  }
}

export class TemporalHumanoidNode {
  actualNode!: Node;
  cachedPosition = new Vector3(0);
  cachedOrientation = Quaternion.IDENTITY;
  position = new TemporalSmoother<Vector3>(new Vector3(0));
  orientation = new TemporalSmoother<Quaternion>(Quaternion.IDENTITY);
}

export class SpatialState {
  position = new Vector3(0);
  angle: radian = 0;
  directionVec = new Vector3(0); // for efficiency, vector version of angle
  enumVelocity: e_Velocity = e_Velocity.e_Velocity_Idle;
  floatVelocity = 0; // for efficiency, float version

  actualMovement = new Vector3(0);
  physicsMovement = new Vector3(0); // ignores effects like positionoffset
  animMovement = new Vector3(0);
  movement = new Vector3(0); // one of the above (default)
  actionSmuggleMovement = new Vector3(0);
  movementSmuggleMovement = new Vector3(0);
  positionOffsetMovement = new Vector3(0);

  bodyAngle: radian = 0;
  bodyDirectionVec = new Vector3(0); // for efficiency, vector version of bodyAngle
  relBodyAngleNonquantized: radian = 0;
  relBodyAngle: radian = 0;
  relBodyDirectionVec = new Vector3(0); // for efficiency, vector version of relBodyAngle
  relBodyDirectionVecNonquantized = new Vector3(0);
  foot: e_Foot = e_Foot.e_Foot_Left;

  Clone(): SpatialState {
    return Object.assign(new SpatialState(), this);
  }
}

export const emptyVec = new Vector3(0);

const bodyRotationSmoothingFactor = 1.0;
const bodyRotationSmoothingMaxAngle = 0.25 * pi;
const initialReQueueDelayFrames = 32;

/** shared immutable (0, -1, 0): the 'forward' direction in anim space */
const DOWN = new Vector3(0, -1, 0);

function FillTemporalHumanoidNodes(targetNode: Node, temporalHumanoidNodes: TemporalHumanoidNode[]): void {
  const temporalHumanoidNode = new TemporalHumanoidNode();
  temporalHumanoidNode.actualNode = targetNode;
  temporalHumanoidNode.cachedPosition = targetNode.GetPosition();
  temporalHumanoidNode.cachedOrientation = targetNode.GetRotation();
  // initial values, not sure if really needed
  temporalHumanoidNode.position.SetValue(targetNode.GetPosition(), EnvironmentManager.GetInstance().GetTime_ms());
  temporalHumanoidNode.orientation.SetValue(targetNode.GetRotation(), EnvironmentManager.GetInstance().GetTime_ms());
  temporalHumanoidNodes.push(temporalHumanoidNode);

  const gatherNodes: Node[] = [];
  targetNode.GetNodes(gatherNodes);
  for (let i = 0; i < gatherNodes.length; i++) {
    FillTemporalHumanoidNodes(gatherNodes[i], temporalHumanoidNodes);
  }
}

// ----- fullbody model preparation cache
// PORT: the C++ computed the unique vertex list (O(n^2) linear search), the unique indices and the
// bone weights for every player. They only depend on the source fullbody mesh and the vertex color
// (bone weight) map, so they are computed once per (source geometry, colorCoords) and shared
// (read-only) by all players. Each player still gets its own vertex buffers.

interface FullbodySubgeomData {
  /** unique vertices, all 5 element blocks, NOT yet multiplied by zMultiplier */
  uniqueMesh: Float32Array;
  /** per source vertex: index into the unique vertices (C++ int *uniqueIndices) */
  uniqueIndices: Int32Array;
  weightedVertices: WeightedVertex[];
  /** weightedVertices flattened for the skinning loop */
  skinVertexIDs: Int32Array;
  /** bones of vertex v are [skinBoneStart[v], skinBoneStart[v + 1]) */
  skinBoneStart: Int32Array;
  skinBoneJoint: Int32Array;
  skinBoneWeight: Float32Array;
}

const fullbodyModelCache = new WeakMap<GeometryData, WeakMap<Map<string, Vector3>, FullbodySubgeomData[]>>();

function BuildFullbodySubgeomData(mesh: MaterializedTriangleMesh, colorCoords: Map<string, Vector3>): FullbodySubgeomData {
  const elementCount = GetTriangleMeshElementCount();
  const meshData = mesh.vertices;
  const elementOffset = Math.trunc(mesh.verticesDataSize / elementCount); // was: fullbodyMeshSize
  const texOffset = elementOffset * 2;

  // generate list of unique vertices and an array linking vertexIDs with uniqueVertexIDs
  // PORT: map lookup on (position, texcoord) instead of the linear search; yields the same first-occurrence indices
  const uniqueIndices = new Int32Array(Math.trunc(elementOffset / 3));
  const uniqueSources: number[] = []; // source offset (v) of the first occurrence of each unique vertex
  const lookup = new Map<string, number>();
  for (let v = 0; v < elementOffset; v += 3) {
    // texcoord also needs to be shared
    const key =
      meshData[v] + ',' + meshData[v + 1] + ',' + meshData[v + 2] + '|' +
      meshData[v + texOffset] + ',' + meshData[v + texOffset + 1] + ',' + meshData[v + texOffset + 2];
    let index = lookup.get(key);
    if (index === undefined) {
      index = uniqueSources.length;
      uniqueSources.push(v);
      lookup.set(key, index);
    }
    uniqueIndices[v / 3] = index;
  }

  const uniqueSize = uniqueSources.length * 3 * elementCount;
  const uniqueMesh = new Float32Array(uniqueSize);
  const uniqueElementOffset = uniqueSize / elementCount;

  for (let u = 0; u < uniqueSources.length; u++) {
    const v = uniqueSources[u];
    for (let e = 0; e < elementCount; e++) {
      uniqueMesh[u * 3 + e * uniqueElementOffset + 0] = meshData[v + e * elementOffset + 0];
      uniqueMesh[u * 3 + e * uniqueElementOffset + 1] = meshData[v + e * elementOffset + 1];
      uniqueMesh[u * 3 + e * uniqueElementOffset + 2] = meshData[v + e * elementOffset + 2];
    }
  }

  const weightedVertices: WeightedVertex[] = [];
  let boneCount = 0;
  for (let v = 0; v < uniqueElementOffset; v += 3) {
    const weightedVertex = new WeightedVertex();
    weightedVertex.vertexID = v / 3;

    let color = colorCoords.get(Float32Key(uniqueMesh[v], uniqueMesh[v + 1], uniqueMesh[v + 2]));
    if (color === undefined) {
      console.warn(`color coord not found: ${real_to_str(uniqueMesh[v])}, ${real_to_str(uniqueMesh[v + 1])}, ${real_to_str(uniqueMesh[v + 2])}`);
      assert(false, 'HumanoidBase::PrepareFullbodyModel: color coord not found');
      // PORT: C++ dereferenced end() here (undefined behaviour); bind the vertex fully to joint 0 instead
      color = new Vector3(9, 0, 0);
    }

    let totalWeight = 0.0;
    const weightedBones = [new WeightedBone(), new WeightedBone(), new WeightedBone()];
    for (let c = 0; c < 3; c++) {
      const jointID = Math.floor(color.coords[c] * 0.1);
      const weight = (color.coords[c] - jointID * 10.0) / 9.0;

      weightedBones[c].jointID = jointID;
      weightedBones[c].weight = weight;

      totalWeight += weight;
    }

    // total weight has to be 1.0;
    for (let c = 0; c < 3; c++) {
      if (c === 0) {
        if (weightedBones[c].weight === 0) {
          console.warn(`offending jointID: ${weightedBones[c].jointID} (coord ${c}) (vertexpos ${uniqueMesh[v]}, ${uniqueMesh[v + 1]}, ${uniqueMesh[v + 2]})`);
        }
        assert(weightedBones[c].weight !== 0, 'HumanoidBase::PrepareFullbodyModel: zero weight for first bone');
      }
      if (weightedBones[c].weight > 0.01) {
        weightedBones[c].weight /= totalWeight;
        weightedVertex.bones.push(weightedBones[c]);
      }
    }

    boneCount += weightedVertex.bones.length;
    weightedVertices.push(weightedVertex);
  }

  const skinVertexIDs = new Int32Array(weightedVertices.length);
  const skinBoneStart = new Int32Array(weightedVertices.length + 1);
  const skinBoneJoint = new Int32Array(boneCount);
  const skinBoneWeight = new Float32Array(boneCount);
  let b = 0;
  for (let v = 0; v < weightedVertices.length; v++) {
    skinVertexIDs[v] = weightedVertices[v].vertexID;
    skinBoneStart[v] = b;
    for (const bone of weightedVertices[v].bones) {
      skinBoneJoint[b] = bone.jointID;
      skinBoneWeight[b] = bone.weight;
      b++;
    }
  }
  skinBoneStart[weightedVertices.length] = b;

  return { uniqueMesh, uniqueIndices, weightedVertices, skinVertexIDs, skinBoneStart, skinBoneJoint, skinBoneWeight };
}

function GetFullbodyModelData(sourceGeometryData: GeometryData, colorCoords: Map<string, Vector3>): FullbodySubgeomData[] {
  let perColorCoords = fullbodyModelCache.get(sourceGeometryData);
  if (!perColorCoords) {
    perColorCoords = new WeakMap();
    fullbodyModelCache.set(sourceGeometryData, perColorCoords);
  }
  let data = perColorCoords.get(colorCoords);
  if (!data) {
    data = sourceGeometryData.GetTriangleMeshesRef().map((mesh) => BuildFullbodySubgeomData(mesh, colorCoords));
    perColorCoords.set(colorCoords, data);
  }
  return data;
}

export class HumanoidBase {
  constructor(
    player: PlayerBase,
    match: Match,
    humanoidSourceNode: Node,
    fullbodySourceNode: Node,
    colorCoords: Map<string, Vector3>,
    animCollection: AnimCollection,
    fullbodyTargetNode: Node,
    kit: Resource<Surface> | null,
    bodyUpdatePhaseOffset: number,
  ) {
    this.fullbodyTargetNode = fullbodyTargetNode;
    this.match = match;
    this.player = player;
    this.anims = animCollection;
    this.buf_bodyUpdatePhaseOffset = bodyUpdatePhaseOffset;

    this.interruptAnim = e_InterruptAnim.e_InterruptAnim_None;
    this.reQueueDelayFrames = 0;

    this.buf_LowDetailMode = false;
    this.fetchedbuf_previousSnapshotTime_ms = 0;

    this.currentAnim = new Anim();
    this.previousAnim = new Anim();

    this.decayingPositionOffset = new Vector3(0);
    this.decayingDifficultyFactor = 0.0;

    this._cache_AgilityFactor = GetConfiguration().GetReal('gameplay_agilityfactor', _default_AgilityFactor);
    this._cache_AccelerationFactor = GetConfiguration().GetReal('gameplay_accelerationfactor', _default_AccelerationFactor);

    this.allowedBodyDirVecs.push(new Vector3(0, -1, 0));
    this.allowedBodyDirVecs.push(new Vector3(0, -1, 0).GetRotated2D(-0.25 * pi));
    this.allowedBodyDirVecs.push(new Vector3(0, -1, 0).GetRotated2D(0.25 * pi));
    this.allowedBodyDirVecs.push(new Vector3(0, -1, 0).GetRotated2D(-0.75 * pi));
    this.allowedBodyDirVecs.push(new Vector3(0, -1, 0).GetRotated2D(0.75 * pi));

    this.allowedBodyDirAngles.push(0 * pi);
    this.allowedBodyDirAngles.push(0.25 * pi);
    this.allowedBodyDirAngles.push(-0.25 * pi);
    this.allowedBodyDirAngles.push(0.75 * pi);
    this.allowedBodyDirAngles.push(-0.75 * pi);

    this.preferredDirectionVecs.push(new Vector3(0, -1, 0));
    this.preferredDirectionVecs.push(new Vector3(0, -1, 0).GetRotated2D(0.111 * pi));
    this.preferredDirectionVecs.push(new Vector3(0, -1, 0).GetRotated2D(-0.111 * pi));
    this.preferredDirectionVecs.push(new Vector3(0, -1, 0).GetRotated2D(0.25 * pi));
    this.preferredDirectionVecs.push(new Vector3(0, -1, 0).GetRotated2D(-0.25 * pi));
    this.preferredDirectionVecs.push(new Vector3(0, -1, 0).GetRotated2D(0.5 * pi));
    this.preferredDirectionVecs.push(new Vector3(0, -1, 0).GetRotated2D(-0.5 * pi));
    this.preferredDirectionVecs.push(new Vector3(0, -1, 0).GetRotated2D(0.75 * pi));
    this.preferredDirectionVecs.push(new Vector3(0, -1, 0).GetRotated2D(-0.75 * pi));
    this.preferredDirectionVecs.push(new Vector3(0, -1, 0).GetRotated2D(0.999 * pi));
    this.preferredDirectionVecs.push(new Vector3(0, -1, 0).GetRotated2D(-0.999 * pi));

    this.preferredDirectionAngles.push(0 * pi);
    this.preferredDirectionAngles.push(0.111 * pi); // 20
    this.preferredDirectionAngles.push(-0.111 * pi);
    this.preferredDirectionAngles.push(0.25 * pi); // 45
    this.preferredDirectionAngles.push(-0.25 * pi);
    this.preferredDirectionAngles.push(0.5 * pi); // 90
    this.preferredDirectionAngles.push(-0.5 * pi);
    this.preferredDirectionAngles.push(0.75 * pi); // 135
    this.preferredDirectionAngles.push(-0.75 * pi);
    this.preferredDirectionAngles.push(0.999 * pi); // 180
    this.preferredDirectionAngles.push(-0.999 * pi);

    assert(match);

    const playerHeight = player.GetPlayerData().GetHeight();
    this.zMultiplier = (1.0 / defaultPlayerHeight) * playerHeight;

    this.humanoidNode = Node.Copy(humanoidSourceNode, '');
    this.humanoidNode.SetLocalMode(e_LocalMode_Absolute);

    const skin = ResourceManagerPool.GetInstance().FetchSurface(
      'media/objects/players/textures/skin0' + int_to_str(player.GetPlayerData().GetSkinColor()) + '.png',
      true,
      true,
    );

    this.fullbodyNode = Node.Copy(fullbodySourceNode, int_to_str(player.GetID()));
    this.fullbodyNode.SetLocalMode(e_LocalMode_Absolute);
    fullbodyTargetNode.AddNode(this.fullbodyNode);

    const fullbodyGeometry = this.fullbodyNode.GetObject('fullbody') as Geometry;
    const tmesh = fullbodyGeometry.GetGeometryData().GetResource().GetTriangleMeshesRef();
    for (let i = 0; i < tmesh.length; i++) {
      const diffuseTexture = tmesh[i].material.diffuseTexture;
      if (diffuseTexture !== null) {
        if (diffuseTexture.GetIdentString() === 'skin.jpg') {
          tmesh[i].material.diffuseTexture = skin;
          tmesh[i].material.specular_amount = 0.002;
          tmesh[i].material.shininess = 0.2;
        }
      }
    }

    fullbodyGeometry.OnUpdateGeometryData();

    this.kitDiffuseTextureIdentString = 'kit_template.png';
    this.SetKit(kit);

    this.scene3D = GetScene3D();

    FillNodeMap(this.humanoidNode, this.nodeMap);
    FillTemporalHumanoidNodes(this.humanoidNode, this.buf_TemporalHumanoidNodes);

    // PORT: the unique vertex / bone weight data is computed from (and cached per) the pristine source mesh
    this._fullbodySourceGeometryData = (fullbodySourceNode.GetObject('fullbody') as Geometry).GetGeometryData().GetResource();
    this.PrepareFullbodyModel(colorCoords);
    this.buf_bodyUpdatePhase = 0;

    // hairstyle

    // (the hairstyle geometry data is shared by all players with that hairstyle; like the C++ renderer, each Geometry
    // object keeps the materials as they were at its own OnUpdateGeometryData(), see Geometry.materialsSnapshot)
    const geometry = ResourceManagerPool.GetInstance().FetchGeometryData('media/objects/players/hairstyles/' + player.GetPlayerData().GetHairStyle() + '.ase', true, true);
    this.hairStyle = new Geometry('hairstyle');

    this.hairStyle.SetLocalMode(e_LocalMode_Absolute);
    this.hairStyle.SetGeometryData(geometry);
    fullbodyTargetNode.AddObject(this.hairStyle);

    const hairTexture = ResourceManagerPool.GetInstance().FetchSurface(
      'media/objects/players/textures/hair/' + player.GetPlayerData().GetHairColor() + '.png',
      true,
      true,
    );

    const hairtmesh = this.hairStyle.GetGeometryData().GetResource().GetTriangleMeshesRef();

    for (let i = 0; i < hairtmesh.length; i++) {
      if (hairtmesh[i].material.diffuseTexture !== null) {
        hairtmesh[i].material.diffuseTexture = hairTexture;
        hairtmesh[i].material.specular_amount = 0.01;
        hairtmesh[i].material.shininess = 0.05;
      }
    }
    this.hairStyle.OnUpdateGeometryData();

    this.ResetPosition(new Vector3(0), new Vector3(0));

    this.currentMentalImage = null;
  }

  /** C++ destructor ~HumanoidBase() */
  Exit(): void {
    if (Verbose()) console.debug('exiting humanoidbase.. ');
    const fullbodyIdent = (this.fullbodyNode.GetObject('fullbody') as Geometry | null)?.GetGeometryData().GetIdentString();

    this.humanoidNode.Exit();
    this.fullbodyTargetNode.DeleteNode(this.fullbodyNode);
    this.fullbodyTargetNode.DeleteObject(this.hairStyle);

    this.buf_TemporalHumanoidNodes = [];

    this.uniqueFullbodyMesh = [];
    this.uniqueIndicesVec = [];
    this._skinData = [];

    // PORT: the C++ resource manager dropped the per-player fullbody geometry copy once unreferenced (RemoveUnused);
    // purge it explicitly so copies do not pile up in the resource cache over a career.
    ResourceManagerPool.GetInstance().Purge((name) => name === fullbodyIdent);

    if (Verbose()) console.debug('done');
  }

  PrepareFullbodyModel(colorCoords: Map<string, Vector3>): void {
    if (Verbose()) console.debug('prepare full body model.. ');

    // base anim with default angles - all anims' joints will be inversely rotated by the joints in this anim. this way, the fullbody mesh doesn't need to have 0 degree angles
    const baseAnim = new Animation();
    baseAnim.Load('media/animations/base.anim.util');
    const animApplyBuffer = new AnimApplyBuffer();
    animApplyBuffer.anim = baseAnim;
    animApplyBuffer.frameNum = 0;
    animApplyBuffer.smooth = false;
    animApplyBuffer.smoothFactor = 0.0;
    animApplyBuffer.position = new Vector3(0);
    animApplyBuffer.orientation = 0;
    animApplyBuffer.offsets.clear();
    // the C++ call passed (..., offsets, 0, false, true), which binds to movementHistory = none, timeDiff_ms = 0, noPos = true
    animApplyBuffer.anim.Apply(this.nodeMap, animApplyBuffer.frameNum, 0, animApplyBuffer.smooth, animApplyBuffer.smoothFactor, animApplyBuffer.position, animApplyBuffer.orientation, animApplyBuffer.offsets, null, 0, true);
    const jointsVec: Node[] = [];
    this.humanoidNode.GetNodes(jointsVec, true);

    // joints

    for (let i = 0; i < jointsVec.length; i++) {
      const joint = new Joint();
      joint.node = jointsVec[i];
      joint.origPos = jointsVec[i].GetDerivedPosition();
      this.joints.push(joint);
    }
    this._jointTransforms = new Float64Array(this.joints.length * 12);

    const fullbodyGeometry = this.fullbodyNode.GetObject('fullbody') as Geometry;
    const materializedTriangleMeshes = fullbodyGeometry.GetGeometryData().GetResource().GetTriangleMeshesRef();

    this.fullbodySubgeomCount = materializedTriangleMeshes.length;

    const sourceData = GetFullbodyModelData(this._fullbodySourceGeometryData ?? fullbodyGeometry.GetGeometryData().GetResource(), colorCoords);
    assert(sourceData.length === this.fullbodySubgeomCount, 'HumanoidBase::PrepareFullbodyModel: subgeom count mismatch');

    for (let subgeom = 0; subgeom < this.fullbodySubgeomCount; subgeom++) {
      const data = sourceData[subgeom];

      this.weightedVerticesVec.push(data.weightedVertices);

      const uniqueMesh = new FloatArray();
      uniqueMesh.size = data.uniqueMesh.length;
      uniqueMesh.data = new Float32Array(data.uniqueMesh);

      const uniqueElementOffset = uniqueMesh.size / GetTriangleMeshElementCount();
      for (let i = 0; i < uniqueElementOffset; i++) {
        uniqueMesh.data[i] *= this.zMultiplier;
      }

      this.uniqueFullbodyMesh.push(uniqueMesh);
      this.uniqueIndicesVec.push(data.uniqueIndices);
      this._skinData.push(data);

      // update geometry object so that it uses indices & shared vertices

      const mesh = materializedTriangleMeshes[subgeom];
      mesh.vertices = new Float32Array(uniqueMesh.data);
      mesh.verticesDataSize = uniqueMesh.size;
      mesh.indices = Array.from(data.uniqueIndices);
    } // subgeom

    fullbodyGeometry.OnUpdateGeometryData();

    for (let i = 0; i < this.joints.length; i++) {
      this.joints[i].orientation = jointsVec[i].GetDerivedRotation().GetInverse().GetNormalized();
    }

    const straightAnim = new Animation();
    straightAnim.Load('media/animations/straight.anim.util');
    animApplyBuffer.anim = straightAnim;
    animApplyBuffer.anim.Apply(this.nodeMap, animApplyBuffer.frameNum, 0, animApplyBuffer.smooth, animApplyBuffer.smoothFactor, animApplyBuffer.position, animApplyBuffer.orientation, animApplyBuffer.offsets, null, 0, true);

    for (let i = 0; i < this.joints.length; i++) {
      this.joints[i].position = jointsVec[i].GetDerivedPosition();
    }

    this.UpdateFullbodyModel(true);
    fullbodyGeometry.OnUpdateGeometryData(false);

    for (let i = 0; i < this.joints.length; i++) {
      this.joints[i].origPos = jointsVec[i].GetDerivedPosition();
    }
  }

  UpdateFullbodyNodes(): void {
    this.fullbodyOffset = this.humanoidNode.GetPosition().Get2D();
    this.fullbodyNode.SetPosition(this.fullbodyOffset);

    for (let i = 0; i < this.joints.length; i++) {
      this.joints[i].orientation = this.joints[i].node.GetDerivedRotation();
      this.joints[i].position = this.joints[i].node.GetDerivedPosition().Sub(this.fullbodyOffset);
    }

    // todo: something is wrong with the hairdo update logic, so just always update now
    // PORT: RecursiveUpdateSpatialData calls are gone; derived transforms are recomputed lazily
    this.hairStyle.SetRotation(this.joints[2].orientation, false);
    this.hairStyle.SetPosition(this.joints[2].position.Mul(this.zMultiplier).Add(this.fullbodyOffset), false);
  }

  NeedsModelUpdate(): boolean {
    if (this.buf_LowDetailMode && this.buf_bodyUpdatePhase !== 1 - this.buf_bodyUpdatePhaseOffset) return false;
    else return true;
  }

  /**
   * CPU skinning: writes the skinned positions/normals/tangents/bitangents into the fullbody geometry's vertex
   * array in place. The caller uploads it via geometry.OnUpdateGeometryData(false).
   * PORT: the per-vertex quaternion rotations are replaced by per-joint 3x3 matrices (computed once per call)
   * that are algebraically identical to the C++ Vector3::Rotate(quat) formula; the loop is allocation-free.
   */
  UpdateFullbodyModel(updateSrc = false): void {
    const fullbodyGeometry = this.fullbodyNode.GetObject('fullbody') as Geometry;
    const materializedTriangleMeshes = fullbodyGeometry.GetGeometryData().GetResource().GetTriangleMeshesRef();

    // per joint: M (rotation by joint orientation, 9) and t = position * z - M * (origPos * z) (3)
    const jt = this._jointTransforms;
    const z = this.zMultiplier;
    for (let j = 0; j < this.joints.length; j++) {
      const joint = this.joints[j];
      const q = joint.orientation.elements;
      const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
      // v' = v + 2w (q x v) + 2 q x (q x v)  ==  M v
      const d = 1.0 - 2.0 * (qx * qx + qy * qy + qz * qz);
      const m0 = d + 2.0 * qx * qx, m1 = 2.0 * (qx * qy - qw * qz), m2 = 2.0 * (qx * qz + qw * qy);
      const m3 = 2.0 * (qx * qy + qw * qz), m4 = d + 2.0 * qy * qy, m5 = 2.0 * (qy * qz - qw * qx);
      const m6 = 2.0 * (qx * qz - qw * qy), m7 = 2.0 * (qy * qz + qw * qx), m8 = d + 2.0 * qz * qz;
      const o = joint.origPos.coords;
      const p = joint.position.coords;
      const ox = o[0] * z, oy = o[1] * z, oz = o[2] * z;
      const base = j * 12;
      jt[base + 0] = m0; jt[base + 1] = m1; jt[base + 2] = m2;
      jt[base + 3] = m3; jt[base + 4] = m4; jt[base + 5] = m5;
      jt[base + 6] = m6; jt[base + 7] = m7; jt[base + 8] = m8;
      jt[base + 9] = p[0] * z - (m0 * ox + m1 * oy + m2 * oz);
      jt[base + 10] = p[1] * z - (m3 * ox + m4 * oy + m5 * oz);
      jt[base + 11] = p[2] * z - (m6 * ox + m7 * oy + m8 * oz);
    }

    for (let subgeom = 0; subgeom < this.fullbodySubgeomCount; subgeom++) {
      const uniqueMesh = this.uniqueFullbodyMesh[subgeom];
      const skin = this._skinData[subgeom];
      const src = uniqueMesh.data;
      const dst = materializedTriangleMeshes[subgeom].vertices;

      const vertexIDs = skin.skinVertexIDs;
      const boneStart = skin.skinBoneStart;
      const boneJoint = skin.skinBoneJoint;
      const boneWeight = skin.skinBoneWeight;

      const uniqueVertexCount = vertexIDs.length;

      const off1 = uniqueMesh.size / GetTriangleMeshElementCount();
      const off3 = off1 * 3;
      const off4 = off1 * 4;

      for (let v = 0; v < uniqueVertexCount; v++) {
        const i = vertexIDs[v] * 3;
        const vx = src[i], vy = src[i + 1], vz = src[i + 2];
        const nx = src[i + off1], ny = src[i + off1 + 1], nz = src[i + off1 + 2];
        const tx = src[i + off3], ty = src[i + off3 + 1], tz = src[i + off3 + 2];
        const bx = src[i + off4], by = src[i + off4 + 1], bz = src[i + off4 + 2];

        let rvx: number, rvy: number, rvz: number;
        let rnx: number, rny: number, rnz: number;
        let rtx: number, rty: number, rtz: number;
        let rbx: number, rby: number, rbz: number;

        const b0 = boneStart[v];
        const b1 = boneStart[v + 1];

        if (b1 - b0 === 1) {
          const m = boneJoint[b0] * 12;
          const m0 = jt[m], m1 = jt[m + 1], m2 = jt[m + 2], m3 = jt[m + 3], m4 = jt[m + 4], m5 = jt[m + 5], m6 = jt[m + 6], m7 = jt[m + 7], m8 = jt[m + 8];

          rvx = m0 * vx + m1 * vy + m2 * vz + jt[m + 9];
          rvy = m3 * vx + m4 * vy + m5 * vz + jt[m + 10];
          rvz = m6 * vx + m7 * vy + m8 * vz + jt[m + 11];

          rnx = m0 * nx + m1 * ny + m2 * nz;
          rny = m3 * nx + m4 * ny + m5 * nz;
          rnz = m6 * nx + m7 * ny + m8 * nz;

          rtx = m0 * tx + m1 * ty + m2 * tz;
          rty = m3 * tx + m4 * ty + m5 * tz;
          rtz = m6 * tx + m7 * ty + m8 * tz;

          rbx = m0 * bx + m1 * by + m2 * bz;
          rby = m3 * bx + m4 * by + m5 * bz;
          rbz = m6 * bx + m7 * by + m8 * bz;
        } else {
          rvx = 0; rvy = 0; rvz = 0;
          rnx = 0; rny = 0; rnz = 0;
          rtx = 0; rty = 0; rtz = 0;
          rbx = 0; rby = 0; rbz = 0;

          for (let b = b0; b < b1; b++) {
            const m = boneJoint[b] * 12;
            const w = boneWeight[b];
            const m0 = jt[m], m1 = jt[m + 1], m2 = jt[m + 2], m3 = jt[m + 3], m4 = jt[m + 4], m5 = jt[m + 5], m6 = jt[m + 6], m7 = jt[m + 7], m8 = jt[m + 8];

            rvx += (m0 * vx + m1 * vy + m2 * vz + jt[m + 9]) * w;
            rvy += (m3 * vx + m4 * vy + m5 * vz + jt[m + 10]) * w;
            rvz += (m6 * vx + m7 * vy + m8 * vz + jt[m + 11]) * w;

            rnx += (m0 * nx + m1 * ny + m2 * nz) * w;
            rny += (m3 * nx + m4 * ny + m5 * nz) * w;
            rnz += (m6 * nx + m7 * ny + m8 * nz) * w;

            rtx += (m0 * tx + m1 * ty + m2 * tz) * w;
            rty += (m3 * tx + m4 * ty + m5 * tz) * w;
            rtz += (m6 * tx + m7 * ty + m8 * tz) * w;

            rbx += (m0 * bx + m1 * by + m2 * bz) * w;
            rby += (m3 * bx + m4 * by + m5 * bz) * w;
            rbz += (m6 * bx + m7 * by + m8 * bz) * w;
          }

          // PORT: C++ FastNormalize (inverse sqrt approximation) -> exact normalization; zero vectors stay zero like before
          let l = rnx * rnx + rny * rny + rnz * rnz;
          if (l > 0) { l = 1.0 / Math.sqrt(l); rnx *= l; rny *= l; rnz *= l; }
          l = rtx * rtx + rty * rty + rtz * rtz;
          if (l > 0) { l = 1.0 / Math.sqrt(l); rtx *= l; rty *= l; rtz *= l; }
          l = rbx * rbx + rby * rby + rbz * rbz;
          if (l > 0) { l = 1.0 / Math.sqrt(l); rbx *= l; rby *= l; rbz *= l; }
        }

        if (updateSrc) {
          src[i] = rvx; src[i + 1] = rvy; src[i + 2] = rvz;
          src[i + off1] = rnx; src[i + off1 + 1] = rny; src[i + off1 + 2] = rnz;
          src[i + off3] = rtx; src[i + off3 + 1] = rty; src[i + off3 + 2] = rtz;
          src[i + off4] = rbx; src[i + off4 + 1] = rby; src[i + off4 + 2] = rbz;
        }

        dst[i] = rvx; dst[i + 1] = rvy; dst[i + 2] = rvz;
        dst[i + off1] = rnx; dst[i + off1 + 1] = rny; dst[i + off1 + 2] = rnz;
        dst[i + off3] = rtx; dst[i + off3 + 1] = rty; dst[i + off3 + 2] = rtz;
        dst[i + off4] = rbx; dst[i + off4 + 1] = rby; dst[i + off4 + 2] = rbz;
      }
    } // subgeom
  }

  Process(): void {
    this._cache_AgilityFactor = GetConfiguration().GetReal('gameplay_agilityfactor', _default_AgilityFactor);
    this._cache_AccelerationFactor = GetConfiguration().GetReal('gameplay_accelerationfactor', _default_AccelerationFactor);

    this.decayingPositionOffset = this.decayingPositionOffset.Mul(0.95);
    if (this.decayingPositionOffset.GetLength() < 0.005) this.decayingPositionOffset = new Vector3(0);
    this.decayingDifficultyFactor = clamp(this.decayingDifficultyFactor - 0.002, 0.0, 1.0);

    assert(this.match);

    if (!this.currentMentalImage) {
      this.currentMentalImage = this.match.GetMentalImage(0);
    }

    this.CalculateSpatialState();
    this.spatialState.positionOffsetMovement = new Vector3(0);

    this.currentAnim.frameNum++;
    this.previousAnim.frameNum++;

    if (this.currentAnim.frameNum === this.currentAnim.anim.GetFrameCount() - 1 && this.interruptAnim === e_InterruptAnim.e_InterruptAnim_None) {
      this.interruptAnim = e_InterruptAnim.e_InterruptAnim_Switch;
    }

    let mayReQueue = false;

    // already some anim interrupt waiting?

    if (mayReQueue) {
      if (this.interruptAnim !== e_InterruptAnim.e_InterruptAnim_None) {
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
        this.player.RequestCommand(commandQueue);
      }

      // iterate through the command queue and pick the first that is applicable

      let found = false;
      for (let i = 0; i < commandQueue.length; i++) {
        const command = commandQueue[i];

        found = this.SelectAnim(command, this.interruptAnim);
        if (found) break;
      }

      if (this.interruptAnim !== e_InterruptAnim.e_InterruptAnim_ReQueue && !found) {
        if (Verbose()) {
          console.warn('RED ALERT! NO APPLICABLE ANIM FOUND FOR HUMANOIDBASE! NOOOO!');
          console.warn(`currentanimtype: ${this.currentAnim.anim.GetVariable('type')}`);
          for (let i = 0; i < commandQueue.length; i++) {
            console.warn(`desiredanimtype: ${commandQueue[i].desiredFunctionType}`);
          }
        }
      }

      if (found) {
        this.startPos = this.spatialState.position;
        this.startAngle = this.spatialState.angle;

        const predicted = this.CalculatePredictedSituation();
        this.nextStartPos = predicted.predictedPos;
        this.nextStartAngle = predicted.predictedAngle;

        this.animApplyBuffer.anim = this.currentAnim.anim;
        this.animApplyBuffer.smooth = true;
        this.animApplyBuffer.smoothFactor = this.interruptAnim === e_InterruptAnim.e_InterruptAnim_Switch ? 0.6 : 1.0;

        // decaying difficulty
        const animDiff = atof(this.currentAnim.anim.GetVariable('animdifficultyfactor'));
        if (animDiff > this.decayingDifficultyFactor) this.decayingDifficultyFactor = animDiff;

        // if we just requeued, for example, from movement to ballcontrol, there's no reason we can not immediately requeue to another ballcontrol again (next time). only apply the initial requeue delay on subsequent anims of the same type
        // (so we can have a fast ballcontrol -> ballcontrol requeue, but after that, use the initial delay)
        if (this.interruptAnim === e_InterruptAnim.e_InterruptAnim_ReQueue && this.previousAnim.functionType === this.currentAnim.functionType) {
          this.reQueueDelayFrames = initialReQueueDelayFrames; // don't try requeueing (some types of anims, see selectanim()) too often
        }
      }
    }
    this.reQueueDelayFrames = clamp(this.reQueueDelayFrames - 1, 0, 10000);

    this.interruptAnim = e_InterruptAnim.e_InterruptAnim_None;

    if (this.startPos.coords[2] !== 0) {
      // the z coordinate not being 0 denotes something went horribly wrong :P
      Log(e_FatalError, 'HumanoidBase', 'Process', 'BWAAAAAH FLYING PLAYERS!! height: ' + real_to_str(this.startPos.coords[2]));
    }

    // movement/rotation smuggle

    // start with +1, because we want to influence the first frame as well
    // as for finishing, finish with frameBias = 1.0, even if the last frame is 'spiritually' the one-to-last, since the first frame of the next anim is actually 'same-tempered' as the current anim's last frame.
    // however, it works best to have all values 'done' at this one-to-last frame, so the next anim can read out these correct (new starting) values.
    const frameBias = (this.currentAnim.frameNum + 1) / (this.currentAnim.anim.GetEffectiveFrameCount() + 1);

    this.currentAnim.rotationSmuggleOffset = this.currentAnim.rotationSmuggle.begin * (1.0 - frameBias) + this.currentAnim.rotationSmuggle.end * frameBias;

    // next frame

    this.animApplyBuffer.frameNum = this.currentAnim.frameNum;

    if (this.currentAnim.positions.length > this.currentAnim.frameNum) {
      this.animApplyBuffer.position = this.startPos
        .Add(this.currentAnim.actionSmuggleOffset)
        .Add(this.currentAnim.actionSmuggleSustainOffset)
        .Add(this.currentAnim.movementSmuggleOffset)
        .Add(this.currentAnim.positions[this.currentAnim.frameNum]);
      this.animApplyBuffer.orientation = this.startAngle + this.currentAnim.rotationSmuggleOffset;
      this.animApplyBuffer.noPos = true;
    } else {
      if (this.player.GetDebug()) console.debug(`ERROR: ${this.currentAnim.positions.length}, ${this.currentAnim.frameNum} (${this.currentAnim.anim.GetName()})`);
      this.animApplyBuffer.position = this.startPos
        .Add(this.currentAnim.actionSmuggleOffset)
        .Add(this.currentAnim.actionSmuggleSustainOffset)
        .Add(this.currentAnim.movementSmuggleOffset);
      this.animApplyBuffer.orientation = this.startAngle;
      this.animApplyBuffer.noPos = false;
    }

    this.animApplyBuffer.offsets = CloneOffsets(this.offsets);
  }

  PreparePutBuffers(snapshotTime_ms: number): void {
    // offsets
    this.CalculateGeomOffsets(); // todo: in a perfect world, we don't want to do cpu intensive and/or stuff that uses a lot of mutex locking in this here function

    this.buf_animApplyBuffer = this.animApplyBuffer.Clone();
    this.buf_animApplyBuffer.snapshotTime_ms = snapshotTime_ms;

    // display humanoids farther away from action at half FPS
    this.buf_LowDetailMode = false;
    if (!this.player.GetExternalController() && !this.match.GetPause()) {
      let focusPos = this.match.GetBall().Predict(100).Get2D();
      const designatedPossessionPlayer = this.match.GetDesignatedPossessionPlayer();
      if (designatedPossessionPlayer) {
        focusPos = focusPos.Mul(0.5).Add(designatedPossessionPlayer.GetPosition().Mul(0.5));
      }

      if (this.spatialState.position.Sub(focusPos).GetLength() > 14.0) this.buf_LowDetailMode = true;
    }
  }

  FetchPutBuffers(putTime_ms: number): void {
    this.fetchedbuf_animApplyBuffer = this.buf_animApplyBuffer.Clone();
    assert(this.fetchedbuf_animApplyBuffer.anim === this.buf_animApplyBuffer.anim);

    this.fetchedbuf_LowDetailMode = this.buf_LowDetailMode;
    this.buf_bodyUpdatePhase++;
    if (this.buf_bodyUpdatePhase === 2) this.buf_bodyUpdatePhase = 0;
    this.fetchedbuf_bodyUpdatePhase = this.buf_bodyUpdatePhase;
    this.fetchedbuf_bodyUpdatePhaseOffset = this.buf_bodyUpdatePhaseOffset;
  }

  Put(): void {
    // the apply function doesn't know better than that it is displaying snapshot times, so continue this hoax into the timeDiff_ms value. then,
    // the temporalsmoother will convert it to 'realtime' once again
    let timeDiff_ms = this.fetchedbuf_animApplyBuffer.snapshotTime_ms - this.fetchedbuf_previousSnapshotTime_ms;
    // PORT: unsigned long in C++: a negative difference wrapped around to a huge value, which clamps to 50
    timeDiff_ms = timeDiff_ms < 0 ? 50 : clamp(timeDiff_ms, 10, 50);
    this.fetchedbuf_previousSnapshotTime_ms = this.fetchedbuf_animApplyBuffer.snapshotTime_ms;

    const temporalNodes = this.buf_TemporalHumanoidNodes;
    for (let i = 0; i < temporalNodes.length; i++) {
      // first, restore the previous non-temporal-smoothed values, so the Apply() function can use them for smoothing
      temporalNodes[i].actualNode.SetPosition(temporalNodes[i].cachedPosition, false);
      temporalNodes[i].actualNode.SetRotation(temporalNodes[i].cachedOrientation, false);
    }

    const buf = this.fetchedbuf_animApplyBuffer;
    buf.anim.Apply(this.nodeMap, buf.frameNum, -1, buf.smooth, buf.smoothFactor, buf.position, buf.orientation, buf.offsets, this.movementHistory, timeDiff_ms, buf.noPos, false);

    // we've just set the humanoid positions for time fetchedbuf_animApplyBuffer.snapshotTime_ms. however, it's eventually going to be displayed in a historic position, for temporal smoothing.
    // thus; read out the current values we've just set, insert them in the temporal smoother, and get the historic spatial data instead (GetValue).
    const previousPutTime_ms = this.match.GetPreviousPutTime_ms();
    for (let i = 0; i < temporalNodes.length; i++) {
      const temporalNode = temporalNodes[i];
      // save the non-historic version in cachedNode
      temporalNode.cachedPosition = temporalNode.actualNode.GetPosition();
      temporalNode.cachedOrientation = temporalNode.actualNode.GetRotation();

      // sudden realisation: by only SetValue'ing here instead of in prepareputbuffers, aren't we missing out on valuable interpolateable data?
      temporalNode.position.SetValue(temporalNode.actualNode.GetPosition(), buf.snapshotTime_ms);
      temporalNode.orientation.SetValue(temporalNode.actualNode.GetRotation(), buf.snapshotTime_ms);

      temporalNode.actualNode.SetPosition(temporalNode.position.GetValue(previousPutTime_ms), false);
      temporalNode.actualNode.SetRotation(temporalNode.orientation.GetValue(previousPutTime_ms), false);
    }

    // PORT: humanoidNode->RecursiveUpdateSpatialData() calls dropped: derived transforms are recomputed lazily
    this.UpdateFullbodyNodes();
  }

  CalculateGeomOffsets(): void {
    // todo (the original body of this function was commented out)
  }

  SetOffset(nodeName: string, bias: number, orientation: Quaternion, isRelative = false): void {
    const existing = this.offsets.get(nodeName);
    if (existing === undefined) {
      if (bias !== 0) {
        const biasedOffset = new BiasedOffset();
        biasedOffset.bias = bias;
        biasedOffset.orientation = orientation;
        biasedOffset.isRelative = isRelative;
        this.offsets.set(nodeName, biasedOffset);
      }
    } else {
      if (bias !== 0) {
        const biasedOffset = new BiasedOffset();
        biasedOffset.bias = bias;
        biasedOffset.orientation = orientation;
        biasedOffset.isRelative = isRelative;
        this.offsets.set(nodeName, biasedOffset);
      } else {
        this.offsets.delete(nodeName);
      }
    }
  }

  GetFrameNum(): number {
    return this.currentAnim.frameNum;
  }
  GetFrameCount(): number {
    return this.currentAnim.anim.GetFrameCount();
  }

  GetPosition(): Vector3 {
    return this.spatialState.position;
  }
  GetDirectionVec(): Vector3 {
    return this.spatialState.directionVec;
  }
  GetBodyDirectionVec(): Vector3 {
    return this.spatialState.bodyDirectionVec;
  }
  GetAngle(): radian {
    return this.spatialState.angle;
  }
  GetRelBodyAngle(): radian {
    return this.spatialState.relBodyAngle;
  }
  GetEnumVelocity(): e_Velocity {
    return this.spatialState.enumVelocity;
  }
  GetCurrentFunctionType(): e_FunctionType {
    return this.currentAnim.functionType;
  }
  GetPreviousFunctionType(): e_FunctionType {
    return this.previousAnim.functionType;
  }
  GetMovement(): Vector3 {
    return this.spatialState.movement;
  }

  GetGeomPosition(): Vector3 {
    return this.humanoidNode.GetPosition();
  }

  GetIdleMovementAnimID(): number {
    const query = new CrudeSelectionQuery();
    query.byFunctionType = true;
    query.functionType = e_FunctionType.e_FunctionType_Movement;
    query.byIncomingVelocity = true;
    query.incomingVelocity = e_Velocity.e_Velocity_Idle;
    query.byOutgoingVelocity = true;
    query.outgoingVelocity = e_Velocity.e_Velocity_Idle;

    const dataSet: DataSet = [];
    this.anims.CrudeSelection(dataSet, query);
    if (Verbose()) if (dataSet.length === 0) console.debug('no animations to begin with');

    const desiredIdleLevel = 1;
    this.SetNumericVariableSimilarityPredicate('idlelevel', desiredIdleLevel);
    this._SortDataSetByKey(dataSet, (id) => this._NumericVariableKey(id));

    this.SetIncomingBodyDirectionSimilarityPredicate(new Vector3(0, -1, 0));
    this._SortDataSetByKey(dataSet, (id) => this._IncomingBodyDirectionSimilarityKey(id));

    this.SetIncomingVelocitySimilarityPredicate(e_Velocity.e_Velocity_Idle);
    this._SortDataSetByKey(dataSet, (id) => this._IncomingVelocitySimilarityKey(id));

    this.SetMovementSimilarityPredicate(new Vector3(0, -1, 0), e_Velocity.e_Velocity_Idle);
    this.SetBodyDirectionSimilarityPredicate(this.spatialState.position.Add(new Vector3(0, -10, 0).GetRotated2D(this.spatialState.angle))); // lookat
    const relLookAt = this._GetRelLookAt();
    this._SortDataSetByKey(dataSet, (id) => this._BodyDirectionSimilarityKey(id, relLookAt));

    this._SortDataSetByKey(dataSet, (id) => this._MovementSimilarityKey(id));

    return dataSet[0];
  }

  ResetPosition(newPos: Vector3, focusPos: Vector3): void {
    this.startPos = newPos;
    this.startAngle = FixAngle(focusPos.Sub(newPos).GetNormalized(new Vector3(0, -1, 0)).GetAngle2D());
    this.nextStartPos = this.startPos;
    this.nextStartAngle = this.startAngle;
    this.previousPosition2D = this.startPos;

    this.spatialState.position = this.startPos;
    this.spatialState.angle = this.startAngle;
    this.spatialState.directionVec = new Vector3(0, -1, 0).GetRotated2D(this.startAngle);
    this.spatialState.floatVelocity = 0;
    this.spatialState.enumVelocity = e_Velocity.e_Velocity_Idle;
    this.spatialState.movement = new Vector3(0);
    this.spatialState.relBodyDirectionVec = new Vector3(0, -1, 0);
    this.spatialState.relBodyAngle = 0;
    this.spatialState.bodyDirectionVec = new Vector3(0, -1, 0);
    this.spatialState.bodyAngle = 0;
    this.spatialState.foot = e_Foot.e_Foot_Right;

    const idleAnimID = this.GetIdleMovementAnimID();
    const currentAnim = this.currentAnim;
    currentAnim.id = idleAnimID;
    currentAnim.anim = this.anims.GetAnim(currentAnim.id);
    currentAnim.positions = this.match.GetAnimPositionCache(currentAnim.anim).slice();
    currentAnim.frameNum = Math.trunc(random(0, currentAnim.anim.GetEffectiveFrameCount() - 1));
    currentAnim.radiusOffset = 0.0;
    currentAnim.touchFrame = -1;
    currentAnim.originatingInterrupt = e_InterruptAnim.e_InterruptAnim_None;
    currentAnim.fullActionSmuggle = new Vector3(0);
    currentAnim.actionSmuggle = new Vector3(0);
    currentAnim.actionSmuggleOffset = new Vector3(0);
    currentAnim.actionSmuggleSustain = new Vector3(0);
    currentAnim.actionSmuggleSustainOffset = new Vector3(0);
    currentAnim.movementSmuggle = new Vector3(0);
    currentAnim.movementSmuggleOffset = new Vector3(0);
    currentAnim.rotationSmuggle.begin = 0;
    currentAnim.rotationSmuggle.end = 0;
    currentAnim.rotationSmuggleOffset = 0;
    currentAnim.functionType = e_FunctionType.e_FunctionType_Movement;
    currentAnim.incomingMovement = new Vector3(0);
    currentAnim.outgoingMovement = new Vector3(0);
    currentAnim.positionOffset = new Vector3(0);

    const previousAnim = this.previousAnim;
    previousAnim.id = idleAnimID;
    previousAnim.anim = currentAnim.anim;
    previousAnim.positions = this.match.GetAnimPositionCache(previousAnim.anim).slice();
    previousAnim.frameNum = 0;
    previousAnim.radiusOffset = 0.0;
    previousAnim.touchFrame = -1;
    previousAnim.originatingInterrupt = e_InterruptAnim.e_InterruptAnim_None;
    previousAnim.fullActionSmuggle = new Vector3(0);
    previousAnim.actionSmuggle = new Vector3(0);
    previousAnim.actionSmuggleOffset = new Vector3(0);
    previousAnim.actionSmuggleSustain = new Vector3(0);
    previousAnim.actionSmuggleSustainOffset = new Vector3(0);
    previousAnim.movementSmuggle = new Vector3(0);
    previousAnim.movementSmuggleOffset = new Vector3(0);
    previousAnim.rotationSmuggle.begin = 0;
    previousAnim.rotationSmuggle.end = 0;
    previousAnim.rotationSmuggleOffset = 0;
    previousAnim.functionType = e_FunctionType.e_FunctionType_Movement;
    previousAnim.incomingMovement = new Vector3(0);
    previousAnim.outgoingMovement = new Vector3(0);
    previousAnim.positionOffset = new Vector3(0);

    this.humanoidNode.SetPosition(this.startPos, false);

    this.animApplyBuffer.anim = currentAnim.anim;
    this.animApplyBuffer.smooth = false;
    this.animApplyBuffer.smoothFactor = 0.0;
    this.animApplyBuffer.position = this.startPos;
    this.animApplyBuffer.orientation = this.startAngle;
    this.animApplyBuffer.offsets.clear();
    this.buf_animApplyBuffer = this.animApplyBuffer.Clone();

    this.interruptAnim = e_InterruptAnim.e_InterruptAnim_None;
    this.tripType = 0;

    this.decayingPositionOffset = new Vector3(0);
    this.decayingDifficultyFactor = 0.0;

    this.movementHistory.length = 0;
  }

  OffsetPosition(offset: Vector3): void {
    // todo: move this to team process or disable it altogether
    // ponder on the consequences and decide!
    // update: seems to function well as is atm

    assert(offset.coords[2] === 0.0);

    const cheat = 1.0;

    this.nextStartPos = this.nextStartPos.Add(offset.Mul(cheat));
    this.startPos = this.startPos.Add(offset.Mul(cheat));
    this.spatialState.position = this.spatialState.position.Add(offset.Mul(cheat));
    this.spatialState.positionOffsetMovement = this.spatialState.positionOffsetMovement.Add(offset.Mul(100.0).Mul(cheat));
    this.decayingPositionOffset = this.decayingPositionOffset.Add(offset.Mul(cheat));
    if (this.decayingPositionOffset.GetLength() > 0.1) this.decayingPositionOffset = this.decayingPositionOffset.GetNormalized().Mul(0.1);
    this.currentAnim.positionOffset = this.currentAnim.positionOffset.Add(offset.Mul(cheat));
  }

  TripMe(tripVector: Vector3, tripType: number): void {
    if (this.match.GetBallRetainer() === this.player) return;
    if (this.currentAnim.anim.GetVariable('incoming_special_state') === '' && this.currentAnim.anim.GetVariable('outgoing_special_state') === '') {
      if (
        this.interruptAnim === e_InterruptAnim.e_InterruptAnim_None &&
        (this.currentAnim.functionType !== e_FunctionType.e_FunctionType_Trip || (this.currentAnim.anim.GetVariable('triptype') === '1' && tripType > 1)) &&
        this.currentAnim.functionType !== e_FunctionType.e_FunctionType_Sliding
      ) {
        this.interruptAnim = e_InterruptAnim.e_InterruptAnim_Trip;
        this.tripDirection = tripVector;
        this.tripType = tripType;
      }
    }
  }

  GetHumanoidNode(): Node {
    return this.humanoidNode;
  }
  GetFullbodyNode(): Node {
    return this.fullbodyNode;
  }

  GetDecayingPositionOffsetLength(): number {
    return this.decayingPositionOffset.GetLength();
  }
  GetDecayingDifficultyFactor(): number {
    return this.decayingDifficultyFactor;
  }

  GetCurrentAnim(): Anim {
    return this.currentAnim;
  }
  GetPreviousAnim(): Anim {
    return this.previousAnim;
  }

  GetNodeMap(): NodeMap {
    return this.nodeMap;
  }

  Hide(): void {
    this.fullbodyNode.SetPosition(new Vector3(1000, 1000, -1000));
    this.hairStyle.SetPosition(new Vector3(1000, 1000, -1000));
  } // hax ;)

  SetKit(newKit: Resource<Surface> | null): void {
    if (Verbose() && newKit) console.debug(`setting new kit: ${newKit.GetIdentString()}`);
    const fullbodyGeometry = this.fullbodyNode.GetObject('fullbody') as Geometry;
    const tmesh = fullbodyGeometry.GetGeometryData().GetResource().GetTriangleMeshesRef();

    if (newKit !== null) {
      for (let i = 0; i < tmesh.length; i++) {
        const diffuseTexture = tmesh[i].material.diffuseTexture;
        if (diffuseTexture !== null) {
          if (diffuseTexture.GetIdentString() === this.kitDiffuseTextureIdentString) {
            tmesh[i].material.diffuseTexture = newKit;
            tmesh[i].material.specular_amount = 0.01;
            tmesh[i].material.shininess = 0.01;
          }
        } else if (Verbose()) console.debug('no texture!');
      }
      this.kitDiffuseTextureIdentString = newKit.GetIdentString();
    }

    fullbodyGeometry.OnUpdateGeometryData();
  }

  ResetSituation(focusPos: Vector3): void {
    this.currentMentalImage = null;

    this.ResetPosition(this.spatialState.position, focusPos);
  }

  // ----- protected

  protected _HighOrBouncyBall(): boolean {
    const ball = this.match.GetBall();
    const ballHeight1 = ball.Predict(10).coords[2];
    const ballHeight2 = ball.Predict(defaultTouchOffset_ms).coords[2];
    const ballBounce = Math.abs(ball.GetMovement().coords[2]);
    let highBall = false;
    if (ballHeight1 > 0.3 || ballHeight2 > 0.3) {
      highBall = true;
    } else if (ballBounce > 1.0) {
      // low balls are also treated as 'high ball' when there's a lot of bounce going on (hard to control)
      highBall = true;
    }
    return highBall;
  }

  /** ALERT: set sorting predicates before calling this function. strict kinda overrules the allowedstuff */
  protected _KeepBestDirectionAnims(dataSet: DataSet, command: PlayerCommand, strict = true, allowedAngle: radian = 0, allowedVelocitySteps = 0, forcedQuadrantID = -1): void {
    assert(dataSet.length !== 0);

    let bestQuadrantID = forcedQuadrantID;
    if (bestQuadrantID === -1) {
      this._SortDataSetByKey(dataSet, (id) => this._MovementSimilarityKey(id));

      // we want the best anim to be a baseanim, and compare other anims to it
      if (strict) {
        if (command.desiredFunctionType !== e_FunctionType.e_FunctionType_Movement) {
          this._SortDataSetByKey(dataSet, (id) => this._BaseanimSimilarityKey(id));
        }
      }

      const bestAnim = this.anims.GetAnim(dataSet[0]);

      bestQuadrantID = atoi(bestAnim.GetVariable('quadrant_id'));
    }

    const bestQuadrant = this.anims.GetQuadrant(bestQuadrantID);

    // PORT: the C++ erased non-qualifying entries while iterating; filtering in place keeps the same entries in the same order
    let keep = 1;
    for (let i = 1; i < dataSet.length; i++) {
      const animID = dataSet[i];
      const anim = this.anims.GetAnim(animID);

      let predicate: boolean;
      if (strict) {
        predicate = atoi(anim.GetVariable('quadrant_id')) === bestQuadrantID;
      } else {
        const quadrantID = atoi(anim.GetVariable('quadrant_id'));
        const quadrant = this.anims.GetQuadrant(quadrantID);

        predicate = true;

        if (anim.GetVariable('lastditch') !== 'true') {
          // last ditch anims may always change velo
          if (Math.abs(GetVelocityID(quadrant.velocity, true) - GetVelocityID(bestQuadrant.velocity, true)) > allowedVelocitySteps) predicate = false;
        }
        if (Math.abs(quadrant.angle - bestQuadrant.angle) > allowedAngle) predicate = false;
      }

      if (predicate) dataSet[keep++] = animID;
    }
    dataSet.length = keep;
  }

  /** ALERT: set sorting predicates before calling this function. strict kinda overrules the allowedstuff */
  protected _KeepBestBodyDirectionAnims(dataSet: DataSet, command: PlayerCommand, strict = true, allowedAngle: radian = 0): void {
    // delete nonqualified bodydir quadrants

    assert(dataSet.length !== 0);

    const relLookAt = this._GetRelLookAt();
    this._SortDataSetByKey(dataSet, (id) => this._BodyDirectionSimilarityKey(id, relLookAt));

    // we want the best anim to be a baseanim, and compare other anims to it
    if (strict) {
      if (command.desiredFunctionType !== e_FunctionType.e_FunctionType_Movement) {
        this._SortDataSetByKey(dataSet, (id) => this._BaseanimSimilarityKey(id));
      }
    }

    const bestAnim = this.anims.GetAnim(dataSet[0]);

    const bestOutgoingBodyAngle = this.ForceIntoAllowedBodyDirectionAngle(bestAnim.GetOutgoingBodyAngle());
    const bestOutgoingAngle = this.ForceIntoPreferredDirectionAngle(bestAnim.GetOutgoingAngle());
    const bestLookAngle = bestOutgoingBodyAngle + bestOutgoingAngle;

    let adaptedAllowedAngle = 0.06 * pi; // between 0 and 20 deg
    if (!strict) {
      adaptedAllowedAngle = allowedAngle;
    }

    // PORT: in-place filter instead of erase-while-iterating (same result)
    let keep = 1;
    for (let i = 1; i < dataSet.length; i++) {
      const animID = dataSet[i];
      const anim = this.anims.GetAnim(animID);

      const animOutgoingBodyAngle = this.ForceIntoAllowedBodyDirectionAngle(anim.GetOutgoingBodyAngle());
      const animOutgoingAngle = this.ForceIntoPreferredDirectionAngle(anim.GetOutgoingAngle());
      const animLookAngle = animOutgoingBodyAngle + animOutgoingAngle;

      if (Math.abs(animLookAngle - bestLookAngle) <= adaptedAllowedAngle) dataSet[keep++] = animID;
    }
    dataSet.length = keep;
  }

  /** returns false on no applicable anim found */
  protected SelectAnim(command: PlayerCommand, localInterruptAnim: e_InterruptAnim, preferPassAndShot = false): boolean {
    assert(command.desiredDirection.coords[2] === 0.0);

    if (localInterruptAnim !== e_InterruptAnim.e_InterruptAnim_ReQueue || this.currentAnim.frameNum > 12) this.CalculateFactualSpatialState();

    // CREATE A CRUDE SET OF POTENTIAL ANIMATIONS

    const query = new CrudeSelectionQuery();
    query.byFunctionType = true;
    query.functionType = command.desiredFunctionType;

    query.byFoot = false;
    query.foot = this.spatialState.foot === e_Foot.e_Foot_Left ? e_Foot.e_Foot_Right : e_Foot.e_Foot_Left;

    query.byIncomingVelocity = true;
    query.incomingVelocity = this.spatialState.enumVelocity;
    query.incomingVelocity_Strict = true;
    query.byIncomingBodyDirection = true;
    query.incomingBodyDirection_Strict = true;
    query.incomingBodyDirection = this.spatialState.relBodyDirectionVec;
    query.incomingVelocity_ForceLinearity = true;
    query.incomingBodyDirection_ForceLinearity = true;

    if (command.desiredFunctionType === e_FunctionType.e_FunctionType_Trip) {
      query.byTripType = true;
      query.tripType = command.tripType;
    }
    query.properties.Set('incoming_special_state', this.currentAnim.anim.GetVariable('outgoing_special_state'));
    if (this.match.GetBallRetainer() === this.player) query.properties.Set('incoming_retain_state', this.currentAnim.anim.GetVariable('outgoing_retain_state'));
    if (command.useSpecialVar1) query.properties.Set('specialvar1', command.specialVar1);
    if (command.useSpecialVar2) query.properties.Set('specialvar2', command.specialVar2);

    if (this.currentAnim.anim.GetVariable('outgoing_special_state') !== '') query.incomingVelocity = e_Velocity.e_Velocity_Idle; // standing up anims always start out idle

    const dataSet: DataSet = [];
    this.anims.CrudeSelection(dataSet, query);
    if (dataSet.length === 0) {
      if (command.desiredFunctionType === e_FunctionType.e_FunctionType_Movement) {
        if (Verbose()) console.debug('no movement animations to begin with (humanoidbase)');
        dataSet.push(this.GetIdleMovementAnimID()); // do with idle anim (should not happen too often, only after weird bumps when there's for example a need for a sprint anim at an impossible body angle, after a trip of whatever)
      } else return false;
    }

    // NOW SORT OUT THE RESULTING SET

    const adaptedDesiredVelocityFloat = command.desiredVelocityFloat;

    if (command.useDesiredMovement) {
      const relDesiredDirection = command.desiredDirection.GetRotated2D(-this.spatialState.angle);
      this.SetMovementSimilarityPredicate(relDesiredDirection, FloatToEnumVelocity(adaptedDesiredVelocityFloat));
      this.SetBodyDirectionSimilarityPredicate(command.desiredLookAt);

      if (command.desiredFunctionType === e_FunctionType.e_FunctionType_Movement) {
        this._KeepBestDirectionAnims(dataSet, command);
        if (command.useDesiredLookAt) this._KeepBestBodyDirectionAnims(dataSet, command);
      } else {
        // undefined animtype
        this._SortDataSetByKey(dataSet, (id) => this._MovementSimilarityKey(id));
      }
    }

    const desiredIdleLevel = 1;
    this.SetNumericVariableSimilarityPredicate('idlelevel', desiredIdleLevel);
    this._SortDataSetByKey(dataSet, (id) => this._NumericVariableKey(id));

    this.SetFootSimilarityPredicate(this.spatialState.foot);
    this._SortDataSetByKey(dataSet, (id) => this._FootSimilarityKey(id));

    this.SetIncomingBodyDirectionSimilarityPredicate(this.spatialState.relBodyDirectionVec);
    this._SortDataSetByKey(dataSet, (id) => this._IncomingBodyDirectionSimilarityKey(id));

    this.SetIncomingVelocitySimilarityPredicate(this.spatialState.enumVelocity);
    this._SortDataSetByKey(dataSet, (id) => this._IncomingVelocitySimilarityKey(id));

    if (command.useDesiredTripDirection) {
      const relDesiredTripDirection = command.desiredTripDirection.GetRotated2D(-this.spatialState.angle);
      this.SetTripDirectionSimilarityPredicate(relDesiredTripDirection);
      this._SortDataSetByKey(dataSet, (id) => this._TripDirectionSimilarityKey(id));
    }

    if (command.desiredFunctionType !== e_FunctionType.e_FunctionType_Movement) {
      this._SortDataSetByKey(dataSet, (id) => this._BaseanimSimilarityKey(id));
    }

    // process result

    let selectedAnimID = -1;
    const positions_tmp: Vector3[] = [];
    const touchFrame_tmp = -1;
    const radiusOffset_tmp = 0.0;
    const touchPos_tmp = new Vector3(0);
    const fullActionSmuggle_tmp = new Vector3(0);
    const actionSmuggle_tmp = new Vector3(0);
    let rotationSmuggle_tmp: radian = 0;

    if (dataSet.length === 0) {
      if (Verbose()) console.debug('no animations left');
      return false;
    }

    if (
      command.desiredFunctionType === e_FunctionType.e_FunctionType_Movement ||
      command.desiredFunctionType === e_FunctionType.e_FunctionType_Trip ||
      command.desiredFunctionType === e_FunctionType.e_FunctionType_Special
    ) {
      selectedAnimID = dataSet[0];
      const nextAnim = this.anims.GetAnim(selectedAnimID);
      const desiredMovement = command.desiredDirection.Mul(command.desiredVelocityFloat);
      assert(desiredMovement.coords[2] === 0.0);
      let desiredBodyDirectionRel = new Vector3(0, -1, 0);
      if (command.useDesiredLookAt) {
        desiredBodyDirectionRel = command.desiredLookAt
          .Sub(this.spatialState.position)
          .Get2D()
          .GetRotated2D(-this.spatialState.angle)
          .Sub(nextAnim.GetTranslation())
          .GetNormalized(new Vector3(0, -1, 0));
      }
      rotationSmuggle_tmp = this.CalculatePhysicsVector(nextAnim, command.useDesiredMovement, desiredMovement, command.useDesiredLookAt, desiredBodyDirectionRel, positions_tmp).rotationOffset_ret;
    }

    // check if we really want to requeue - only requeue movement to movement, for example, when we want to go a different direction

    if (localInterruptAnim === e_InterruptAnim.e_InterruptAnim_ReQueue && selectedAnimID !== -1 && this.currentAnim.positions.length > 1 && positions_tmp.length > 1) {
      // don't requeue to same quadrant
      const currentOutgoingIdle = FloatToEnumVelocity(this.currentAnim.anim.GetOutgoingVelocity()) === e_Velocity.e_Velocity_Idle;
      if (
        this.currentAnim.functionType === command.desiredFunctionType &&
        ((!currentOutgoingIdle && this.currentAnim.anim.GetVariable('quadrant_id') === this.anims.GetAnim(selectedAnimID).GetVariable('quadrant_id')) ||
          (currentOutgoingIdle &&
            Math.abs(
              this.ForceIntoPreferredDirectionAngle(this.currentAnim.anim.GetOutgoingAngle()) -
                this.ForceIntoPreferredDirectionAngle(this.anims.GetAnim(selectedAnimID).GetOutgoingAngle()),
            ) < 0.2 * pi))
      ) {
        selectedAnimID = -1;
        if (this.player.GetDebug()) console.debug('rejecting requeue anim for leading into the same quadrant');
      }
    }

    // make it so

    if (selectedAnimID !== -1) {
      // C++: *previousAnim = *currentAnim;
      this.previousAnim.CopyFrom(this.currentAnim);

      const currentAnim = this.currentAnim;
      currentAnim.anim = this.anims.GetAnim(selectedAnimID);
      currentAnim.id = selectedAnimID;
      currentAnim.functionType = command.desiredFunctionType;
      currentAnim.frameNum = 0;
      currentAnim.touchFrame = touchFrame_tmp;
      currentAnim.originatingInterrupt = localInterruptAnim;
      currentAnim.radiusOffset = radiusOffset_tmp;
      currentAnim.touchPos = touchPos_tmp;
      currentAnim.rotationSmuggle.begin = clamp(
        ModulateIntoRange(-pi, pi, this.spatialState.relBodyAngleNonquantized - currentAnim.anim.GetIncomingBodyAngle()) * bodyRotationSmoothingFactor,
        -bodyRotationSmoothingMaxAngle,
        bodyRotationSmoothingMaxAngle,
      );
      currentAnim.rotationSmuggle.end = rotationSmuggle_tmp;
      currentAnim.rotationSmuggleOffset = 0;
      currentAnim.fullActionSmuggle = fullActionSmuggle_tmp;
      currentAnim.actionSmuggle = actionSmuggle_tmp;
      currentAnim.actionSmuggleOffset = new Vector3(0);
      currentAnim.actionSmuggleSustain = new Vector3(0);
      currentAnim.actionSmuggleSustainOffset = new Vector3(0);
      currentAnim.movementSmuggle = new Vector3(0);
      currentAnim.movementSmuggleOffset = new Vector3(0);
      currentAnim.incomingMovement = this.spatialState.movement;
      currentAnim.outgoingMovement = this.CalculateOutgoingMovement(positions_tmp);
      currentAnim.positions = positions_tmp;
      currentAnim.positionOffset = new Vector3(0.0);
      currentAnim.originatingCommand = command.Clone();

      return true;
    }

    return false;
  }

  /** C++ CalculatePredictedSituation(Vector3 &predictedPos, radian &predictedAngle) */
  protected CalculatePredictedSituation(): { predictedPos: Vector3; predictedAngle: radian } {
    const currentAnim = this.currentAnim;
    let predictedPos: Vector3;
    if (currentAnim.positions.length > currentAnim.frameNum) {
      assert(currentAnim.positions.length > currentAnim.anim.GetEffectiveFrameCount());
      predictedPos = this.spatialState.position
        .Add(currentAnim.positions[currentAnim.anim.GetEffectiveFrameCount()])
        .Add(currentAnim.actionSmuggle)
        .Add(currentAnim.actionSmuggleSustain)
        .Add(currentAnim.movementSmuggle);
    } else {
      predictedPos = this.spatialState.position
        .Add(currentAnim.anim.GetTranslation().Get2D().GetRotated2D(this.spatialState.angle))
        .Add(currentAnim.actionSmuggle)
        .Add(currentAnim.actionSmuggleSustain)
        .Add(currentAnim.movementSmuggle);
    }

    let predictedAngle = this.spatialState.angle + currentAnim.anim.GetOutgoingAngle() + currentAnim.rotationSmuggle.end;
    predictedAngle = ModulateIntoRange(-pi, pi, predictedAngle);
    assert(predictedPos.coords[2] === 0.0);
    return { predictedPos, predictedAngle };
  }

  protected CalculateOutgoingMovement(positions: Vector3[]): Vector3 {
    if (positions.length < 2) return new Vector3(0);
    return positions[positions.length - 1].Sub(positions[positions.length - 2]).Mul(100.0);
  }

  /** realtime properties, based on 'physics' */
  protected CalculateSpatialState(): void {
    const currentAnim = this.currentAnim;
    const spatialState = this.spatialState;

    let position: Vector3;
    if (currentAnim.positions.length > currentAnim.frameNum) {
      position = this.startPos
        .Add(currentAnim.positions[currentAnim.frameNum])
        .Add(currentAnim.actionSmuggleOffset)
        .Add(currentAnim.actionSmuggleSustainOffset)
        .Add(currentAnim.movementSmuggleOffset);
    } else {
      position = currentAnim.anim.GetKeyFrame('player', currentAnim.frameNum).position;
      position = position.WithCoord(2, 0.0);
      position = this.startPos
        .Add(position.GetRotated2D(this.startAngle))
        .Add(currentAnim.actionSmuggleOffset)
        .Add(currentAnim.actionSmuggleSustainOffset)
        .Add(currentAnim.movementSmuggleOffset);
    }

    if (currentAnim.frameNum > 12) {
      spatialState.foot = currentAnim.anim.GetOutgoingFoot();
    }

    assert(this.startPos.coords[2] === 0.0);
    assert(currentAnim.actionSmuggleOffset.coords[2] === 0.0);
    assert(currentAnim.movementSmuggleOffset.coords[2] === 0.0);
    assert(position.coords[2] === 0.0);

    spatialState.actualMovement = position.Sub(this.previousPosition2D).Mul(100.0);
    const positionOffsetMovementIgnoreFactor = 0.5;
    spatialState.physicsMovement = spatialState.actualMovement
      .Sub(spatialState.actionSmuggleMovement)
      .Sub(spatialState.movementSmuggleMovement)
      .Sub(spatialState.positionOffsetMovement.Mul(positionOffsetMovementIgnoreFactor));
    spatialState.animMovement = spatialState.physicsMovement;
    if (currentAnim.positions.length > 0) {
      // this way, action cheating is being omitted from the current movement, making for better requeues. however, keep in mind that
      // movementoffsets, from bumping into other players, for example, will also be ignored this way.
      const origPositionCache = this.match.GetAnimPositionCache(currentAnim.anim);
      spatialState.animMovement = CalculateMovementAtFrame(origPositionCache, currentAnim.frameNum, 1).GetRotated2D(this.startAngle);
    }

    spatialState.movement = spatialState.physicsMovement; // PICK DEFAULT

    const bodyOrientation = currentAnim.anim.GetKeyFrame('body', currentAnim.frameNum).orientation;
    const z = bodyOrientation.GetAngles().Z;

    const bodyDirectionVec = new Vector3(0, -1, 0).GetRotated2D(z + this.startAngle + currentAnim.rotationSmuggleOffset);

    spatialState.floatVelocity = spatialState.movement.GetLength();
    spatialState.enumVelocity = FloatToEnumVelocity(spatialState.floatVelocity);

    if (spatialState.enumVelocity !== e_Velocity.e_Velocity_Idle) {
      spatialState.directionVec = spatialState.movement.GetNormalized();
    } else {
      // too slow for comfort, use body direction as global direction
      spatialState.directionVec = bodyDirectionVec;
    }

    spatialState.position = position;
    spatialState.angle = ModulateIntoRange(-pi, pi, FixAngle(spatialState.directionVec.GetAngle2D()));

    if (spatialState.enumVelocity !== e_Velocity.e_Velocity_Idle) {
      let adaptedBodyDirectionVec = bodyDirectionVec.GetRotated2D(-spatialState.angle);
      // prefer straight forward, so lie about the actual direction a bit
      // this may fix bugs of body dir being non-0 somewhere during 0 anims
      // but it may also cause other bugs (going 0 to 45 all over again each time)

      const preferCorrectVeloOverCorrectAngle: boolean = true; // todo: for false, should also alter .movement, right?
      const bodyAngleRel = adaptedBodyDirectionVec.GetAngle2D(DOWN);
      if (spatialState.enumVelocity === e_Velocity.e_Velocity_Sprint && Math.abs(bodyAngleRel) >= 0.125 * pi) {
        if (preferCorrectVeloOverCorrectAngle) {
          // on impossible combinations of velocity and body angle, decrease body angle
          adaptedBodyDirectionVec = new Vector3(0, -1, 0).GetRotated2D(0.12 * pi * signSide(bodyAngleRel));
        } else {
          // on impossible combinations of velocity and body angle, decrease velocity
          spatialState.floatVelocity = walkSprintSwitch - 0.1;
          spatialState.enumVelocity = FloatToEnumVelocity(spatialState.floatVelocity);
        }
      } else if (spatialState.enumVelocity === e_Velocity.e_Velocity_Walk && Math.abs(bodyAngleRel) >= 0.5 * pi) {
        if (preferCorrectVeloOverCorrectAngle) {
          // on impossible combinations of velocity and body angle, decrease body angle
          adaptedBodyDirectionVec = new Vector3(0, -1, 0).GetRotated2D(0.495 * pi * signSide(bodyAngleRel));
        } else {
          // on impossible combinations of velocity and body angle, decrease velocity
          spatialState.floatVelocity = dribbleWalkSwitch - 0.1;
          spatialState.enumVelocity = FloatToEnumVelocity(spatialState.floatVelocity);
        }
      }

      spatialState.relBodyDirectionVecNonquantized = adaptedBodyDirectionVec;
      spatialState.relBodyDirectionVec = this.ForceIntoAllowedBodyDirectionVec(adaptedBodyDirectionVec);
    } else {
      spatialState.relBodyDirectionVecNonquantized = new Vector3(0, -1, 0);
      spatialState.relBodyDirectionVec = new Vector3(0, -1, 0);
    }
    spatialState.relBodyAngle = spatialState.relBodyDirectionVec.GetAngle2D(DOWN);
    spatialState.relBodyAngleNonquantized = spatialState.relBodyDirectionVecNonquantized.GetAngle2D(DOWN);
    spatialState.bodyDirectionVec = spatialState.relBodyDirectionVec.GetRotated2D(spatialState.angle); // rotate back, we now have it forced into allowed angle
    spatialState.bodyAngle = spatialState.bodyDirectionVec.GetAngle2D(DOWN);

    this.previousPosition2D = position;
  }

  /** realtime properties, based on anim. usable at last frame of anim. more riggid than above function */
  protected CalculateFactualSpatialState(): void {
    this.spatialState.foot = this.currentAnim.anim.GetOutgoingFoot();

    if (this.currentAnim.anim.GetVariable('outgoing_special_state') !== '') {
      this.spatialState.floatVelocity = 0;
      this.spatialState.enumVelocity = e_Velocity.e_Velocity_Idle;
      this.spatialState.movement = new Vector3(0);
    }
  }

  protected AddTripCommandToQueue(commandQueue: PlayerCommandQueue, tripVector: Vector3, tripType: number): void {
    // (like the original, this uses the tripDirection member instead of the tripVector parameter)
    if (tripType === 1) {
      commandQueue.push(this.GetTripCommand(this.tripDirection, tripType));
    } else {
      // allow both types 2 and 3, but prefer the right one
      let otherTripType = 3;
      if (tripType === 3) otherTripType = 2;
      commandQueue.push(this.GetTripCommand(this.tripDirection, tripType));
      commandQueue.push(this.GetTripCommand(this.tripDirection, otherTripType));
      commandQueue.push(this.GetTripCommand(this.tripDirection, 1));
    }
  }

  protected GetTripCommand(tripVector: Vector3, tripType: number): PlayerCommand {
    const command = new PlayerCommand();
    command.desiredFunctionType = e_FunctionType.e_FunctionType_Trip;
    command.useDesiredMovement = false;
    command.useDesiredTripDirection = true;
    command.desiredTripDirection = tripVector;
    command.desiredVelocityFloat = this.spatialState.floatVelocity;
    command.useTripType = true;
    command.tripType = tripType;
    return command;
  }

  protected GetBasicMovementCommand(desiredDirection: Vector3, velocityFloat: number): PlayerCommand {
    // (like the original, this uses the current direction instead of the desiredDirection parameter)
    const command = new PlayerCommand();
    command.desiredFunctionType = e_FunctionType.e_FunctionType_Movement;
    command.useDesiredMovement = true;
    command.useDesiredLookAt = true;
    command.desiredDirection = this.spatialState.directionVec;
    command.desiredVelocityFloat = velocityFloat;
    command.desiredLookAt = this.spatialState.position.Add(command.desiredDirection.Mul(10.0));
    return command;
  }

  // ----- dataset sorting predicates
  // PORT: every C++ Compare*(a, b) predicate is of the form key(a) < key(b) for a per-anim key; the Compare*
  // methods are kept, and this class sorts with _SortDataSetByKey (computes each key once, then stable sorts),
  // which gives exactly the order of std::stable_sort with the Compare* predicate.

  /**
   * Stable ascending sort of dataSet by key(animIndex). Equivalent to
   * std::stable_sort(dataSet, [](a, b) { return key(a) < key(b); }) but evaluates each key only once.
   */
  protected _SortDataSetByKey(dataSet: DataSet, key: (animIndex: number) => number): void {
    const n = dataSet.length;
    if (n < 2) return;
    const keys = new Float64Array(n);
    const order = new Array<number>(n);
    const ids = dataSet.slice();
    for (let i = 0; i < n; i++) {
      keys[i] = key(ids[i]);
      order[i] = i;
    }
    order.sort((a, b) => (keys[a] < keys[b] ? -1 : keys[b] < keys[a] ? 1 : a - b));
    for (let i = 0; i < n; i++) dataSet[i] = ids[order[i]];
  }

  protected SetFootSimilarityPredicate(desiredFoot: e_Foot): void {
    this.predicate_DesiredFoot = desiredFoot;
  }

  private _FootSimilarityKey(animIndex: number): number {
    const anim = this.anims.GetAnim(animIndex);
    let key = 1;
    if (anim.GetCurrentFoot() === this.predicate_DesiredFoot) key = 0;
    if (FloatToEnumVelocity(anim.GetIncomingVelocity()) === e_Velocity.e_Velocity_Idle) key = 0;
    return key;
  }

  protected CompareFootSimilarity(animIndex1: number, animIndex2: number): boolean {
    return this._FootSimilarityKey(animIndex1) < this._FootSimilarityKey(animIndex2);
  }

  protected SetIncomingVelocitySimilarityPredicate(velocity: e_Velocity): void {
    this.predicate_IncomingVelocity = velocity;
  }

  private _IncomingVelocitySimilarityKey(animIndex: number): number {
    const anim = this.anims.GetAnim(animIndex);
    const currentVelocityID = GetVelocityID(this.predicate_IncomingVelocity);

    // rate difference anim incoming / actual incoming
    const anim_incomingVelocityID = GetVelocityID(FloatToEnumVelocity(anim.GetIncomingVelocity()));
    let rating = Math.abs(clamp(anim_incomingVelocityID - currentVelocityID, -3, 3));

    // also add a penalty for anim incoming velocities which aren't between actual incoming and anim outgoing
    const anim_outgoingVelocityID = GetVelocityID(FloatToEnumVelocity(anim.GetOutgoingVelocity()));
    if (anim_incomingVelocityID > Math.max(currentVelocityID, anim_outgoingVelocityID)) rating += 0.5;
    if (anim_incomingVelocityID < Math.min(currentVelocityID, anim_outgoingVelocityID)) rating += 0.5;
    return rating;
  }

  protected CompareIncomingVelocitySimilarity(animIndex1: number, animIndex2: number): boolean {
    return this._IncomingVelocitySimilarityKey(animIndex1) < this._IncomingVelocitySimilarityKey(animIndex2);
  }

  protected SetMovementSimilarityPredicate(relDesiredDirection: Vector3, desiredVelocity: e_Velocity): void {
    this.predicate_RelDesiredDirection = relDesiredDirection;
    this.predicate_DesiredVelocity = desiredVelocity;
    // this isn't working all too well: if targetmovement is set to 0 (aka corneringbias towards 1), both dribble @ 0 deg and dribble @ 90 deg will be the same distance (from 0), so still no preference for braking straight
    this.predicate_CorneringBias = CalculateBiasForFastCornering(
      new Vector3(0, -1.0 * this.spatialState.floatVelocity, 0),
      relDesiredDirection.Mul(EnumToFloatVelocity(desiredVelocity)),
      1.0,
      0.9,
    ); // anim space values!
  }

  protected GetMovementSimilarity(animIndex: number, relDesiredDirection: Vector3, desiredVelocity: e_Velocity, corneringBias: number): number {
    let desiredMovement = relDesiredDirection.Mul(EnumToFloatVelocity(desiredVelocity));

    const anim = this.anims.GetAnim(animIndex);
    const outgoingDirection = this.ForceIntoPreferredDirectionVec(anim.GetOutgoingDirection());
    const outgoingVelocity = RangeVelocity(anim.GetOutgoingVelocity());
    const outgoingMovement = outgoingDirection.Mul(outgoingVelocity);

    // anims that end at lower velocities have an advantage: they don't get dragged into the currentmovement that much
    // thus: have a bias that is higher at higher outgoing velocities, which means anim outgoingmovement gets more % of current movement and less % of their own
    // *enabled again: altered the physics system so that it will regard anim movement more, so this became useful again for proper hard cornering

    desiredMovement = desiredMovement.Mul(1.0 - corneringBias);

    let value = desiredMovement.Sub(outgoingMovement).GetLength();

    value -= Math.abs(relDesiredDirection.GetDotProduct(outgoingDirection)) * 4.0; // prefer straight lines (towards/away from desired outgoing)

    return value;
  }

  private _MovementSimilarityKey(animIndex: number): number {
    return this.GetMovementSimilarity(animIndex, this.predicate_RelDesiredDirection, this.predicate_DesiredVelocity, this.predicate_CorneringBias);
  }

  protected CompareMovementSimilarity(animIndex1: number, animIndex2: number): boolean {
    return this._MovementSimilarityKey(animIndex1) < this._MovementSimilarityKey(animIndex2);
  }

  private _DirectionSimilarityKey(animIndex: number): number {
    return Math.abs(this.predicate_RelDesiredDirection.GetAngle2D(this.anims.GetAnim(animIndex).GetOutgoingDirection()));
  }

  protected CompareDirectionSimilarity(animIndex1: number, animIndex2: number): boolean {
    return this._DirectionSimilarityKey(animIndex1) < this._DirectionSimilarityKey(animIndex2);
  }

  private _OutgoingVelocitySimilarityKey(animIndex: number): number {
    return Math.abs(clamp(RangeVelocity(this.anims.GetAnim(animIndex).GetOutgoingVelocity()) - EnumToFloatVelocity(this.predicate_DesiredVelocity), -sprintVelocity, sprintVelocity));
  }

  protected CompareOutgoingVelocitySimilarity(animIndex1: number, animIndex2: number): boolean {
    return this._OutgoingVelocitySimilarityKey(animIndex1) < this._OutgoingVelocitySimilarityKey(animIndex2);
  }

  protected SetIncomingBodyDirectionSimilarityPredicate(relIncomingBodyDirection: Vector3): void {
    this.predicate_RelIncomingBodyDirection = relIncomingBodyDirection;
  }

  private _IncomingBodyDirectionSimilarityKey(animIndex: number): number {
    const anim = this.anims.GetAnim(animIndex);
    let rating = Math.abs(this.ForceIntoAllowedBodyDirectionVec(anim.GetIncomingBodyDirection()).GetAngle2D(this.ForceIntoAllowedBodyDirectionVec(this.predicate_RelIncomingBodyDirection))) / pi;
    if (FloatToEnumVelocity(anim.GetIncomingVelocity()) === e_Velocity.e_Velocity_Idle) rating = 0;
    return rating;
  }

  protected CompareIncomingBodyDirectionSimilarity(animIndex1: number, animIndex2: number): boolean {
    return this._IncomingBodyDirectionSimilarityKey(animIndex1) < this._IncomingBodyDirectionSimilarityKey(animIndex2);
  }

  protected SetBodyDirectionSimilarityPredicate(lookAt: Vector3): void {
    this.predicate_LookAt = lookAt;
  }

  /** (predicate_LookAt - position) in anim space; the loop-invariant part of the body direction rating */
  private _GetRelLookAt(): Vector3 {
    return this.predicate_LookAt.Sub(this.spatialState.position).GetRotated2D(-this.spatialState.angle);
  }

  private _BodyDirectionSimilarityKey(animIndex: number, relLookAt: Vector3): number {
    const a = this.anims.GetAnim(animIndex);

    const relDesiredBodyDirection = relLookAt.Sub(a.GetTranslation()).GetNormalized(DOWN);

    // this version corrects for rotation smuggle; we will probably end up walking in a direction a bit rotated towards the user desired direction, instead of pure anim direction.
    // we need some heuristic to use that fact, because else, we may end up looking in the wrong direction somewhat
    const maxAngleSmuggle = 0.1 * pi; // mind you, for anims ending idle, this shouldn't be >= 0.125f * pi, because then we end up allowing multiple outgoing angles.
    // after all, outgoing direction will be skewed by this value as max, which will make outgoing body direction follow in the same dir
    // but since idle anims don't have outgoing body directions, it will just change their outgoing directions and they will be pointing in exactly the same direction
    const outgoingDirection = a.GetOutgoingDirection();
    const outgoingAngle = outgoingDirection
      .GetRotated2D(clamp(this.predicate_RelDesiredDirection.GetAngle2D(outgoingDirection), -maxAngleSmuggle, maxAngleSmuggle))
      .GetAngle2D(DOWN);
    const predictedOutgoingBodyDirection = a.GetOutgoingBodyDirection().GetRotated2D(outgoingAngle);
    let rating = Math.abs(predictedOutgoingBodyDirection.GetAngle2D(relDesiredBodyDirection));

    // penalty for body angles (as opposed to straight forward), to get a slight preference for forward angles
    rating += Math.abs(a.GetOutgoingBodyAngle()) * 0.05;

    return rating;
  }

  protected CompareBodyDirectionSimilarity(animIndex1: number, animIndex2: number): boolean {
    const relLookAt = this._GetRelLookAt();
    return this._BodyDirectionSimilarityKey(animIndex1, relLookAt) < this._BodyDirectionSimilarityKey(animIndex2, relLookAt);
  }

  protected SetTripDirectionSimilarityPredicate(relDesiredTripDirection: Vector3): void {
    this.predicate_RelDesiredTripDirection = relDesiredTripDirection;
  }

  private _TripDirectionSimilarityKey(animIndex: number): number {
    return -GetVectorFromString(this.anims.GetAnim(animIndex).GetVariable('bumpdirection')).GetDotProduct(this.predicate_RelDesiredTripDirection);
  }

  protected CompareTripDirectionSimilarity(animIndex1: number, animIndex2: number): boolean {
    return this._TripDirectionSimilarityKey(animIndex1) < this._TripDirectionSimilarityKey(animIndex2);
  }

  protected SetBallDirectionSimilarityPredicate(relDesiredBallDirection: Vector3): void {
    this.predicate_RelDesiredBallDirection = relDesiredBallDirection;
  }

  private _BallDirectionSimilarityKey(animIndex: number): number {
    return -GetVectorFromString(this.anims.GetAnim(animIndex).GetVariable('balldirection')).Get2D().GetDotProduct(this.predicate_RelDesiredBallDirection);
  }

  protected CompareBallDirectionSimilarity(animIndex1: number, animIndex2: number): boolean {
    return this._BallDirectionSimilarityKey(animIndex1) < this._BallDirectionSimilarityKey(animIndex2);
  }

  /** 0 for base anims, 1 otherwise (CompareBaseanimSimilarity: isBase1 && !isBase2) */
  private _BaseanimSimilarityKey(animIndex: number): number {
    return this.anims.GetAnim(animIndex).GetVariable('baseanim') === 'true' ? 0 : 1;
  }

  protected CompareBaseanimSimilarity(animIndex1: number, animIndex2: number): boolean {
    const isBase1 = this.anims.GetAnim(animIndex1).GetVariable('baseanim') === 'true';
    const isBase2 = this.anims.GetAnim(animIndex2).GetVariable('baseanim') === 'true';

    if (isBase1 === true && isBase2 === false) return true;
    return false;
  }

  protected CompareCatchOrDeflect(animIndex1: number, animIndex2: number): boolean {
    const catch1 = this.anims.GetAnim(animIndex1).GetVariable('outgoing_retain_state') !== '';
    const catch2 = this.anims.GetAnim(animIndex2).GetVariable('outgoing_retain_state') !== '';

    if (catch1 === true && catch2 === false) return true;
    return false;
  }

  protected SetNumericVariableSimilarityPredicate(varName: string, desiredValue: number): void {
    this.predicate_NumericVariableName = varName;
    this.predicate_NumericVariableValue = desiredValue;
  }

  private _NumericVariableKey(animIndex: number): number {
    return Math.abs(atof(this.anims.GetAnim(animIndex).GetVariable(this.predicate_NumericVariableName)) - this.predicate_NumericVariableValue);
  }

  protected CompareNumericVariable(animIndex1: number, animIndex2: number): boolean {
    return this._NumericVariableKey(animIndex1) < this._NumericVariableKey(animIndex2);
  }

  /**
   * C++ Vector3 CalculatePhysicsVector(anim, useDesiredMovement, desiredMovement, useDesiredBodyDirection,
   * desiredBodyDirectionRel, std::vector<Vector3> &positions_ret, radian &rotationOffset_ret).
   * positions_ret is cleared and filled; result is the C++ return value.
   */
  protected CalculatePhysicsVector(
    anim: Animation,
    useDesiredMovement: boolean,
    desiredMovement: Vector3,
    useDesiredBodyDirection: boolean,
    desiredBodyDirectionRel: Vector3,
    positions_ret: Vector3[],
  ): { result: Vector3; rotationOffset_ret: radian } {
    positions_ret.length = 0;
    let rotationOffset_ret: radian;

    const spatialState = this.spatialState;
    const player = this.player;

    const animTouchFrame = atoi(anim.GetVariable('touchframe'));
    const touch = animTouchFrame > 0;

    const stat_agility = player.GetStat('physical_agility');
    const stat_acceleration = player.GetStat('physical_acceleration');
    const stat_dribble = player.GetStat('technical_dribble');

    const incomingSwitchBias = 0.0; // anything other than 0.0 may result in unpuristic behavior
    let outgoingSwitchBias = 0.0;

    const animType = anim.GetAnimType();
    const isMovement = animType === 'movement';
    const isBallControl = animType === 'ballcontrol';
    const isTrap = animType === 'trap';
    const isInterfere = animType === 'interfere';
    const isDeflect = animType === 'deflect';
    const isSliding = animType === 'sliding';
    const isSpecial = animType === 'special';
    const isTrip = animType === 'trip';

    if (isBallControl) {
      outgoingSwitchBias = 0.0;
    } else if (isTrap) {
      outgoingSwitchBias = 0.0;
    } else if (isInterfere) {
      outgoingSwitchBias = 0.0;
    } else if (isDeflect) {
      outgoingSwitchBias = 1.0;
    } else if (isSliding) {
      outgoingSwitchBias = 0.0;
    } else if (isSpecial) {
      outgoingSwitchBias = 1.0;
    } else if (isTrip) {
      outgoingSwitchBias = 0.5; // direction partly predecided by collision function in match class
    } else if (touch) {
      outgoingSwitchBias = 1.0;
    }

    const hasIncomingSpecialState = anim.GetVariable('incoming_special_state') !== '';
    if (hasIncomingSpecialState || anim.GetVariable('outgoing_special_state') !== '') outgoingSwitchBias = 1.0;

    const animIncomingMovement = new Vector3(0, -1, 0).GetRotated2D(spatialState.angle).Mul(RangeVelocity(anim.GetIncomingVelocity()));
    const adaptedCurrentMovement = animIncomingMovement.Mul(incomingSwitchBias).Add(spatialState.movement.Mul(1.0 - incomingSwitchBias));

    const predictedOutgoingMovement = anim.GetOutgoingMovement().GetRotated2D(spatialState.angle);
    const velocifiedDesiredMovement = useDesiredMovement ? desiredMovement : predictedOutgoingMovement;

    assert(desiredMovement.coords[2] === 0.0);

    const adaptedDesiredMovement = predictedOutgoingMovement.Mul(outgoingSwitchBias).Add(velocifiedDesiredMovement.Mul(1.0 - outgoingSwitchBias));
    assert(predictedOutgoingMovement.coords[2] === 0.0);
    assert(velocifiedDesiredMovement.coords[2] === 0.0);
    assert(adaptedDesiredMovement.coords[2] === 0.0);

    const playerMaxVelocity = player.GetMaxVelocity();
    let maxVelocity = playerMaxVelocity;
    if (touch) maxVelocity *= 0.92;

    let resultingMovement: Vector3;

    const timeStep_ms = 10;

    const difficultyFactor = atof(anim.GetVariable('animdifficultyfactor'));
    const difficultyPenaltyFactor = Math.pow(clamp((difficultyFactor - 0.0) * (1.0 - (stat_agility * 0.2 + stat_acceleration * 0.2)) * 2.0, 0.0, 1.0), 0.7);

    let powerFactor = 1.0 - clamp(Math.pow(player.GetLastTouchBias(1000), 0.8) * (0.8 - stat_dribble * 0.3), 0.0, 0.4); // todo: put lasttouchbias thing in loop, so it'll change over time (in that loop)
    // moved to per ms timeloop penalty
    powerFactor *= 1.0 - clamp(this.decayingPositionOffset.GetLength() * (10.0 - player.GetStat('physical_balance') * 5.0) - 0.1, 0.0, 0.3);

    let temporalMovement = adaptedCurrentMovement;

    assert(adaptedCurrentMovement.coords[2] === 0.0);
    assert(adaptedDesiredMovement.coords[2] === 0.0);

    // orig anim positions

    const origPositionCache = this.match.GetAnimPositionCache(anim);

    let currentPosition = new Vector3(0);

    // amount of pure physics that 'shines through' pure anim
    let physicsBias = 1.0;
    // angle deviation away from anim
    let maxAngleMod_underAnimAngle: radian = 0.125 * pi;
    let maxAngleMod_overAnimAngle: radian = 0.125 * pi;
    let maxAngleMod_straightAnimAngle: radian = 0.125 * pi;
    if (touch) {
      let bonus = 1.0 - Math.pow(NormalizedClamp(adaptedCurrentMovement.Add(predictedOutgoingMovement).GetLength() * 0.5, 0, sprintVelocity), 0.8) * 0.8;
      bonus *= 0.6 + 0.4 * player.GetStat('technical_ballcontrol'); // todo: shouldn't this be agility?
      maxAngleMod_underAnimAngle = 0.2 * pi * bonus;
      maxAngleMod_overAnimAngle = 0;
      maxAngleMod_straightAnimAngle = 0.1 * pi * bonus;
    }
    if (isSliding) {
      maxAngleMod_underAnimAngle = 0.5 * pi;
      maxAngleMod_overAnimAngle = 0.5 * pi;
      maxAngleMod_straightAnimAngle = 0.5 * pi;
    }

    if (isMovement) physicsBias *= 1.0;

    if (isBallControl) physicsBias *= 1.0;
    if (isTrap) physicsBias *= 1.0;

    if (animType === 'shortpass') physicsBias *= 0.0;
    if (animType === 'highpass') physicsBias *= 0.0;
    if (animType === 'shot') physicsBias *= 0.0;

    if (isInterfere) physicsBias *= 0.5;
    if (isDeflect) physicsBias *= 0.0;

    if (isSliding) physicsBias *= 1.0;
    if (isTrip) {
      if (anim.GetVariable('triptype') === '1') physicsBias *= 0.5;
      else physicsBias *= 0.0;
    }

    if (isSpecial) physicsBias *= 0.0;
    if (hasIncomingSpecialState) physicsBias *= 0.0;

    const mod_AllowRotation: boolean = true;
    const mod_CorneringBraking: boolean = false;
    const mod_PointinessCurve: boolean = true;
    const mod_MaximumAccelDecel: boolean = false;
    const mod_BrakeOnTouch: boolean = false; // may be too pointy for anims near 90 degree
    const mod_MaxCornering: boolean = true;
    const mod_MaxChange: boolean = true;
    const mod_AirResistance: boolean = true;
    const mod_CheatBodyDirection: boolean = false;

    const accelerationMultiplier = 0.5 + this._cache_AccelerationFactor;

    // rotate anim towards desired angle

    let toDesiredAngle_capped: radian = 0;
    if (mod_AllowRotation && physicsBias > 0.0) {
      let animOutgoingVector = predictedOutgoingMovement.GetNormalized(0);
      if (FloatToEnumVelocity(predictedOutgoingMovement.GetLength()) === e_Velocity.e_Velocity_Idle) animOutgoingVector = anim.GetOutgoingDirection().GetRotated2D(spatialState.angle);
      let desiredVector = adaptedDesiredMovement.GetNormalized(0);
      if (FloatToEnumVelocity(adaptedDesiredMovement.GetLength()) === e_Velocity.e_Velocity_Idle) desiredVector = desiredBodyDirectionRel.GetRotated2D(spatialState.angle);
      const toDesiredAngle = desiredVector.GetAngle2D(animOutgoingVector);
      if (Math.abs(toDesiredAngle) <= 0.5 * pi || isSliding) {
        // if we want > x degrees, just skip it to next anim, it'll only look weird otherwise

        const animChange = animOutgoingVector.GetAngle2D(spatialState.directionVec);
        if (Math.abs(animChange) > 0.06 * pi) {
          const sign = signSide(animChange);
          if (signSide(toDesiredAngle) === sign) {
            toDesiredAngle_capped = clamp(toDesiredAngle, -maxAngleMod_overAnimAngle, maxAngleMod_overAnimAngle);
          } else {
            toDesiredAngle_capped = clamp(toDesiredAngle, -maxAngleMod_underAnimAngle, maxAngleMod_underAnimAngle);
          }
        } else {
          // straight ahead anim, has no specific side.
          toDesiredAngle_capped = clamp(toDesiredAngle, -maxAngleMod_straightAnimAngle, maxAngleMod_straightAnimAngle);
        }
      }
    }

    let maximumOutgoingVelocity = sprintVelocity;
    // brake on cornering
    if (mod_CorneringBraking) {
      let brakeBias = 0.8;
      brakeBias *= touch ? 1.0 : 0.8;
      brakeBias *= 1.0 - stat_agility * 0.2;

      let animOutgoingMovement = anim.GetOutgoingMovement();
      animOutgoingMovement = animOutgoingMovement.GetRotated2D(toDesiredAngle_capped);
      brakeBias *= Math.pow(NormalizedClamp(spatialState.floatVelocity, idleVelocity, sprintVelocity - 0.5), 0.8); // 0.5f);
      const maxVelo =
        sprintVelocity * (1.0 - brakeBias + (1.0 - Math.pow(Math.abs(animOutgoingMovement.GetNormalized(0).GetAngle2D(DOWN) / pi), 0.5)) * brakeBias);
      maximumOutgoingVelocity = maxVelo;
    }

    const frameCount = anim.GetFrameCount();
    const effectiveFrameCount = anim.GetEffectiveFrameCount();
    const outgoingVelocityIsIdle = FloatToEnumVelocity(anim.GetOutgoingVelocity()) === e_Velocity.e_Velocity_Idle;

    // --- loop da loop ------------------------------------------------------------------------------------------------------------------------------------------
    for (let time_ms = 0; time_ms < frameCount * 10; time_ms += timeStep_ms) {
      // start with +1, because we want to influence the first frame as well
      // as for finishing, finish with frameBias = 1.0, even if the last frame is 'spiritually' the one-to-last, since the first frame of the next anim is actually 'same-tempered' as the current anim's last frame.
      // however, it works best to have all values 'done' at this one-to-last frame, so the next anim can read out these correct (new starting) values.
      const frameBias = (time_ms + 10) / ((effectiveFrameCount + 1) * 10);

      let lagExp = 1.0;
      if (mod_PointinessCurve && physicsBias > 0.0 && (isBallControl || isMovement)) {
        lagExp = 1.4 - this._cache_AgilityFactor * 0.8;
        lagExp *= 1.2 - stat_agility * 0.4;
        if (touch) {
          lagExp += -0.1 + clamp(difficultyFactor * 0.4, 0.0, 0.5);
        } else {
          lagExp += -0.2 + clamp(difficultyFactor * 0.2, 0.0, 0.2);
        }

        lagExp = clamp(lagExp, 0.25, 4.0);
        if (touch && time_ms < animTouchFrame * 10) lagExp = Math.max(lagExp, 0.7); // else, we could 'miss' the ball because we're already turned around too much

        lagExp = lagExp * physicsBias + 1.0 * (1.0 - physicsBias);
      }
      const adaptedFrameBias = Math.pow(frameBias, lagExp);
      const animMovement = CalculateMovementAtFrame(origPositionCache, Math.trunc(effectiveFrameCount * adaptedFrameBias), 1).GetRotated2D(spatialState.angle);

      const animVelo = animMovement.GetLength();
      let adaptedAnimMovement = animMovement;
      let adaptedAnimVelo = animVelo;

      // adapt sprint velocity to player's max velocity stat

      if (animVelo > walkSprintSwitch && (isMovement || isBallControl || isTrap)) {
        if (maxVelocity > animVelo) {
          // only speed up, don't slow down. may be faster parts (jumps and such) within anim, allow this
          adaptedAnimVelo = StretchSprintTo(animVelo, animSprintVelocity, maxVelocity);
          adaptedAnimMovement = adaptedAnimMovement.GetNormalized(0).Mul(adaptedAnimVelo);
        }
      }

      let maxSlower = 1.6; // rationale: don't want to end up below dribbleVelocity - idleDribbleSwitch (= change velocity)
      if (touch) maxSlower = 1.2;
      let maxFaster = 0.0;
      if (touch) maxFaster = 0.0;
      const temporalVelo = temporalMovement.GetLength();
      if (temporalVelo > adaptedAnimVelo) maxFaster = Math.min(0.0 + 1.0 * (1.0 - frameBias), Math.max(maxFaster, temporalVelo - adaptedAnimVelo)); // ..already going faster.. well okay, allow this
      if (maxFaster > 0) maxFaster *= Math.max(0.0, adaptedAnimMovement.GetNormalizedMax(1.0).GetDotProduct(adaptedDesiredMovement.GetNormalized(0))); // only go faster if it's in the right direction
      if (isSliding) maxFaster = 100;
      const desiredVelocity = adaptedDesiredMovement.GetLength();
      adaptedAnimVelo = clamp(desiredVelocity, adaptedAnimVelo - maxSlower, adaptedAnimVelo + maxFaster);
      adaptedAnimMovement = adaptedAnimMovement.GetNormalized(0).Mul(adaptedAnimVelo);

      if (mod_CorneringBraking) {
        const frameBiasedMaximumOutgoingVelocity = sprintVelocity * (1.0 - frameBias) + maximumOutgoingVelocity * frameBias;
        if (adaptedAnimVelo > frameBiasedMaximumOutgoingVelocity) {
          adaptedAnimVelo = frameBiasedMaximumOutgoingVelocity;
          adaptedAnimMovement = adaptedAnimMovement.GetNormalized(0).Mul(adaptedAnimVelo);
        }
      }

      if (mod_MaximumAccelDecel) {
        // this is basically meant to enforce transitions to be smoother, disallowing bizarre steps. however, with low enough max values, it can also serve as a physics slowness thing.
        // in that regard, the maxaccel part is somewhat similar to the air resistance mod below. they can live together; this one can serve as a constant maximum, and the air resistance as a velocity-based maximum.
        // update: decided to not let them live together, this should now purely be used for capping transition speed
        const maxAccelMPS = 20.0;
        const maxDecelMPS = 20.0;
        const currentVelo = temporalMovement.GetLength();
        const veloChangeMPS = (adaptedAnimVelo - currentVelo) / (timeStep_ms * 0.001);
        if (veloChangeMPS < -maxDecelMPS || veloChangeMPS > maxAccelMPS) {
          adaptedAnimVelo = currentVelo + clamp(veloChangeMPS, -maxDecelMPS, maxAccelMPS) * (timeStep_ms * 0.001);
          adaptedAnimMovement = adaptedAnimMovement.GetNormalized(0).Mul(adaptedAnimVelo);
        }
      }

      let resultingPhysicsMovement = adaptedAnimMovement;

      // angle
      resultingPhysicsMovement = resultingPhysicsMovement.GetRotated2D(toDesiredAngle_capped * frameBias);

      // --- stay true to anim? -----------------------------------------------------------------------------------------------------------------------

      resultingPhysicsMovement = resultingPhysicsMovement.Mul(physicsBias).Add(animMovement.Mul(1.0 - physicsBias));

      // that's it, we now know where we want to go in life

      let toDesired = resultingPhysicsMovement.Sub(temporalMovement);

      // --- end --------------------------------------------------------------------------------------------------------------------------------------

      assert(toDesired.coords[2] === 0.0);

      let penaltyBreakFactor = 0.0;
      if (mod_BrakeOnTouch) {
        // slow down after touching ball
        // (precalc at touchframe, because temporalMovement will change because of this, so if we don't precalc then changing numBrakeFrames will change the amount of effect)
        const numBrakeFrames = 15;
        if (touch && time_ms >= animTouchFrame * 10 && time_ms < (animTouchFrame + numBrakeFrames) * 10) {
          const brakeFramesInto = Math.trunc((time_ms - animTouchFrame * 10) / 10);
          const brakeFrameFactor = Math.pow(1.0 - brakeFramesInto / numBrakeFrames, 0.5);

          const touchBrakeFactor = 0.3;

          let touchDifficultyFactor = clamp((difficultyFactor + 0.7) * (1.0 - stat_dribble * 0.4), 0.0, 1.0);
          touchDifficultyFactor *= 1.0 - Math.pow(Math.abs(anim.GetOutgoingAngle()) / pi, 0.75); // don't help with braking (when going nearer 180 deg)

          const veloFactor = NormalizedClamp(temporalMovement.GetLength(), walkVelocity, sprintVelocity);

          penaltyBreakFactor = touchDifficultyFactor * veloFactor * brakeFrameFactor * touchBrakeFactor;
        }
      }

      if (mod_MaxCornering) {
        const predictedMovement = temporalMovement.Add(toDesired);
        const startVelo = idleDribbleSwitch;
        if (temporalMovement.GetLength() > startVelo && predictedMovement.GetLength() > startVelo) {
          const angle = predictedMovement.GetNormalized().GetAngle2D(temporalMovement.GetNormalized());
          let maxAngleFactor = 1.0 * (timeStep_ms / 1000.0);
          maxAngleFactor *= 0.7 + 0.3 * stat_agility;
          if (!touch) maxAngleFactor *= 1.5;
          let maxAngle = maxAngleFactor * pi;
          const veloFactor = Math.pow(NormalizedClamp(temporalMovement.GetLength(), 0, sprintVelocity), 1.0);
          maxAngle /= veloFactor + 0.01;

          if (Math.abs(angle) > maxAngle) {
            const mode: number = 1; // 0: restrict max angle, 1: restrict velocity

            if (mode === 0) {
              const restrictedPredictedMovement = predictedMovement.GetRotated2D((Math.abs(angle) - maxAngle) * -signSide(angle));
              const newToDesired = restrictedPredictedMovement.Sub(temporalMovement);
              toDesired = newToDesired;
            } else if (mode === 1) {
              const overAngle = Math.abs(angle) - maxAngle; // > 0
              toDesired = toDesired.Add(temporalMovement.Neg().Mul(clamp((overAngle / pi) * 3.0, 0.0, 1.0))); // was: 3
            }
          }
        }
      }

      if (mod_MaxChange) {
        let maxChange = 0.03;
        if (isTrip) maxChange *= 0.7;
        if (isSliding) maxChange = 0.1;
        // no power first few frames, so transitions are smoother
        const veloFactor = Math.pow(NormalizedClamp(temporalMovement.GetLength(), 0, sprintVelocity), 1.5);
        let firstStepFactor = veloFactor;
        if (isMovement) firstStepFactor *= 0.4;
        maxChange *= 1.0 - firstStepFactor + firstStepFactor * curve(NormalizedClamp(time_ms, 0.0, 160.0), 1.0);

        maxChange *= 1.2 - veloFactor * 0.4;

        maxChange *= 0.75 + this._cache_AgilityFactor * 0.5;

        maxChange *= powerFactor;

        const desiredLength = toDesired.GetLength();
        const maxAddition = maxChange * timeStep_ms;

        toDesired = toDesired.GetNormalizedMax(Math.min(desiredLength, maxAddition));
      }

      // air resistance

      if (mod_AirResistance && !isSliding && !isDeflect) {
        const veloExp = 1.8;
        let accelPower = 11.0 * accelerationMultiplier;
        const falloffStartVelo = idleDribbleSwitch;

        if (temporalMovement.Add(toDesired).GetLength() > falloffStartVelo) {
          // less accelpower on tough anims
          accelPower *= 1.0 - difficultyPenaltyFactor * 0.4;

          const veloAirResistanceFactor = clamp(
            Math.pow(clamp((temporalMovement.GetLength() - falloffStartVelo) / (playerMaxVelocity - falloffStartVelo), 0.0, 1.0), veloExp),
            0.0,
            1.0,
          );

          // circular version
          let forwardVector = new Vector3(0);
          if (temporalMovement.Add(toDesired).GetLength() > temporalMovement.GetLength()) {
            // outside the 'velocity circle'
            const destination = temporalMovement.Add(toDesired);
            const velo = temporalMovement.GetLength();
            const accel = destination.GetLength() - velo;
            forwardVector = destination.GetNormalized(0).Mul(accel);
          }

          const accelerationAddition = forwardVector.GetLength();
          const maxAccelerationMPS = accelPower * (1.0 - veloAirResistanceFactor) * (stat_acceleration * 0.3 + 0.7);
          const maxAccelerationAddition = maxAccelerationMPS * (timeStep_ms / 1000.0);
          if (accelerationAddition > maxAccelerationAddition) {
            const remainingFactor = maxAccelerationAddition / accelerationAddition;
            toDesired = toDesired.Sub(forwardVector.Mul(1.0 - remainingFactor));
          }
        }
      }

      // MAKE IT SEW! http://static.wixstatic.com/media/fc58ad_c0ef2d69d98f4f7ba8e7e488f0e28ece.jpg

      let tmpTemporalMovement = temporalMovement.Add(toDesired);

      // make sure outgoing velocity is of the same idleness as the anim
      if (time_ms >= (frameCount - 2) * 10) {
        let hardQuantize: boolean = true;
        if (!hardQuantize && anim.GetVariable('outgoing_special_state') !== '') hardQuantize = true;

        if (!hardQuantize) {
          // soft version
          if (outgoingVelocityIsIdle && FloatToEnumVelocity(tmpTemporalMovement.GetLength()) !== e_Velocity.e_Velocity_Idle) {
            tmpTemporalMovement = tmpTemporalMovement.GetNormalizedTo(idleDribbleSwitch - 0.01);
          } else if (!outgoingVelocityIsIdle && FloatToEnumVelocity(tmpTemporalMovement.GetLength()) === e_Velocity.e_Velocity_Idle) {
            tmpTemporalMovement = anim.GetOutgoingMovement().GetRotated2D(spatialState.angle).GetNormalizedTo(idleDribbleSwitch + 0.01);
          }
        } else {
          // hard version
          if (outgoingVelocityIsIdle && FloatToEnumVelocity(tmpTemporalMovement.GetLength()) !== e_Velocity.e_Velocity_Idle) {
            tmpTemporalMovement = new Vector3(0);
          } else if (!outgoingVelocityIsIdle && FloatToEnumVelocity(tmpTemporalMovement.GetLength()) === e_Velocity.e_Velocity_Idle) {
            tmpTemporalMovement = anim.GetOutgoingMovement().GetRotated2D(spatialState.angle).GetNormalizedTo(dribbleVelocity);
          }
        }
      }

      assert(tmpTemporalMovement.coords[2] === 0.0);
      temporalMovement = tmpTemporalMovement;

      if (time_ms >= (frameCount - 2) * 10) penaltyBreakFactor = 0.0;
      currentPosition = currentPosition.Add(temporalMovement.Mul(1.0 - penaltyBreakFactor).Mul(timeStep_ms / 1000.0));
      assert(currentPosition.coords[2] === 0.0);

      if (time_ms % 10 === 0) {
        positions_ret.push(currentPosition);
      }
    }

    assert(positions_ret.length >= frameCount);
    resultingMovement = temporalMovement;

    if (!outgoingVelocityIsIdle && FloatToEnumVelocity(resultingMovement.GetLength()) !== e_Velocity.e_Velocity_Idle) {
      rotationOffset_ret = resultingMovement.GetRotated2D(-spatialState.angle).GetAngle2D(anim.GetOutgoingMovement());
    } else {
      rotationOffset_ret = toDesiredAngle_capped * physicsBias;
    }

    // body direction assist
    if (mod_CheatBodyDirection && useDesiredBodyDirection && isMovement) {
      const angleFactor = 0.5;
      const maxAngle = 0.25 * pi;

      const predictedAngleRel = anim.GetOutgoingAngle() + anim.GetOutgoingBodyAngle() + rotationOffset_ret;
      const desiredRotationOffset = desiredBodyDirectionRel.GetRotated2D(-predictedAngleRel).GetAngle2D(DOWN);

      if (Math.abs(desiredRotationOffset) < 0.5 * pi) {
        // else: too much

        const outgoingVelocityFactorInv = 1.0 - NormalizedClamp(resultingMovement.GetLength(), idleDribbleSwitch, sprintVelocity - 1.0) * 1.0;
        const animLengthFactor = NormalizedClamp(anim.GetFrameCount(), 0, 25);
        const maximizedRotationOffset = clamp(
          desiredRotationOffset,
          outgoingVelocityFactorInv * animLengthFactor * angleFactor * -maxAngle,
          outgoingVelocityFactorInv * animLengthFactor * angleFactor * maxAngle,
        );

        rotationOffset_ret += maximizedRotationOffset;
      }
    }

    assert(resultingMovement.coords[2] === 0.0);

    return { result: resultingMovement, rotationOffset_ret };
  }

  protected ForceIntoAllowedBodyDirectionVec(src: Vector3): Vector3 {
    // check what allowed dir this vector is closest to
    let bestDot = -1.0;
    let bestIndex = 0;
    for (let i = 0; i < this.allowedBodyDirVecs.length; i++) {
      const nDotL = this.allowedBodyDirVecs[i].GetDotProduct(src);
      if (nDotL > bestDot) {
        bestDot = nDotL;
        bestIndex = i;
      }
    }

    return this.allowedBodyDirVecs[bestIndex];
  }

  /** for making small differences irrelevant while sorting */
  protected ForceIntoAllowedBodyDirectionAngle(angle: radian): radian {
    let bestAngleDiff = 10000.0;
    let bestIndex = 0;
    for (let i = 0; i < this.allowedBodyDirAngles.length; i++) {
      const diff = Math.abs(this.allowedBodyDirAngles[i] - angle);
      if (diff < bestAngleDiff) {
        bestAngleDiff = diff;
        bestIndex = i;
      }
    }

    return this.allowedBodyDirAngles[bestIndex];
  }

  protected ForceIntoPreferredDirectionVec(src: Vector3): Vector3 {
    let bestDot = -1.0;
    let bestIndex = 0;
    for (let i = 0; i < this.preferredDirectionVecs.length; i++) {
      const nDotL = this.preferredDirectionVecs[i].GetDotProduct(src);
      if (nDotL > bestDot) {
        bestDot = nDotL;
        bestIndex = i;
      }
    }

    return this.preferredDirectionVecs[bestIndex];
  }

  protected ForceIntoPreferredDirectionAngle(angle: radian): radian {
    let bestAngleDiff = 10000.0;
    let bestIndex = 0;
    for (let i = 0; i < this.preferredDirectionAngles.length; i++) {
      const diff = Math.abs(this.preferredDirectionAngles[i] - angle);
      if (diff < bestAngleDiff) {
        bestAngleDiff = diff;
        bestIndex = i;
      }
    }

    return this.preferredDirectionAngles[bestIndex];
  }

  // ----- members

  protected fullbodyNode: Node;
  protected uniqueFullbodyMesh: FloatArray[] = [];
  /** < subgeoms < vertices > >; PORT: shared read-only between all players using the same source model */
  protected weightedVerticesVec: WeightedVertex[][] = [];
  protected fullbodySubgeomCount = 0;
  /** PORT: shared read-only between all players using the same source model */
  protected uniqueIndicesVec: Int32Array[] = [];
  protected joints: Joint[] = [];
  protected fullbodyOffset = new Vector3(0);
  protected fullbodyTargetNode: Node;

  protected humanoidNode: Node;
  protected scene3D: Scene3D;

  protected hairStyle: Geometry;

  protected kitDiffuseTextureIdentString = '';

  protected match: Match;
  protected player: PlayerBase;

  protected anims: AnimCollection;
  protected nodeMap: NodeMap = new Map();

  protected animApplyBuffer = new AnimApplyBuffer();

  protected buf_animApplyBuffer = new AnimApplyBuffer();

  protected buf_TemporalHumanoidNodes: TemporalHumanoidNode[] = [];

  protected buf_LowDetailMode = false;
  protected buf_bodyUpdatePhase = 0;
  protected buf_bodyUpdatePhaseOffset: number;

  protected fetchedbuf_animApplyBuffer = new AnimApplyBuffer();

  protected fetchedbuf_previousSnapshotTime_ms = 0;

  protected fetchedbuf_LowDetailMode = false;
  protected fetchedbuf_bodyUpdatePhase = 0;
  protected fetchedbuf_bodyUpdatePhaseOffset = 0;

  protected offsets = new Map<string, BiasedOffset>();

  protected currentAnim: Anim;
  protected previousAnim: Anim;

  // position/rotation offsets at the start of currentAnim
  protected startPos = new Vector3(0);
  protected startAngle: radian = 0;

  // position/rotation offsets at the end of currentAnim
  protected nextStartPos = new Vector3(0);
  protected nextStartAngle: radian = 0;

  // realtime info
  protected spatialState = new SpatialState();

  protected previousPosition2D = new Vector3(0);

  protected interruptAnim: e_InterruptAnim = e_InterruptAnim.e_InterruptAnim_None;
  protected reQueueDelayFrames = 0;
  protected tripType = 0;
  protected tripDirection = new Vector3(0);

  protected decayingPositionOffset = new Vector3(0);
  protected decayingDifficultyFactor = 0;

  // for comparing dataset entries (needed by std::list::sort)
  protected predicate_DesiredFoot: e_Foot = e_Foot.e_Foot_Left;
  protected predicate_IncomingVelocity: e_Velocity = e_Velocity.e_Velocity_Idle;
  protected predicate_RelDesiredDirection = new Vector3(0);
  protected predicate_DesiredDirection = new Vector3(0);
  protected predicate_CorneringBias = 0;
  protected predicate_DesiredVelocity: e_Velocity = e_Velocity.e_Velocity_Idle;
  protected predicate_RelIncomingBodyDirection = new Vector3(0);
  protected predicate_LookAt = new Vector3(0);
  protected predicate_RelDesiredTripDirection = new Vector3(0);
  protected predicate_RelDesiredBallDirection = new Vector3(0);
  protected predicate_NumericVariableName = '';
  protected predicate_NumericVariableValue = 0;

  protected currentMentalImage: MentalImage | null = null;

  protected _cache_AgilityFactor = 0;
  protected _cache_AccelerationFactor = 0;

  protected zMultiplier = 1;

  protected allowedBodyDirVecs: Vector3[] = [];
  protected allowedBodyDirAngles: radian[] = [];
  protected preferredDirectionVecs: Vector3[] = [];
  protected preferredDirectionAngles: radian[] = [];

  protected movementHistory: MovementHistory = [];

  // PORT: additions for the cached, allocation-free skinning
  /** pristine source fullbody mesh (key of the module-level model cache) */
  private _fullbodySourceGeometryData: GeometryData | null = null;
  /** per subgeom: shared unique mesh / bone weight data */
  private _skinData: FullbodySubgeomData[] = [];
  /** per joint: 3x3 rotation + translation, filled once per UpdateFullbodyModel call */
  private _jointTransforms = new Float64Array(0);
}
