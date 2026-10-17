export type QualityTier = 'high' | 'medium' | 'low';

export interface QualitySettings {
  readonly multisampling: number;
  readonly ao: false | { readonly halfRes: boolean; readonly samples: number; readonly denoise: number };
  readonly bloom: false | { readonly levels: number };
  readonly aberration: boolean;
  readonly grain: boolean;
  readonly maxPixelRatio: number;
  readonly atmosphere: { readonly view: readonly [number, number]; readonly steps: number; readonly octaves: number; readonly shadow: number; readonly edges: boolean };
}

export const QUALITY: Record<QualityTier, QualitySettings> = {
  high: { multisampling: 4, ao: { halfRes: true, samples: 8, denoise: 1 }, bloom: { levels: 8 }, aberration: true, grain: true, maxPixelRatio: 2, atmosphere: { view: [192, 108], steps: 32, octaves: 6, shadow: 3, edges: true } },
  medium: { multisampling: 2, ao: { halfRes: true, samples: 4, denoise: 1 }, bloom: { levels: 5 }, aberration: true, grain: true, maxPixelRatio: 1.5, atmosphere: { view: [160, 90], steps: 24, octaves: 5, shadow: 2, edges: true } },
  low: { multisampling: 0, ao: false, bloom: false, aberration: false, grain: true, maxPixelRatio: 1.25, atmosphere: { view: [128, 72], steps: 20, octaves: 4, shadow: 1, edges: false } },
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
