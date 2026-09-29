import { describe, expect, it, beforeAll } from 'vitest';
import { installDiskFileSystem } from './helpers';
import { Vector3, Quaternion } from '../src/blunted/base/math/vector3';
import { pi } from '../src/blunted/base/math/bluntmath';
import { ResourceManagerPool } from '../src/blunted/managers/resourcemanagerpool';
import { ObjectLoader } from '../src/blunted/utils/objectloader';
import { XMLLoader } from '../src/blunted/utils/xmlloader';
import { Node } from '../src/blunted/scene/node';
import { e_ObjectType } from '../src/blunted/scene/spatial';

beforeAll(() => installDiskFileSystem());

describe('math', () => {
  it('rotates vectors like the original', () => {
    const q = Quaternion.FromAngleAxis(pi * 0.5, new Vector3(0, 0, 1));
    const v = q.MulVec(new Vector3(1, 0, 0));
    expect(v.coords[0]).toBeCloseTo(0);
    expect(v.coords[1]).toBeCloseTo(1);
    expect(new Vector3(1, 0, 0).GetRotated(q).coords[1]).toBeCloseTo(1);
    expect(new Vector3(0, 1, 0).GetAngle2D()).toBeCloseTo(pi / 2);
    expect(new Vector3(1, 0, 0).GetAngle2D(new Vector3(0, 1, 0))).toBeCloseTo(-pi / 2);
  });
  it('normalizes with fallback', () => {
    expect(new Vector3(0).GetNormalized(0).Equals(new Vector3(0))).toBe(true);
    expect(new Vector3(3, 4, 0).GetLength()).toBeCloseTo(5);
    expect(new Vector3(3, 4, 0).GetNormalizedMax(1).GetLength()).toBeCloseTo(1);
  });
  it('slerps', () => {
    const a = Quaternion.IDENTITY;
    const b = Quaternion.FromAngleAxis(pi * 0.5, new Vector3(0, 0, 1));
    const m = a.GetSlerped(0.5, b);
    expect(m.GetAngleAxis().angle).toBeCloseTo(pi * 0.25);
  });
});

describe('xml', () => {
  it('keeps multimap ordering', () => {
    const t = new XMLLoader().Load('<p2>b</p2><p10>c</p10><p1>a</p1><p1>d</p1>');
    expect(t.children.map(([k, v]) => k + v.value)).toEqual(['p1a', 'p1d', 'p10c', 'p2b']);
  });
});

describe('loaders', () => {
  it('loads the fullbody player model', () => {
    const geom = ResourceManagerPool.GetInstance().FetchGeometryData('media/objects/players/models/fullbody.ase');
    const meshes = geom.GetResource().GetTriangleMeshesRef();
    expect(meshes.length).toBeGreaterThan(0);
    const aabb = geom.GetResource().GetAABB();
    expect(aabb.maxxyz.coords[2]).toBeGreaterThan(1.5);
  });
  it('loads the player skeleton object', () => {
    const node = new ObjectLoader().LoadObject('media/objects/players/player.object');
    const all = node.GetNodes([], true).map((n) => n.GetName());
    expect(all).toContain('left_ankle');
    expect(all).toContain('neck');
    const neck = node.GetNodes([], true).find((n) => n.GetName() === 'neck') as Node;
    expect(neck.GetDerivedPosition().coords[2]).toBeGreaterThan(1.4);
    const copy = Node.Copy(node, '_copy');
    expect(copy.GetObjects(e_ObjectType.e_ObjectType_Geometry).length).toBe(node.GetObjects(e_ObjectType.e_ObjectType_Geometry).length);
  });
  it('loads the stadium in reasonable time', () => {
    const t0 = performance.now();
    const node = new ObjectLoader().LoadObject('media/objects/stadiums/test/test.object');
    const t1 = performance.now();
    const geoms = node.GetObjects(e_ObjectType.e_ObjectType_Geometry);
    expect(geoms.length).toBe(2);
    let tris = 0;
    for (const g of geoms) for (const m of (g as any).GetGeometryData().GetResource().GetTriangleMeshesRef()) tris += m.verticesDataSize / 45;
    console.log(`stadium: ${tris} triangles in ${(t1 - t0).toFixed(0)}ms`);
    expect(tris).toBeGreaterThan(1000);
  });
});
