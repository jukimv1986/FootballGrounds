// Port of blunted/base/math/vector3 and quaternion.
// Original: written by bastiaan konings schuiling 2008 - 2014 (public domain / Apache-2.0).
//
// PORTING NOTE: in C++ Vector3/Quaternion are mutable value types. Here they are IMMUTABLE
// reference types: every operation returns a new instance and `coords`/`elements` are
// readonly tuples, so sharing an instance can never cause aliasing bugs. C++ in-place
// operations become rebinding, e.g.
//   v += w;            ->  v = v.Add(w);
//   v.Normalize(0);    ->  v = v.GetNormalized(0);
//   v.coords[2] = 0;   ->  v = v.WithCoord(2, 0);
//   q.SetAngleAxis(a, axis);  ->  q = Quaternion.FromAngleAxis(a, axis);
//   quat * vec         ->  quat.MulVec(vec)
//   quat * quat2       ->  quat.Mul(quat2)
//   quat * 0.5f        ->  quat.Scale(0.5)
//   Vector3 v = quat;  ->  Vector3.FromQuaternion(quat)
//   Quaternion q = vec ->  Quaternion.FromVector(vec)

import { ModulateIntoRange, clamp, pi, signSide, type radian, type real } from './bluntmath';

export type Coords3 = readonly [number, number, number];
export type Elements4 = readonly [number, number, number, number];

export class Vector3 {
  readonly coords: Coords3;

  constructor();
  constructor(xyz: real);
  constructor(x: real, y: real, z: real);
  constructor(x?: real, y?: real, z?: real) {
    if (x === undefined) this.coords = [0, 0, 0];
    else if (y === undefined) this.coords = [x, x, x];
    else this.coords = [x, y, z as number];
  }

  static readonly ZERO = new Vector3(0, 0, 0);

  /** C++: `Vector3 v = quat;` (direction the quaternion points -z at) */
  static FromQuaternion(quat: Quaternion): Vector3 {
    const blah = new Quaternion(0, 0, -1, 0);
    const result = quat.Mul(blah).Mul(quat.GetInverse());
    return new Vector3(result.elements[0], result.elements[1], result.elements[2]);
  }

  /** accepts a Vector3 or a scalar (C++ implicitly converted `0` to `Vector3(0)`) */
  static From(v: Vector3 | number): Vector3 {
    return typeof v === 'number' ? new Vector3(v) : v;
  }

  GetEnvCoord(index: number): number {
    return this.coords[index];
  }

  /** replaces SetEnvCoord / `coords[i] = value` */
  WithCoord(index: number, value: number): Vector3 {
    const c: [number, number, number] = [this.coords[0], this.coords[1], this.coords[2]];
    c[index] = value;
    return new Vector3(c[0], c[1], c[2]);
  }

  get x(): number { return this.coords[0]; }
  get y(): number { return this.coords[1]; }
  get z(): number { return this.coords[2]; }

  // ----- operators

  /** operator == */
  Equals(v: Vector3): boolean {
    return this.coords[0] === v.coords[0] && this.coords[1] === v.coords[1] && this.coords[2] === v.coords[2];
  }

  /** operator != */
  NotEquals(v: Vector3): boolean {
    return !this.Equals(v);
  }

  /** operator * (scalar or component-wise) */
  Mul(s: real | Vector3): Vector3 {
    const c = this.coords;
    if (typeof s === 'number') return new Vector3(c[0] * s, c[1] * s, c[2] * s);
    return new Vector3(c[0] * s.coords[0], c[1] * s.coords[1], c[2] * s.coords[2]);
  }

  /** operator / (scalar or component-wise) */
  Div(s: real | Vector3): Vector3 {
    const c = this.coords;
    if (typeof s === 'number') return new Vector3(c[0] / s, c[1] / s, c[2] / s);
    return new Vector3(c[0] / s.coords[0], c[1] / s.coords[1], c[2] / s.coords[2]);
  }

  /** operator + (vector or scalar added to every component) */
  Add(v: Vector3 | real): Vector3 {
    const c = this.coords;
    if (typeof v === 'number') return new Vector3(c[0] + v, c[1] + v, c[2] + v);
    return new Vector3(c[0] + v.coords[0], c[1] + v.coords[1], c[2] + v.coords[2]);
  }

  /** operator - (vector or scalar subtracted from every component) */
  Sub(v: Vector3 | real): Vector3 {
    const c = this.coords;
    if (typeof v === 'number') return new Vector3(c[0] - v, c[1] - v, c[2] - v);
    return new Vector3(c[0] - v.coords[0], c[1] - v.coords[1], c[2] - v.coords[2]);
  }

  /** unary operator - */
  Neg(): Vector3 {
    return new Vector3(-this.coords[0], -this.coords[1], -this.coords[2]);
  }

  /** operator < (lexicographic, used for ordered map keys) */
  LessThan(v: Vector3): boolean {
    const a = this.coords;
    const b = v.coords;
    if (a[0] === b[0]) {
      if (a[1] === b[1]) return a[2] < b[2];
      return a[1] < b[1];
    }
    return a[0] < b[0];
  }

  /** stable string key, for replacing std::map<Vector3, T> with Map<string, T> */
  Key(): string {
    return `${this.coords[0]},${this.coords[1]},${this.coords[2]}`;
  }

  // ----- mathematics

  GetCrossProduct(f: Vector3): Vector3 {
    const c = this.coords;
    const d = f.coords;
    return new Vector3(c[1] * d[2] - c[2] * d[1], c[2] * d[0] - c[0] * d[2], c[0] * d[1] - c[1] * d[0]);
  }

  GetDotProduct(f: Vector3): real {
    const c = this.coords;
    const d = f.coords;
    return c[0] * d[0] + c[1] * d[1] + c[2] * d[2];
  }

  /** C++ Normalize()/Normalize(ifNull)/GetNormalized()/GetNormalized(ifNull) */
  GetNormalized(ifNull?: Vector3 | number): Vector3 {
    const c = this.coords;
    if (ifNull !== undefined) {
      if (Math.abs(c[0]) < 0.000001 && Math.abs(c[1]) < 0.000001 && Math.abs(c[2]) < 0.000001) {
        return Vector3.From(ifNull);
      }
    }
    const f = 1.0 / Math.sqrt(this.GetDotProduct(this));
    return new Vector3(c[0] * f, c[1] * f, c[2] * f);
  }

  /** C++ FastNormalize() */
  GetFastNormalized(): Vector3 {
    return this.GetNormalized();
  }

  GetNormalizedTo(length: number): Vector3 {
    const c = this.coords;
    const f = length / Math.sqrt(this.GetDotProduct(this));
    return new Vector3(c[0] * f, c[1] * f, c[2] * f);
  }

  /** C++ NormalizeMax()/GetNormalizedMax() */
  GetNormalizedMax(length: number): Vector3 {
    if (this.GetLength() > length) return this.GetNormalized(0).Mul(length);
    return this;
  }

  GetDistance(f: Vector3): real {
    const v0 = this.coords[0] - f.coords[0];
    const v1 = this.coords[1] - f.coords[1];
    const v2 = this.coords[2] - f.coords[2];
    if (v0 === 0 && v1 === 0 && v2 === 0) return 0;
    let length = Math.sqrt(v0 * v0 + v1 * v1 + v2 * v2);
    if (length < 0.000001) length = 0;
    return length;
  }

  GetLength(): real {
    const c = this.coords;
    let length = Math.sqrt(c[0] * c[0] + c[1] * c[1] + c[2] * c[2]);
    if (length < 0.000001) length = 0;
    return length;
  }

  GetSquaredLength(): real {
    const c = this.coords;
    return c[0] * c[0] + c[1] * c[1] + c[2] * c[2];
  }

  /** without argument: absolute 2D angle (0 .. 2pi). with argument: signed angle to `test` (-pi .. pi); both need to be normalized! */
  GetAngle2D(test?: Vector3): radian {
    const c = this.coords;
    if (test === undefined) {
      let angle = Math.atan2(c[1], c[0]);
      if (angle < 0) angle += 2 * pi;
      return angle;
    }
    const t = test.coords;
    let angle = -Math.atan2(c[0] * t[1] - c[1] * t[0], c[0] * t[0] + c[1] * t[1]);
    angle = ModulateIntoRange(-pi, pi, angle);
    return angle;
  }

  /** C++ Rotate(quat) */
  GetRotated(quat: Quaternion): Vector3 {
    const q = quat.elements;
    const c = this.coords;
    let uvx = c[2] * q[1] - c[1] * q[2];
    let uvy = c[0] * q[2] - c[2] * q[0];
    let uvz = c[1] * q[0] - c[0] * q[1];
    let uuvx = uvz * q[1] - uvy * q[2];
    let uuvy = uvx * q[2] - uvz * q[0];
    let uuvz = uvy * q[0] - uvx * q[1];
    uvx *= 2.0 * q[3];
    uvy *= 2.0 * q[3];
    uvz *= 2.0 * q[3];
    uuvx *= 2.0;
    uuvy *= 2.0;
    uuvz *= 2.0;
    return new Vector3(c[0] + uvx + uuvx, c[1] + uvy + uuvy, c[2] + uvz + uuvz);
  }

  /** C++ Rotate2D()/GetRotated2D() */
  GetRotated2D(angle: radian): Vector3 {
    const c = this.coords;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return new Vector3(c[0] * cos - c[1] * sin, c[1] * cos + c[0] * sin, c[2]);
  }

  Get2D(): Vector3 {
    return new Vector3(this.coords[0], this.coords[1], 0);
  }

  Compare(test: Vector3): boolean {
    return this.Equals(test);
  }

  GetAbsolute(): Vector3 {
    return new Vector3(Math.abs(this.coords[0]), Math.abs(this.coords[1]), Math.abs(this.coords[2]));
  }

  EnforceMaximumDeviation(deviant: Vector3, maxDeviation: number): Vector3 {
    let result: Vector3 = this;
    const difference = deviant.Sub(this);
    const differenceDistance = difference.GetLength();
    if (differenceDistance > maxDeviation) {
      result = result.Add(difference.GetNormalized().Mul(differenceDistance - maxDeviation));
    }
    return result;
  }

  GetClamped2D(v1: Vector3, v2: Vector3): Vector3 {
    let result: Vector3 = this;
    const v1_to_v2 = v2.GetAngle2D(v1);
    const direction = signSide(v1_to_v2);
    const v1_to_this = this.GetAngle2D(v1);
    const v2_to_this = this.GetAngle2D(v2);
    if (signSide(v1_to_this) !== direction || signSide(v2_to_this) === direction) {
      if (Math.abs(v1_to_this) < Math.abs(v2_to_this)) result = v1;
      else result = v2;
    }
    return result;
  }

  /** C++ Extrapolate(direction, time): direction in units/sec, time in ms */
  GetExtrapolated(direction: Vector3, time_ms: number): Vector3 {
    return this.Add(direction.Mul(time_ms / 1000.0));
  }

  Print(): void {
    console.log(`${this.coords[0]}, ${this.coords[1]}, ${this.coords[2]}`);
  }

  toString(): string {
    return `${this.coords[0]} ${this.coords[1]} ${this.coords[2]}`;
  }
}

export const QUATERNION_IDENTITY: Elements4 = [0, 0, 0, 1];

export class Quaternion {
  readonly elements: Elements4;

  constructor();
  constructor(values: Elements4 | readonly number[]);
  constructor(x: real, y: real, z: real, w: real);
  constructor(x?: real | Elements4 | readonly number[], y?: real, z?: real, w?: real) {
    if (x === undefined) this.elements = [0, 0, 0, 1];
    else if (typeof x !== 'number') this.elements = [x[0], x[1], x[2], x[3]];
    else this.elements = [x, y as number, z as number, w as number];
  }

  static readonly IDENTITY = new Quaternion(0, 0, 0, 1);

  /** C++ SetAngleAxis */
  static FromAngleAxis(rfangle: radian, rkaxis: Vector3): Quaternion {
    const fhalfangle = 0.5 * rfangle;
    const fsin = Math.sin(fhalfangle);
    return new Quaternion(fsin * rkaxis.coords[0], fsin * rkaxis.coords[1], fsin * rkaxis.coords[2], Math.cos(fhalfangle));
  }

  /** C++ SetAngles */
  static FromAngles(X: radian, Y: radian, Z: radian): Quaternion {
    const c1 = Math.cos(Y / 2.0);
    const s1 = Math.sin(Y / 2.0);
    const c2 = Math.cos(Z / 2.0);
    const s2 = Math.sin(Z / 2.0);
    const c3 = Math.cos(X / 2.0);
    const s3 = Math.sin(X / 2.0);
    const c1c2 = c1 * c2;
    const s1s2 = s1 * s2;
    return new Quaternion(
      c1c2 * s3 + s1s2 * c3,
      s1 * c2 * c3 + c1 * s2 * s3,
      c1 * s2 * c3 - s1 * c2 * s3,
      c1c2 * c3 - s1s2 * s3,
    );
  }

  /** C++ Set(const Matrix3 &) with the 9 elements (column major, row minor) */
  static FromMatrix3(m: readonly number[]): Quaternion {
    let n4: number;
    let q: [number, number, number, number];
    const tr = m[0] + m[4] + m[8];
    if (tr > 0.0) {
      q = [m[7] - m[5], m[2] - m[6], m[3] - m[1], tr + 1.0];
      n4 = q[3];
    } else if (m[0] > m[4] && m[0] > m[8]) {
      q = [1.0 + m[0] - m[4] - m[8], m[1] + m[3], m[2] + m[6], m[7] - m[5]];
      n4 = q[0];
    } else if (m[4] > m[8]) {
      q = [m[1] + m[3], 1.0 + m[4] - m[0] - m[8], m[5] + m[7], m[2] - m[6]];
      n4 = q[1];
    } else {
      q = [m[2] + m[6], m[5] + m[7], 1.0 + m[8] - m[0] - m[4], m[3] - m[1]];
      n4 = q[2];
    }
    const s = 0.5 / Math.sqrt(n4);
    return new Quaternion(q[0] * s, q[1] * s, q[2] * s, q[3] * s);
  }

  /** C++ `Quaternion q = vec;` (orientation looking along vec) */
  static FromVector(vec: Vector3): Quaternion {
    const z = vec.GetNormalized();
    let y = new Vector3(0, -1, 0);
    const x = y.GetCrossProduct(z).GetNormalized();
    y = z.GetCrossProduct(x);
    return Quaternion.FromMatrix3([
      x.coords[0], x.coords[1], x.coords[2],
      y.coords[0], y.coords[1], y.coords[2],
      z.coords[0], z.coords[1], z.coords[2],
    ]);
  }

  // ----- operators

  /** operator != (note: faithfully reproduces the original's element-index typo) */
  NotEquals(f: Quaternion): boolean {
    const a = this.elements;
    const b = f.elements;
    return b[0] !== a[0] || b[0] !== a[1] || b[2] !== a[2] || b[3] !== a[3];
  }

  /** operator * (float) */
  Scale(s: number): Quaternion {
    const e = this.elements;
    return new Quaternion(e[0] * s, e[1] * s, e[2] * s, e[3] * s);
  }

  /** operator * (Vector3): rotates the vector */
  MulVec(fac: Vector3): Vector3 {
    const qvec = new Vector3(this.elements[0], this.elements[1], this.elements[2]);
    let uv = qvec.GetCrossProduct(fac);
    let uuv = qvec.GetCrossProduct(uv);
    uv = uv.Mul(2.0 * this.elements[3]);
    uuv = uuv.Mul(2.0);
    return fac.Add(uv).Add(uuv);
  }

  /** operator * (Quaternion) */
  Mul(f: Quaternion): Quaternion {
    const a = this.elements;
    const b = f.elements;
    return new Quaternion(
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] + a[1] * b[3] + a[2] * b[0] - a[0] * b[2],
      a[3] * b[2] + a[2] * b[3] + a[0] * b[1] - a[1] * b[0],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    );
  }

  Add(q2: Quaternion): Quaternion {
    const a = this.elements;
    const b = q2.elements;
    return new Quaternion(a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]);
  }

  Sub(q2: Quaternion): Quaternion {
    const a = this.elements;
    const b = q2.elements;
    return new Quaternion(a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]);
  }

  Neg(): Quaternion {
    const a = this.elements;
    return new Quaternion(-a[0], -a[1], -a[2], -a[3]);
  }

  // ----- mathematics

  GetInverse(): Quaternion {
    const fnorm = this.GetMagnitude();
    if (fnorm < 0.000001) return Quaternion.IDENTITY;
    const finvnorm = 1.0 / fnorm;
    const e = this.elements;
    return new Quaternion(-e[0] * finvnorm, -e[1] * finvnorm, -e[2] * finvnorm, e[3] * finvnorm);
  }

  /** C++ ConstructMatrix: returns the 9 elements of the rotation matrix */
  ConstructMatrix(): number[] {
    const e = this.elements;
    const xx = e[0] * e[0], xy = e[0] * e[1], xz = e[0] * e[2], xw = e[0] * e[3];
    const yy = e[1] * e[1], yz = e[1] * e[2], yw = e[1] * e[3];
    const zz = e[2] * e[2], zw = e[2] * e[3];
    return [
      1 - 2 * (yy + zz), 2 * (xy - zw), 2 * (xz + yw),
      2 * (xy + zw), 1 - 2 * (xx + zz), 2 * (yz - xw),
      2 * (xz - yw), 2 * (yz + xw), 1 - 2 * (xx + yy),
    ];
  }

  /** C++ GetAngles(X, Y, Z) */
  GetAngles(): { X: radian; Y: radian; Z: radian } {
    const e = this.elements;
    const x = 0, y = 2, z = 1;
    const singularityTest = e[x] * e[y] + e[z] * e[3];
    if (singularityTest > 0.49999 || singularityTest < -0.49999) {
      let Z = 0;
      let Y = 0;
      if (singularityTest > 0) {
        Z = 2 * Math.atan2(e[x], e[z]);
        Y = pi * 0.5;
      }
      if (singularityTest < 0) {
        Z = -2 * Math.atan2(e[x], e[z]);
        Y = -pi * 0.5;
      }
      return { X: 0, Y, Z };
    }
    const sqx = e[x] * e[x];
    const sqy = e[y] * e[y];
    const sqz = e[z] * e[z];
    const Z = Math.atan2(2 * e[y] * e[3] - 2 * e[x] * e[z], 1 - 2 * sqy - 2 * sqz);
    const Y = Math.asin(2 * e[x] * e[y] + 2 * e[z] * e[3]);
    const X = Math.atan2(2 * e[x] * e[3] - 2 * e[y] * e[z], 1 - 2 * sqx - 2 * sqz);
    return { X, Y, Z };
  }

  /** C++ GetAngleAxis(angle, axis) */
  GetAngleAxis(): { angle: radian; axis: Vector3 } {
    const e = this.elements;
    const angle = 2.0 * Math.acos(clamp(e[3], -1, 1));
    const div = Math.sqrt(Math.max(0, 1.0 - e[3] * e[3]));
    if (div < 0.000001) return { angle, axis: new Vector3(e[0], e[1], e[2]) };
    return { angle, axis: new Vector3(e[0] / div, e[1] / div, e[2] / div) };
  }

  conjugate_get(): Quaternion {
    const e = this.elements;
    return new Quaternion(-e[0], -e[1], -e[2], e[3]);
  }

  GetMagnitude(): real {
    const e = this.elements;
    if (e[0] === 0 && e[1] === 0 && e[2] === 0 && e[3] === 0) return 0;
    const magnitude = Math.sqrt(e[0] * e[0] + e[1] * e[1] + e[2] * e[2] + e[3] * e[3]);
    if (magnitude < 0.000001) return 0;
    return magnitude;
  }

  /** C++ Normalize()/GetNormalized() */
  GetNormalized(): Quaternion {
    const e = this.elements;
    const qmagsq = e[0] * e[0] + e[1] * e[1] + e[2] * e[2] + e[3] * e[3];
    if (qmagsq < 0.000001) return Quaternion.IDENTITY;
    if (Math.abs(1.0 - qmagsq) < 2.107342e-8) return this.Scale(2.0 / (1.0 + qmagsq));
    return this.Scale(1.0 / Math.sqrt(qmagsq));
  }

  GetDotProduct(s: Quaternion): number {
    const a = this.elements;
    const b = s.elements;
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  }

  GetLerped(bias: number, to: Quaternion): Quaternion {
    return this.Scale(1 - bias).Add(to.Scale(bias)).GetNormalized();
  }

  GetSlerped(bias: number, to: Quaternion): Quaternion {
    const a = this.elements;
    let qb = to;
    let cosHalfTheta = a[3] * qb.elements[3] + a[0] * qb.elements[0] + a[1] * qb.elements[1] + a[2] * qb.elements[2];
    if (cosHalfTheta < 0) {
      qb = qb.Neg();
      cosHalfTheta = -cosHalfTheta;
    }
    if (Math.abs(cosHalfTheta) >= 1.0) return this;
    const halfTheta = Math.acos(cosHalfTheta);
    const sinHalfTheta = Math.sqrt(1.0 - cosHalfTheta * cosHalfTheta);
    const b = qb.elements;
    if (Math.abs(sinHalfTheta) < 0.000001) {
      return new Quaternion(a[0] * 0.5 + b[0] * 0.5, a[1] * 0.5 + b[1] * 0.5, a[2] * 0.5 + b[2] * 0.5, a[3] * 0.5 + b[3] * 0.5);
    }
    const ratioA = Math.sin((1 - bias) * halfTheta) / sinHalfTheta;
    const ratioB = Math.sin(bias * halfTheta) / sinHalfTheta;
    return new Quaternion(
      a[0] * ratioA + b[0] * ratioB,
      a[1] * ratioA + b[1] * ratioB,
      a[2] * ratioA + b[2] * ratioB,
      a[3] * ratioA + b[3] * ratioB,
    );
  }

  GetRotationTo(to: Quaternion): Quaternion {
    return to.Mul(this.GetInverse());
  }

  GetRotationMultipliedBy(factor: number): Quaternion {
    let { angle, axis } = this.GetAngleAxis();
    if (angle > pi) angle -= 2.0 * pi;
    angle = (angle * factor) % (2.0 * pi);
    return Quaternion.FromAngleAxis(angle, axis).GetNormalized();
  }

  GetRotationAngle(to: Quaternion): radian {
    return 2.0 * Math.acos(clamp(this.GetDotProduct(to), -1.0, 1.0));
  }

  /** C++ MakeSameNeighborhood(src): returns the (possibly negated) quaternion and the dot product */
  GetSameNeighborhood(src: Quaternion): { quat: Quaternion; dot: number } {
    const dot = this.GetDotProduct(src);
    if (dot < 0) return { quat: this.Neg(), dot: -dot };
    return { quat: this, dot };
  }

  Print(): void {
    const e = this.elements;
    console.log(`${e[0]}, ${e[1]}, ${e[2]}, ${e[3]}`);
  }
}

export type Vector = Vector3;
