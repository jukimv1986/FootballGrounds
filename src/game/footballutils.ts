// Port of legacy/src/utils.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).
// PORT: renamed to footballutils.ts (avoids clashing with the utils/ directory).

import { Vector3, Quaternion } from '../blunted/base/math/vector3';
import { NormalizedClamp, clamp, cround, curve, pi, type radian } from '../blunted/base/math/bluntmath';
import { CircularBuffer } from '../blunted/base/circularbuffer';
import { assert } from '../blunted/base/assert';
import { Log, e_FatalError } from '../blunted/base/log';
import { real_to_str, tokenize } from '../blunted/base/utils';
import type { Camera } from '../blunted/scene/objects/camera';
import { GetConfiguration } from './globals';
import { _default_QuantizedDirectionBias, e_Velocity, temporalSmoother_history_ms } from './gamedefines';

export function GetQuantizedDirectionBias(): number {
  return GetConfiguration().GetReal('gameplay_quantizeddirectionbias', _default_QuantizedDirectionBias);
}

/** C++ QuantizeDirection(Vector3 &inputDirection, float bias): returns the quantized direction */
export function QuantizeDirection(inputDirection: Vector3, bias = 1.0): Vector3 {
  // digitize input

  const inputDirectionNorm = inputDirection.GetNormalized(0);

  const directions = GetConfiguration().GetInt('gameplay_quantizeddirectioncount', 8);

  let angle: radian = inputDirectionNorm.GetAngle2D();
  angle /= pi * 2.0;
  angle = cround(angle * directions);
  angle /= directions;
  angle *= pi * 2.0;

  return inputDirectionNorm
    .Mul(1.0 - bias)
    .Add(new Vector3(1, 0, 0).GetRotated2D(angle).Mul(bias))
    .GetNormalized(inputDirectionNorm)
    .Mul(inputDirection.GetLength());
}

/** aspect ratio of the browser window (the 3D context and the 2D gui both fill it); 16/9 without DOM */
function GetWindowAspectRatio(): number {
  if (typeof window === 'undefined') return 16 / 9;
  return window.innerWidth / Math.max(1, window.innerHeight);
}

/**
 * Projects a world position to screen coordinates in percent (0 .. 100, y down), like the original.
 * The C++ built the (inverse) camera matrix with Matrix4::ConstructInverse and a GL style
 * perspective matrix; this does the same arithmetic without the matrix classes.
 */
export function GetProjectedCoord(pos3D: Vector3, camera: Camera): Vector3 {
  // rotMat.ConstructInverse(camera->GetDerivedPosition(), Vector3(1, 1, 1), camera->GetDerivedRotation())
  const rotation_inverse = camera.GetDerivedRotation().GetInverse();
  const position_inverse = rotation_inverse.MulVec(camera.GetDerivedPosition().Neg());
  const r = rotation_inverse.ConstructMatrix();

  const fov = camera.GetFOV();

  // cotangent
  const f = 1.0 / Math.tan(((fov / 360.0) * pi * 2) / 2.0);

  // PORT: the 3D context and the 2D window manager both use the browser window's aspect ratio
  let aspect = GetWindowAspectRatio();
  const aspect2D = GetWindowAspectRatio();
  if (aspect2D < aspect) aspect = aspect2D;

  const zNear = 40.0;
  const zFar = 270.0;

  // view space (rotMat * pos)
  const p = pos3D.coords;
  const vx = r[0] * p[0] + r[1] * p[1] + r[2] * p[2] + position_inverse.coords[0];
  const vy = r[3] * p[0] + r[4] * p[1] + r[5] * p[2] + position_inverse.coords[1];
  const vz = r[6] * p[0] + r[7] * p[1] + r[8] * p[2] + position_inverse.coords[2];

  // perspMat * view
  const x = (f / aspect) * vx;
  const y = f * vy;
  const w = -1 * vz;

  let rx = x / w;
  let ry = y / w;

  ry = -ry;

  ry *= aspect2D / aspect;

  rx = (rx + 1.0) * 0.5 * 100;
  ry = (ry + 1.0) * 0.5 * 100;
  const rz = (0 + 1.0) * 0.5 * 100;

  return new Vector3(rx, ry, rz);
}

export function GetVelocityID(velo: e_Velocity, treatDribbleAsWalk = false): number {
  let id = 0;
  switch (velo) {
    case e_Velocity.e_Velocity_Idle:
      id = 0;
      break;
    case e_Velocity.e_Velocity_Dribble:
      id = 1;
      break;
    case e_Velocity.e_Velocity_Walk:
      id = 2;
      break;
    case e_Velocity.e_Velocity_Sprint:
      id = 3;
      break;
    default:
      id = 0;
      break;
  }
  if (treatDribbleAsWalk && id > 1) id--;
  return id;
}

// stats fiddling

export enum e_PositionName {
  e_PositionName_GK,
  e_PositionName_SW,
  e_PositionName_D,
  e_PositionName_WB,
  e_PositionName_DM,
  e_PositionName_M,
  e_PositionName_AM,
  e_PositionName_F,
  e_PositionName_ST,
}

export interface WeightedPosition {
  positionName: e_PositionName;
  weight: number;
}

export interface Stat {
  name: string;
  value: number;
}

export enum e_DevelopmentCurveType {
  e_DevelopmentCurveType_Early,
  e_DevelopmentCurveType_Normal,
  e_DevelopmentCurveType_Late,
}

const defaultProfiles = new Map<e_PositionName, Stat[]>();

export function GetPositionName(shortcut: string): e_PositionName {
  if (shortcut === 'GK') return e_PositionName.e_PositionName_GK;
  if (shortcut === 'SW') return e_PositionName.e_PositionName_SW;
  if (shortcut === 'D') return e_PositionName.e_PositionName_D;
  if (shortcut === 'WB') return e_PositionName.e_PositionName_WB;
  if (shortcut === 'DM') return e_PositionName.e_PositionName_DM;
  if (shortcut === 'M') return e_PositionName.e_PositionName_M;
  if (shortcut === 'AM') return e_PositionName.e_PositionName_AM;
  if (shortcut === 'F') return e_PositionName.e_PositionName_F;
  if (shortcut === 'ST') return e_PositionName.e_PositionName_ST;

  Log(e_FatalError, 'utils.cpp', 'GetPositionName', "Position '" + shortcut + "' not found!");
  return e_PositionName.e_PositionName_M;
}

/** converts FM positions string into weighted positions vector (pushes into and returns weightedPositions) */
export function GetWeightedPositions(positionString: string, weightedPositions: WeightedPosition[] = []): WeightedPosition[] {
  // split by comma
  const positions: string[] = [];
  tokenize(positionString, positions, ',');
  for (let i = 0; i < positions.length; i++) {
    // trim leading/trailing space
    positions[i] = positions[i].trim();
    // remove L/C/R notice (after space)
    const firstspace = positions[i].indexOf(' ');
    if (firstspace !== -1) positions[i] = positions[i].substring(0, firstspace);

    if (positions[i].indexOf('/') !== -1) {
      // position mixture
      const subpositions: string[] = [];
      tokenize(positions[i], subpositions, '/');
      for (let j = 0; j < subpositions.length; j++) {
        weightedPositions.push({ positionName: GetPositionName(subpositions[j]), weight: 1.0 / subpositions.length });
      }
    } else {
      // just one position
      weightedPositions.push({ positionName: GetPositionName(positions[i]), weight: 1.0 });
    }
  }
  return weightedPositions;
}

function MakeStats(values: number[]): Stat[] {
  const names = [
    'physical_balance',
    'physical_reaction',
    'physical_acceleration',
    'physical_velocity',
    'physical_stamina',
    'physical_agility',
    'physical_shotpower',
    'technical_standingtackle',
    'technical_slidingtackle',
    'technical_ballcontrol',
    'technical_dribble',
    'technical_shortpass',
    'technical_highpass',
    'technical_header',
    'technical_shot',
    'technical_volley',
    'mental_calmness',
    'mental_workrate',
    'mental_resilience',
    'mental_defensivepositioning',
    'mental_offensivepositioning',
    'mental_vision',
  ];
  return names.map((name, i) => ({ name, value: values[i] }));
}

export function InitDefaultProfiles(): void {
  // std::map::insert does not overwrite existing entries
  const insert = (positionName: e_PositionName, stats: Stat[]): void => {
    if (!defaultProfiles.has(positionName)) defaultProfiles.set(positionName, stats);
  };

  //                  bal  rea  acc  vel  sta  agi  shp  stt  slt  bac  dri  shp  hip  hea  sho  vol  cal  wor  res  dep  ofp  vis
  insert(e_PositionName.e_PositionName_GK, MakeStats([0.6, 0.8, 0.5, 0.4, 0.5, 0.6, 0.6, 0.2, 0.2, 0.3, 0.2, 0.6, 0.7, 0.2, 0.3, 0.2, 0.5, 0.5, 0.5, 0.9, 0.1, 0.5]));
  insert(e_PositionName.e_PositionName_SW, MakeStats([0.7, 0.7, 0.5, 0.5, 0.5, 0.4, 0.7, 0.8, 0.8, 0.3, 0.2, 0.4, 0.4, 0.6, 0.2, 0.2, 0.5, 0.5, 0.5, 0.8, 0.2, 0.4]));
  insert(e_PositionName.e_PositionName_D, MakeStats([0.8, 0.7, 0.5, 0.5, 0.5, 0.5, 0.6, 0.8, 0.8, 0.5, 0.3, 0.5, 0.5, 0.6, 0.3, 0.2, 0.5, 0.5, 0.5, 0.8, 0.3, 0.6]));
  insert(e_PositionName.e_PositionName_WB, MakeStats([0.6, 0.5, 0.6, 0.6, 0.5, 0.5, 0.5, 0.7, 0.7, 0.5, 0.5, 0.7, 0.7, 0.5, 0.4, 0.3, 0.5, 0.5, 0.5, 0.6, 0.4, 0.6]));
  insert(e_PositionName.e_PositionName_DM, MakeStats([0.7, 0.6, 0.5, 0.5, 0.5, 0.5, 0.6, 0.7, 0.6, 0.5, 0.4, 0.7, 0.7, 0.5, 0.4, 0.3, 0.5, 0.5, 0.5, 0.6, 0.4, 0.6]));
  insert(e_PositionName.e_PositionName_M, MakeStats([0.4, 0.5, 0.6, 0.6, 0.5, 0.6, 0.6, 0.4, 0.3, 0.7, 0.6, 0.8, 0.7, 0.4, 0.5, 0.4, 0.5, 0.5, 0.5, 0.5, 0.5, 0.7]));
  insert(e_PositionName.e_PositionName_AM, MakeStats([0.4, 0.5, 0.6, 0.6, 0.5, 0.7, 0.7, 0.2, 0.2, 0.6, 0.7, 0.6, 0.5, 0.4, 0.7, 0.5, 0.5, 0.5, 0.5, 0.3, 0.7, 0.4]));
  insert(e_PositionName.e_PositionName_F, MakeStats([0.4, 0.5, 0.7, 0.7, 0.5, 0.7, 0.7, 0.2, 0.1, 0.5, 0.8, 0.6, 0.6, 0.4, 0.7, 0.4, 0.5, 0.5, 0.5, 0.25, 0.75, 0.5]));
  insert(e_PositionName.e_PositionName_ST, MakeStats([0.3, 0.6, 0.6, 0.6, 0.5, 0.7, 0.8, 0.1, 0.1, 0.5, 0.7, 0.5, 0.4, 0.6, 0.8, 0.7, 0.5, 0.5, 0.5, 0.2, 0.8, 0.3]));

  // give all positions the same stats on average

  const keys = [...defaultProfiles.keys()].sort((a, b) => a - b);
  for (const key of keys) {
    const stats = defaultProfiles.get(key) as Stat[];
    let totalStats = 0.0;
    const statsAmount = stats.length;
    for (let j = 0; j < stats.length; j++) {
      totalStats += stats[j].value;
    }
    const averageStat = totalStats / statsAmount;
    // average should be 0.5...
    for (let j = 0; j < stats.length; j++) {
      stats[j].value += 0.5 - averageStat;
      assert(stats[j].value > 0.0 && stats[j].value < 1.0);
    }
  }
}

/** pushes into and returns averageProfile */
export function GetDefaultProfile(weightedPositions: WeightedPosition[], averageProfile: Stat[] = []): Stat[] {
  // total weight
  let totalWeight = 0.0;
  for (let i = 0; i < weightedPositions.length; i++) {
    totalWeight += weightedPositions[i].weight;
  }

  for (const stat of MakeStats(new Array<number>(22).fill(0.0))) averageProfile.push(stat);

  for (let i = 0; i < weightedPositions.length; i++) {
    const stats = defaultProfiles.get(weightedPositions[i].positionName);
    assert(stats !== undefined);
    if (!stats) continue;
    for (let j = 0; j < stats.length; j++) {
      averageProfile[j].value += stats[j].value * (weightedPositions[i].weight / totalWeight);
    }
  }
  return averageProfile;
}

export function GetProfileString(profileStats: Stat[]): string {
  let result = '';
  for (let i = 0; i < profileStats.length; i++) {
    result += '<' + profileStats[i].name + '>' + real_to_str(profileStats[i].value) + '</' + profileStats[i].name + '>\n';
  }
  return result;
}

/**
 * PORT: the C++ declared this in utils.hpp but its definition was commented out ("deprecated");
 * ported from that commented-out definition so the declared API exists.
 */
export function GetAverageStatFromValue(age: number, value: number): number {
  // right now: overall lowest/highest value: 10/45643480

  let currentStat = clamp(value / 46000000.0, 0.000001, 0.99);

  // player value works exponentially.. rich clubs are willing to pay lots extra for that little bit more skill
  currentStat = Math.pow(currentStat, 0.2);

  // young players are 'overpriced', as in, their price is higher than the corresponding stat, since 'potential' is considered in the price
  // same for old players, the other way around. 'curve' this right
  const base = 15; // youngest (40 is oldest)
  const exaggerate = 1.5;
  const valueToStatMultiplier = [
    0.64, 0.66, 0.68, 0.7, 0.73, 0.76, 0.79, 0.82, 0.85, 0.88, 0.91, 0.94, 0.97,
    1.0, // toppling point (age 28) - at this age the 'value' graph cuts the 'stats' graph
    1.04, 1.08, 1.12, 1.16, 1.2, 1.24, 1.28, 1.32, 1.35, 1.38, 1.41, 1.43,
  ];
  for (let i = 0; i <= 40 - base; i++) {
    valueToStatMultiplier[i] -= 1.0;
    valueToStatMultiplier[i] *= exaggerate;
    valueToStatMultiplier[i] += 1.0;
  }
  currentStat *= valueToStatMultiplier[Math.trunc(age) - base];

  return currentStat;
}

export function CalculateStat(baseStat: number, profileStat: number, age: number, _developmentCurveType: e_DevelopmentCurveType): number {
  // todo: profile-profile on specific early/late age skill factors
  // todo: use development curves. this is just a quick and dirty version for the demo

  const idealAge = 27;
  const ageFactor = curve(1.0 - NormalizedClamp(Math.abs(age - idealAge), 0, 13) * 0.5, 1.0) * 2.0 - 1.0; // 0 .. 1
  assert(ageFactor >= 0.0 && ageFactor <= 1.0);

  // this factor should roughly be around 1.0 for good players at their top age.
  const agedBaseStat = baseStat * (ageFactor * 0.5 + 0.5) * 1.2;

  const agedProfileStat = clamp(profileStat * 2.0 * agedBaseStat, 0.01, 1.0); // profile stat * 2 because average == 0.5

  return agedProfileStat;
}

// /stats fiddling

type TemporalData = Vector3 | Quaternion | number;

export class TemporalValue<T extends TemporalData> {
  constructor(
    public data: T,
    public time_ms = 0,
  ) {}
}

/**
 * C++ template TemporalSmoother<T>, instantiated for Vector3, Quaternion and float (the match's
 * camera FOV buffer). The default value is what the C++ TemporalValue<T> constructor produced:
 * Vector3 users pass `new Vector3(0)`, Quaternion users `Quaternion.IDENTITY`, number users `0`.
 */
export class TemporalSmoother<T extends TemporalData> {
  protected values: CircularBuffer<TemporalValue<T>>;
  protected snapshotSize: number;

  constructor(protected defaultValue: T) {
    this.snapshotSize = 3 + Math.trunc(Math.ceil(temporalSmoother_history_ms / 10.0)); // not sure how to calculate proper number?
    this.values = new CircularBuffer<TemporalValue<T>>(this.snapshotSize);
  }

  SetValue(data: T, valueTime_ms: number): void {
    this.values.push_back(new TemporalValue<T>(data, valueTime_ms));
  }

  /** get interpolated measurement, history_ms seconds ago from now */
  GetValue(currentTime_ms: number, history_ms: number = temporalSmoother_history_ms): T {
    const size = this.values.size();
    if (size === 0) return this.defaultValue;
    if (size === 1) return this.values.at(0).data; // only one value yet

    const now_ms = currentTime_ms;
    let targetTime_ms = 0;
    if (history_ms <= now_ms) targetTime_ms = now_ms - history_ms; // this makes sure targetTime_ms won't become negative

    // find the 2 values we need

    let value1_data = this.defaultValue;
    let value1_time_ms = 0;
    let value2_data = this.defaultValue;
    let value2_time_ms = 0;

    for (let i = 0; i < size; i++) {
      const iter = this.values.at(i);
      if (iter.time_ms <= targetTime_ms) {
        value1_data = iter.data;
        value1_time_ms = iter.time_ms;
      } else if (iter.time_ms > targetTime_ms) {
        value2_data = iter.data;
        value2_time_ms = iter.time_ms;
        break;
      }
    }

    if (value1_time_ms === 0) return value2_data;
    if (value2_time_ms === 0) return value1_data;

    const bias = NormalizedClamp(targetTime_ms, value1_time_ms, Math.max(value2_time_ms, value1_time_ms + 1));

    return this.MixData(value1_data, value2_data, bias);
  }

  Clear(): void {
    this.values.clear();
  }

  protected MixData(data1: T, data2: T, bias = 0.0): T {
    if (data1 instanceof Quaternion) {
      // C++ specialization TemporalSmoother<Quaternion>::MixData
      return data1.GetLerped(bias, data2 as Quaternion) as T;
    }
    if (data1 instanceof Vector3) {
      return data1.Mul(1.0 - bias).Add((data2 as Vector3).Mul(bias)) as T;
    }
    return ((data1 as number) * (1.0 - bias) + (data2 as number) * bias) as T;
  }
}
