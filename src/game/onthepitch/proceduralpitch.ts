// Port of legacy/src/onthepitch/proceduralpitch.{hpp,cpp}. Original: written by bastiaan konings schuiling 2008 - 2015 (public domain / Apache-2.0).
//
// Generates the pitch diffuse/specular/normal textures. The C++ version wrote them into the GL
// texture resources "pitch_0N.png", "pitch_specular_0N.png" and "pitch_normal_0N.png" (N = 1..4,
// one per pitch quarter) that the stadium's pitch.ase materials reference. Here the pixels go into
// Surfaces that are registered under those same names with ResourceManagerPool.RegisterSurface(),
// so the renderer picks them up through the materials.
//
// PORT: the SDL pixel format is gone; "Uint32" colors are packed as 0xRRGGBB (see SDL_MapRGB()).

import { clamp, curve, fastrandom, NormalizedClamp, pi, random, cround, type radian } from '../../blunted/base/math/bluntmath';
import { Log, e_Notice, e_Warning } from '../../blunted/base/log';
import { int_to_str } from '../../blunted/base/utils';
import { FileSystem } from '../../blunted/managers/filesystem';
import { ResourceManagerPool } from '../../blunted/managers/resourcemanagerpool';
import { Surface } from '../../blunted/scene/resources/surface';
import { lineHalfW, pitchFullHalfH, pitchFullHalfW, pitchHalfH, pitchHalfW } from '../gamedefines';
import { GetConfiguration, Verbose } from '../globals';
import { Perlin } from '../misc/perlin';

let perlinTex: Float32Array = new Float32Array(1);
let perlinTexW = 1;
let perlinTexH = 1;

/** C++ Vector3 *seamlessTex: 3 floats (r, g, b) per texel */
let seamlessTex: Float32Array = new Float32Array(3);
let seamlessTexW = 1;
let seamlessTexH = 1;

/** C++ Vector3 *overlayTex: 3 floats (r, g, b) per texel */
let overlayTex: Float32Array = new Float32Array(3);
let overlay_alphaTex: Float32Array = new Float32Array(1);
let overlayTexW = 1;
let overlayTexH = 1;

/**
 * PORT: the C++ read GetConfiguration()->GetReal("graphics_pitchredtoblueratio") for every pixel;
 * the value can't change during generation, so GeneratePitch() reads it once.
 */
let pitchRedToBlueRatio = 0.5;

/** C++ SDL_MapRGB: float components are converted to Uint8 (truncated) */
function SDL_MapRGB(r: number, g: number, b: number): number {
  return (((Math.trunc(r) & 255) << 16) | ((Math.trunc(g) & 255) << 8) | (Math.trunc(b) & 255)) >>> 0;
}

/** C++ BilinearSample<float> */
function BilinearSample(tex: Float32Array, x: number, y: number, w: number, h: number): number {
  // actual bilinear version
  const intX1 = Math.trunc(Math.floor(x));
  const intY1 = Math.trunc(Math.floor(y));
  const intX2 = (intX1 + 1) % w;
  const intY2 = (intY1 + 1) % h;
  const x1y1 = tex[intY1 * w + intX1];
  const x2y1 = tex[intY1 * w + intX2];
  const x1y2 = tex[intY2 * w + intX1];
  const x2y2 = tex[intY2 * w + intX2];
  const xBias = x - intX1;
  const yBias = y - intY1;
  return (x1y1 * (1.0 - xBias) + x2y1 * xBias) * (1.0 - yBias) + (x1y2 * (1.0 - xBias) + x2y2 * xBias) * yBias;
}

/** C++ BilinearSample<Vector3>: tex holds 3 floats per texel, result is written to out[0..2] */
function BilinearSample3(tex: Float32Array, x: number, y: number, w: number, h: number, out: number[]): void {
  const intX1 = Math.trunc(Math.floor(x));
  const intY1 = Math.trunc(Math.floor(y));
  const intX2 = (intX1 + 1) % w;
  const intY2 = (intY1 + 1) % h;
  const i11 = (intY1 * w + intX1) * 3;
  const i21 = (intY1 * w + intX2) * 3;
  const i12 = (intY2 * w + intX1) * 3;
  const i22 = (intY2 * w + intX2) * 3;
  const xBias = x - intX1;
  const yBias = y - intY1;
  for (let c = 0; c < 3; c++) {
    out[c] =
      (tex[i11 + c] * (1.0 - xBias) + tex[i21 + c] * xBias) * (1.0 - yBias) +
      (tex[i12 + c] * (1.0 - xBias) + tex[i22 + c] * xBias) * yBias;
  }
}

const sampleScratch = [0, 0, 0];

/** returns a packed 0xRRGGBB color. PORT: pitchSurf (only used for its pixel format in C++) is unused. */
export function GetPitchDiffuseColor(_pitchSurf: Surface | null, xCoord: number, yCoord: number): number {
  const texMultiplier = 0.3;
  const texScale = 0.32;
  const randomNoiseMultiplier = 0.0;
  const perlinNoiseMultiplier = 0.4;
  const brightness = 2.0;

  const contrast = 0.4; // g <=> rb contrast. lower = less saturation, higher = greener
  const rToB = pitchRedToBlueRatio * 2.0; // 0 .. 2, higher is more red, lower is more blue
  let r = (35 - contrast * 10) * rToB * brightness;
  let g = 46 * brightness;
  let b = (25 - contrast * 10) * (2.0 - rToB) * brightness;

  let seamlessX = ((xCoord / pitchFullHalfW) * 0.5 + 0.5) * seamlessTexW * 18.0 * texScale;
  let seamlessY = ((yCoord / pitchFullHalfH) * 0.5 + 0.5) * seamlessTexH * 12.0 * texScale;
  seamlessX = seamlessX % seamlessTexW;
  seamlessY = seamlessY % seamlessTexH;
  const tex = sampleScratch;
  BilinearSample3(seamlessTex, seamlessX, seamlessY, seamlessTexW, seamlessTexH, tex);
  r = r * (1.0 - texMultiplier) + tex[0] * texMultiplier;
  g = g * (1.0 - texMultiplier) + tex[1] * texMultiplier;
  b = b * (1.0 - texMultiplier) + tex[2] * texMultiplier;

  let perlX = ((xCoord / pitchFullHalfW) * 0.5 + 0.5) * perlinTexW;
  let perlY = ((yCoord / pitchFullHalfH) * 0.5 + 0.5) * perlinTexH;
  const randomSpread = 2.5;
  const randomX = fastrandom(-1, 1);
  perlX = clamp(perlX + randomX * randomSpread, 0, perlinTexW - 1);
  const randomY = fastrandom(-1, 1);
  perlY = clamp(perlY + randomY * randomSpread, 0, perlinTexH - 1);
  const perlinNoise = BilinearSample(perlinTex, perlX, perlY, perlinTexW, perlinTexH) - 0.5;
  const perlinNoiseR = perlinNoise;
  const perlinNoiseG = perlinNoise;
  const perlinNoiseB = perlinNoise;

  let randomNoise = 0.0;
  if (randomNoiseMultiplier > 0.0) randomNoise = fastrandom(-1, 1);
  r += (perlinNoiseR * perlinNoiseMultiplier + randomNoise * randomNoiseMultiplier) * 40.0;
  g += (perlinNoiseG * perlinNoiseMultiplier + randomNoise * randomNoiseMultiplier) * 40.0;
  b += (perlinNoiseB * perlinNoiseMultiplier + randomNoise * randomNoiseMultiplier) * 40.0;

  // fake ambient occlusion
  // (lightPos - Vector3(xCoord / pitchHalfW, yCoord / pitchHalfH, 0)).GetLength() with lightPos == 0
  const aoX = xCoord / pitchHalfW;
  const aoY = yCoord / pitchHalfH;
  let aoLength = Math.sqrt(aoX * aoX + aoY * aoY);
  if (aoLength < 0.000001) aoLength = 0;
  const darkness = 1.0 - Math.pow(clamp(aoLength * 0.7, 0.0, 1.0), 1.5) * 0.18;
  r *= darkness;
  g *= darkness;
  b *= darkness;

  const overlayX = ((xCoord / pitchFullHalfW) * 0.5 + 0.5) * overlayTexW;
  const overlayY = ((yCoord / pitchFullHalfH) * 0.5 + 0.5) * overlayTexH;
  const overlay = sampleScratch;
  BilinearSample3(overlayTex, overlayX, overlayY, overlayTexW, overlayTexH, overlay);
  const overlay_alpha = BilinearSample(overlay_alphaTex, overlayX, overlayY, overlayTexW, overlayTexH);
  r = clamp(r * (1.0 - overlay_alpha) + overlay[0] * overlay_alpha, 0, 255);
  g = clamp(g * (1.0 - overlay_alpha) + overlay[1] * overlay_alpha, 0, 255);
  b = clamp(b * (1.0 - overlay_alpha) + overlay[2] * overlay_alpha, 0, 255);

  return SDL_MapRGB(r, g, b);
}

/** returns a packed 0xRRGGBB color. PORT: pitchSurf (only used for its pixel format in C++) is unused. */
export function GetPitchSpecularColor(_pitchSurf: Surface | null, xCoord: number, yCoord: number): number {
  const base = 2.0;
  const noisefac = 18.0;

  let perlX = ((xCoord / pitchFullHalfW) * 0.5 + 0.5) * perlinTexW;
  let perlY = ((yCoord / pitchFullHalfH) * 0.5 + 0.5) * perlinTexH;
  const randomSpread = 2.5;
  const randomX = fastrandom(-1, 1);
  perlX = clamp(perlX + randomX * randomSpread, 0, perlinTexW - 1);
  const randomY = fastrandom(-1, 1);
  perlY = clamp(perlY + randomY * randomSpread, 0, perlinTexH - 1);
  const noise = base + BilinearSample(perlinTex, perlX, perlY, perlinTexW, perlinTexH) * noisefac;

  return SDL_MapRGB(noise, noise, noise);
}

export function xmod(coord: number, repeat: number): number {
  return coord - repeat * Math.floor(coord / repeat);
}

export function GetSmoothGrassDirection(coord: number, repeat: number, transitionSharpness = 5): number {
  const iteration = Math.floor(coord / repeat);
  let bias = coord - repeat * iteration; // goes from 0 to 1 over two bands (since bands are split by being < 0.5 and > 0.5)
  bias = Math.sin(bias * 2 * pi) * 0.5 + 0.5;
  for (let i = 0; i < transitionSharpness; i++) {
    bias = curve(bias, 1.0);
  }

  // back to -1 .. 1 range
  bias *= 2.0;
  bias -= 1.0;
  return bias;
}

/** the mow line parameters of GetPitchNormalColor */
function GetGrassNormalParams(repeatMultiplier: number): { xRepeat: number; yRepeat: number; xStrength: number; yStrength: number; transitionSharpness: number } {
  const xRepeat = 11.0 * repeatMultiplier;
  const yRepeat = 11.0 * repeatMultiplier;
  const xStrength = 0.12;
  const yStrength = 0.1; // i *think* the mowing of the 'lateral' lines may undo the strength of these medial lines. so make this less apparent

  let transitionSharpness = 5;
  if (repeatMultiplier > 0.75) transitionSharpness = 7; // wider mow lines == more sharpening to correct for upscale
  return { xRepeat, yRepeat, xStrength, yStrength, transitionSharpness };
}

/**
 * second half of GetPitchNormalColor, taking the (x, y) grass direction offsets that only depend
 * on yCoord and xCoord respectively (so CreateChunk can compute them once per row/column)
 */
function PitchNormalColorFromGrass(xCoord: number, yCoord: number, grassOffsetX: number, grassOffsetY: number): number {
  const noisefac = 0.06;

  let nx = 0;
  let ny = 0;
  let nz = 1;

  if (Math.abs(xCoord) < pitchHalfW && Math.abs(yCoord) < pitchHalfH) {
    nx += grassOffsetX;
    ny += grassOffsetY;
  }

  nx += fastrandom(-1, 1) * noisefac;
  ny += fastrandom(-1, 1) * noisefac;

  // normal.Normalize()
  const f = 1.0 / Math.sqrt(nx * nx + ny * ny + nz * nz);
  nx *= f;
  ny *= f;
  nz *= f;

  nx = nx * 0.5 + 0.5;
  ny = ny * 0.5 + 0.5;
  nz = nz * 0.5 + 0.5;

  return SDL_MapRGB(nx * 255, ny * 255, nz * 255);
}

/** returns a packed 0xRRGGBB color. PORT: pitchSurf (only used for its pixel format in C++) is unused. */
export function GetPitchNormalColor(_pitchSurf: Surface | null, xCoord: number, yCoord: number, repeatMultiplier: number): number {
  let grassOffsetX = 0;
  let grassOffsetY = 0;
  if (Math.abs(xCoord) < pitchHalfW && Math.abs(yCoord) < pitchHalfH) {
    const params = GetGrassNormalParams(repeatMultiplier);
    grassOffsetX = GetSmoothGrassDirection(yCoord / params.yRepeat, 1.0, params.transitionSharpness) * params.yStrength;
    grassOffsetY = GetSmoothGrassDirection(xCoord / params.xRepeat, 1.0, params.transitionSharpness) * params.xStrength;
  }
  return PitchNormalColorFromGrass(xCoord, yCoord, grassOffsetX, grassOffsetY);
}

/** C++ ConvertCoord(resX, resY, x1, y1, offsetW, offsetH, float &x, float &y) */
export function ConvertCoord(resX: number, resY: number, x1: number, y1: number, offsetW: number, offsetH: number): { x: number; y: number } {
  let x = x1;
  let y = y1;
  // convert to bitmap scale
  x *= resX;
  x /= pitchFullHalfW;
  y *= resY;
  y /= pitchFullHalfH;
  // see which of the 4 parts of the pitch is to be drawed on, mirror accordingly
  if (offsetW === -1) x = resX - x - 1;
  if (offsetH === -1) y = resY - y - 1;
  return { x, y };
}

function LightenPixel(bitmap: Uint32Array, index: number): void {
  const pixel = bitmap[index];
  let r = (pixel >>> 16) & 255;
  let g = (pixel >>> 8) & 255;
  let b = pixel & 255;
  r = Math.trunc(r * 0.5 + 100);
  g = Math.trunc(g * 0.5 + 100);
  b = Math.trunc(b * 0.5 + 100);
  bitmap[index] = SDL_MapRGB(r, g, b);
}

/** PORT: SDL_PixelFormat parameter dropped; bitmap holds packed 0xRRGGBB colors */
export function BmpRect(bitmap: Uint32Array, resX: number, resY: number, x1: number, y1: number, x2: number, y2: number, offsetW: number, offsetH: number): void {
  const c1 = ConvertCoord(resX, resY, x1, y1, offsetW, offsetH);
  const c2 = ConvertCoord(resX, resY, x2, y2, offsetW, offsetH);
  let rx1 = c1.x;
  let ry1 = c1.y;
  let rx2 = c2.x;
  let ry2 = c2.y;

  if (rx2 < rx1) {
    const tmp = rx2;
    rx2 = rx1;
    rx1 = tmp;
  }
  if (ry2 < ry1) {
    const tmp = ry2;
    ry2 = ry1;
    ry1 = tmp;
  }

  for (let xi = Math.trunc(Math.ceil(rx1)); xi <= Math.trunc(Math.floor(rx2)); xi++) {
    for (let yi = Math.trunc(Math.ceil(ry1)); yi <= Math.trunc(Math.floor(ry2)); yi++) {
      LightenPixel(bitmap, yi * resX + xi);
    }
  }
}

/** PORT: SDL_PixelFormat parameter dropped; bitmap holds packed 0xRRGGBB colors */
export function BmpArc(bitmap: Uint32Array, resX: number, resY: number, x1: number, y1: number, radius: number, begin: radian, end: radian, offsetW: number, offsetH: number): void {
  const steps = Math.trunc(resX * 0.03 * radius); // hackish approximation ;)
  const step = Math.abs(end - begin) / steps;
  let currentRad = begin;
  for (let i = 0; i < steps; i++) {
    const x = x1 + Math.sin(currentRad) * radius;
    const y = y1 + Math.cos(pi + currentRad) * radius;

    const c = ConvertCoord(resX, resY, x, y, offsetW, offsetH);
    const rx = cround(c.x);
    const ry = cround(c.y);
    if (rx >= 0 && rx < resX && ry >= 0 && ry < resY) {
      LightenPixel(bitmap, ry * resX + rx);
    }
    currentRad += step;
  }
}

/** PORT: SDL_PixelFormat parameter dropped; diffuseBitmap holds packed 0xRRGGBB colors. (Not called: disabled in the original too.) */
export function DrawLines(diffuseBitmap: Uint32Array, resX: number, resY: number, offsetW: number, offsetH: number): void {
  // only draw lowerright section, other sections are mirrored through offsetW and offsetH

  BmpRect(diffuseBitmap, resX, resY, pitchHalfW - lineHalfW, 0, pitchHalfW + lineHalfW, pitchHalfH + lineHalfW, offsetW, offsetH); // backline
  BmpRect(diffuseBitmap, resX, resY, 0, pitchHalfH - lineHalfW, pitchHalfW - lineHalfW, pitchHalfH + lineHalfW, offsetW, offsetH); // sideline
  BmpRect(diffuseBitmap, resX, resY, 0, 0, lineHalfW * 0.5, pitchHalfH - lineHalfW, offsetW, offsetH); // middleline // for some reason, the middle line needs to be half-half-width to become the right width. i don't know why either.

  // 16.5m box
  BmpRect(diffuseBitmap, resX, resY, pitchHalfW - 16.5 - lineHalfW, 0, pitchHalfW - 16.5 + lineHalfW, 20.15 - lineHalfW, offsetW, offsetH); // vert
  BmpRect(diffuseBitmap, resX, resY, pitchHalfW - 16.5 - lineHalfW, 20.15 - lineHalfW, pitchHalfW - lineHalfW, 20.15 + lineHalfW, offsetW, offsetH); // horiz

  // keeper box (9.16m half width)
  BmpRect(diffuseBitmap, resX, resY, pitchHalfW - 5.5 - lineHalfW, 0, pitchHalfW - 5.5 + lineHalfW, 9.16 - lineHalfW, offsetW, offsetH); // vert
  BmpRect(diffuseBitmap, resX, resY, pitchHalfW - 5.5 - lineHalfW, 9.16 - lineHalfW, pitchHalfW - lineHalfW, 9.16 + lineHalfW, offsetW, offsetH); // horiz

  BmpArc(diffuseBitmap, resX, resY, 0, 0, 9.15, 0.5 * pi, 1 * pi, offsetW, offsetH); // middle circle
  BmpArc(diffuseBitmap, resX, resY, pitchHalfW - 11, 0, 9.15, 1.208 * pi, 1.5 * pi, offsetW, offsetH); // penalty arc

  BmpArc(diffuseBitmap, resX, resY, pitchHalfW, pitchHalfH, 0.5, 1.55 * pi, 2 * pi, offsetW, offsetH); // corner arc

  // penalty spot
  BmpArc(diffuseBitmap, resX, resY, pitchHalfW - 11, 0, 0.08, 0.5 * pi, 1.5 * pi, offsetW, offsetH);
  BmpArc(diffuseBitmap, resX, resY, pitchHalfW - 11, 0, 0.04, 0.5 * pi, 1.5 * pi, offsetW, offsetH);

  // center spot
  BmpArc(diffuseBitmap, resX, resY, 0, 0, 0.08, 0.5 * pi, 1.0 * pi, offsetW, offsetH);
  BmpArc(diffuseBitmap, resX, resY, 0, 0, 0.04, 0.5 * pi, 1.0 * pi, offsetW, offsetH);
}

/** copies a packed 0xRRGGBB bitmap into a new RGBA surface */
function BitmapToSurface(bitmap: Uint32Array, resX: number, resY: number): Surface {
  const surface = Surface.Create(resX, resY);
  const data = surface.data;
  for (let i = 0, n = resX * resY; i < n; i++) {
    const pixel = bitmap[i];
    const o = i * 4;
    data[o] = (pixel >>> 16) & 255;
    data[o + 1] = (pixel >>> 8) & 255;
    data[o + 2] = pixel & 255;
    data[o + 3] = 255;
  }
  surface.MarkDirty();
  return surface;
}

function CreateChunk(i: number, resX: number, resY: number, resSpecularX: number, resSpecularY: number, resNormalX: number, resNormalY: number, grassNormalRepeatMultiplier = 0.5): void {
  let offsetW: number;
  let offsetH: number;
  if (i === 1 || i === 3) offsetW = -1;
  else offsetW = 0;
  if (i === 1 || i === 2) offsetH = -1;
  else offsetH = 0;

  const diffuseBitmap = new Uint32Array(resX * resY);
  const specularBitmap = new Uint32Array(resSpecularX * resSpecularY);
  const normalBitmap = new Uint32Array(resNormalX * resNormalY);

  // PORT: the C++ loops ran x-outer/y-inner; they run y-outer here for memory locality. This only
  // changes which fastrandom() value lands on which pixel.

  for (let y = 0; y < resY; y++) {
    const yCoord = (y / (resY * 1.0)) * pitchFullHalfH + pitchFullHalfH * offsetH;
    for (let x = 0; x < resX; x++) {
      const xCoord = (x / (resX * 1.0)) * pitchFullHalfW + pitchFullHalfW * offsetW;
      diffuseBitmap[y * resX + x] = GetPitchDiffuseColor(null, xCoord, yCoord);
    }
  }
  // DrawLines(diffuseBitmap, resX, resY, offsetW, offsetH); (disabled in the original)
  for (let y = 0; y < resSpecularY; y++) {
    const ySpecularCoord = (y / (resSpecularY * 1.0)) * pitchFullHalfH + pitchFullHalfH * offsetH;
    for (let x = 0; x < resSpecularX; x++) {
      const xSpecularCoord = (x / (resSpecularX * 1.0)) * pitchFullHalfW + pitchFullHalfW * offsetW;
      specularBitmap[y * resSpecularX + x] = GetPitchSpecularColor(null, xSpecularCoord, ySpecularCoord);
    }
  }

  // PORT: GetPitchNormalColor's mow line offsets only depend on the row (x offset) or the column
  // (y offset), so they are computed once per row/column here (same values, much faster).
  const grassParams = GetGrassNormalParams(grassNormalRepeatMultiplier);
  const grassOffsetYPerColumn = new Float64Array(resNormalX);
  for (let x = 0; x < resNormalX; x++) {
    const xNormalCoord = (x / (resNormalX * 1.0)) * pitchFullHalfW + pitchFullHalfW * offsetW;
    grassOffsetYPerColumn[x] = GetSmoothGrassDirection(xNormalCoord / grassParams.xRepeat, 1.0, grassParams.transitionSharpness) * grassParams.xStrength;
  }
  for (let y = 0; y < resNormalY; y++) {
    const yNormalCoord = (y / (resNormalY * 1.0)) * pitchFullHalfH + pitchFullHalfH * offsetH;
    const grassOffsetX = GetSmoothGrassDirection(yNormalCoord / grassParams.yRepeat, 1.0, grassParams.transitionSharpness) * grassParams.yStrength;
    for (let x = 0; x < resNormalX; x++) {
      const xNormalCoord = (x / (resNormalX * 1.0)) * pitchFullHalfW + pitchFullHalfW * offsetW;
      normalBitmap[y * resNormalX + x] = PitchNormalColorFromGrass(xNormalCoord, yNormalCoord, grassOffsetX, grassOffsetYPerColumn[x]);
    }
  }

  // overwrite pitch textures
  // PORT: the C++ asserted the textures were already loaded (by the stadium's materials);
  // RegisterSurface() replaces them if they are, and registers them otherwise.

  const pool = ResourceManagerPool.GetInstance();
  pool.RegisterSurface('pitch_0' + int_to_str(i) + '.png', BitmapToSurface(diffuseBitmap, resX, resY));
  pool.RegisterSurface('pitch_specular_0' + int_to_str(i) + '.png', BitmapToSurface(specularBitmap, resSpecularX, resSpecularY));
  pool.RegisterSurface('pitch_normal_0' + int_to_str(i) + '.png', BitmapToSurface(normalBitmap, resNormalX, resNormalY));
}

/** C++ IMG_Load: decoded RGBA pixels of an image file, or null when it isn't available (e.g. in Node) */
function LoadImagePixels(filename: string): { w: number; h: number; data: Uint8ClampedArray } | null {
  const path = FileSystem.Resolve(filename);
  const image = path ? FileSystem.GetImage(path) : null;
  if (!image) return null;
  const surface = Surface.FromImage(image);
  const data = surface.EnsurePixels();
  return { w: surface.width, h: surface.height, data };
}

export function GeneratePitch(resX: number, resY: number, resSpecularX: number, resSpecularY: number, resNormalX: number, resNormalY: number): void {
  pitchRedToBlueRatio = GetConfiguration().GetReal('graphics_pitchredtoblueratio', 0.5);

  const seamless = LoadImagePixels('media/textures/pitch/seamlessgrass08.png');
  if (seamless) {
    seamlessTexW = seamless.w;
    seamlessTexH = seamless.h;
    seamlessTex = new Float32Array(seamlessTexW * seamlessTexH * 3);
    for (let i = 0; i < seamlessTexW * seamlessTexH; i++) {
      seamlessTex[i * 3] = seamless.data[i * 4];
      seamlessTex[i * 3 + 1] = seamless.data[i * 4 + 1];
      seamlessTex[i * 3 + 2] = seamless.data[i * 4 + 2];
    }
  } else {
    // PORT: fallback when the image isn't decoded (Node/tests); the C++ would have crashed
    Log(e_Warning, 'ProceduralPitch', 'GeneratePitch', 'seamlessgrass08.png not available, using a flat color');
    seamlessTexW = 1;
    seamlessTexH = 1;
    seamlessTex = new Float32Array([64, 96, 48]);
  }

  const overlay = LoadImagePixels('media/textures/pitch/overlay.png');
  if (overlay) {
    overlayTexW = overlay.w;
    overlayTexH = overlay.h;
    overlayTex = new Float32Array(overlayTexW * overlayTexH * 3);
    overlay_alphaTex = new Float32Array(overlayTexW * overlayTexH);
    for (let i = 0; i < overlayTexW * overlayTexH; i++) {
      overlayTex[i * 3] = overlay.data[i * 4];
      overlayTex[i * 3 + 1] = overlay.data[i * 4 + 1];
      overlayTex[i * 3 + 2] = overlay.data[i * 4 + 2];
      overlay_alphaTex[i] = overlay.data[i * 4 + 3] / 256.0;
    }
  } else {
    // PORT: fallback when the image isn't decoded (Node/tests): no overlay
    Log(e_Warning, 'ProceduralPitch', 'GeneratePitch', 'overlay.png not available, generating without overlay');
    overlayTexW = 1;
    overlayTexH = 1;
    overlayTex = new Float32Array(3);
    overlay_alphaTex = new Float32Array(1);
  }

  const scale = 0.06;

  const seed = Math.floor(Date.now() / 1000); // time(NULL)
  const perlin1 = new Perlin(4, 0.06 * scale, 0.5, seed); // low freq
  const perlin2 = new Perlin(4, 0.14 * scale, 0.5, seed + 139882); // mid freq
  perlinTexW = 1600;
  perlinTexH = 1000;
  perlinTex = new Float32Array(perlinTexW * perlinTexH);

  // make sure sines are in range -1 to 1
  // generate sine
  const noiseFactor = 0.15; // 'random grid of canals'
  const sinScale = 4.0; // smaller is larger (heh)
  const ynoise = new Float64Array(perlinTexH);
  for (let y = 0; y < perlinTexH; y++) {
    ynoise[y] =
      (Math.sin((y / perlinTexH) * 13 * sinScale) +
        Math.sin((y / perlinTexH) * 43 * sinScale) +
        Math.sin((y / perlinTexH) * 107 * sinScale) +
        Math.sin((y / perlinTexH) * 245 * sinScale)) *
      0.25;
  }
  const xnoiseArray = new Float64Array(perlinTexW);
  for (let x = 0; x < perlinTexW; x++) {
    xnoiseArray[x] =
      (Math.sin((x / perlinTexW) * 15 * sinScale) +
        Math.sin((x / perlinTexW) * 41 * sinScale) +
        Math.sin((x / perlinTexW) * 109 * sinScale) +
        Math.sin((x / perlinTexW) * 241 * sinScale)) *
      0.25;
  }

  // PORT: y-outer loop for memory locality (the noise values don't depend on the loop order)
  for (let y = 0; y < perlinTexH; y++) {
    for (let x = 0; x < perlinTexW; x++) {
      const xnoise = xnoiseArray[x];
      let noise = xnoise * 0.65 + ynoise[y] * 0.35;
      noise = curve(noise * 0.5 + 0.5, 0.4) * 2.0 - 1.0; // compress
      let value = perlin1.Get(x, y) * 0.4 + perlin2.Get(x, y) * 0.6; // the multiplier is bias between the noises
      value = value * 1.7 + 0.5; // most of perlin noise is well between -0.5 and 0.5, so expand a bit
      value += (NormalizedClamp(noise, -0.9, 0.9) * 2.0 - 1.0) * noiseFactor; // cut off on both sides, for graphics effect
      value = clamp(value, 0.2, 0.8); // clamp in range; there'll be some clipping otherwise
      value = curve(value, 0.4);
      perlinTex[y * perlinTexW + x] = value;
    }
  }

  // PORT: the 4 chunks were generated in 4 threads; here sequentially
  const grassNormalRepeatMultiplier = random(0, 1) > 0.5 ? 1.0 : 0.5;
  for (let i = 0; i < 4; i++) {
    CreateChunk(i + 1, resX, resY, resSpecularX, resSpecularY, resNormalX, resNormalY, grassNormalRepeatMultiplier);
    if (Verbose()) Log(e_Notice, 'ProceduralPitch', 'GeneratePitch', 'generated pitch chunk ' + int_to_str(i + 1));
  }

  perlinTex = new Float32Array(1);
  perlinTexW = 1;
  perlinTexH = 1;
  overlayTex = new Float32Array(3);
  overlay_alphaTex = new Float32Array(1);
  overlayTexW = 1;
  overlayTexH = 1;
  seamlessTex = new Float32Array(3);
  seamlessTexW = 1;
  seamlessTexH = 1;
}
