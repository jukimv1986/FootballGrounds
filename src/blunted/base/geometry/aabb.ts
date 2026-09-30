// Port of blunted/base/geometry/aabb (axis aligned bounding box). Mutable, like the original.

import { Vector3, Quaternion } from '../math/vector3';

const MAX = 3.4028234663852886e38;

export class AABB {
  minxyz: Vector3;
  maxxyz: Vector3;

  constructor(src?: AABB) {
    if (src) {
      this.minxyz = src.minxyz;
      this.maxxyz = src.maxxyz;
    } else {
      this.minxyz = new Vector3(0);
      this.maxxyz = new Vector3(0);
    }
  }

  Clone(): AABB {
    return new AABB(this);
  }

  /** operator += : grows this box to include `add` (mutates, returns this) */
  AddAABB(add: AABB): AABB {
    const a = this.minxyz.coords;
    const b = this.maxxyz.coords;
    const c = add.minxyz.coords;
    const d = add.maxxyz.coords;
    this.minxyz = new Vector3(Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.min(a[2], c[2]));
    this.maxxyz = new Vector3(Math.max(b[0], d[0]), Math.max(b[1], d[1]), Math.max(b[2], d[2]));
    return this;
  }

  /** operator + (Vector3): translated copy */
  Translated(vec: Vector3): AABB {
    const r = new AABB(this);
    r.minxyz = r.minxyz.Add(vec);
    r.maxxyz = r.maxxyz.Add(vec);
    return r;
  }

  /** operator * (Quaternion): AABB of the rotated box */
  Rotated(rot: Quaternion): AABB {
    const mn = this.minxyz.coords;
    const mx = this.maxxyz.coords;
    const r = new AABB();
    r.Reset();
    for (let i = 0; i < 8; i++) {
      const v = rot.MulVec(new Vector3(i & 1 ? mx[0] : mn[0], i & 2 ? mx[1] : mn[1], i & 4 ? mx[2] : mn[2]));
      r.Expand(v);
    }
    return r;
  }

  /** grows the box to include a point */
  Expand(v: Vector3): void {
    const a = this.minxyz.coords;
    const b = this.maxxyz.coords;
    const c = v.coords;
    this.minxyz = new Vector3(Math.min(a[0], c[0]), Math.min(a[1], c[1]), Math.min(a[2], c[2]));
    this.maxxyz = new Vector3(Math.max(b[0], c[0]), Math.max(b[1], c[1]), Math.max(b[2], c[2]));
  }

  Reset(): void {
    this.minxyz = new Vector3(MAX, MAX, MAX);
    this.maxxyz = new Vector3(-MAX, -MAX, -MAX);
  }

  SetMinXYZ(min: Vector3): void {
    this.minxyz = min;
  }

  SetMaxXYZ(max: Vector3): void {
    this.maxxyz = max;
  }

  MakeDirty(): void {
    // radius/center are computed on demand
  }

  GetRadius(): number {
    const x = this.maxxyz.coords[0] - this.minxyz.coords[0];
    const y = this.maxxyz.coords[1] - this.minxyz.coords[1];
    const z = this.maxxyz.coords[2] - this.minxyz.coords[2];
    const length = Math.sqrt(x * x + y * y);
    return Math.sqrt(length * length + z * z) / 2.0;
  }

  /** C++ GetCenter(Vector3 &center) */
  GetCenter(): Vector3 {
    return this.minxyz.Add(this.maxxyz).Mul(0.5);
  }

  /** sphere intersection */
  IntersectsSphere(center: Vector3, radius: number): boolean {
    let d = 0;
    for (let i = 0; i < 3; i++) {
      const c = center.coords[i];
      if (c < this.minxyz.coords[i]) {
        const s = c - this.minxyz.coords[i];
        d += s * s;
      } else if (c > this.maxxyz.coords[i]) {
        const s = c - this.maxxyz.coords[i];
        d += s * s;
      }
    }
    return d <= radius * radius;
  }

  /** C++ Intersects(const AABB &) (strict overlap) */
  Intersects(src: AABB): boolean {
    const mn = this.minxyz.coords, mx = this.maxxyz.coords, smn = src.minxyz.coords, smx = src.maxxyz.coords;
    return (
      smn[0] < mx[0] && smn[1] < mx[1] && smn[2] < mx[2] &&
      smx[0] > mn[0] && smx[1] > mn[1] && smx[2] > mn[2]
    );
  }
}
