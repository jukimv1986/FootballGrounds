// Port of legacy/src/utils/animationextensions/animationextension.hpp. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).

import type { Vector3, Quaternion } from '../../../blunted/base/math/vector3';
import type { radian } from '../../../blunted/base/math/bluntmath';
import type { Animation } from '../animation';

export abstract class AnimationExtension {
  constructor(protected parent: Animation | null) {}

  /** C++ destructor */
  Exit(): void {
    this.parent = null;
  }

  abstract Shift(fromFrame: number, offset: number): void;
  abstract Rotate2D(angle: radian): void;
  abstract Mirror(): void;

  /**
   * C++ GetKeyFrame(int frame, Quaternion &orientation, Vector3 &position, float &power) const.
   * PORT: in/out parameters: pass the caller's current values; the returned object holds the
   * values after the call (unchanged where the C++ did not write them).
   */
  abstract GetKeyFrame(
    frame: number,
    orientation?: Quaternion,
    position?: Vector3,
    power?: number,
  ): { result: boolean; orientation: Quaternion; position: Vector3; power: number };
  abstract SetKeyFrame(frame: number, orientation: Quaternion, position?: Vector3, power?: number): void;
  abstract DeleteKeyFrame(frame: number): void;

  abstract Load(tokenizedLine: string[]): void;
  /** PORT: C++ Save(FILE *file) wrote to a file; this returns the text that was written (may be '') */
  abstract Save(): string;
}
