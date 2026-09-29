// Port of legacy/src/utils/splitgeometry.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2014 (public domain / Apache-2.0).

import { AABB } from '../../blunted/base/geometry/aabb';
import { Vector3 } from '../../blunted/base/math/vector3';
import { cround } from '../../blunted/base/math/bluntmath';
import { int_to_str } from '../../blunted/base/utils';
import { ResourceManagerPool } from '../../blunted/managers/resourcemanagerpool';
import { Node } from '../../blunted/scene/node';
import { Geometry } from '../../blunted/scene/objects/geometry';
import { GetTriangleMeshElementCount, type GeometryData } from '../../blunted/scene/resources/geometrydata';
import type { Resource } from '../../blunted/scene/resources/resource';
import type { Scene3D } from '../../blunted/scene/scene3d';

interface GeomIndex {
  x: number;
  y: number;
  geomData: Resource<GeometryData>;
}

/**
 * Port of blunted base/geometry/trianglemeshutils GetTriangleMeshAABB (not part of the ported
 * foundation, only used here). Only looks at the position block of the vertex data.
 */
function GetTriangleMeshAABB(vertices: Float32Array, verticesDataSize: number, indices: readonly number[]): AABB {
  const aabb = new AABB();

  aabb.Reset();
  const mn = [aabb.minxyz.coords[0], aabb.minxyz.coords[1], aabb.minxyz.coords[2]];
  const mx = [aabb.maxxyz.coords[0], aabb.maxxyz.coords[1], aabb.maxxyz.coords[2]];

  if (indices.length === 0) {
    const triangleCount = Math.trunc(Math.trunc(Math.trunc(verticesDataSize / GetTriangleMeshElementCount()) / 3) / 3);
    for (let t = 0; t < triangleCount; t++) {
      for (let v = 0; v < 3; v++) {
        for (let i = 0; i < 3; i++) {
          const value = vertices[t * 9 + v * 3 + i];
          if (value < mn[i]) mn[i] = value;
          if (value > mx[i]) mx[i] = value;
        }
      }
    }
  } else {
    for (let t = 0; t < Math.trunc(indices.length / 3); t++) {
      for (let v = 0; v < 3; v++) {
        for (let i = 0; i < 3; i++) {
          const value = vertices[indices[t * 3 + v] + i];
          if (value < mn[i]) mn[i] = value;
          if (value > mx[i]) mx[i] = value;
        }
      }
    }
  }

  aabb.SetMinXYZ(new Vector3(mn[0], mn[1], mn[2]));
  aabb.SetMaxXYZ(new Vector3(mx[0], mx[1], mx[2]));
  aabb.MakeDirty();
  return aabb;
}

function GetGridGeom(name: string, _scene3D: Scene3D, geomVec: GeomIndex[], aabb: AABB, gridSize: number): Resource<GeometryData> {
  // calculate grid position

  const center = aabb.GetCenter();

  let index = center.coords[0] / gridSize;
  let intIndex = cround(index);
  const x = gridSize * intIndex;

  index = center.coords[1] / gridSize;
  intIndex = cround(index);
  const y = gridSize * intIndex;

  // check if geom exists

  for (let i = 0; i < geomVec.length; i++) {
    if (geomVec[i].x === x && geomVec[i].y === y) {
      return geomVec[i].geomData; // found! return geomdata
    }
  }

  // not found! create geomdata

  const newIndex: GeomIndex = {
    x,
    y,
    geomData: ResourceManagerPool.GetInstance().FetchGeometryData(name + ' gridGeomData @ ' + int_to_str(x) + ', ' + int_to_str(y), false, false),
  };
  geomVec.push(newIndex);

  return newIndex.geomData;
}

/** splits a geometry into multiple geometry objects on a grid of gridSize meters (for more efficient culling) */
export function SplitGeometry(scene3D: Scene3D, source: Geometry, gridSize = 1.0): Node {
  const resultNode = new Node(source.GetName());

  const geomVec: GeomIndex[] = [];

  // iterate trianglemeshes
  const geomData = source.GetGeometryData();

  const tmeshes = geomData.GetResource().GetTriangleMeshes();

  for (let i = 0; i < tmeshes.length; i++) {
    const indices: number[] = []; // empty == don't use indices
    const aabb = GetTriangleMeshAABB(tmeshes[i].vertices, tmeshes[i].verticesDataSize, indices);
    const subGeomData = GetGridGeom(source.GetName(), scene3D, geomVec, aabb, gridSize);

    const newTMesh = new Float32Array(tmeshes[i].verticesDataSize);
    newTMesh.set(tmeshes[i].vertices.subarray(0, tmeshes[i].verticesDataSize));
    // C++ copied the MaterializedTriangleMesh (and thus the material struct) by value
    subGeomData.GetResource().AddTriangleMesh({ ...tmeshes[i].material }, newTMesh, tmeshes[i].verticesDataSize, indices);
  }

  for (let i = 0; i < geomVec.length; i++) {
    const x = geomVec[i].x;
    const y = geomVec[i].y;
    const geom = new Geometry(source.GetName() + ' gridGeom @ ' + int_to_str(x) + ', ' + int_to_str(y));
    geom.SetGeometryData(geomVec[i].geomData);
    resultNode.AddObject(geom);
  }

  return resultNode;
}
