// Port of blunted/scene/resources/geometrydata and types/material.

import { Vector3 } from '../../base/math/vector3';
import { AABB } from '../../base/geometry/aabb';
import type { Resource } from './resource';
import type { Surface } from './surface';

/** number of per-vertex element blocks in MaterializedTriangleMesh.vertices */
export const __triangleMeshElementCount = 5;
export function GetTriangleMeshElementCount(): number {
  return __triangleMeshElementCount;
}

export interface Material {
  diffuseTexture: Resource<Surface> | null;
  normalTexture: Resource<Surface> | null;
  specularTexture: Resource<Surface> | null;
  illuminationTexture: Resource<Surface> | null;
  shininess: number;
  specular_amount: number;
  self_illumination: Vector3;
}

export function CreateMaterial(): Material {
  return {
    diffuseTexture: null,
    normalTexture: null,
    specularTexture: null,
    illuminationTexture: null,
    shininess: 0,
    specular_amount: 0,
    self_illumination: new Vector3(0),
  };
}

export interface MaterializedTriangleMesh {
  material: Material;
  /**
   * 5 consecutive blocks of verticesDataSize / 5 floats each:
   * positions, normals, texture coords, tangents, bitangents (3 floats per vertex each).
   */
  vertices: Float32Array;
  verticesDataSize: number;
  /** empty: plain triangle list; otherwise indices into the (unique) vertex list */
  indices: number[];
}

export class GeometryData {
  protected isDynamic = false;
  protected triangleMeshes: MaterializedTriangleMesh[] = [];
  /** bumped on every change so the renderer can re-upload buffers */
  version = 0;

  Clone(): GeometryData {
    const g = new GeometryData();
    g.isDynamic = this.isDynamic;
    g.triangleMeshes = this.triangleMeshes.map((m) => ({
      material: { ...m.material },
      vertices: new Float32Array(m.vertices),
      verticesDataSize: m.verticesDataSize,
      indices: m.indices.slice(),
    }));
    return g;
  }

  DeleteTriangleMeshes(): void {
    this.triangleMeshes = [];
    this.version++;
  }

  SetTriangleMesh(material: Material, vertices: Float32Array, verticesDataSize: number, indices: number[]): void {
    this.triangleMeshes = [];
    this.AddTriangleMesh(material, vertices, verticesDataSize, indices);
  }

  AddTriangleMesh(material: Material, vertices: Float32Array, verticesDataSize: number, indices: number[]): void {
    this.triangleMeshes.push({ material, vertices, verticesDataSize, indices });
    this.version++;
  }

  /** C++ GetTriangleMeshes() and GetTriangleMeshesRef() (the array is shared, not copied) */
  GetTriangleMeshesRef(): MaterializedTriangleMesh[] {
    return this.triangleMeshes;
  }

  GetTriangleMeshes(): MaterializedTriangleMesh[] {
    return this.triangleMeshes;
  }

  SetDynamic(dynamic: boolean): void {
    this.isDynamic = dynamic;
  }

  IsDynamic(): boolean {
    return this.isDynamic;
  }

  GetAABB(): AABB {
    const aabb = new AABB();
    aabb.Reset();
    let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    for (const mesh of this.triangleMeshes) {
      const v = mesh.vertices;
      const count = mesh.verticesDataSize / __triangleMeshElementCount;
      for (let i = 0; i < count; i += 3) {
        const x = v[i], y = v[i + 1], z = v[i + 2];
        if (x < mnx) mnx = x;
        if (y < mny) mny = y;
        if (z < mnz) mnz = z;
        if (x > mxx) mxx = x;
        if (y > mxy) mxy = y;
        if (z > mxz) mxz = z;
      }
    }
    if (mnx !== Infinity) {
      aabb.SetMinXYZ(new Vector3(mnx, mny, mnz));
      aabb.SetMaxXYZ(new Vector3(mxx, mxy, mxz));
    }
    return aabb;
  }
}
