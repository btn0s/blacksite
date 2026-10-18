export type QualityTier = 'high' | 'medium' | 'low';

export interface QualitySettings {
  readonly multisampling: number;
  readonly ao: false | { readonly halfRes: boolean; readonly samples: number; readonly denoise: number };
  readonly bloom: false | { readonly levels: number };
  readonly aberration: boolean;
  readonly grain: boolean;
  readonly sharpen: boolean;
  readonly maxPixelRatio: number;
  readonly bake: { readonly directions: number; readonly sky: number; readonly sun: number; readonly lamp: number };
  readonly shafts: number;
  readonly atmosphere: { readonly view: readonly [number, number]; readonly steps: number; readonly octaves: number; readonly shadow: number; readonly edges: boolean };
}

export const QUALITY: Record<QualityTier, QualitySettings> = {
  high: { multisampling: 4, ao: { halfRes: true, samples: 8, denoise: 1 }, bloom: { levels: 8 }, aberration: true, grain: true, sharpen: true, maxPixelRatio: 2, bake: { directions: 48, sky: 512, sun: 2048, lamp: 256 }, shafts: 24, atmosphere: { view: [192, 108], steps: 32, octaves: 6, shadow: 3, edges: true } },
  medium: { multisampling: 2, ao: { halfRes: true, samples: 4, denoise: 1 }, bloom: { levels: 5 }, aberration: true, grain: true, sharpen: true, maxPixelRatio: 1.5, bake: { directions: 40, sky: 512, sun: 2048, lamp: 256 }, shafts: 16, atmosphere: { view: [160, 90], steps: 24, octaves: 5, shadow: 2, edges: true } },
  low: { multisampling: 0, ao: false, bloom: false, aberration: false, grain: true, sharpen: false, maxPixelRatio: 1.25, bake: { directions: 32, sky: 384, sun: 1024, lamp: 128 }, shafts: 12, atmosphere: { view: [128, 72], steps: 20, octaves: 4, shadow: 1, edges: false } },
};

export function autoQuality(): QualityTier {
  if (typeof window === 'undefined') return 'high';
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const screen = window.screen;
  const small = Math.min(screen?.width ?? window.innerWidth, screen?.height ?? window.innerHeight) < 600;
  if (coarse || small) return 'low';
  const cores = typeof navigator === 'undefined' ? 8 : navigator.hardwareConcurrency || 8;
  return cores <= 4 ? 'medium' : 'high';
}

export interface DepthSettings {
  readonly near: number;
  readonly far: number;
  readonly camera: { readonly near: number; readonly far: number };
  readonly gl: { readonly logarithmicDepthBuffer: boolean };
}

const NEAR: Record<QualityTier, number> = { high: 0.1, medium: 0.15, low: 0.2 };

export function depthDefaults(tier: QualityTier, options: { readonly far?: number; readonly near?: number; readonly logarithmic?: boolean } = {}): DepthSettings {
  const near = options.near ?? NEAR[tier];
  const far = options.far ?? 400;
  return { near, far, camera: { near, far }, gl: { logarithmicDepthBuffer: options.logarithmic ?? false } };
}
