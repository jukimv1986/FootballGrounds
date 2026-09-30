// Kit textures for generated clubs and national teams (browser only).
//
// The engine maps player kits with the UV layout of databases/default/template_kit.png: shirt
// front (0..512 x 0..420, sleeves in the top corners), shirt back (512..1024), shorts front/back
// (y 420..578) and socks (y 586..768). We paint that layout on a 1024x1024 canvas from the club's
// colors and kit pattern (stripes, hoops, halves, sash, contrast sleeves, pinstripes, chevron),
// add a collar, the shirt sponsor and a soft shading pass, then register it:
//   - FileSystem.PutImage(`databases/default/${kit_url}_kit_0N.png`): the engine's Team checks
//     FileSystem.Exists() and the runner preloads through FileSystem, which then skips it;
//   - ResourceManagerPool.RegisterSurface(same file name): FetchSurface() is keyed by file name.
// Logos (scoreboard) are painted the same way as 128x128 crests.

import { FileSystem } from '../../blunted/managers/filesystem';
import { ResourceManagerPool } from '../../blunted/managers/resourcemanagerpool';
import { Surface } from '../../blunted/scene/resources/surface';
import { registerGeneratedUrl } from '../../ui/dom';
import type { Registration } from './bridge';
import type { KitPattern, RGB } from '../core/types';

function css(c: RGB, a = 1): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
}

function luminance(c: RGB): number {
  return (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
}

function contrast(c: RGB): RGB {
  return luminance(c) > 0.55 ? [20, 20, 30] : [245, 245, 245];
}

function distance(a: RGB, b: RGB): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

export interface KitDesign {
  shirt: RGB;
  trim: RGB;
  shorts: RGB;
  socks: RGB;
  pattern: KitPattern;
  sponsor: string;
}

/** home (1) and away (2) designs from club colors */
export function kitDesign(colors: [RGB, RGB], pattern: KitPattern, sponsor: string, kitNum: number): KitDesign {
  const [c1, c2] = colors;
  if (kitNum === 1) return { shirt: c1, trim: c2, shorts: luminance(c1) > 0.8 ? c2 : distance(c2, c1) > 200 ? c2 : [245, 245, 245], socks: c1, pattern, sponsor };
  // away: the secondary color (or white/black if it is too close to the home shirt)
  const base: RGB = distance(c2, c1) > 180 ? c2 : luminance(c1) > 0.5 ? [25, 25, 35] : [245, 245, 245];
  return { shirt: base, trim: c1, shorts: base, socks: base, pattern: pattern === 'stripes' || pattern === 'hoops' ? 'plain' : pattern, sponsor };
}

const SHIRT_FRONT: [number, number][] = [
  [0, 0],
  [512, 0],
  [512, 150],
  [415, 166],
  [404, 180],
  [404, 424],
  [108, 424],
  [108, 180],
  [97, 166],
  [0, 150],
];

function path(ctx: CanvasRenderingContext2D, pts: [number, number][], dx = 0): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x + dx, y) : ctx.lineTo(x + dx, y)));
  ctx.closePath();
}

export function paintKit(ctx: CanvasRenderingContext2D, d: KitDesign): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 1024, 1024);
  for (const dx of [0, 512]) {
    ctx.save();
    path(ctx, SHIRT_FRONT, dx);
    ctx.fillStyle = css(d.shirt);
    ctx.fill();
    ctx.clip();
    const tx = 108 + dx;
    const tw = 296;
    ctx.fillStyle = css(d.trim);
    switch (d.pattern) {
      case 'stripes':
        for (let x = tx + 18; x < tx + tw; x += 74) ctx.fillRect(x, 0, 37, 430);
        for (let x = dx + 4; x < dx + 100; x += 74) ctx.fillRect(x, 0, 30, 170);
        break;
      case 'pinstripes':
        for (let x = tx + 10; x < tx + tw; x += 30) ctx.fillRect(x, 0, 6, 430);
        break;
      case 'hoops':
        for (let y = 40; y < 430; y += 84) ctx.fillRect(dx, y, 512, 42);
        break;
      case 'halves':
        if (dx === 0) ctx.fillRect(0, 0, 256, 430);
        else ctx.fillRect(768, 0, 256, 430);
        break;
      case 'sash': {
        ctx.beginPath();
        const sx = dx === 0 ? 0 : 1024;
        const dir = dx === 0 ? 1 : -1;
        ctx.moveTo(sx + dir * 60, 0);
        ctx.lineTo(sx + dir * 170, 0);
        ctx.lineTo(sx + dir * 470, 430);
        ctx.lineTo(sx + dir * 360, 430);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 'sleeves':
        ctx.fillRect(dx, 0, 112, 180);
        ctx.fillRect(dx + 400, 0, 112, 180);
        break;
      case 'chevron':
        ctx.beginPath();
        ctx.moveTo(tx, 120);
        ctx.lineTo(tx + tw / 2, 230);
        ctx.lineTo(tx + tw, 120);
        ctx.lineTo(tx + tw, 170);
        ctx.lineTo(tx + tw / 2, 280);
        ctx.lineTo(tx, 170);
        ctx.closePath();
        ctx.fill();
        break;
      case 'plain':
        // thin trim on the sleeve cuffs
        ctx.fillRect(dx, 136, 100, 14);
        ctx.fillRect(dx + 412, 136, 100, 14);
        break;
    }
    // soft shading: darker towards the hem and the flanks
    const g = ctx.createLinearGradient(0, 0, 0, 430);
    g.addColorStop(0, 'rgba(255,255,255,0.06)');
    g.addColorStop(0.7, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = g;
    ctx.fillRect(dx, 0, 512, 430);
    ctx.restore();
    // collar
    ctx.fillStyle = css(d.trim);
    ctx.beginPath();
    if (dx === 0) {
      ctx.moveTo(210, 0);
      ctx.lineTo(302, 0);
      ctx.lineTo(256, 52);
    } else {
      ctx.ellipse(768, 0, 50, 20, 0, 0, Math.PI);
    }
    ctx.closePath();
    ctx.fill();
  }
  // sponsor on the chest
  if (d.sponsor) {
    ctx.fillStyle = css(contrast(d.shirt), 0.92);
    ctx.font = 'bold 40px "Alegreya Sans", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(d.sponsor.toUpperCase(), 256, 170, 250);
  }
  // shorts (front + back) with a side stripe
  ctx.fillStyle = css(d.shorts);
  ctx.fillRect(100, 420, 312, 162);
  ctx.fillRect(612, 420, 312, 162);
  ctx.fillStyle = css(distance(d.shorts, d.trim) > 120 ? d.trim : contrast(d.shorts));
  ctx.fillRect(108, 424, 12, 154);
  ctx.fillRect(392, 424, 12, 154);
  ctx.fillRect(620, 424, 12, 154);
  ctx.fillRect(904, 424, 12, 154);
  // socks with a band
  ctx.fillStyle = css(d.socks);
  ctx.fillRect(0, 582, 560, 192);
  ctx.fillStyle = css(distance(d.socks, d.trim) > 120 ? d.trim : contrast(d.socks));
  ctx.fillRect(0, 600, 560, 26);
  ctx.fillRect(0, 640, 560, 10);
}

export function paintCrest(ctx: CanvasRenderingContext2D, colors: [RGB, RGB], label: string, size = 128): void {
  const [c1, c2] = colors;
  const s = size / 128;
  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.scale(s, s);
  ctx.beginPath();
  ctx.moveTo(64, 6);
  ctx.lineTo(116, 20);
  ctx.lineTo(112, 72);
  ctx.quadraticCurveTo(100, 108, 64, 124);
  ctx.quadraticCurveTo(28, 108, 16, 72);
  ctx.lineTo(12, 20);
  ctx.closePath();
  ctx.fillStyle = css(c1);
  ctx.fill();
  ctx.lineWidth = 7;
  ctx.strokeStyle = css(distance(c1, c2) > 120 ? c2 : contrast(c1));
  ctx.stroke();
  ctx.clip();
  ctx.fillStyle = css(c2, 0.9);
  ctx.fillRect(56, 0, 16, 128);
  ctx.fillStyle = css(contrast(c1));
  ctx.font = 'bold 34px "Alegreya Sans SC", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5;
  ctx.strokeStyle = css(c1);
  ctx.strokeText(label.substring(0, 3), 64, 62);
  ctx.fillText(label.substring(0, 3), 64, 62);
  ctx.restore();
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

async function registerImage(file: string, cv: HTMLCanvasElement): Promise<void> {
  const full = `databases/default/${file}`;
  ResourceManagerPool.GetInstance().RegisterSurface(full, Surface.FromImage(cv));
  if (typeof createImageBitmap !== 'undefined') {
    const bmp = await createImageBitmap(cv);
    FileSystem.PutImage(full, bmp);
  }
}

export function canPaint(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}

/** paints and registers kits (and logos) for every generated side of a registration */
export async function prepareKits(reg: Registration, patterns: [KitPattern, KitPattern], sponsors: [string, string], shorts: [string, string], crestUrls?: [string, string]): Promise<void> {
  if (!canPaint()) return;
  // the scoreboard shows logos through dataUrl(): serve the same crests the career screens show
  for (const side of [0, 1] as const) {
    if (crestUrls?.[side] && reg.logoUrls[side].startsWith('fgcareer/')) registerGeneratedUrl(`databases/default/${reg.logoUrls[side]}`, crestUrls[side]);
  }
  for (const side of [0, 1] as const) {
    if (!reg.generatedKits[side]) continue;
    for (const n of [1, 2]) {
      const cv = canvas(1024, 1024);
      const ctx = cv.getContext('2d');
      if (!ctx) continue;
      paintKit(ctx, kitDesign(reg.colors[side], patterns[side], sponsors[side], n));
      await registerImage(`${reg.kitUrls[side]}_kit_0${n}.png`, cv);
    }
    if (reg.logoUrls[side].startsWith('fgcareer/')) {
      const cv = canvas(128, 128);
      const ctx = cv.getContext('2d');
      if (ctx) {
        paintCrest(ctx, reg.colors[side], shorts[side]);
        await registerImage(reg.logoUrls[side], cv);
      }
    }
  }
}

/** a kit texture as a data URL (creator/club screens preview) */
export function kitPreviewDataUrl(colors: [RGB, RGB], pattern: KitPattern, sponsor: string, kitNum = 1): string {
  if (!canPaint()) return '';
  const cv = canvas(1024, 1024);
  const ctx = cv.getContext('2d');
  if (!ctx) return '';
  paintKit(ctx, kitDesign(colors, pattern, sponsor, kitNum));
  return cv.toDataURL('image/png');
}
