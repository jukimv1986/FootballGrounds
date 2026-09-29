// Port of legacy/src/utils/animationextensions/footballanimationextension.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).

import { Vector3, Quaternion } from '../../../blunted/base/math/vector3';
import { cround, type radian } from '../../../blunted/base/math/bluntmath';
import { atof, atoi, int_to_str, real_to_str } from '../../../blunted/base/utils';
import { SortedIntMap, type Animation } from '../animation';
import { AnimationExtension } from './animationextension';

/** C++ struct FootballKeyFrame (copied by value in C++: use Clone()) */
export class FootballKeyFrame {
  orientation: Quaternion = Quaternion.IDENTITY;
  position: Vector3 = new Vector3(0);
  power = 0;

  Clone(): FootballKeyFrame {
    const k = new FootballKeyFrame();
    k.orientation = this.orientation;
    k.position = this.position;
    k.power = this.power;
    return k;
  }
}

export class FootballAnimationExtension extends AnimationExtension {
  /** std::map<int, FootballKeyFrame> */
  protected animation = new SortedIntMap<FootballKeyFrame>();

  constructor(parent: Animation | null) {
    super(parent);
  }

  override Exit(): void {
    this.animation.clear();
    super.Exit();
  }

  /** todo: offset does not yet work (only +1 and -1) */
  Shift(fromFrame: number, offset: number): void {
    const newAnimation = new SortedIntMap<FootballKeyFrame>();
    const frames = this.animation.frames;
    const values = this.animation.values;

    if (offset === 1) {
      for (let i = 0; i < frames.length; i++) {
        const keyFrame = values[i];
        let frameNum = frames[i];
        if (frames[i] >= fromFrame) frameNum++; // shift
        newAnimation.insert(frameNum, keyFrame);
      }
    }
    if (offset === -1) {
      for (let i = 0; i < frames.length; i++) {
        const keyFrame = values[i];
        let frameNum = frames[i];
        if (frames[i] !== fromFrame) {
          if (frames[i] > fromFrame) {
            frameNum--; // shift
          }
          newAnimation.insert(frameNum, keyFrame);
        }
      }
    }

    this.animation = newAnimation;
  }

  Rotate2D(angle: radian): void {
    const values = this.animation.values;
    for (let i = 0; i < values.length; i++) {
      values[i].position = values[i].position.GetRotated2D(angle);
    }
  }

  Mirror(): void {
    const values = this.animation.values;
    for (let i = 0; i < values.length; i++) {
      values[i].position = values[i].position.WithCoord(0, -values[i].position.coords[0]);
    }
  }

  /**
   * C++ bool GetKeyFrame(int frame, Quaternion &orientation, Vector3 &position, float &power) const.
   * PORT: in/out parameters; position and power are only written when the frame exists (orientation never).
   */
  GetKeyFrame(
    frame: number,
    orientation: Quaternion = Quaternion.IDENTITY,
    position: Vector3 = new Vector3(0),
    power = 0,
  ): { result: boolean; orientation: Quaternion; position: Vector3; power: number } {
    const keyFrame = this.animation.get(frame);

    if (keyFrame !== undefined) {
      return { result: true, orientation, position: keyFrame.position, power: keyFrame.power };
    } else {
      return { result: false, orientation, position, power };
    }
  }

  SetKeyFrame(frame: number, orientation: Quaternion, position: Vector3 = new Vector3(0, 0, 0), power = 1.0): void {
    const existing = this.animation.get(frame);
    if (existing === undefined) {
      // keyframe does not exist yet
      const keyFrame = new FootballKeyFrame();
      keyFrame.orientation = orientation;
      keyFrame.position = position;
      keyFrame.power = power;
      this.animation.insert(frame, keyFrame);
    } else {
      // already there
      existing.orientation = orientation;
      existing.position = position;
      existing.power = power;
    }
  }

  DeleteKeyFrame(frame: number): void {
    this.animation.delete(frame);
  }

  Load(tokenizedLine: string[]): void {
    this.animation.clear();
    let key = 2;
    while (key < tokenizedLine.length) {
      const frame = Math.trunc(cround(atoi(tokenizedLine[key]) * 1.0));

      const position = new Vector3(atof(tokenizedLine[key + 1]), atof(tokenizedLine[key + 2]), atof(tokenizedLine[key + 3]));

      const orientation = Quaternion.IDENTITY;
      this.SetKeyFrame(frame, orientation, position, 0);
      key += 4;
    }
  }

  /** PORT: C++ Save(FILE *file); returns the line that was written ('' when there are no keyframes) */
  Save(): string {
    if (this.animation.size === 0) return '';

    let line = 'extension,football,';

    for (const [frame, keyFrame] of this.animation) {
      line += int_to_str(frame) + ','; // frame number
      line += real_to_str(keyFrame.position.coords[0]) + ','; // X pos
      line += real_to_str(keyFrame.position.coords[1]) + ','; // Y pos
      line += real_to_str(keyFrame.position.coords[2]) + ','; // Z pos
    }

    line = line.substring(0, line.length - 1);

    return line + '\n';
  }

  /** C++ bool GetFirstTouch(Vector3 &position, int &frame); in/out parameters (unchanged when there is no touch) */
  GetFirstTouch(position: Vector3 = new Vector3(0), frame = 0): { result: boolean; position: Vector3; frame: number } {
    if (!this.animation.empty()) {
      return { result: true, position: this.animation.values[0].position, frame: this.animation.frames[0] };
    } else {
      return { result: false, position, frame };
    }
  }

  GetTouchCount(): number {
    return this.animation.size;
  }

  /** C++ bool GetTouch(unsigned int num, Vector3 &position, int &frame); in/out parameters (unchanged when not found) */
  GetTouch(num: number, position: Vector3 = new Vector3(0), frame = 0): { result: boolean; position: Vector3; frame: number } {
    if (this.animation.size > num && num >= 0) {
      return { result: true, position: this.animation.values[num].position, frame: this.animation.frames[num] };
    } else {
      return { result: false, position, frame };
    }
  }

  /** C++ bool GetTouchPos(int frame, Vector3 &position); in/out parameter (unchanged when not found) */
  GetTouchPos(frame: number, position: Vector3 = new Vector3(0)): { result: boolean; position: Vector3 } {
    const keyFrame = this.animation.get(frame);
    if (keyFrame !== undefined) {
      return { result: true, position: keyFrame.position };
    } else {
      return { result: false, position };
    }
  }

  GetAnimation(): SortedIntMap<FootballKeyFrame> {
    return this.animation;
  }
}
