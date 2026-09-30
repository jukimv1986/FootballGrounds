// Port of blunted/scene/objects/geometry.

import { AABB } from '../../base/geometry/aabb';
import { Vector3 } from '../../base/math/vector3';
import { BaseObject, e_ObjectType } from '../spatial';
import { GeometryData, type Material } from '../resources/geometrydata';
import { Resource } from '../resources/resource';
import { ResourceManagerPool } from '../../managers/resourcemanagerpool';

export class Geometry extends BaseObject {
  protected geometryData: Resource<GeometryData> | null = null;
  /** bumped by OnUpdateGeometryData; `materialsVersion` only when materials changed too */
  geometryVersion = 0;
  materialsVersion = 0;
  /**
   * the triangle meshes' materials as they were at the last OnUpdateGeometryData(true). The C++ renderer
   * captured them there, per geometry object, so objects sharing one GeometryData (hairstyles) keep their
   * own textures. Read by src/blunted/render; null = use the live materials.
   */
  materialsSnapshot: Material[] | null = null;

  constructor(name: string, objectType: e_ObjectType = e_ObjectType.e_ObjectType_Geometry) {
    super(name, objectType);
  }

  /** C++ copy constructor Geometry(src, postfix): deep copies the geometry data */
  override CopyObject(postfix: string): Geometry {
    // like C++ Object(src): the copied object keeps its name; only nodes and resource copies get the postfix
    const copy = new Geometry(this.name, this.objectType);
    this.CopySpatialTo(copy);
    if (this.geometryData) {
      const srcName = this.geometryData.GetIdentString();
      copy.geometryData = ResourceManagerPool.GetInstance().FetchGeometryDataCopy(srcName, srcName + postfix);
    }
    return copy;
  }

  SetGeometryData(geometryData: Resource<GeometryData>): void {
    this.geometryData = geometryData;
    this.OnUpdateGeometryData(true);
  }

  GetGeometryData(): Resource<GeometryData> {
    if (!this.geometryData) throw new Error(`Geometry ${this.name} has no geometry data`);
    return this.geometryData;
  }

  HasGeometryData(): boolean {
    return this.geometryData !== null;
  }

  /** tells the renderer the vertex data (and optionally the materials) changed */
  OnUpdateGeometryData(updateMaterials = true): void {
    this.geometryVersion++;
    if (updateMaterials) {
      this.materialsVersion++;
      this.materialsSnapshot = this.geometryData ? this.geometryData.GetResource().GetTriangleMeshesRef().map((m) => ({ ...m.material })) : null;
    }
  }

  override GetAABB(): AABB {
    if (!this.geometryData) return super.GetAABB();
    return this.geometryData.GetResource().GetAABB().Rotated(this.GetDerivedRotation()).Translated(this.GetDerivedPosition());
  }

  ApplyForceAtRelativePosition(_force: number, _direction: Vector3, _position: Vector3): void {}
}
