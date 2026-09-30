// Engine GeometryData -> Three.js BufferGeometry.
//
// Like the C++ VertexBuffer (graphics_geometry.cpp), one vertex buffer is shared by every Geometry object
// using the same GeometryData. The MaterializedTriangleMeshes are concatenated, reordered so that
// meshes with the same material are contiguous, and each run of equal materials becomes one draw group
// (the original also merged sequential chunks until a texture changed). This matters: the stadium has
// 1642 triangle meshes but only ~30 materials.
//
// Per-vertex data comes from the 5-block layout of MaterializedTriangleMesh.vertices:
//   positions | normals | texcoords (u, v, w) | tangents | bitangents   (3 floats per vertex each)
// The ASE loader already negated v; textures are uploaded unflipped with repeat wrapping, which is
// exactly what the original did. Tangents become vec4 with w = sign(dot(cross(N, T), B)) so Three's
// TBN (B = cross(N, T) * w) equals the original's (bump.x * T + bump.y * B + bump.z * N).

import * as THREE from 'three';
import type { GeometryData, MaterializedTriangleMesh } from '../scene/resources/geometrydata';

const ELEMENTS = 5;

export class GeometryBuffers {
  geometry = new THREE.BufferGeometry();
  users = 0;
  /** GeometryData.version at the last (re)build */
  dataVersion = -1;
  /** bumped whenever the draw groups change, so users re-assign their material arrays */
  partitionVersion = 0;
  /** first mesh (index into the data's triangle meshes) of every draw group */
  groupFirstMesh: number[] = [];
  /** draw group of every triangle mesh */
  meshGroup: Int32Array = new Int32Array(0);
  hasTangents = false;
  indexed = false;
  dynamic = false;
  lastUploadFrame = -1;
  vertexCount = 0;
  triangleCount = 0;
  /** bounding sphere radius (local space), for shadow-caster decisions */
  radius = 0;

  // structure the buffers were built for
  private meshSizes: number[] = [];
  private meshIndexCounts: number[] = [];
  /** meshes in buffer order, and their first vertex / first index */
  private order: number[] = [];
  private vertexStart: number[] = [];
  private indexStart: number[] = [];

  private position: THREE.BufferAttribute | null = null;
  private normal: THREE.BufferAttribute | null = null;
  private uv: THREE.BufferAttribute | null = null;
  private tangent: THREE.BufferAttribute | null = null;

  constructor(readonly data: GeometryData) {}

  /** true when mesh count, vertex counts or index counts differ from what the buffers were built for */
  StructureChanged(): boolean {
    if (this.data.version !== this.dataVersion) return true;
    const meshes = this.data.GetTriangleMeshesRef();
    if (meshes.length !== this.meshSizes.length) return true;
    for (let i = 0; i < meshes.length; i++) {
      if (meshes[i].verticesDataSize !== this.meshSizes[i] || meshes[i].indices.length !== this.meshIndexCounts[i]) return true;
    }
    return false;
  }

  /** whether the current draw groups are valid for these per-mesh material keys */
  PartitionMatches(keys: readonly string[]): boolean {
    if (keys.length !== this.meshGroup.length) return false;
    for (let i = 0; i < keys.length; i++) {
      if (keys[i] !== keys[this.groupFirstMesh[this.meshGroup[i]]]) return false;
    }
    return true;
  }

  /**
   * (re)builds the buffers. `keys` holds a material key per triangle mesh (meshes with equal keys are
   * merged into one draw group); `needTangents` whether any material uses a normal map.
   */
  Build(keys: readonly string[], needTangents: boolean): void {
    const meshes = this.data.GetTriangleMeshesRef();
    this.dataVersion = this.data.version;
    this.dynamic = this.data.IsDynamic();
    this.hasTangents = needTangents;
    this.meshSizes = meshes.map((m) => m.verticesDataSize);
    this.meshIndexCounts = meshes.map((m) => m.indices.length);

    // partition
    const groupOfKey = new Map<string, number>();
    const groupMeshes: number[][] = [];
    this.meshGroup = new Int32Array(meshes.length);
    this.groupFirstMesh = [];
    for (let i = 0; i < meshes.length; i++) {
      const key = keys[i] ?? '';
      let g = groupOfKey.get(key);
      if (g === undefined) {
        g = groupMeshes.length;
        groupOfKey.set(key, g);
        groupMeshes.push([]);
        this.groupFirstMesh.push(i);
      }
      groupMeshes[g].push(i);
      this.meshGroup[i] = g;
    }

    // layout
    this.order = [];
    this.vertexStart = new Array(meshes.length).fill(0);
    this.indexStart = new Array(meshes.length).fill(0);
    this.indexed = meshes.some((m) => m.indices.length > 0);
    let vertexCount = 0;
    let indexCount = 0;
    const groupRanges: { start: number; count: number }[] = [];
    for (const list of groupMeshes) {
      const groupStart = this.indexed ? indexCount : vertexCount;
      for (const i of list) {
        const n = VertexCount(meshes[i]);
        this.order.push(i);
        this.vertexStart[i] = vertexCount;
        this.indexStart[i] = indexCount;
        vertexCount += n;
        indexCount += meshes[i].indices.length > 0 ? meshes[i].indices.length : n;
      }
      groupRanges.push({ start: groupStart, count: (this.indexed ? indexCount : vertexCount) - groupStart });
    }
    this.vertexCount = vertexCount;
    this.triangleCount = Math.trunc((this.indexed ? indexCount : vertexCount) / 3);

    const old = this.geometry;
    const geometry = new THREE.BufferGeometry();
    const usage = this.dynamic ? THREE.DynamicDrawUsage : THREE.StaticDrawUsage;
    this.position = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3).setUsage(usage);
    this.normal = new THREE.BufferAttribute(new Float32Array(vertexCount * 3), 3).setUsage(usage);
    this.uv = new THREE.BufferAttribute(new Float32Array(vertexCount * 2), 2);
    geometry.setAttribute('position', this.position);
    geometry.setAttribute('normal', this.normal);
    geometry.setAttribute('uv', this.uv);
    if (needTangents) {
      this.tangent = new THREE.BufferAttribute(new Float32Array(vertexCount * 4), 4).setUsage(usage);
      geometry.setAttribute('tangent', this.tangent);
    } else {
      this.tangent = null;
    }
    if (this.indexed) {
      const IndexArray = vertexCount > 65535 ? Uint32Array : Uint16Array;
      geometry.setIndex(new THREE.BufferAttribute(new IndexArray(indexCount), 1));
    }
    for (let g = 0; g < groupRanges.length; g++) geometry.addGroup(groupRanges[g].start, groupRanges[g].count, g);
    this.geometry = geometry;
    this.partitionVersion++;
    old.dispose();

    this.Upload(true, -1);
    if (!this.dynamic) {
      geometry.computeBoundingSphere();
      this.radius = geometry.boundingSphere ? geometry.boundingSphere.radius : 0;
    }
  }

  /**
   * copies the vertex data into the attributes. `full` also refreshes texture coordinates and indices
   * (the per-frame skinning updates of the players only touch positions, normals and tangents).
   */
  Upload(full: boolean, frame: number): void {
    this.lastUploadFrame = frame;
    const meshes = this.data.GetTriangleMeshesRef();
    const pos = this.position!.array as Float32Array;
    const nrm = this.normal!.array as Float32Array;
    const uv = this.uv!.array as Float32Array;
    const tan = this.tangent ? (this.tangent.array as Float32Array) : null;
    const index = this.geometry.index ? (this.geometry.index.array as Uint16Array | Uint32Array) : null;

    for (const i of this.order) {
      const mesh = meshes[i];
      const n = VertexCount(mesh);
      if (n === 0) continue;
      const block = n * 3;
      const v = mesh.vertices;
      const vo = this.vertexStart[i];
      pos.set(v.subarray(0, block), vo * 3);
      nrm.set(v.subarray(block, 2 * block), vo * 3);
      if (full) {
        const t0 = 2 * block;
        for (let k = 0, o = vo * 2; k < n; k++, o += 2) {
          uv[o] = v[t0 + k * 3];
          uv[o + 1] = v[t0 + k * 3 + 1];
        }
        if (index) {
          const io = this.indexStart[i];
          const idx = mesh.indices;
          if (idx.length > 0) for (let k = 0; k < idx.length; k++) index[io + k] = vo + idx[k];
          else for (let k = 0; k < n; k++) index[io + k] = vo + k;
        }
      }
      if (tan) {
        const n0 = block;
        const t0 = 3 * block;
        const b0 = 4 * block;
        for (let k = 0, o = vo * 4; k < n; k++, o += 4) {
          const k3 = k * 3;
          const nx = v[n0 + k3], ny = v[n0 + k3 + 1], nz = v[n0 + k3 + 2];
          const tx = v[t0 + k3], ty = v[t0 + k3 + 1], tz = v[t0 + k3 + 2];
          const bx = v[b0 + k3], by = v[b0 + k3 + 1], bz = v[b0 + k3 + 2];
          // w = sign(dot(cross(N, T), B))
          const w = (ny * tz - nz * ty) * bx + (nz * tx - nx * tz) * by + (nx * ty - ny * tx) * bz;
          tan[o] = tx;
          tan[o + 1] = ty;
          tan[o + 2] = tz;
          tan[o + 3] = w < 0 ? -1 : 1;
        }
      }
    }

    this.position!.needsUpdate = true;
    this.normal!.needsUpdate = true;
    if (this.tangent) this.tangent.needsUpdate = true;
    if (full) {
      this.uv!.needsUpdate = true;
      if (this.geometry.index) this.geometry.index.needsUpdate = true;
    }
    if (this.dynamic) this.UpdateBounds(pos);
  }

  /** cheap bounding sphere for dynamic meshes: the sphere around the positions' AABB */
  private UpdateBounds(pos: Float32Array): void {
    let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1], z = pos[i + 2];
      if (x < mnx) mnx = x;
      if (x > mxx) mxx = x;
      if (y < mny) mny = y;
      if (y > mxy) mxy = y;
      if (z < mnz) mnz = z;
      if (z > mxz) mxz = z;
    }
    const geometry = this.geometry;
    if (!geometry.boundingSphere) geometry.boundingSphere = new THREE.Sphere();
    const sphere = geometry.boundingSphere;
    if (mnx === Infinity) {
      sphere.center.set(0, 0, 0);
      sphere.radius = 0;
    } else {
      sphere.center.set((mnx + mxx) * 0.5, (mny + mxy) * 0.5, (mnz + mxz) * 0.5);
      const dx = mxx - mnx, dy = mxy - mny, dz = mxz - mnz;
      sphere.radius = 0.5 * Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    this.radius = sphere.radius;
  }

  Dispose(): void {
    this.geometry.dispose();
    this.position = this.normal = this.uv = this.tangent = null;
  }
}

function VertexCount(mesh: MaterializedTriangleMesh): number {
  if (mesh.vertices.length < mesh.verticesDataSize) return 0;
  return Math.trunc(mesh.verticesDataSize / ELEMENTS / 3);
}
