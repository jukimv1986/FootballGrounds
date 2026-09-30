// Port of blunted/scene/objects/camera.

import { BaseObject, e_ObjectType } from '../spatial';

export class Camera extends BaseObject {
  protected fov = 45;
  protected nearCap = 1;
  protected farCap = 1000;

  constructor(name: string) {
    super(name, e_ObjectType.e_ObjectType_Camera);
  }

  Init(): void {}

  /** vertical field of view in degrees */
  SetFOV(fov: number): void {
    this.fov = fov;
  }

  GetFOV(): number {
    return this.fov;
  }

  SetCapping(nearCap: number, farCap: number): void {
    this.nearCap = nearCap;
    this.farCap = farCap;
  }

  /** C++ GetCapping(float &near, float &far) */
  GetCapping(): { nearCap: number; farCap: number } {
    return { nearCap: this.nearCap, farCap: this.farCap };
  }
}
