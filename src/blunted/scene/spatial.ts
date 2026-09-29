// Port of blunted/types/spatial + scene/object + scene/scene3d/node: the engine's scene graph.
// Rendering, audio etc. no longer live in separate threaded "systems"; instead the Three.js
// renderer (src/blunted/render) reads this graph every frame.

import { Vector3, Quaternion } from '../base/math/vector3';
import { AABB } from '../base/geometry/aabb';
import { Properties } from '../base/properties';

export enum e_LocalMode {
  e_LocalMode_Relative,
  e_LocalMode_Absolute,
}
export const e_LocalMode_Relative = e_LocalMode.e_LocalMode_Relative;
export const e_LocalMode_Absolute = e_LocalMode.e_LocalMode_Absolute;

export enum e_ObjectType {
  e_ObjectType_Camera = 1,
  e_ObjectType_Image2D = 2,
  e_ObjectType_Geometry = 3,
  e_ObjectType_Skybox = 4,
  e_ObjectType_Light = 5,
  e_ObjectType_Joint = 6,
  e_ObjectType_AudioReceiver = 7,
  e_ObjectType_Sound = 8,
  e_ObjectType_UserStart = 9,
}
export const e_ObjectType_Camera = e_ObjectType.e_ObjectType_Camera;
export const e_ObjectType_Image2D = e_ObjectType.e_ObjectType_Image2D;
export const e_ObjectType_Geometry = e_ObjectType.e_ObjectType_Geometry;
export const e_ObjectType_Light = e_ObjectType.e_ObjectType_Light;
export const e_ObjectType_Sound = e_ObjectType.e_ObjectType_Sound;

export abstract class Spatial {
  protected name: string;
  protected parent: Spatial | null = null;
  protected position: Vector3 = new Vector3(0, 0, 0);
  protected rotation: Quaternion = Quaternion.IDENTITY;
  protected scale: Vector3 = new Vector3(1, 1, 1);
  protected localMode: e_LocalMode = e_LocalMode.e_LocalMode_Relative;

  private _cache_DerivedPosition: Vector3 | null = null;
  private _cache_DerivedRotation: Quaternion | null = null;
  private _cache_DerivedScale: Vector3 | null = null;

  /** bumped on every transform change of this spatial or an ancestor; lets the renderer skip unchanged objects */
  transformVersion = 0;

  constructor(name: string) {
    this.name = name;
  }

  abstract Exit(): void;

  SetLocalMode(localMode: e_LocalMode): void {
    this.localMode = localMode;
    this.InvalidateSpatialData();
  }

  GetLocalMode(): e_LocalMode {
    return this.localMode;
  }

  SetName(name: string): void {
    this.name = name;
  }

  GetName(): string {
    return this.name;
  }

  SetParent(parent: Spatial | null): void {
    this.parent = parent;
    this.InvalidateSpatialData();
  }

  GetParent(): Spatial | null {
    return this.parent;
  }

  SetPosition(newPosition: Vector3, _updateSpatialData = true): void {
    this.position = newPosition;
    this.InvalidateSpatialData();
  }

  GetPosition(): Vector3 {
    return this.position;
  }

  SetRotation(newRotation: Quaternion, _updateSpatialData = true): void {
    this.rotation = newRotation;
    this.InvalidateSpatialData();
  }

  GetRotation(): Quaternion {
    return this.rotation;
  }

  SetScale(newScale: Vector3): void {
    this.scale = newScale;
    this.InvalidateSpatialData();
  }

  GetScale(): Vector3 {
    return this.scale;
  }

  GetDerivedPosition(): Vector3 {
    if (this._cache_DerivedPosition === null) {
      if (this.localMode === e_LocalMode.e_LocalMode_Relative && this.parent) {
        const parentDerivedRotation = this.parent.GetDerivedRotation();
        const parentDerivedScale = this.parent.GetDerivedScale();
        const parentDerivedPosition = this.parent.GetDerivedPosition();
        this._cache_DerivedPosition = parentDerivedRotation.MulVec(parentDerivedScale.Mul(this.position)).Add(parentDerivedPosition);
      } else {
        this._cache_DerivedPosition = this.position;
      }
    }
    return this._cache_DerivedPosition;
  }

  GetDerivedRotation(): Quaternion {
    if (this._cache_DerivedRotation === null) {
      if (this.localMode === e_LocalMode.e_LocalMode_Relative && this.parent) {
        this._cache_DerivedRotation = this.parent.GetDerivedRotation().Mul(this.rotation).GetNormalized();
      } else {
        this._cache_DerivedRotation = this.rotation;
      }
    }
    return this._cache_DerivedRotation;
  }

  GetDerivedScale(): Vector3 {
    if (this._cache_DerivedScale === null) {
      if (this.localMode === e_LocalMode.e_LocalMode_Relative && this.parent) {
        this._cache_DerivedScale = this.parent.GetDerivedScale().Mul(this.scale);
      } else {
        this._cache_DerivedScale = this.scale;
      }
    }
    return this._cache_DerivedScale;
  }

  /** invalidates the derived transform cache of this spatial and everything below it */
  InvalidateSpatialData(): void {
    this._cache_DerivedPosition = null;
    this._cache_DerivedRotation = null;
    this._cache_DerivedScale = null;
    this.transformVersion++;
    this.InvalidateChildren();
  }

  protected InvalidateChildren(): void {}

  GetAABB(): AABB {
    const aabb = new AABB();
    aabb.Reset();
    return aabb;
  }
}

export class BaseObject extends Spatial {
  protected objectType: e_ObjectType;
  protected enabled = true;
  properties = new Properties();
  /** slot for the renderer / audio backend to attach its own data */
  backendData: unknown = null;

  constructor(name: string, objectType: e_ObjectType) {
    super(name);
    this.objectType = objectType;
  }

  Exit(): void {
    this.parent = null;
  }

  GetObjectType(): e_ObjectType {
    return this.objectType;
  }

  IsEnabled(): boolean {
    return this.enabled;
  }

  Enable(): void {
    this.enabled = true;
  }

  Disable(): void {
    this.enabled = false;
  }

  GetProperties(): Properties {
    return this.properties;
  }

  PropertyExists(property: string): boolean {
    return this.properties.Exists(property);
  }

  GetProperty(property: string): string {
    return this.properties.Get(property);
  }

  SetProperties(properties: Properties): void {
    this.properties.AddProperties(properties);
  }

  SetProperty(name: string, value: string): void {
    this.properties.Set(name, value);
  }

  /** C++ ObjectFactory::CopyObject: copies this object (subclasses deep-copy their resources) */
  CopyObject(postfix: string): BaseObject {
    // like C++ Object(src): the copied object keeps its name (postfix only applies to nodes/resources)
    const copy = new BaseObject(this.name, this.objectType);
    this.CopySpatialTo(copy);
    return copy;
  }

  protected CopySpatialTo(target: BaseObject): void {
    target.position = this.position;
    target.rotation = this.rotation;
    target.scale = this.scale;
    target.localMode = this.localMode;
    target.enabled = this.enabled;
    target.properties = this.properties.Clone();
  }

  /** C++ Poke(systemType): notifies backends of changes. Kept as a no-op hook. */
  Poke(_targetSystemType?: number): void {}

  Synchronize(): void {}
}
