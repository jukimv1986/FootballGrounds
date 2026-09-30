// Port of blunted/base/geometry/line.

import { Vector3 } from '../math/vector3';
import { AABB } from './aabb';

export class Line {
  protected vertices: [Vector3, Vector3];

  constructor(vec1: Vector3 = new Vector3(0), vec2: Vector3 = new Vector3(0)) {
    this.vertices = [vec1, vec2];
  }

  SetVertex(pos: number, vec: Vector3): void;
  SetVertex(pos: number, x: number, y: number, z: number): void;
  SetVertex(pos: number, x: Vector3 | number, y?: number, z?: number): void {
    this.vertices[pos] = typeof x === 'number' ? new Vector3(x, y as number, z as number) : x;
  }

  GetVertex(pos: number): Vector3 {
    return this.vertices[pos];
  }

  GetAABB(): AABB {
    const aabb = new AABB();
    aabb.SetMinXYZ(this.vertices[0]);
    aabb.SetMaxXYZ(this.vertices[0]);
    aabb.Expand(this.vertices[1]);
    return aabb;
  }

  /** returns offset from p1 towards p2 (0 == p1, 1 == p2) (2D) */
  GetClosestToPoint(point: Vector3): number {
    const v0 = this.vertices[0];
    const v1 = this.vertices[1];
    if (v0.Equals(v1)) return 0;
    const lineDistance = v1.Sub(v0).GetLength();
    if (lineDistance < 0.000001) return 0;
    const u =
      ((point.coords[0] - v0.coords[0]) * (v1.coords[0] - v0.coords[0]) +
        (point.coords[1] - v0.coords[1]) * (v1.coords[1] - v0.coords[1])) /
      (lineDistance * lineDistance);
    return u;
  }

  /** C++ GetDistanceToPoint(point, float &u): returns { distance, u } (2D) */
  GetDistanceToPoint(point: Vector3): { distance: number; u: number } {
    const u = this.GetClosestToPoint(point);
    const v0 = this.vertices[0];
    const v1 = this.vertices[1];
    const intersect = new Vector3(v0.coords[0] + u * (v1.coords[0] - v0.coords[0]), v0.coords[1] + u * (v1.coords[1] - v0.coords[1]), 0);
    return { distance: intersect.Sub(point).GetLength(), u };
  }

  /** C++ GetIntersectionPoint(line[, float &u]): 2D line intersection, returns { point, u } */
  GetIntersectionPointU(line: Line): { point: Vector3; u: number } {
    const v0 = this.vertices[0];
    const v1 = this.vertices[1];
    const l0 = line.GetVertex(0);
    const l1 = line.GetVertex(1);
    const divisor = (l1.coords[1] - l0.coords[1]) * (v1.coords[0] - v0.coords[0]) - (l1.coords[0] - l0.coords[0]) * (v1.coords[1] - v0.coords[1]);
    if (divisor === 0) return { point: v0, u: 0 };
    const u = ((l1.coords[0] - l0.coords[0]) * (v0.coords[1] - l0.coords[1]) - (l1.coords[1] - l0.coords[1]) * (v0.coords[0] - l0.coords[0])) / divisor;
    return { point: v0.Add(v1.Sub(v0).Mul(u)), u };
  }

  GetIntersectionPoint(line: Line): Vector3 {
    return this.GetIntersectionPointU(line).point;
  }

  WhatSide(point: Vector3): boolean {
    const v0 = this.vertices[0];
    const v1 = this.vertices[1];
    return (v1.coords[0] - v0.coords[0]) * (point.coords[1] - v0.coords[1]) - (v1.coords[1] - v0.coords[1]) * (point.coords[0] - v0.coords[0]) > 0;
  }

  GetLength(): number {
    return this.vertices[0].Sub(this.vertices[1]).GetLength();
  }
}
