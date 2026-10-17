import { NATURE, type Atmosphere } from '@blacksite/look'
import type { Tier } from './model'

const PHONE: Atmosphere = { ...NATURE, physical: NATURE.physical && { ...NATURE.physical, clouds: NATURE.physical.clouds && { ...NATURE.physical.clouds, density: 1.3 } } }

export function atmosphereFor(tier: Tier): Atmosphere {
  return tier === 'low' ? PHONE : NATURE
}
