// Simplified stand-in for legacy/src/onthepitch/proceduralpitch.cpp (GeneratePitch) for the render test
// page: the pitch_0N.png files are 16x16 placeholders that the match overwrites with generated
// textures. Same layout (4 quarters, pitch_01 .. pitch_04, same world <-> texel mapping), same base
// colour / seamless grass / vignette / line overlay and mowing-stripe normal map; the perlin noise
// is left out. Replaces the surfaces through ResourceManagerPool.RegisterSurface, like a ported
// GeneratePitch would, which also exercises the renderer's surface-replacement path.

import { ResourceManagerPool } from '../blunted/managers/resourcemanagerpool';
import { FileSystem } from '../blunted/managers/filesystem';
import { Surface } from '../blunted/scene/resources/surface';

const pitchHalfW = 55;
const pitchHalfH = 36;
const pitchFullHalfW = 60;
const pitchFullHalfH = 40;

function curve(source: number, bias = 1.0): number {
  return (Math.sin((source - 0.5) * Math.PI) * 0.5 + 0.5) * bias + source * (1.0 - bias);
}

function GetSmoothGrassDirection(coord: number, repeat: number, transitionSharpness: number): number {
  const iteration = Math.floor(coord / repeat);
  let bias = coord - repeat * iteration;
  bias = Math.sin(bias * 2 * Math.PI) * 0.5 + 0.5;
  for (let i = 0; i < transitionSharpness; i++) bias = curve(bias, 1.0);
  return bias * 2.0 - 1.0;
}

function NewCanvas(w: number, h: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas.getContext('2d', { willReadFrequently: true })!;
}

export function GenerateTestPitch(resX = 1024, resY = 512, grassNormalRepeatMultiplier = 0.5): void {
  const pool = ResourceManagerPool.GetInstance();
  const seamless = FileSystem.GetImage('media/textures/pitch/seamlessgrass08.png');
  const overlay = FileSystem.GetImage('media/textures/pitch/overlay.png');

  for (let i = 1; i <= 4; i++) {
    const offsetW = i === 1 || i === 3 ? -1 : 0;
    const offsetH = i === 1 || i === 2 ? -1 : 0;

    // diffuse
    const ctx = NewCanvas(resX, resY);
    const rToB = 1.0;
    const contrast = 0.4;
    const brightness = 2.0;
    const base = [(35 - contrast * 10) * rToB * brightness, 46 * brightness, (25 - contrast * 10) * (2.0 - rToB) * brightness];
    ctx.fillStyle = `rgb(${base[0]}, ${base[1]}, ${base[2]})`;
    ctx.fillRect(0, 0, resX, resY);
    if (seamless) {
      // seamless grass tiled 18 * 0.32 times over the full pitch width, 12 * 0.32 over its height
      const tilesX = 18 * 0.32 * 0.5;
      const tilesY = 12 * 0.32 * 0.5;
      const pattern = ctx.createPattern(seamless as CanvasImageSource, 'repeat')!;
      const sx = resX / (tilesX * seamless.width);
      const sy = resY / (tilesY * seamless.height);
      const phaseX = offsetW === 0 ? tilesX : 0;
      const phaseY = offsetH === 0 ? tilesY : 0;
      pattern.setTransform(new DOMMatrix().scale(sx, sy).translate(-phaseX * seamless.width, -phaseY * seamless.height));
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, resX, resY);
      ctx.globalAlpha = 1;
    }
    // vignette: darker towards the edges (darkness = 1 - clamp(dist * 0.7)^1.5 * 0.18)
    const img = ctx.getImageData(0, 0, resX, resY);
    const d = img.data;
    for (let y = 0; y < resY; y++) {
      const yCoord = (y / resY) * pitchFullHalfH + pitchFullHalfH * offsetH;
      for (let x = 0; x < resX; x++) {
        const xCoord = (x / resX) * pitchFullHalfW + pitchFullHalfW * offsetW;
        const dx = xCoord / pitchHalfW, dy = yCoord / pitchHalfH;
        const darkness = 1.0 - Math.pow(Math.min(1, Math.sqrt(dx * dx + dy * dy) * 0.7), 1.5) * 0.18;
        const o = (y * resX + x) * 4;
        d[o] *= darkness;
        d[o + 1] *= darkness;
        d[o + 2] *= darkness;
      }
    }
    ctx.putImageData(img, 0, 0);
    if (overlay) {
      const ow = overlay.width / 2, oh = overlay.height / 2;
      ctx.drawImage(overlay as CanvasImageSource, offsetW === 0 ? ow : 0, offsetH === 0 ? oh : 0, ow, oh, 0, 0, resX, resY);
    }
    const diffuse = Surface.Create(resX, resY);
    diffuse.data = ctx.getImageData(0, 0, resX, resY).data;
    diffuse.MarkDirty();
    pool.RegisterSurface(`pitch_0${i}.png`, diffuse);

    // specular: low, slightly noisy (base 2 + noise * 18, out of 255)
    const specular = Surface.Create(resX / 2, resY / 2);
    const sd = specular.data;
    for (let p = 0; p < sd.length; p += 4) {
      const v = 2 + (0.35 + Math.random() * 0.3) * 18;
      sd[p] = sd[p + 1] = sd[p + 2] = v;
      sd[p + 3] = 255;
    }
    specular.MarkDirty();
    pool.RegisterSurface(`pitch_specular_0${i}.png`, specular);

    // normal: mowing stripes inside the lines, plus a little noise
    const normal = Surface.Create(resX, resY);
    const nd = normal.data;
    const repeat = 11.0 * grassNormalRepeatMultiplier;
    const sharpness = grassNormalRepeatMultiplier > 0.75 ? 7 : 5;
    for (let y = 0; y < resY; y++) {
      const yCoord = (y / resY) * pitchFullHalfH + pitchFullHalfH * offsetH;
      const stripeY = Math.abs(yCoord) < pitchHalfH ? GetSmoothGrassDirection(yCoord / repeat, 1.0, sharpness) * 0.1 : 0;
      for (let x = 0; x < resX; x++) {
        const xCoord = (x / resX) * pitchFullHalfW + pitchFullHalfW * offsetW;
        let nx = 0, ny = 0;
        if (Math.abs(xCoord) < pitchHalfW && Math.abs(yCoord) < pitchHalfH) {
          nx = stripeY;
          ny = GetSmoothGrassDirection(xCoord / repeat, 1.0, sharpness) * 0.12;
        }
        nx += (Math.random() * 2 - 1) * 0.06;
        ny += (Math.random() * 2 - 1) * 0.06;
        const len = Math.sqrt(nx * nx + ny * ny + 1);
        const o = (y * resX + x) * 4;
        nd[o] = ((nx / len) * 0.5 + 0.5) * 255;
        nd[o + 1] = ((ny / len) * 0.5 + 0.5) * 255;
        nd[o + 2] = ((1 / len) * 0.5 + 0.5) * 255;
        nd[o + 3] = 255;
      }
    }
    normal.MarkDirty();
    pool.RegisterSurface(`pitch_normal_0${i}.png`, normal);
  }
}
