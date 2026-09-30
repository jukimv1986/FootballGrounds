// Port of blunted/scene/resources/soundbuffer: holds an encoded audio file; the audio backend decodes it.

export class SoundBuffer {
  /** raw file bytes (wav) */
  bytes: ArrayBuffer | null = null;
  /** decoded buffer, filled by the audio backend */
  decoded: unknown = null;
  filename = '';
}
