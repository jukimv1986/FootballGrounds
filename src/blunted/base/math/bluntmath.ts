// Port of blunted/base/math/bluntmath.{hpp,cpp}.
// Original: written by bastiaan konings schuiling 2008 - 2014 (public domain / Apache-2.0).

export type real = number;
export type radian = number;

export const pi = 3.1415926535897932384626433832795028841972;

export function clamp(value: real, min: real, max: real): real {
  if (min > value) return min;
  if (max < value) return max;
  return value;
}

export function NormalizedClamp(value: real, min: real, max: real): real {
  let banana = clamp(value, min, max);
  banana = (banana - min) / (max - min);
  return banana;
}

export function invsqrt(fvalue: real): real {
  return 1 / Math.sqrt(fvalue);
}

export function sign(n: real): boolean {
  return n >= 0;
}

/** returns -1 or 1 */
export function signSide(n: real): number {
  return n >= 0 ? 1 : -1;
}

export function is_odd(n: number): boolean {
  return (n & 1) === 1;
}

export function pot(x: number): number {
  let val = 1;
  while (val < x) val *= 2;
  return val;
}

export function ModulateIntoRange(min: real, max: real, value: real): real {
  const step = max - min;
  let newValue = value;
  while (newValue < min) newValue += step;
  while (newValue > max) newValue -= step;
  return newValue;
}

/** make linear / into sined _/- */
export function curve(source: number, bias = 1.0): number {
  return (Math.sin((source - 0.5) * pi) * 0.5 + 0.5) * bias + source * (1.0 - bias);
}

// ----- random numbers
// The original used boost::mt19937 (random) and an LCG (fastrandom). Both are replaced by
// a seedable mulberry32 generator so matches and careers can be replayed deterministically.

let rngState = (Date.now() ^ 0x9e3779b9) >>> 0;

function nextRandom01(): number {
  rngState = (rngState + 0x6d2b79f5) >>> 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randomseed(seed?: number): void {
  rngState = (seed ?? (Date.now() ^ 0x9e3779b9)) >>> 0;
}

export function random(min: real, max: real): real {
  return min + nextRandom01() * (max - min);
}

export function fastrandomseed(seed?: number): void {
  randomseed(seed);
}

export function fastrandom(min: real, max: real): real {
  return min + nextRandom01() * (max - min);
}

/** C/C++ round(): halfway cases away from zero (Math.round rounds -2.5 to -2, C rounds it to -3) */
export function cround(x: number): number {
  return x < 0 ? -Math.round(-x) : Math.round(x);
}

/** C/C++ integer conversion `(int)x`: truncates toward zero */
export function toInt(x: number): number {
  return Math.trunc(x);
}
