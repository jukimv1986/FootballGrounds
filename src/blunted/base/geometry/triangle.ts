// Port of blunted/base/geometry/triangle (subset used by the game and the .ase loader).

import { Vector3 } from '../math/vector3';
import { AABB } from './aabb';
import type { Line } from './line';

export class Triangle {
  protected vertices: Vector3[] = [new Vector3(0), new Vector3(0), new Vector3(0)];
  protected normals: Vector3[] = [new Vector3(0), new Vector3(0), new Vector3(0)];
  protected tangents: Vector3[] = [new Vector3(0), new Vector3(0), new Vector3(0)];
  protected biTangents: Vector3[] = [new Vector3(0), new Vector3(0), new Vector3(0)];
  /** [vertex][texture unit] */
  protected textureVertices: Vector3[][] = [0, 1, 2].map(() => Array.from({ length: 8 }, () => new Vector3(0)));

  constructor(v1?: Vector3, v2?: Vector3, v3?: Vector3) {
    if (v1 && v2 && v3) this.vertices = [v1, v2, v3];
  }

  SetVertex(pos: number, vec: Vector3): void {
    this.vertices[pos] = vec;
  }

  GetVertex(pos: number): Vector3 {
    return this.vertices[pos];
  }

  SetNormal(pos: number, vec: Vector3): void {
    this.normals[pos] = vec;
  }

  SetNormals(vec: Vector3): void {
    this.normals = [vec, vec, vec];
  }

  GetNormal(pos: number): Vector3 {
    return this.normals[pos];
  }

  SetTextureVertex(texture_unit: number, pos: number, xyz: Vector3): void {
    this.textureVertices[pos][texture_unit] = xyz;
  }

  GetTextureVertex(pos: number, texture_unit = 0): Vector3 {
    return this.textureVertices[pos][texture_unit];
  }

  GetTangent(pos: number): Vector3 {
    return this.tangents[pos];
  }

  GetBiTangent(pos: number): Vector3 {
    return this.biTangents[pos];
  }

  GetAABB(): AABB {
    const aabb = new AABB();
    aabb.Reset();
    for (const v of this.vertices) aabb.Expand(v);
    return aabb;
  }

  /** C++ IntersectsLine(line, Vector3 &intersectVec): returns the intersection point or null */
  IntersectsLine(u_ray: Line): Vector3 | null {
    const u = this.vertices[1].Sub(this.vertices[0]);
    const v = this.vertices[2].Sub(this.vertices[0]);
    const dir = u_ray.GetVertex(1).Sub(u_ray.GetVertex(0));
    const w0 = u_ray.GetVertex(0).Sub(this.vertices[0]);
    const a = -this.normals[0].GetDotProduct(w0);
    const b = this.normals[0].GetDotProduct(dir);
    if (Math.abs(b) < 0.000001) return null;
    const r = a / b;
    if (r <= 0.0 || r >= 1.0) return null;
    const intersectVec = u_ray.GetVertex(0).Add(dir.Mul(r));
    const uu = u.GetDotProduct(u);
    const uv = u.GetDotProduct(v);
    const vv = v.GetDotProduct(v);
    const w = intersectVec.Sub(this.vertices[0]);
    const wu = w.GetDotProduct(u);
    const wv = w.GetDotProduct(v);
    const D = uv * uv - uu * vv;
    const s = (uv * wv - vv * wu) / D;
    if (s < 0.0 || s > 1.0) return null;
    const t = (uv * wu - uu * wv) / D;
    if (t < 0.0 || s + t > 1.0) return null;
    return intersectVec;
  }

  CalculateTangents(): void {
    const edge1 = this.vertices[1].Sub(this.vertices[0]);
    const edge2 = this.vertices[2].Sub(this.vertices[0]);
    const edge1uv = this.GetTextureVertex(1).Sub(this.GetTextureVertex(0));
    const edge2uv = this.GetTextureVertex(2).Sub(this.GetTextureVertex(0));
    const cp = edge1uv.coords[1] * edge2uv.coords[0] - edge1uv.coords[0] * edge2uv.coords[1];
    if (cp !== 0) {
      const mul = 1.0 / cp;
      for (let v = 0; v < 3; v++) {
        this.tangents[v] = edge1.Mul(-edge2uv.coords[1]).Add(edge2.Mul(edge1uv.coords[1])).Mul(mul).GetNormalized();
        this.biTangents[v] = edge1.Mul(-edge2uv.coords[0]).Add(edge2.Mul(edge1uv.coords[0])).Mul(mul).GetNormalized();
        const crossProduct = this.normals[v].GetCrossProduct(this.tangents[v]);
        if (crossProduct.GetDotProduct(this.biTangents[v]) > 0) this.biTangents[v] = this.biTangents[v].Neg();
      }
    } else {
      for (let v = 0; v < 3; v++) {
        this.tangents[v] = new Vector3(1, 0, 0);
        this.biTangents[v] = new Vector3(0, 1, 0);
      }
    }
  }
}
