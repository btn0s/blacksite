import { NATURE, type Atmosphere } from '@blacksite/look'
import type { LookTuning } from '@blacksite/look/webgpu'
import type { Tier } from './model'

const GOLDEN_HOUR: Atmosphere = {
  ...NATURE,
  exposure: 1,
  sun: { ...NATURE.sun, color: [1, 0.8, 0.58], direction: [-0.76, 0.22, -0.61] },
  grade: { ...NATURE.grade, lut: null, saturation: 0.94, bloom: 0.12, vignette: 0.12 },
  physical: NATURE.physical && {
    ...NATURE.physical,
    rayleigh: 1.1,
    mieScattering: 9 * 3.996e-3,
    mieAbsorption: 9 * 0.404e-3,
    aerial: 5,
    sky: 1.15,
    clear: 70,
    heightFog: { extinction: 0.0008, base: 110, scaleHeight: 90, start: 70, albedo: [0.68, 0.78, 0.94], phase: 0.55, emissive: [0, 0, 0] },
    clouds: NATURE.physical.clouds && { ...NATURE.physical.clouds, coverage: 0.5, density: 1.15 },
  },
}
const PHONE: Atmosphere = { ...GOLDEN_HOUR, physical: GOLDEN_HOUR.physical && { ...GOLDEN_HOUR.physical, clouds: GOLDEN_HOUR.physical.clouds && { ...GOLDEN_HOUR.physical.clouds, density: 1.3 } } }

export const sunlight = { sunLux: 63000, skyLux: 16000, ev100: 13 }
export const cameraGrade = { contrast: 1.04, toe: 0 }

export const moods: Record<string, Partial<LookTuning>> = {
  overcast: {
    fogDensity: 0.015, fogHeight: 1500, haze: 0.11, cloudCoverage: 0.75, cloudAltitude: 1.2, cloudDensity: 2.8, sunStrength: 0.75, ambient: 1, groundBounce: 0.5,
    shafts: 1.6, exposure: -0.3, saturation: 0.7, coolness: 0.6, bloom: 0.45, grain: 0.06, vignette: 0.45, aberration: 0.12,
  },
}

export function atmosphereFor(tier: Tier): Atmosphere {
  return tier === 'low' ? PHONE : GOLDEN_HOUR
}
