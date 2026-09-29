// Replacement for blunted's AudioSystem (systems/audio + the OpenAL renderer). Instead of system
// objects receiving messages, the backend observes the scene graph every frame:
//  - every Sound object found in the scene is tracked;
//  - when `sound.playRequests` changes (Sound.Poke()), its buffer (re)starts, looping or one-shot;
//  - GetGain()/GetPitch()/IsEnabled() changes are applied live (the crowd loops change gain
//    continuously);
//  - sounds removed from the scene stop.
// SoundBuffer.bytes (wav) are decoded with AudioContext.decodeAudioData, cached per file.
//
// PORT: playback is not positional (the original placed OpenAL sources in 3D, but the match only
// uses ambient crowd loops, the ball and the whistles).

import type { Scene3D } from '../scene/scene3d';
import { e_ObjectType } from '../scene/spatial';
import type { Sound } from '../scene/objects/sound';
import type { SoundBuffer } from '../scene/resources/soundbuffer';
import type { Properties } from '../base/properties';

interface SoundState {
  lastPlayRequests: number;
  source: AudioBufferSourceNode | null;
  gain: GainNode | null;
  appliedGain: number;
  appliedPitch: number;
  pendingStart: boolean;
  pendingSince_ms: number;
  seenFrame: number;
}

export interface WebAudioOptions {
  /** use an existing context (tests / shared app context) */
  context?: AudioContext | null;
  /** configuration to read `audio_volume` from, or a getter for it (e.g. game/globals GetConfiguration) */
  config?: Properties | (() => Properties) | null;
  /** attach first-gesture / visibility listeners to this window (default: global window) */
  target?: Window | null;
}

/** one-shots whose buffer takes longer than this to decode are dropped instead of played late */
const maxOneShotDelay_ms = 300;
/** smoothing time constant for gain changes (avoids zipper noise on the crowd loops) */
const gainSmoothing_s = 0.04;

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export class WebAudioBackend {
  protected ctx: AudioContext | null = null;
  protected master: GainNode | null = null;
  protected config: Properties | (() => Properties) | null;
  protected decoded = new Map<string, AudioBuffer>();
  protected decoding = new Map<string, Promise<AudioBuffer | null>>();
  protected failed = new Set<string>();
  protected sounds = new Map<Sound, SoundState>();
  protected frame = 0;
  protected muted = false;
  protected masterVolume = -1;
  protected gestureListener: (() => void) | null = null;

  constructor(options: WebAudioOptions = {}) {
    this.config = options.config ?? null;
    if (options.context) {
      this.ctx = options.context;
    } else {
      const Ctor: typeof AudioContext | undefined =
        typeof window !== 'undefined' ? (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) : undefined;
      if (Ctor) {
        try {
          this.ctx = new Ctor({ latencyHint: 'interactive' });
        } catch {
          this.ctx = null;
        }
      }
    }
    if (this.ctx) {
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      const target = options.target === undefined ? (typeof window !== 'undefined' ? window : null) : options.target;
      if (target) this.InstallListeners(target);
    }
  }

  /** false when Web Audio is unavailable (Node, very old browsers): everything is a no-op */
  IsAvailable(): boolean {
    return this.ctx !== null;
  }

  GetContext(): AudioContext | null {
    return this.ctx;
  }

  /** the configuration `audio_volume` is read from (or a getter for it) */
  SetConfiguration(config: Properties | (() => Properties) | null): void {
    this.config = config;
  }

  protected InstallListeners(target: Window): void {
    // browsers start contexts suspended until the first user gesture
    const resume = () => {
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
      if (this.ctx.state === 'running' && this.gestureListener) {
        for (const type of ['pointerdown', 'keydown', 'touchend', 'mousedown'] as const) target.removeEventListener(type, this.gestureListener, true);
        this.gestureListener = null;
      }
    };
    this.gestureListener = resume;
    for (const type of ['pointerdown', 'keydown', 'touchend', 'mousedown'] as const) target.addEventListener(type, resume, true);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!this.ctx) return;
        if (document.hidden) void this.ctx.suspend().catch(() => undefined);
        else void this.ctx.resume().catch(() => undefined);
      });
    }
  }

  /** tries to resume the context (call from a user gesture handler, e.g. "kick off" button) */
  Resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
  }

  SetMuted(muted: boolean): void {
    this.muted = muted;
    this.masterVolume = -1;
  }

  /**
   * Master gain from config `audio_volume` (0 .. 1, default 0.5).
   * PORT: the gameplay code already multiplies every sound's gain by audio_volume (as the original
   * did), so the master is normalized to 1.0 at the default volume and only attenuates below it:
   * master = clamp(2 * audio_volume, 0, 1). Lowering/muting the volume applies instantly, also to
   * one-shots that were triggered with the old volume.
   */
  protected UpdateMasterVolume(): void {
    if (!this.ctx || !this.master) return;
    const config = typeof this.config === 'function' ? this.config() : this.config;
    const volume = config ? config.GetReal('audio_volume', 0.5) : 0.5;
    const target = this.muted ? 0 : Math.min(1, Math.max(0, volume * 2));
    if (target !== this.masterVolume) {
      this.masterVolume = target;
      this.master.gain.setTargetAtTime(target, this.ctx.currentTime, gainSmoothing_s);
    }
  }

  protected BufferKey(buffer: SoundBuffer, fallback: string): string {
    return buffer.filename || fallback;
  }

  /** decoded buffer, starting the decode if needed (null while decoding / on failure) */
  protected GetDecoded(buffer: SoundBuffer, key: string): AudioBuffer | null {
    if (buffer.decoded && typeof AudioBuffer !== 'undefined' && buffer.decoded instanceof AudioBuffer) return buffer.decoded;
    const cached = this.decoded.get(key);
    if (cached) {
      buffer.decoded = cached;
      return cached;
    }
    void this.Decode(buffer, key);
    return null;
  }

  protected Decode(buffer: SoundBuffer, key: string): Promise<AudioBuffer | null> {
    const cached = this.decoded.get(key);
    if (cached) return Promise.resolve(cached);
    const pending = this.decoding.get(key);
    if (pending) return pending;
    if (!this.ctx || !buffer.bytes || this.failed.has(key)) return Promise.resolve(null);
    // decodeAudioData detaches its input: hand it a copy, the FileSystem cache owns the original
    const bytes = buffer.bytes.slice(0);
    const promise = this.ctx
      .decodeAudioData(bytes)
      .then((audioBuffer) => {
        this.decoded.set(key, audioBuffer);
        buffer.decoded = audioBuffer;
        return audioBuffer;
      })
      .catch((err: unknown) => {
        this.failed.add(key);
        console.warn(`WebAudioBackend: could not decode ${key}`, err);
        return null;
      })
      .finally(() => this.decoding.delete(key));
    this.decoding.set(key, promise);
    return promise;
  }

  /** decodes every sound buffer in the scene up front (call after creating a match) */
  async PrepareScene(scene3D: Scene3D, timeout_ms = 5000): Promise<void> {
    if (!this.ctx) return;
    const jobs: Promise<unknown>[] = [];
    for (const sound of scene3D.GetObjects<Sound>(e_ObjectType.e_ObjectType_Sound)) {
      const res = sound.GetSoundBuffer();
      if (!res) continue;
      jobs.push(this.Decode(res.GetResource(), this.BufferKey(res.GetResource(), res.GetIdentString())));
    }
    await Promise.race([Promise.all(jobs), new Promise((resolve) => setTimeout(resolve, timeout_ms))]);
  }

  /** call once per rendered frame */
  Update(scene3D: Scene3D): void {
    if (!this.ctx || !this.master) return;
    this.frame++;
    this.UpdateMasterVolume();
    const time = nowMs();
    for (const sound of scene3D.GetObjects<Sound>(e_ObjectType.e_ObjectType_Sound)) this.UpdateSound(sound, time);
    for (const [sound, st] of this.sounds) {
      if (st.seenFrame !== this.frame) {
        // no longer in the scene graph
        this.StopSource(st);
        this.sounds.delete(sound);
      }
    }
  }

  protected UpdateSound(sound: Sound, time: number): void {
    let st = this.sounds.get(sound);
    if (!st) {
      st = { lastPlayRequests: 0, source: null, gain: null, appliedGain: -1, appliedPitch: -1, pendingStart: false, pendingSince_ms: 0, seenFrame: 0 };
      this.sounds.set(sound, st);
    }
    st.seenFrame = this.frame;

    if (sound.playRequests !== st.lastPlayRequests) {
      st.lastPlayRequests = sound.playRequests;
      st.pendingStart = true;
      st.pendingSince_ms = time;
    }

    const res = sound.GetSoundBuffer();
    if (st.pendingStart && res) {
      const buffer = res.GetResource();
      const key = this.BufferKey(buffer, res.GetIdentString());
      const audioBuffer = this.GetDecoded(buffer, key);
      if (audioBuffer) {
        st.pendingStart = false;
        if (sound.GetLoop() || time - st.pendingSince_ms <= maxOneShotDelay_ms) this.StartSource(sound, st, audioBuffer);
      } else if (this.failed.has(key) || !buffer.bytes) {
        st.pendingStart = false;
      }
    }

    if (st.source && st.gain) this.ApplyParams(sound, st, false);
  }

  protected StartSource(sound: Sound, st: SoundState, audioBuffer: AudioBuffer): void {
    const ctx = this.ctx!;
    // one source per sound, like the OpenAL renderer: a new Poke restarts it
    this.StopSource(st);
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.loop = sound.GetLoop();
    const gain = ctx.createGain();
    source.connect(gain);
    gain.connect(this.master!);
    st.source = source;
    st.gain = gain;
    this.ApplyParams(sound, st, true);
    source.onended = () => {
      if (st.source === source) {
        st.source = null;
        st.gain = null;
      }
      try {
        gain.disconnect();
      } catch {
        // already disconnected
      }
    };
    source.start();
  }

  protected ApplyParams(sound: Sound, st: SoundState, immediate: boolean): void {
    const ctx = this.ctx!;
    const targetGain = sound.IsEnabled() ? Math.min(4, Math.max(0, sound.GetGain())) : 0;
    if (targetGain !== st.appliedGain) {
      if (immediate) st.gain!.gain.setValueAtTime(targetGain, ctx.currentTime);
      else st.gain!.gain.setTargetAtTime(targetGain, ctx.currentTime, gainSmoothing_s);
      st.appliedGain = targetGain;
    }
    const targetPitch = Math.min(4, Math.max(0.05, sound.GetPitch()));
    if (targetPitch !== st.appliedPitch) {
      st.source!.playbackRate.setValueAtTime(targetPitch, ctx.currentTime);
      st.appliedPitch = targetPitch;
    }
    if (st.source!.loop !== sound.GetLoop()) st.source!.loop = sound.GetLoop();
  }

  protected StopSource(st: SoundState): void {
    const source = st.source;
    st.source = null;
    const gain = st.gain;
    st.gain = null;
    st.appliedGain = -1;
    st.appliedPitch = -1;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // not started / already stopped
      }
      try {
        source.disconnect();
      } catch {
        // already disconnected
      }
    }
    if (gain) {
      try {
        gain.disconnect();
      } catch {
        // already disconnected
      }
    }
  }

  /** stops every playing sound (end of match). Sounds only restart when poked again. */
  StopAll(): void {
    for (const st of this.sounds.values()) {
      this.StopSource(st);
      st.pendingStart = false;
    }
  }

  /** StopAll() and forget every tracked sound */
  Reset(): void {
    this.StopAll();
    this.sounds.clear();
  }

  /** drops the decoded-buffer cache (memory) */
  PurgeDecoded(): void {
    this.decoded.clear();
    this.failed.clear();
  }
}
