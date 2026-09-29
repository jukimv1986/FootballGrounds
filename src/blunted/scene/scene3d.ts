// Port of blunted/scene/scene3d/scene3d: the root of the 3D scene graph.

import { Node } from './node';
import type { BaseObject, e_ObjectType } from './spatial';

export class Scene3D {
  protected hierarchyRoot = new Node('scene3D root');

  constructor(protected name = 'scene3D') {}

  Init(): void {}

  Exit(): void {
    this.hierarchyRoot.Exit();
    this.hierarchyRoot = new Node('scene3D root');
  }

  GetRoot(): Node {
    return this.hierarchyRoot;
  }

  AddNode(node: Node): void {
    this.hierarchyRoot.AddNode(node);
  }

  DeleteNode(node: Node): void {
    this.hierarchyRoot.DeleteNode(node);
  }

  AddObject(object: BaseObject): void {
    this.hierarchyRoot.AddObject(object);
  }

  DeleteObject(object: BaseObject | string): void {
    this.hierarchyRoot.DeleteObject(object);
  }

  /** C++ CreateSystemObjects(object): system objects no longer exist, kept as a no-op */
  CreateSystemObjects(_object: BaseObject): void {}

  GetObjects<T extends BaseObject>(targetObjectType: e_ObjectType, gatherObjects: T[] = []): T[] {
    return this.hierarchyRoot.GetObjects<T>(targetObjectType, gatherObjects, true);
  }

  PrintTree(): void {
    this.hierarchyRoot.PrintTree();
  }
}
