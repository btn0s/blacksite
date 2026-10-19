import { NATURE, type Atmosphere } from '@blacksite/look'
import type { Tier } from './model'

const GOLDEN_HOUR: Atmosphere = {
  ...NATURE,
  exposure: 1,
  sun: { ...NATURE.sun, direction: [-0.55, 0.34, 0.763] },
  grade: { ...NATURE.grade, lut: null, saturation: 1, bloom: 0.15 },
  physical: NATURE.physical && { ...NATURE.physical, rayleigh: 0.85, mie: 5, sky: 1.3, clear: 250 },
}
const PHONE: Atmosphere = { ...GOLDEN_HOUR, physical: GOLDEN_HOUR.physical && { ...GOLDEN_HOUR.physical, clouds: GOLDEN_HOUR.physical.clouds && { ...GOLDEN_HOUR.physical.clouds, density: 1.3 } } }

export const sunlight = { sunLux: 63000, skyLux: 12000, ev100: 13 }
export const cameraGrade = { contrast: 1.06, toe: 0 }

export function atmosphereFor(tier: Tier): Atmosphere {
  return tier === 'low' ? PHONE : GOLDEN_HOUR
}
