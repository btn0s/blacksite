export type QualityTier = 'high' | 'medium' | 'low';

export interface QualitySettings {
  readonly multisampling: number;
  readonly ao: false | { readonly halfRes: boolean; readonly samples: number; readonly denoise: number };
  readonly bloom: false | { readonly levels: number };
  readonly aberration: boolean;
  readonly grain: boolean;
  readonly maxPixelRatio: number;
}

export const QUALITY: Record<QualityTier, QualitySettings> = {
  high: { multisampling: 4, ao: { halfRes: true, samples: 8, denoise: 1 }, bloom: { levels: 8 }, aberration: true, grain: true, maxPixelRatio: 2 },
  medium: { multisampling: 2, ao: { halfRes: true, samples: 4, denoise: 1 }, bloom: { levels: 5 }, aberration: true, grain: true, maxPixelRatio: 1.5 },
  low: { multisampling: 0, ao: false, bloom: false, aberration: false, grain: true, maxPixelRatio: 1.25 },
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
