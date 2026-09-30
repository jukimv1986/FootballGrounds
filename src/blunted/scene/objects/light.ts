// Port of blunted/scene/objects/light.

import { Vector3 } from '../../base/math/vector3';
import { BaseObject, e_ObjectType } from '../spatial';

export enum e_LightType {
  e_LightType_Directional,
  e_LightType_Point,
}

export class Light extends BaseObject {
  protected color = new Vector3(1, 1, 1);
  protected radius = 1000000;
  protected lightType = e_LightType.e_LightType_Point;
  protected shadow = false;

  constructor(name: string) {
    super(name, e_ObjectType.e_ObjectType_Light);
  }

  override CopyObject(postfix: string): Light {
    // like C++ Object(src): the copied object keeps its name (postfix only applies to nodes/resources)
    const copy = new Light(this.name);
    this.CopySpatialTo(copy);
    copy.color = this.color;
    copy.radius = this.radius;
    copy.lightType = this.lightType;
    copy.shadow = this.shadow;
    return copy;
  }

  SetColor(color: Vector3): void {
    this.color = color;
  }

  GetColor(): Vector3 {
    return this.color;
  }

  SetRadius(radius: number): void {
    this.radius = radius;
  }

  GetRadius(): number {
    return this.radius;
  }

  SetType(lightType: e_LightType): void {
    this.lightType = lightType;
  }

  GetType(): e_LightType {
    return this.lightType;
  }

  SetShadow(shadow: boolean): void {
    this.shadow = shadow;
  }

  GetShadow(): boolean {
    return this.shadow;
  }

  UpdateValues(): void {}
}
