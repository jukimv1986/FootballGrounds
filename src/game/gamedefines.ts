// Port of gamedefines.{hpp,cpp}.
// Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).

import { Vector3 } from '../blunted/base/math/vector3';
import { tokenize, atof, atoi } from '../blunted/base/utils';
import { FileSystem } from '../blunted/managers/filesystem';
import type { Player } from './onthepitch/player/player';

export const idleVelocity = 0.0;
export const dribbleVelocity = 3.5;
export const walkVelocity = 5.0;
export const sprintVelocity = 8.0;

export const animSprintVelocity = 7.0;

export const idleDribbleSwitch = 1.8;
export const dribbleWalkSwitch = 4.2;
export const walkSprintSwitch = 6.0;
// PES6 digital control mode, quantizes some input to x degree angles
export const quantizeDirection = true;

export const analogStickDeadzone = 0.75;

export const _default_CameraZoom = 0.5;
export const _default_CameraHeight = 0.3;
export const _default_CameraFOV = 0.4;
export const _default_CameraAngleFactor = 0.0;

export const _default_Difficulty = 0.6;
export const _default_MatchDuration = 0.4;

export const _default_QuantizedDirectionBias = 0.0;

export const _default_AgilityFactor = 0.5;
export const _default_AccelerationFactor = 0.5;

export const _default_ShortPass_AutoDirection = 0.4;
export const _default_ShortPass_AutoPower = 0.7;
export const _default_ThroughPass_AutoDirection = 0.2;
export const _default_ThroughPass_AutoPower = 0.7;
export const _default_HighPass_AutoDirection = 0.2;
export const _default_HighPass_AutoPower = 0.5;
export const _default_Shot_AutoDirection = 0.2;

/** for example: when we need to travel 4 meters, we need to go at velo 4 * distanceToVelocityMultiplier */
export const distanceToVelocityMultiplier = 2.6;

export const ballPredictionSize_ms = 3000;
export const ballHistorySize_ms = 4000;

export const ballDistanceOptimizeThreshold = 10.0;

export const playerNum = 11;

/** how far into an animation the ball is usually touched */
export const defaultTouchOffset_ms = 80;

export const defaultPlayerHeight = 1.92;

export const temporalSmoother_history_ms = 20;

/** C++ typedef std::deque<int> DataSet: a list of animation indices */
export type DataSet = number[];

export enum e_Side {
  e_Side_Left,
  e_Side_Right,
}

export enum e_Velocity {
  e_Velocity_Idle,
  e_Velocity_Dribble,
  e_Velocity_Walk,
  e_Velocity_Sprint,
}

export enum e_FunctionType {
  e_FunctionType_None,
  e_FunctionType_Movement,
  e_FunctionType_BallControl,
  e_FunctionType_Trap,
  e_FunctionType_ShortPass,
  e_FunctionType_LongPass,
  e_FunctionType_HighPass,
  e_FunctionType_Header,
  e_FunctionType_Shot,
  e_FunctionType_Deflect,
  e_FunctionType_Catch,
  e_FunctionType_Interfere,
  e_FunctionType_Trip,
  e_FunctionType_Sliding,
  e_FunctionType_Special,
}

export enum e_TouchType {
  e_TouchType_Intentional_Kicked, // goalies can't touch this
  e_TouchType_Intentional_Nonkicked, // headers and such
  e_TouchType_Accidental, // collisions
  e_TouchType_None,
  e_TouchType_SIZE,
}

export enum e_SetPiece {
  e_SetPiece_None,
  e_SetPiece_KickOff,
  e_SetPiece_GoalKick,
  e_SetPiece_FreeKick,
  e_SetPiece_Corner,
  e_SetPiece_ThrowIn,
  e_SetPiece_Penalty,
}

export enum e_MatchPhase {
  e_MatchPhase_PreMatch,
  e_MatchPhase_1stHalf,
  e_MatchPhase_2ndHalf,
  e_MatchPhase_1stExtraTime,
  e_MatchPhase_2ndExtraTime,
  e_MatchPhase_Penalties,
}

export enum e_PlayerCommandModifier {
  e_PlayerCommandModifier_None = 0,
  e_PlayerCommandModifier_KnockOn = 1,
}

export class TouchInfo {
  inputDirection = new Vector3(0);
  inputPower = 0;

  autoDirectionBias = 0;
  autoPowerBias = 0;

  /** inputdirection after pass function */
  desiredDirection = new Vector3(0);
  desiredPower = 0;
  /** null == do not use */
  targetPlayer: Player | null = null;
  /** null == do not use */
  forcedTargetPlayer: Player | null = null;

  Clone(): TouchInfo {
    return Object.assign(new TouchInfo(), this);
  }
}

export enum e_StrictMovement {
  e_StrictMovement_False,
  e_StrictMovement_True,
  e_StrictMovement_Dynamic,
}

/**
 * specialVar1:
 *   1: happy celebration
 *   2: inverse celebration (feeling bad)
 *   3: referee showing card
 *
 * C++ copies this struct by value; call Clone() wherever the C++ code copies it and a copy may be modified.
 */
export class PlayerCommand {
  desiredFunctionType = e_FunctionType.e_FunctionType_Movement;

  useDesiredMovement = false;
  desiredDirection = new Vector3(0);
  strictMovement = e_StrictMovement.e_StrictMovement_Dynamic;

  desiredVelocityFloat = idleVelocity;

  useDesiredLookAt = false;
  /** absolute 'look at' position on pitch */
  desiredLookAt = new Vector3(0);

  useTouchInfo = false;
  touchInfo = new TouchInfo();

  onlyDeflectAnimsThatPickupBall = false;

  useTripType = false;
  /** only applicable for trip anims */
  tripType = 1;

  useDesiredTripDirection = false;
  desiredTripDirection = new Vector3(0);

  useSpecialVar1 = false;
  specialVar1 = 0;
  useSpecialVar2 = false;
  specialVar2 = 0;

  modifier = 0;

  Clone(): PlayerCommand {
    const c = Object.assign(new PlayerCommand(), this);
    c.touchInfo = this.touchInfo.Clone();
    return c;
  }
}

export type PlayerCommandQueue = PlayerCommand[];

export enum e_PlayerRole {
  e_PlayerRole_GK,
  e_PlayerRole_CB,
  e_PlayerRole_LB,
  e_PlayerRole_RB,
  e_PlayerRole_DM,
  e_PlayerRole_CM,
  e_PlayerRole_LM,
  e_PlayerRole_RM,
  e_PlayerRole_AM,
  e_PlayerRole_CF,
}

export function GetRoleName(playerRole: e_PlayerRole): string {
  switch (playerRole) {
    case e_PlayerRole.e_PlayerRole_GK: return 'GK';
    case e_PlayerRole.e_PlayerRole_CB: return 'CB';
    case e_PlayerRole.e_PlayerRole_LB: return 'LB';
    case e_PlayerRole.e_PlayerRole_RB: return 'RB';
    case e_PlayerRole.e_PlayerRole_DM: return 'DM';
    case e_PlayerRole.e_PlayerRole_CM: return 'CM';
    case e_PlayerRole.e_PlayerRole_LM: return 'LM';
    case e_PlayerRole.e_PlayerRole_RM: return 'RM';
    case e_PlayerRole.e_PlayerRole_AM: return 'AM';
    case e_PlayerRole.e_PlayerRole_CF: return 'CF';
    default: return 'undefined';
  }
}

export function GetRoleFromString(roleString: string): e_PlayerRole {
  switch (roleString) {
    case 'GK': return e_PlayerRole.e_PlayerRole_GK;
    case 'CB': return e_PlayerRole.e_PlayerRole_CB;
    case 'LB': return e_PlayerRole.e_PlayerRole_LB;
    case 'RB': return e_PlayerRole.e_PlayerRole_RB;
    case 'DM': return e_PlayerRole.e_PlayerRole_DM;
    case 'CM': return e_PlayerRole.e_PlayerRole_CM;
    case 'LM': return e_PlayerRole.e_PlayerRole_LM;
    case 'RM': return e_PlayerRole.e_PlayerRole_RM;
    case 'AM': return e_PlayerRole.e_PlayerRole_AM;
    case 'CF': return e_PlayerRole.e_PlayerRole_CF;
    default: return e_PlayerRole.e_PlayerRole_CM;
  }
}

/** C++ copies this struct by value; use Clone() where a copy is modified */
export class FormationEntry {
  role = e_PlayerRole.e_PlayerRole_CM;
  databasePosition = new Vector3(0);
  /** adapted to player role (combination of databasePosition and hardcoded role position) */
  position = new Vector3(0);

  Clone(): FormationEntry {
    return Object.assign(new FormationEntry(), this);
  }
}

/** C++ copies this struct by value; use Clone() where a copy is modified */
export class PlayerImage {
  teamID = 0;
  side = 0;
  playerID = 0;
  player: Player | null = null;
  position = new Vector3(0);
  directionVec = new Vector3(0);
  bodyDirectionVec = new Vector3(0);
  velocity = 0;
  movement = new Vector3(0);
  formationEntry = new FormationEntry();
  dynamicFormationEntry = new FormationEntry();

  Clone(): PlayerImage {
    const c = Object.assign(new PlayerImage(), this);
    c.formationEntry = this.formationEntry.Clone();
    c.dynamicFormationEntry = this.dynamicFormationEntry.Clone();
    return c;
  }
}

/** strict-weak-ordering "less than" (use with std-sort style: (a, b) => less(a,b) ? -1 : less(b,a) ? 1 : 0) */
export function PlayerImageDepthSortFunc(a: PlayerImage, b: PlayerImage): boolean {
  return a.position.coords[0] * a.side < b.position.coords[0] * b.side;
}

export const pitchHalfW = 55; // only inside side- and backlines
export const pitchHalfH = 36;
export const pitchFullHalfW = 60; // including 'rim'
export const pitchFullHalfH = 40;
export const lineHalfW = 0.06;

export const goalDepth = 2.55;
export const goalHeight = 2.5;
export const goalHalfWidth = 3.7;

export enum e_DecayType {
  e_DecayType_Constant,
  e_DecayType_Variable,
}

export enum e_MagnetType {
  e_MagnetType_Attract,
  e_MagnetType_Repel,
}

/** forcefields consist of forcespots, representing a repelling or attracting force from a position, including linearity/etc parameters */
export class ForceSpot {
  origin = new Vector3(0);
  magnetType = e_MagnetType.e_MagnetType_Attract;
  decayType = e_DecayType.e_DecayType_Constant;
  exp = 1.0;
  power = 0;
  /** scaled #meters until effect is almost decimated */
  scale = 0;
}

export class PassRating {
  rating = 0;

  constructor(
    public playerID: number,
    /** 0 .. 1 == worst .. best: what are the odds a pass to this player will complete? */
    public odds: number,
    /** is this player in a good position? */
    public pos: number,
    /** target's situational rating */
    public sit: number,
  ) {}

  CalculateRating(opportunism: number): void {
    this.rating = (this.sit * 1.0 + this.odds * 1.0) * 0.5 * (1 - opportunism) + this.pos * opportunism;
  }

  /** operator < */
  LessThan(other: PassRating): boolean {
    return this.rating < other.rating;
  }
}

export type PassRatings = PassRating[];

/**
 * Map key for vertex positions as stored in Float32Array vertex buffers.
 * The C++ code used std::map<Vector3, Vector3> with float coordinates; JS numbers are doubles,
 * so keys are rounded to float32 to match positions read back from Float32Arrays.
 */
export function Float32Key(x: number, y: number, z: number): string {
  return `${Math.fround(x)},${Math.fround(y)},${Math.fround(z)}`;
}

/**
 * C++ GetVertexColors(std::map<Vector3, Vector3> &colorCoords).
 * Reads the per-vertex bone weight colors of the fullbody model. Keys are Float32Key(x, y, z).
 */
export function GetVertexColors(colorCoords: Map<string, Vector3>): Map<string, Vector3> {
  const filename = 'media/objects/players/models/fullbody.ase';
  let vertices: Vector3[] = [];
  let colors: Vector3[] = [];
  let faces: [number, number, number][] = [];
  let colorFaces: [number, number, number][] = [];
  for (const line of FileSystem.GetText(filename).split('\n')) {
    const tokens: string[] = [];
    tokenize(line.replace(/\r/g, ''), tokens, ' \t');
    if (tokens.length === 0) continue;
    const t0 = tokens[0];
    if (t0 === '*MESH_NORMALS') {
      // end of useful block: complete previous object
      for (let i = 0; i < colorFaces.length; i++) {
        for (let v = 0; v < 3; v++) {
          const coord = vertices[faces[i][v]];
          const color = colors[colorFaces[i][v]];
          const key = Float32Key(coord.coords[0], coord.coords[1], coord.coords[2]);
          if (!colorCoords.has(key)) colorCoords.set(key, color);
        }
      }
      vertices = [];
      colors = [];
      faces = [];
      colorFaces = [];
    }
    if (t0 === '*MESH_VERTEX') vertices.push(new Vector3(atof(tokens[2]), atof(tokens[3]), atof(tokens[4])));
    if (t0 === '*MESH_FACE') faces.push([atoi(tokens[3]), atoi(tokens[5]), atoi(tokens[7])]);
    if (t0 === '*MESH_VERTCOL') {
      const c = new Vector3(atof(tokens[2]), atof(tokens[3]), atof(tokens[4])).Mul(255);
      colors.push(new Vector3(Math.round(c.coords[0]), Math.round(c.coords[1]), Math.round(c.coords[2])));
    }
    if (t0 === '*MESH_CFACE') colorFaces.push([atoi(tokens[2]), atoi(tokens[3]), atoi(tokens[4])]);
  }
  return colorCoords;
}

export function StringToFunctionType(fun: string): e_FunctionType {
  switch (fun) {
    case 'movement': return e_FunctionType.e_FunctionType_Movement;
    case 'ballcontrol': return e_FunctionType.e_FunctionType_BallControl;
    case 'trap': return e_FunctionType.e_FunctionType_Trap;
    case 'shortpass': return e_FunctionType.e_FunctionType_ShortPass;
    case 'longpass': return e_FunctionType.e_FunctionType_LongPass;
    case 'highpass': return e_FunctionType.e_FunctionType_HighPass;
    case 'shot': return e_FunctionType.e_FunctionType_Shot;
    case 'deflect': return e_FunctionType.e_FunctionType_Deflect;
    case 'catch': return e_FunctionType.e_FunctionType_Catch;
    case 'interfere': return e_FunctionType.e_FunctionType_Interfere;
    case 'trip': return e_FunctionType.e_FunctionType_Trip;
    case 'sliding': return e_FunctionType.e_FunctionType_Sliding;
    case 'special': return e_FunctionType.e_FunctionType_Special;
    default: return e_FunctionType.e_FunctionType_None;
  }
}

/** original was declared but never defined in the C++ source */
export function GetGlobalVelocityMultiplier(): number {
  return 1.0;
}
