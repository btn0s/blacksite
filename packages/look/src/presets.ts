import { normalize } from './atmosphere';
import type { Atmosphere } from './atmosphere';

const lut = (name: string) => new URL(`../luts/${name}.cube`, import.meta.url).href;

export const ZONE: Atmosphere = {
  exposure: 1.12,
  fog: { color: [0.34, 0.37, 0.35], near: 14, far: 150 },
  sky: {
    zenith: [0.27, 0.3, 0.32],
    horizon: [0.45, 0.48, 0.46],
    ground: [0.07, 0.075, 0.07],
    overcast: 0.85,
  },
  sun: { color: [0.9, 0.9, 0.84], direction: normalize([18, 12, 4]), strength: 1.5 },
  fill: { sky: [0.45, 0.48, 0.47], ground: [0.08, 0.085, 0.075], strength: 1.1 },
  grade: { lut: lut('zone'), vignette: 0.38, split: 0, aberration: 0.12, grain: 0.035 },
};

export const HAZE: Atmosphere = {
  exposure: 1.08,
  fog: { color: [0.55, 0.5, 0.37], density: 0.011 },
  sky: {
    zenith: [0.3, 0.36, 0.36],
    horizon: [0.6, 0.5, 0.33],
    ground: [0.06, 0.06, 0.045],
    overcast: 0.25,
  },
  sun: { color: [1, 0.72, 0.42], direction: normalize([-0.9, 0.42, 0.35]), strength: 3.4 },
  fill: { sky: [0.6, 0.52, 0.38], ground: [0.07, 0.065, 0.05], strength: 0.7 },
  grade: { lut: lut('haze'), vignette: 0.42, split: 0, aberration: 0.1, grain: 0.025 },
};

export const NATURE: Atmosphere = {
  exposure: 1.35,
  fog: { color: [0.66, 0.72, 0.8], density: 0.00012 },
  sky: {
    zenith: [0.3, 0.45, 0.7],
    horizon: [0.72, 0.76, 0.8],
    ground: [0.26, 0.25, 0.2],
    overcast: 0.1,
  },
  sun: { color: [1, 0.9, 0.74], direction: normalize([-0.55, 0.42, 0.62]), strength: 3.2 },
  fill: { sky: [0.52, 0.6, 0.72], ground: [0.24, 0.21, 0.15], strength: 0.9 },
  grade: { lut: null, vignette: 0.2, split: 0.3, aberration: 0, grain: 0.006, curve: 'filmic', saturation: 0.92, bloom: 0.45 },
  physical: {
    rayleigh: 0.75,
    mie: 5.5,
    mieAnisotropy: 0.8,
    ozone: 1,
    illuminance: 3.2,
    elevation: 400,
    aerial: 9,
    disk: 1,
    heightFog: { density: 0.0009, base: 120, falloff: 70, tint: [1, 0.98, 0.95] },
    clouds: { coverage: 0.38, altitude: 2.2, density: 2.2, scale: 1.3, wind: 1 },
  },
};

export const PRESETS = { zone: ZONE, haze: HAZE, nature: NATURE } as const;

export type PresetName = keyof typeof PRESETS;

export function atmosphereOf(value: Atmosphere | PresetName): Atmosphere {
  return typeof value === 'string' ? PRESETS[value] : value;
}
