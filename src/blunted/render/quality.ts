// Quality presets for the Three.js renderer (src/blunted/render/threerenderer.ts).
// New code (the C++ renderer had no quality levels; it always rendered a 2048^2 shadow map).

export type RenderQuality = 'low' | 'medium' | 'high';

export interface QualitySettings {
  /** upper bound for devicePixelRatio */
  maxPixelRatio: number;
  /** MSAA. Only honoured at construction: a WebGL context's antialias flag cannot change afterwards */
  antialias: boolean;
  shadows: boolean;
  shadowMapSize: number;
  /** PCF sampling radius in shadow map texels */
  shadowRadius: number;
  /** max texture anisotropy (clamped to what the GPU supports) */
  anisotropy: number;
  /** whether static geometry (stadium) casts shadows; players, ball and other small objects always do.
   *  Cheap since static casters are merged into one or two shadow draw calls. */
  staticShadows: boolean;
}

export const QUALITY_PRESETS: Readonly<Record<RenderQuality, Readonly<QualitySettings>>> = {
  low: { maxPixelRatio: 1, antialias: false, shadows: true, shadowMapSize: 1024, shadowRadius: 1, anisotropy: 2, staticShadows: true },
  medium: { maxPixelRatio: 1.5, antialias: true, shadows: true, shadowMapSize: 2048, shadowRadius: 1.5, anisotropy: 4, staticShadows: true },
  high: { maxPixelRatio: 2, antialias: true, shadows: true, shadowMapSize: 4096, shadowRadius: 2, anisotropy: 16, staticShadows: true },
};

/** rough guess of a sensible default: phones/tablets and small machines get 'low', the rest 'high' */
export function DetectQuality(): RenderQuality {
  if (typeof navigator === 'undefined') return 'medium';
  const ua = navigator.userAgent || '';
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches);
  if (mobile) return 'low';
  const cores = navigator.hardwareConcurrency || 4;
  if (cores <= 4) return 'medium';
  return 'high';
}
