// Port of blunted/loaders/aseloader: 3ds max ASCII scene export -> GeometryData.

import { Vector3 } from '../base/math/vector3';
import { Triangle } from '../base/geometry/triangle';
import { Log, e_FatalError } from '../base/log';
import { atof, atoi, tree_find, tree_load_from_string, treeentry_find, type s_tree } from '../base/utils';
import { CreateMaterial, GeometryData, GetTriangleMeshElementCount } from '../scene/resources/geometrydata';
import type { Resource } from '../scene/resources/resource';
import type { Surface } from '../scene/resources/surface';

interface s_Material {
  maps: [string, string, string, string];
  shininess: string;
  specular_amount: string;
  self_illumination: Vector3;
}

export type SurfaceFetcher = (filename: string) => Resource<Surface>;

export class ASELoader {
  protected triangleCount = 0;

  constructor(protected fetchSurface: SurfaceFetcher) {}

  Load(source: string, geometryData: GeometryData): void {
    this.triangleCount = 0;
    const data = tree_load_from_string(source);
    this.Build(data, geometryData);
  }

  protected Build(data: s_tree, geometryData: GeometryData): void {
    const materialList: s_Material[] = [];
    const material_list = tree_find(data, 'MATERIAL_LIST');
    if (material_list) {
      const material_count = atoi(material_list.entries[0].values[0]);
      for (let m = 0; m < material_count; m++) {
        const material_tree = material_list.entries[m + 1].subtree as s_tree;
        const shine = treeentry_find(material_tree, 'MATERIAL_SHINE');
        const shinestrength = treeentry_find(material_tree, 'MATERIAL_SHINESTRENGTH');
        const self_illumination = treeentry_find(material_tree, 'MATERIAL_SELFILLUM');
        const maps = [
          tree_find(material_tree, 'MAP_DIFFUSE'),
          tree_find(material_tree, 'MAP_BUMP'),
          tree_find(material_tree, 'MAP_SHINE'),
          tree_find(material_tree, 'MAP_SELFILLUM'),
        ];
        const mat: s_Material = { maps: ['', '', '', ''], shininess: '0', specular_amount: '0', self_illumination: new Vector3(0) };
        for (let i = 0; i < 4; i++) {
          const map = maps[i];
          if (map) {
            const bitmap = treeentry_find(map, 'BITMAP');
            // filenames may contain spaces, which the tokenizer split up
            const raw = bitmap ? bitmap.values.join(' ') : '""';
            mat.maps[i] = raw.substring(1, raw.length - 1);
          } else if (i === 0) {
            mat.maps[i] = 'orange.jpg';
          }
        }
        mat.shininess = shine?.values[0] ?? '0';
        mat.specular_amount = shinestrength?.values[0] ?? '0';
        mat.self_illumination = new Vector3(atof(self_illumination?.values[0]));
        materialList.push(mat);
      }
    }

    for (const entry of data.entries) {
      if (entry.name === 'GEOMOBJECT' && entry.subtree && entry.subtree.entries.length > 0) {
        this.BuildTriangleMesh(entry.subtree, geometryData, materialList);
      }
    }
  }

  protected BuildTriangleMesh(data: s_tree, geometryData: GeometryData, materialList: s_Material[]): void {
    const tree_node_tm = tree_find(data, 'NODE_TM');
    const tree_mesh = tree_find(data, 'MESH');
    if (!tree_node_tm || !tree_mesh) {
      Log(e_FatalError, 'ASELoader', 'BuildTriangleMesh', 'subtree NODE_TM or MESH not found');
      return;
    }
    const numvertex = atoi(treeentry_find(tree_mesh, 'MESH_NUMVERTEX')?.values[0]);
    const numtvertex = atoi(treeentry_find(tree_mesh, 'MESH_NUMTVERTEX')?.values[0]);
    let numtfaces = 0;
    if (numtvertex > 0) numtfaces = atoi(treeentry_find(tree_mesh, 'MESH_NUMTVFACES')?.values[0]);

    const tree_mesh_vertex_list = tree_find(tree_mesh, 'MESH_VERTEX_LIST') as s_tree;
    const tree_mesh_face_list = tree_find(tree_mesh, 'MESH_FACE_LIST') as s_tree;
    const tree_mesh_tvertex_list = numtvertex > 0 ? tree_find(tree_mesh, 'MESH_TVERTLIST') : null;
    const tree_mesh_tface_list = numtfaces > 0 ? tree_find(tree_mesh, 'MESH_TFACELIST') : null;
    const tree_mesh_normals = tree_find(tree_mesh, 'MESH_NORMALS') as s_tree;

    const vertex_cache: Vector3[] = new Array(numvertex).fill(new Vector3(0));
    for (const entry of tree_mesh_vertex_list.entries) {
      vertex_cache[atoi(entry.values[0])] = new Vector3(atof(entry.values[1]), atof(entry.values[2]), atof(entry.values[3]));
    }

    const triangles: Triangle[] = [];
    for (const entry of tree_mesh_face_list.entries) {
      // MESH_FACE 0: A: 0 B: 2 C: 1 ...
      const triangle = new Triangle();
      triangle.SetVertex(0, vertex_cache[atoi(entry.values[2])]);
      triangle.SetVertex(1, vertex_cache[atoi(entry.values[4])]);
      triangle.SetVertex(2, vertex_cache[atoi(entry.values[6])]);
      triangles.push(triangle);
    }

    // normal rotation matrix (rows of NODE_TM TM_ROW0..2, normalized)
    const rowValues = (i: number): [number, number, number] => {
      const e = tree_node_tm.entries[i];
      const v: [number, number, number] = [atof(e.values[0]), atof(e.values[1]), atof(e.values[2])];
      const f = 1.0 / Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
      return [v[0] * f, v[1] * f, v[2] * f];
    };
    const m = [...rowValues(4), ...rowValues(5), ...rowValues(6)];

    for (let i = 0; i < tree_mesh_normals.entries.length; i += 4) {
      const entry_normal = tree_mesh_normals.entries[i];
      const triangle = triangles[atoi(entry_normal.values[0])];
      for (let v = 0; v < 3; v++) {
        const e = tree_mesh_normals.entries[i + v + 1];
        const x = atof(e.values[1]), y = atof(e.values[2]), z = atof(e.values[3]);
        // normal3 *= rotation_matrix
        const normal3 = new Vector3(x * m[0] + y * m[3] + z * m[6], x * m[1] + y * m[4] + z * m[7], x * m[2] + y * m[5] + z * m[8]).GetNormalized();
        triangle.SetNormal(v, normal3);
      }
    }

    if (numtvertex > 0 && tree_mesh_tvertex_list && tree_mesh_tface_list) {
      const tvertex_cache: Vector3[] = new Array(numtvertex).fill(new Vector3(0));
      for (const entry of tree_mesh_tvertex_list.entries) {
        tvertex_cache[atoi(entry.values[0])] = new Vector3(atof(entry.values[1]), -atof(entry.values[2]), atof(entry.values[3]));
      }
      for (const entry of tree_mesh_tface_list.entries) {
        const triangle = triangles[atoi(entry.values[0])];
        for (let x = 0; x < 3; x++) {
          // texture units 0, 2 and 3 for texture, bump and specular map respectively
          let texunit = x;
          if (texunit > 0) texunit++;
          triangle.SetTextureVertex(texunit, 0, tvertex_cache[atoi(entry.values[1])]);
          triangle.SetTextureVertex(texunit, 1, tvertex_cache[atoi(entry.values[2])]);
          triangle.SetTextureVertex(texunit, 2, tvertex_cache[atoi(entry.values[3])]);
        }
      }
    }

    const tmeshsize = triangles.length * 3 * 3 * GetTriangleMeshElementCount();
    const raw = new Float32Array(tmeshsize);
    const block = triangles.length * 9;
    for (let t = 0; t < triangles.length; t++) {
      const tri = triangles[t];
      tri.CalculateTangents();
      for (let v = 0; v < 3; v++) {
        const o = t * 9 + v * 3;
        raw.set(tri.GetVertex(v).coords, o);
        raw.set(tri.GetNormal(v).coords, block + o);
        raw.set(tri.GetTextureVertex(v).coords, 2 * block + o);
        raw.set(tri.GetTangent(v).coords, 3 * block + o);
        raw.set(tri.GetBiTangent(v).coords, 4 * block + o);
      }
    }
    this.triangleCount += triangles.length;

    const material = CreateMaterial();
    const entry_material_ref = treeentry_find(data, 'MATERIAL_REF');
    const material_reference = entry_material_ref ? atoi(entry_material_ref.values[0]) : -1;
    if (material_reference !== -1 && materialList[material_reference]) {
      const mat = materialList[material_reference];
      material.diffuseTexture = this.fetchSurface(mat.maps[0]);
      if (mat.maps[1].length > 0) material.normalTexture = this.fetchSurface(mat.maps[1]);
      if (mat.maps[2].length > 0) material.specularTexture = this.fetchSurface(mat.maps[2]);
      if (mat.maps[3].length > 0) material.illuminationTexture = this.fetchSurface(mat.maps[3]);
      material.shininess = atof(mat.shininess);
      material.specular_amount = atof(mat.specular_amount);
      material.self_illumination = mat.self_illumination;
    }
    geometryData.AddTriangleMesh(material, raw, tmeshsize, []);
  }
}
