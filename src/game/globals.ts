// Port of main.{hpp,cpp}: the game-wide globals the original code reached through free functions
// (GetScene3D(), GetConfiguration(), GetMenuTask(), ...), plus the time/scheduler services
// (EnvironmentManager, Scheduler) the match uses for its render interpolation buffers.

import { Vector3 } from '../blunted/base/math/vector3';
import { Properties } from '../blunted/base/properties';
import { ResourceManagerPool } from '../blunted/managers/resourcemanagerpool';
import { Geometry } from '../blunted/scene/objects/geometry';
import { Scene3D } from '../blunted/scene/scene3d';
import type { Database } from './data/database';
import type { IHIDevice } from './hid/ihidevice';
import type { MenuTask } from './menu/menutask';

export enum e_DebugMode {
  e_DebugMode_Off,
  e_DebugMode_Tactical,
  e_DebugMode_AI,
}

interface Globals {
  scene3D: Scene3D;
  config: Properties;
  db: Database | null;
  menuTask: MenuTask | null;
  controllers: IHIDevice[];
  superDebug: boolean;
  debugMode: e_DebugMode;
  pilons: Map<string, Geometry>;
}

const g: Globals = {
  scene3D: new Scene3D('scene3D'),
  config: new Properties(),
  db: null,
  menuTask: null,
  controllers: [],
  superDebug: false,
  debugMode: e_DebugMode.e_DebugMode_Off,
  pilons: new Map(),
};

export function GetScene3D(): Scene3D {
  return g.scene3D;
}

export function SetScene3D(scene3D: Scene3D): void {
  g.scene3D = scene3D;
}

export function GetConfiguration(): Properties {
  return g.config;
}

export function SetConfiguration(config: Properties): void {
  g.config = config;
}

export function GetDB(): Database {
  if (!g.db) throw new Error('database not loaded');
  return g.db;
}

export function SetDB(db: Database): void {
  g.db = db;
}

export function GetMenuTask(): MenuTask {
  if (!g.menuTask) throw new Error('menu task not set');
  return g.menuTask;
}

export function SetMenuTask(menuTask: MenuTask): void {
  g.menuTask = menuTask;
}

export function GetControllers(): IHIDevice[] {
  return g.controllers;
}

export function SetControllers(controllers: IHIDevice[]): void {
  g.controllers = controllers;
}

export function IsReleaseVersion(): boolean {
  return !GetConfiguration().GetBool('debug', false);
}

export function Verbose(): boolean {
  return !IsReleaseVersion();
}

export function SuperDebug(): boolean {
  return g.superDebug;
}

export function GetDebugMode(): e_DebugMode {
  return g.debugMode;
}

export function SetDebugMode(mode: e_DebugMode): void {
  g.debugMode = mode;
}

// ----- debug helpers (colored pilons/circles the AI code can place on the pitch)

function GetPilon(name: string, file: string): Geometry {
  let geom = g.pilons.get(name);
  if (!geom) {
    geom = new Geometry(name);
    geom.SetGeometryData(ResourceManagerPool.GetInstance().FetchGeometryData(file));
    geom.SetPosition(new Vector3(0, 0, -10));
    g.pilons.set(name, geom);
  }
  return geom;
}

export const GetGreenDebugPilon = (): Geometry => GetPilon('green', 'media/objects/helpers/green.ase');
export const GetBlueDebugPilon = (): Geometry => GetPilon('blue', 'media/objects/helpers/blue.ase');
export const GetYellowDebugPilon = (): Geometry => GetPilon('yellow', 'media/objects/helpers/yellow.ase');
export const GetRedDebugPilon = (): Geometry => GetPilon('red', 'media/objects/helpers/red.ase');
export const GetSmallDebugCircle1 = (): Geometry => GetPilon('smalldebugcircle1', 'media/objects/helpers/smalldebugcircle.ase');
export const GetSmallDebugCircle2 = (): Geometry => GetPilon('smalldebugcircle2', 'media/objects/helpers/smalldebugcircle.ase');
export const GetLargeDebugCircle = (): Geometry => GetPilon('largedebugcircle', 'media/objects/helpers/largedebugcircle.ase');
export const SetGreenDebugPilon = (pos: Vector3): void => GetGreenDebugPilon().SetPosition(pos, false);
export const SetBlueDebugPilon = (pos: Vector3): void => GetBlueDebugPilon().SetPosition(pos, false);
export const SetYellowDebugPilon = (pos: Vector3): void => GetYellowDebugPilon().SetPosition(pos, false);
export const SetRedDebugPilon = (pos: Vector3): void => GetRedDebugPilon().SetPosition(pos, false);
export const SetSmallDebugCircle1 = (pos: Vector3): void => GetSmallDebugCircle1().SetPosition(pos, false);
export const SetSmallDebugCircle2 = (pos: Vector3): void => GetSmallDebugCircle2().SetPosition(pos, false);
export const SetLargeDebugCircle = (pos: Vector3): void => GetLargeDebugCircle().SetPosition(pos, false);

/** releases the cached debug geometry (called when a match ends) */
export function ResetDebugPilons(): void {
  g.pilons.clear();
}

// ----- time

/**
 * C++ EnvironmentManager::GetInstance().GetTime_ms(): wall clock in ms.
 * The game loop can install a virtual clock (fast simulation, tests).
 */
export class EnvironmentManager {
  private static instance = new EnvironmentManager();
  private timeSource: () => number = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  static GetInstance(): EnvironmentManager {
    return EnvironmentManager.instance;
  }

  GetTime_ms(): number {
    return Math.floor(this.timeSource());
  }

  SetTimeSource(source: () => number): void {
    this.timeSource = source;
  }
}

/** C++ TaskSequenceInfo */
export interface TaskSequenceInfo {
  sequenceStartTime_ms: number;
  lastSequenceTime_ms: number;
  startTime_ms: number;
  /** fixed step of the sequence (the "game" sequence runs every 10ms) */
  sequenceTime_ms: number;
  timesRan: number;
}

/** C++ Scheduler: the game loop (src/game/gameloop.ts) updates the "game" sequence info */
export class Scheduler {
  private sequences = new Map<string, TaskSequenceInfo>();

  GetTaskSequenceInfo(name: string): TaskSequenceInfo {
    let info = this.sequences.get(name);
    if (!info) {
      info = { sequenceStartTime_ms: 0, lastSequenceTime_ms: 0, startTime_ms: 0, sequenceTime_ms: 10, timesRan: 0 };
      this.sequences.set(name, info);
    }
    return { ...info };
  }

  /** mutable access for the game loop */
  GetMutableTaskSequenceInfo(name: string): TaskSequenceInfo {
    this.GetTaskSequenceInfo(name);
    return this.sequences.get(name) as TaskSequenceInfo;
  }

  ResetTaskSequenceTime(name: string): void {
    const info = this.GetMutableTaskSequenceInfo(name);
    const now = EnvironmentManager.GetInstance().GetTime_ms();
    info.startTime_ms = now;
    info.sequenceStartTime_ms = now;
    info.lastSequenceTime_ms = now;
    info.timesRan = 0;
  }
}

const scheduler = new Scheduler();

export function GetScheduler(): Scheduler {
  return scheduler;
}

/** C++ PredictFrameTimeToGo_ms: estimated ms until the next rendered frame */
export function PredictFrameTimeToGo_ms(_frameCount: number): number {
  return 8;
}
