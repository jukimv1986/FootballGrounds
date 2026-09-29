// Port of blunted/scene/scene3d/node: a scene graph node holding child nodes and objects.

import { AABB } from '../base/geometry/aabb';
import { Log, e_Warning } from '../base/log';
import { BaseObject, Spatial, e_ObjectType } from './spatial';

export class Node extends Spatial {
  protected nodes: Node[] = [];
  protected objects: BaseObject[] = [];

  constructor(name: string) {
    super(name);
  }

  /** C++ copy constructor Node(const Node &source, postfix, scene3D): deep copies child nodes and objects */
  static Copy(source: Node, postfix: string): Node {
    const node = new Node(source.GetName() + postfix);
    node.position = source.position;
    node.rotation = source.rotation;
    node.scale = source.scale;
    node.localMode = source.localMode;
    for (const child of source.nodes) node.AddNode(Node.Copy(child, postfix));
    for (const object of source.objects) node.AddObject(object.CopyObject(postfix));
    return node;
  }

  Exit(): void {
    for (const node of this.nodes) node.Exit();
    this.nodes = [];
    for (const object of this.objects) object.Exit();
    this.objects = [];
    this.parent = null;
  }

  AddNode(node: Node): void {
    this.nodes.push(node);
    node.SetParent(this);
  }

  DeleteNode(node: Node): void {
    const i = this.nodes.indexOf(node);
    if (i >= 0) {
      this.nodes.splice(i, 1);
      node.Exit();
    }
  }

  /** removes a node from this node without exiting it */
  RemoveNode(node: Node): void {
    const i = this.nodes.indexOf(node);
    if (i >= 0) {
      this.nodes.splice(i, 1);
      node.SetParent(null);
    }
  }

  /** C++ GetNodes(std::vector &gatherNodes, bool recurse): pushes into gatherNodes and returns it */
  GetNodes(gatherNodes: Node[] = [], recurse = false): Node[] {
    for (const node of this.nodes) {
      gatherNodes.push(node);
      if (recurse) node.GetNodes(gatherNodes, recurse);
    }
    return gatherNodes;
  }

  /** direct child node by name */
  GetNode(name: string): Node | null {
    for (const node of this.nodes) if (node.GetName() === name) return node;
    return null;
  }

  AddObject(object: BaseObject): void {
    this.objects.push(object);
    object.SetParent(this);
  }

  GetObject(name: string): BaseObject | null {
    for (const object of this.objects) if (object.GetName() === name) return object;
    return null;
  }

  DeleteObject(objectOrName: BaseObject | string, exitObject = true): void {
    const i = typeof objectOrName === 'string' ? this.objects.findIndex((o) => o.GetName() === objectOrName) : this.objects.indexOf(objectOrName);
    if (i < 0) {
      Log(e_Warning, 'Node', 'DeleteObject', `object not found in node ${this.name}`);
      return;
    }
    const [object] = this.objects.splice(i, 1);
    if (exitObject) object.Exit();
    else object.SetParent(null);
  }

  DeleteAllObjects(exitObjects = true): void {
    for (const object of this.objects) {
      if (exitObjects) object.Exit();
      else object.SetParent(null);
    }
    this.objects = [];
  }

  RemoveObject(objectOrName: BaseObject | string): void {
    this.DeleteObject(objectOrName, false);
  }

  RemoveAllObjects(): void {
    this.DeleteAllObjects(false);
  }

  /** all objects (optionally recursive) */
  GetAllObjects(gatherObjects: BaseObject[] = [], recurse = true): BaseObject[] {
    for (const object of this.objects) gatherObjects.push(object);
    if (recurse) for (const node of this.nodes) node.GetAllObjects(gatherObjects, recurse);
    return gatherObjects;
  }

  /** C++ template GetObjects<T>(targetObjectType, gatherObjects, recurse) */
  GetObjects<T extends BaseObject>(targetObjectType: e_ObjectType, gatherObjects: T[] = [], recurse = true): T[] {
    for (const object of this.objects) if (object.GetObjectType() === targetObjectType) gatherObjects.push(object as T);
    if (recurse) for (const node of this.nodes) node.GetObjects<T>(targetObjectType, gatherObjects, recurse);
    return gatherObjects;
  }

  /** direct children (not recursive), for the renderer */
  GetChildNodes(): readonly Node[] {
    return this.nodes;
  }

  GetChildObjects(): readonly BaseObject[] {
    return this.objects;
  }

  PokeObjects(_targetObjectType?: e_ObjectType, _targetSystemType?: number): void {}

  PrintTree(recursionDepth = 0): void {
    console.log(`${'  '.repeat(recursionDepth)}${this.name} [${this.objects.map((o) => o.GetName()).join(', ')}]`);
    for (const node of this.nodes) node.PrintTree(recursionDepth + 1);
  }

  override GetAABB(): AABB {
    const tmp = new AABB();
    tmp.Reset();
    for (const node of this.nodes) tmp.AddAABB(node.GetAABB());
    for (const object of this.objects) tmp.AddAABB(object.GetAABB());
    return tmp;
  }

  protected override InvalidateChildren(): void {
    for (const node of this.nodes) node.InvalidateSpatialData();
    for (const object of this.objects) object.InvalidateSpatialData();
  }
}
