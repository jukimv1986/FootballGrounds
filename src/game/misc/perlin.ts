// Port of legacy/src/misc/perlin.{h,cpp}. Original: Perlin_Noise_Class (c) http://www.flipcode.com/archives/Perlin_Noise_Class.shtml,
// coherent noise (copyright Ken Perlin), as shipped with GameplayFootball, written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).

export const SAMPLE_SIZE = 1024;

const B = SAMPLE_SIZE;
const BM = SAMPLE_SIZE - 1;

const N = 0x1000;

function s_curve(t: number): number {
  return t * t * (3.0 - 2.0 * t);
}

function lerp(t: number, a: number, b: number): number {
  return a + t * (b - a);
}

/**
 * PORT: the original seeded C's srand()/rand(). This is an exact emulation of glibc's default
 * rand() (TYPE_3 additive feedback generator), so a given seed yields the same noise as the
 * Linux build did.
 */
class CRand {
  protected state = new Int32Array(31);
  protected fptr = 3;
  protected rptr = 0;

  srand(seed: number): void {
    let s = seed >>> 0;
    if (s === 0) s = 1;
    this.state[0] = s | 0;
    let word = s | 0;
    for (let i = 1; i < 31; i++) {
      const hi = Math.trunc(word / 127773);
      const lo = word % 127773;
      word = 16807 * lo - 2836 * hi;
      if (word < 0) word += 2147483647;
      this.state[i] = word;
    }
    this.fptr = 3;
    this.rptr = 0;
    for (let kc = 310; kc > 0; kc--) this.rand();
  }

  rand(): number {
    const val = (this.state[this.fptr] + this.state[this.rptr]) | 0;
    this.state[this.fptr] = val;
    const result = (val >>> 1) & 0x7fffffff;
    this.fptr++;
    if (this.fptr >= 31) {
      this.fptr = 0;
      this.rptr++;
    } else {
      this.rptr++;
      if (this.rptr >= 31) this.rptr = 0;
    }
    return result;
  }
}

export class Perlin {
  private mOctaves: number;
  private mFrequency: number;
  private mAmplitude: number;
  private mSeed: number;

  private p = new Int32Array(SAMPLE_SIZE + SAMPLE_SIZE + 2);
  /** [SAMPLE_SIZE + SAMPLE_SIZE + 2][3] */
  private g3 = new Float32Array((SAMPLE_SIZE + SAMPLE_SIZE + 2) * 3);
  /** [SAMPLE_SIZE + SAMPLE_SIZE + 2][2] */
  private g2 = new Float32Array((SAMPLE_SIZE + SAMPLE_SIZE + 2) * 2);
  private g1 = new Float32Array(SAMPLE_SIZE + SAMPLE_SIZE + 2);
  private mStart: boolean;

  private rng = new CRand();
  private scratchVec: [number, number] = [0, 0];

  constructor(octaves: number, freq: number, amp: number, seed: number) {
    this.mOctaves = octaves;
    this.mFrequency = freq;
    this.mAmplitude = amp;
    this.mSeed = seed;
    this.mStart = true;
  }

  Get(x: number, y: number): number {
    const vec = this.scratchVec;
    vec[0] = x;
    vec[1] = y;
    return this.perlin_noise_2D(vec);
  }

  private noise1(arg: number): number {
    if (this.mStart) {
      this.rng.srand(this.mSeed);
      this.mStart = false;
      this.init();
    }

    // setup(0, bx0, bx1, rx0, rx1)
    const t = arg + N;
    const bx0 = Math.trunc(t) & BM;
    const bx1 = (bx0 + 1) & BM;
    const rx0 = t - Math.trunc(t);
    const rx1 = rx0 - 1.0;

    const sx = s_curve(rx0);

    const u = rx0 * this.g1[this.p[bx0]];
    const v = rx1 * this.g1[this.p[bx1]];

    return lerp(sx, u, v);
  }

  private noise2(vec: readonly number[]): number {
    if (this.mStart) {
      this.rng.srand(this.mSeed);
      this.mStart = false;
      this.init();
    }

    let t = vec[0] + N;
    const bx0 = Math.trunc(t) & BM;
    const bx1 = (bx0 + 1) & BM;
    const rx0 = t - Math.trunc(t);
    const rx1 = rx0 - 1.0;

    t = vec[1] + N;
    const by0 = Math.trunc(t) & BM;
    const by1 = (by0 + 1) & BM;
    const ry0 = t - Math.trunc(t);
    const ry1 = ry0 - 1.0;

    const p = this.p;
    const g2 = this.g2;

    const i = p[bx0];
    const j = p[bx1];

    const b00 = p[i + by0];
    const b10 = p[j + by0];
    const b01 = p[i + by1];
    const b11 = p[j + by1];

    const sx = s_curve(rx0);
    const sy = s_curve(ry0);

    // at2(rx, ry) = rx * q[0] + ry * q[1]
    let q = b00 * 2;
    let u = rx0 * g2[q] + ry0 * g2[q + 1];
    q = b10 * 2;
    let v = rx1 * g2[q] + ry0 * g2[q + 1];
    const a = lerp(sx, u, v);

    q = b01 * 2;
    u = rx0 * g2[q] + ry1 * g2[q + 1];
    q = b11 * 2;
    v = rx1 * g2[q] + ry1 * g2[q + 1];
    const b = lerp(sx, u, v);

    return lerp(sy, a, b);
  }

  private noise3(vec: readonly number[]): number {
    if (this.mStart) {
      this.rng.srand(this.mSeed);
      this.mStart = false;
      this.init();
    }

    let t = vec[0] + N;
    const bx0 = Math.trunc(t) & BM;
    const bx1 = (bx0 + 1) & BM;
    const rx0 = t - Math.trunc(t);
    const rx1 = rx0 - 1.0;

    t = vec[1] + N;
    const by0 = Math.trunc(t) & BM;
    const by1 = (by0 + 1) & BM;
    const ry0 = t - Math.trunc(t);
    const ry1 = ry0 - 1.0;

    t = vec[2] + N;
    const bz0 = Math.trunc(t) & BM;
    const bz1 = (bz0 + 1) & BM;
    const rz0 = t - Math.trunc(t);
    const rz1 = rz0 - 1.0;

    const p = this.p;
    const g3 = this.g3;

    const i = p[bx0];
    const j = p[bx1];

    const b00 = p[i + by0];
    const b10 = p[j + by0];
    const b01 = p[i + by1];
    const b11 = p[j + by1];

    t = s_curve(rx0);
    const sy = s_curve(ry0);
    const sz = s_curve(rz0);

    // at3(rx, ry, rz) = rx * q[0] + ry * q[1] + rz * q[2]
    const at3 = (qi: number, rx: number, ry: number, rz: number): number => {
      const q = qi * 3;
      return rx * g3[q] + ry * g3[q + 1] + rz * g3[q + 2];
    };

    let u = at3(b00 + bz0, rx0, ry0, rz0);
    let v = at3(b10 + bz0, rx1, ry0, rz0);
    let a = lerp(t, u, v);

    u = at3(b01 + bz0, rx0, ry1, rz0);
    v = at3(b11 + bz0, rx1, ry1, rz0);
    let b = lerp(t, u, v);

    const c = lerp(sy, a, b);

    u = at3(b00 + bz1, rx0, ry0, rz1);
    v = at3(b10 + bz1, rx1, ry0, rz1);
    a = lerp(t, u, v);

    u = at3(b01 + bz1, rx0, ry1, rz1);
    v = at3(b11 + bz1, rx1, ry1, rz1);
    b = lerp(t, u, v);

    const d = lerp(sy, a, b);

    return lerp(sz, c, d);
  }

  /** normalizes the 2-vector stored at v[offset .. offset + 1] */
  private normalize2(v: Float32Array, offset: number): void {
    let s = Math.sqrt(v[offset] * v[offset] + v[offset + 1] * v[offset + 1]);
    s = 1.0 / s;
    v[offset] = v[offset] * s;
    v[offset + 1] = v[offset + 1] * s;
  }

  /** normalizes the 3-vector stored at v[offset .. offset + 2] */
  private normalize3(v: Float32Array, offset: number): void {
    let s = Math.sqrt(v[offset] * v[offset] + v[offset + 1] * v[offset + 1] + v[offset + 2] * v[offset + 2]);
    s = 1.0 / s;
    v[offset] = v[offset] * s;
    v[offset + 1] = v[offset + 1] * s;
    v[offset + 2] = v[offset + 2] * s;
  }

  private init(): void {
    const p = this.p;
    const g1 = this.g1;
    const g2 = this.g2;
    const g3 = this.g3;
    const rng = this.rng;
    let i: number;
    let j: number;
    let k: number;

    for (i = 0; i < B; i++) {
      p[i] = i;
      g1[i] = ((rng.rand() % (B + B)) - B) / B;
      for (j = 0; j < 2; j++) g2[i * 2 + j] = ((rng.rand() % (B + B)) - B) / B;
      this.normalize2(g2, i * 2);
      for (j = 0; j < 3; j++) g3[i * 3 + j] = ((rng.rand() % (B + B)) - B) / B;
      this.normalize3(g3, i * 3);
    }

    while (--i) {
      k = p[i];
      j = rng.rand() % B;
      p[i] = p[j];
      p[j] = k;
    }

    for (i = 0; i < B + 2; i++) {
      p[B + i] = p[i];
      g1[B + i] = g1[i];
      for (j = 0; j < 2; j++) g2[(B + i) * 2 + j] = g2[i * 2 + j];
      for (j = 0; j < 3; j++) g3[(B + i) * 3 + j] = g3[i * 3 + j];
    }
  }

  private perlin_noise_2D(vec: [number, number]): number {
    const terms = this.mOctaves;
    let result = 0.0;
    let amp = this.mAmplitude;

    vec[0] *= this.mFrequency;
    vec[1] *= this.mFrequency;

    for (let i = 0; i < terms; i++) {
      result += this.noise2(vec) * amp;
      vec[0] *= 2.0;
      vec[1] *= 2.0;
      amp *= 0.5;
    }

    return result;
  }
}
