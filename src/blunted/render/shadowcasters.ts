// Shadow-only geometry, to keep the shadow pass cheap:
//  - static casters (stadium chunks that haven't changed for a while) are merged, in world space, into
//    one opaque depth-only mesh plus one mesh per alpha-tested material (goal nets, fences, crowd);
//  - multi-material dynamic meshes (a player body has 6 materials, i.e. 6 draw calls) get a proxy that
//    draws the whole vertex buffer in one call, sharing the GPU buffers of the visible mesh.
// The root group is only visible during the shadow pass: WebGLRenderer builds the main render list
// before it renders shadow maps, and ThreeRenderer switches the group on from the shadow light's
// updateMatrices() (called right before the shadow traversal) and off again after rendering.
// As a safety net the depth-only material writes neither colour nor depth.

import * as THREE from 'three';
import type { GeometryBuffers } from './rendergeometry';

export interface StaticCaster {
  buffers: GeometryBuffers;
  matrixWorld: THREE.Matrix4;
  /** material per draw group of `buffers` */
  groupMaterials: THREE.Material[];
}

export class ShadowCasters {
  readonly root = new THREE.Group();
  readonly depthOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  private readonly members = new Set<StaticCaster>();
  private batches: THREE.Mesh[] = [];
  private dirty = false;
  /** number of static members merged into the batches */
  batchedCount = 0;

  constructor() {
    this.root.name = 'shadow casters';
    this.root.visible = false;
    this.root.matrixAutoUpdate = false;
    this.root.matrixWorldAutoUpdate = false;
  }

  // ----- per-object proxies

  CreateProxy(): THREE.Mesh {
    const proxy = new THREE.Mesh(new THREE.BufferGeometry(), this.depthOnly);
    proxy.castShadow = true;
    proxy.receiveShadow = false;
    proxy.matrixAutoUpdate = false;
    proxy.matrixWorldAutoUpdate = false;
    proxy.visible = false;
    this.root.add(proxy);
    return proxy;
  }

  /** points the proxy at a (new) source geometry: same attributes and index, no groups */
  SetProxySource(proxy: THREE.Mesh, source: THREE.BufferGeometry): void {
    const old = proxy.geometry;
    const geometry = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'uv']) {
      const attribute = source.getAttribute(name);
      if (attribute) geometry.setAttribute(name, attribute);
    }
    geometry.setIndex(source.index);
    // shared object: dynamic meshes update their bounding sphere in place
    geometry.boundingSphere = source.boundingSphere;
    proxy.geometry = geometry;
    // only the proxy's own GL state is released: the source was disposed first when it was rebuilt,
    // and while it lives removing its (shared) attributes just costs one re-upload
    old.dispose();
  }

  RemoveProxy(proxy: THREE.Mesh): void {
    this.root.remove(proxy);
  }

  // ----- static batches

  Add(member: StaticCaster): void {
    this.members.add(member);
    this.dirty = true;
  }

  Remove(member: StaticCaster): void {
    if (this.members.delete(member)) this.dirty = true;
  }

  /** rebuilds the merged geometry if members changed (call once per frame, before rendering) */
  Update(): void {
    if (!this.dirty) return;
    this.dirty = false;
    for (const mesh of this.batches) {
      this.root.remove(mesh);
      mesh.geometry.dispose();
    }
    this.batches = [];
    this.batchedCount = this.members.size;
    if (this.members.size === 0) return;

    // collect draw ranges: opaque ones share one batch, alpha-tested ones are batched per material
    interface Range {
      member: StaticCaster;
      start: number;
      count: number;
    }
    const opaque: Range[] = [];
    const alpha = new Map<THREE.Material, Range[]>();
    for (const member of this.members) {
      const groups = member.buffers.geometry.groups;
      for (let g = 0; g < groups.length; g++) {
        const material = member.groupMaterials[g];
        if (!material) continue;
        const range = { member, start: groups[g].start, count: groups[g].count };
        if (material.alphaTest > 0) {
          let list = alpha.get(material);
          if (!list) alpha.set(material, (list = []));
          list.push(range);
        } else {
          opaque.push(range);
        }
      }
    }
    if (opaque.length > 0) this.AddBatch(opaque, this.depthOnly, false);
    for (const [material, ranges] of alpha) this.AddBatch(ranges, material, true);
  }

  private AddBatch(ranges: { member: StaticCaster; start: number; count: number }[], material: THREE.Material, withUv: boolean): void {
    let total = 0;
    for (const r of ranges) total += r.count;
    if (total === 0) return;
    const positions = new Float32Array(total * 3);
    const uvs = withUv ? new Float32Array(total * 2) : null;
    const v = new THREE.Vector3();
    let o = 0;
    for (const r of ranges) {
      const buffers = r.member.buffers;
      const pos = buffers.geometry.getAttribute('position').array as Float32Array;
      const uv = buffers.geometry.getAttribute('uv').array as Float32Array;
      const index = buffers.geometry.index ? buffers.geometry.index.array : null;
      const m = r.member.matrixWorld;
      for (let k = r.start; k < r.start + r.count; k++, o++) {
        const vi = index ? index[k] : k;
        v.set(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2]).applyMatrix4(m);
        positions[o * 3] = v.x;
        positions[o * 3 + 1] = v.y;
        positions[o * 3 + 2] = v.z;
        if (uvs) {
          uvs[o * 2] = uv[vi * 2];
          uvs[o * 2 + 1] = uv[vi * 2 + 1];
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (uvs) geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'static shadow batch';
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorldAutoUpdate = false;
    this.root.add(mesh);
    this.batches.push(mesh);
  }

  Clear(): void {
    this.members.clear();
    this.dirty = true;
    this.Update();
    for (const child of [...this.root.children]) {
      this.root.remove(child);
      (child as THREE.Mesh).geometry?.dispose();
    }
    this.batchedCount = 0;
  }

  Dispose(): void {
    this.Clear();
    this.depthOnly.dispose();
  }
}
