// Port of blunted/scene/objects/sound. The Web Audio backend (src/blunted/audio) observes these.

import { BaseObject, e_ObjectType } from '../spatial';
import type { Resource } from '../resources/resource';
import type { SoundBuffer } from '../resources/soundbuffer';

export class Sound extends BaseObject {
  protected radius = 100;
  protected loop = false;
  protected gain = 1;
  protected pitch = 1;
  protected soundBuffer: Resource<SoundBuffer> | null = null;
  /** incremented on every Poke(); the audio backend (re)starts playback when it changes */
  playRequests = 0;

  constructor(name: string) {
    super(name, e_ObjectType.e_ObjectType_Sound);
  }

  SetRadius(radius: number): void {
    this.radius = radius;
  }

  GetRadius(): number {
    return this.radius;
  }

  SetLoop(loop: boolean): void {
    this.loop = loop;
  }

  GetLoop(): boolean {
    return this.loop;
  }

  SetGain(gain: number): void {
    this.gain = gain;
  }

  GetGain(): number {
    return this.gain;
  }

  SetPitch(pitch: number): void {
    this.pitch = pitch;
  }

  GetPitch(): number {
    return this.pitch;
  }

  SetSoundBuffer(soundBuffer: Resource<SoundBuffer>): void {
    this.soundBuffer = soundBuffer;
  }

  GetSoundBuffer(): Resource<SoundBuffer> | null {
    return this.soundBuffer;
  }

  /** C++ Poke(e_SystemType_Audio): (re)starts playback */
  override Poke(_targetSystemType?: number): void {
    this.playRequests++;
  }
}
