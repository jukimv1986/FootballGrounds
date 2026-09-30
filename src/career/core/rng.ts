// Seeded, serialisable random number generator for career mode.
//
// Every career owns one RNG whose 32-bit state lives in the save file, so a career replays
// identically from a save (and tests are deterministic for a seed). Sub-generators derived with
// `Rng.derive(seed, label)` give stable, independent streams for things that must not depend on
// the order of other rolls (e.g. an NPC's stat profile is derived from his own seed).

export class Rng {
  state: number;

  constructor(seed: number | string) {
    this.state = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    if (this.state === 0) this.state = 0x9e3779b9;
  }

  /** stable sub-stream from a seed and a label (does not advance any other generator) */
  static derive(seed: number, label: string | number): Rng {
    return new Rng(hashString(`${seed >>> 0}:${label}`));
  }

  /** mulberry32 */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** float in [min, max) */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** integer in [min, max] (inclusive) */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.next() * list.length)];
  }

  /** weighted pick; weights <= 0 are never picked (falls back to uniform when all are 0) */
  weighted<T>(list: readonly T[], weight: (item: T) => number): T {
    let total = 0;
    for (const item of list) total += Math.max(0, weight(item));
    if (total <= 0) return this.pick(list);
    let r = this.next() * total;
    for (const item of list) {
      r -= Math.max(0, weight(item));
      if (r < 0) return item;
    }
    return list[list.length - 1];
  }

  /** standard normal (Box-Muller) scaled */
  gauss(mean = 0, sd = 1): number {
    const u = Math.max(1e-12, this.next());
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Poisson sample (Knuth; fine for the small lambdas of football scores) */
  poisson(lambda: number): number {
    const l = Math.exp(-Math.max(0, lambda));
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= this.next();
    } while (p > l && k < 30);
    return k - 1;
  }

  shuffle<T>(list: T[]): T[] {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    return list;
  }

  /** a fresh 32-bit seed drawn from this stream */
  seed(): number {
    return Math.floor(this.next() * 4294967296) >>> 0;
  }
}

/** FNV-1a string hash */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** piecewise-linear interpolation through sorted [x, y] points */
export function interpolate(points: readonly (readonly [number, number])[], x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}
