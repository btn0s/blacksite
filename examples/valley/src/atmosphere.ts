import { normalize, type Atmosphere } from '@blacksite/look'
import type { Tier } from './model'

const MEADOW: Atmosphere = {
  exposure: 1.0,
  fog: { color: [0.62, 0.68, 0.74], density: 0.00016 },
  sky: { zenith: [0.28, 0.42, 0.66], horizon: [0.7, 0.74, 0.78], ground: [0.24, 0.24, 0.2], overcast: 0.05 },
  sun: { color: [1, 0.9, 0.76], direction: normalize([-0.55, 0.42, 0.62]), strength: 3.2 },
  fill: { sky: [0.5, 0.58, 0.7], ground: [0.22, 0.2, 0.14], strength: 0.9 },
  grade: { lut: null, vignette: 0.22, split: 0, aberration: 0, grain: 0 },
}

export function atmosphereFor(_tier: Tier): Atmosphere {
  return MEADOW
}
