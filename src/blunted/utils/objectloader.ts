// Port of blunted/utils/objectloader: loads the engine's .object XML scene descriptions.

import { Vector3, Quaternion } from '../base/math/vector3';
import { Properties } from '../base/properties';
import { GetQuaternionFromString, GetVectorFromString } from '../base/utils';
import { FileSystem } from '../managers/filesystem';
import { ResourceManagerPool } from '../managers/resourcemanagerpool';
import { Node } from '../scene/node';
import { Geometry } from '../scene/objects/geometry';
import { Light, e_LightType } from '../scene/objects/light';
import { e_LocalMode } from '../scene/spatial';
import { XMLLoader, type XMLTree } from './xmlloader';

export class ObjectLoader {
  /** C++ LoadObject(scene3D, filename, offset) */
  LoadObject(filename: string, offset: Vector3 = new Vector3(0)): Node {
    const loader = new XMLLoader();
    const objectTree = loader.Load(FileSystem.GetText(filename));
    return this.LoadObjectImpl(filename, objectTree.children[0][1], offset);
  }

  protected LoadObjectImpl(nodename: string, objectTree: XMLTree, offset: Vector3): Node {
    const objNode = new Node('objectnode: ' + nodename);
    const dirpart = nodename.substring(0, nodename.lastIndexOf('/') + 1);

    for (const [tag, child] of objectTree.children) {
      let objectName = '';
      const properties = new Properties();
      let localMode = e_LocalMode.e_LocalMode_Relative;

      if (tag === 'node') {
        objNode.AddNode(this.LoadObjectImpl(dirpart, child, offset));
      } else if (tag === 'name') {
        objNode.SetName(child.value);
      } else if (tag === 'position') {
        objNode.SetPosition(GetVectorFromString(child.value).Add(offset));
      } else if (tag === 'rotation') {
        objNode.SetRotation(GetQuaternionFromString(child.value));
      } else if (tag === 'geometry') {
        let aseFilename = '';
        let position = new Vector3(0);
        let rotation = Quaternion.IDENTITY;
        for (const [t, c] of child.children) {
          if (t === 'filename') aseFilename = c.value;
          if (t === 'name') objectName = c.value;
          if (t === 'position') position = GetVectorFromString(c.value).Add(offset);
          if (t === 'rotation') rotation = GetQuaternionFromString(c.value);
          if (t === 'properties') this.InterpretProperties(c, properties);
          if (t === 'localmode') localMode = this.InterpretLocalMode(c.value);
        }
        const geometry = ResourceManagerPool.GetInstance().FetchGeometryData(dirpart + aseFilename, true);
        const object = new Geometry(objectName);
        if (properties.GetBool('dynamic')) geometry.GetResource().SetDynamic(true);
        object.SetProperties(properties);
        object.SetLocalMode(localMode);
        object.SetPosition(position);
        object.SetRotation(rotation);
        object.SetGeometryData(geometry);
        objNode.AddObject(object);
      } else if (tag === 'light') {
        let position = new Vector3(0);
        for (const [t, c] of child.children) {
          if (t === 'name') objectName = c.value;
          if (t === 'position') position = GetVectorFromString(c.value);
          if (t === 'properties') this.InterpretProperties(c, properties);
          if (t === 'localmode') localMode = this.InterpretLocalMode(c.value);
        }
        const object = new Light(objectName);
        object.SetLocalMode(localMode);
        object.SetColor(GetVectorFromString(properties.Get('color')));
        object.SetRadius(properties.GetReal('radius'));
        object.SetType(properties.Get('type') === 'directional' ? e_LightType.e_LightType_Directional : e_LightType.e_LightType_Point);
        object.SetShadow(properties.GetBool('shadow'));
        object.SetPosition(position);
        objNode.AddObject(object);
      }
      // "joint" (ODE physics joints) is not used by the game and not ported
    }
    return objNode;
  }

  protected InterpretProperties(tree: XMLTree, properties: Properties): void {
    for (const [t, c] of tree.children) properties.Set(t, c.value);
  }

  protected InterpretLocalMode(value: string): e_LocalMode {
    return value === 'absolute' ? e_LocalMode.e_LocalMode_Absolute : e_LocalMode.e_LocalMode_Relative;
  }
}
