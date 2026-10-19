import { NATURE, type Atmosphere } from '@blacksite/look'
import type { Tier } from './model'

const GOLDEN_HOUR: Atmosphere = {
  ...NATURE,
  exposure: 1,
  sun: { ...NATURE.sun, color: [1, 0.9, 0.76], direction: [-0.65, 0.34, -0.68] },
  grade: { ...NATURE.grade, lut: null, saturation: 0.94, bloom: 0.12, vignette: 0.12 },
  physical: NATURE.physical && {
    ...NATURE.physical,
    rayleigh: 1.1,
    mie: 9,
    aerial: 3,
    sky: 1.15,
    clear: 70,
    heightFog: { density: 0.00045, base: 110, falloff: 80, tint: [0.78, 0.87, 1] },
    clouds: NATURE.physical.clouds && { ...NATURE.physical.clouds, coverage: 0.5, density: 1.15 },
  },
}
const PHONE: Atmosphere = { ...GOLDEN_HOUR, physical: GOLDEN_HOUR.physical && { ...GOLDEN_HOUR.physical, clouds: GOLDEN_HOUR.physical.clouds && { ...GOLDEN_HOUR.physical.clouds, density: 1.3 } } }

export const sunlight = { sunLux: 63000, skyLux: 16000, ev100: 13 }
export const cameraGrade = { contrast: 1.04, toe: 0 }

export function atmosphereFor(tier: Tier): Atmosphere {
  return tier === 'low' ? PHONE : GOLDEN_HOUR
}
