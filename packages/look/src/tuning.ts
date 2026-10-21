import type { Atmosphere, CloudSpec } from './atmosphere'

export interface LookTuning {
  fogDensity: number
  fogHeight: number
  haze: number
  cloudCoverage: number
  cloudAltitude: number
  cloudDensity: number
  sunStrength: number
  ambient: number
  groundBounce: number
  shafts: number
  exposure: number
  saturation: number
  coolness: number
  bloom: number
  grain: number
  vignette: number
  aberration: number
}

export interface LookFeatures {
  shafts: boolean
  bloom: boolean
  clouds: boolean
  lens: boolean
}

export interface LookControl {
  readonly key: keyof LookTuning
  readonly label: string
  readonly min: number
  readonly max: number
  readonly step: number
  readonly hint: string
}

export const LOOK_CONTROLS: readonly LookControl[] = [
  { key: 'fogDensity', label: 'Fog density', min: 0, max: 6, step: 0.05, hint: 'Multiple of the authored fog. Higher builds haze sooner with distance.' },
  { key: 'fogHeight', label: 'Fog height falloff (m)', min: 5, max: 800, step: 5, hint: 'Scale height of the fog. Lower hugs low ground; higher fills the whole level.' },
  { key: 'haze', label: 'Distance haze', min: 0, max: 1.5, step: 0.01, hint: 'Multiple of the authored air haze. Lower keeps far mountains and the valley readable.' },
  { key: 'cloudCoverage', label: 'Cloud coverage', min: 0, max: 1, step: 0.01, hint: 'Fraction of the sky under cloud. Re-lights the level from the new sky after a moment.' },
  { key: 'cloudAltitude', label: 'Cloud altitude (km)', min: 0.4, max: 6, step: 0.05, hint: 'Lower reads as heavier and closer.' },
  { key: 'cloudDensity', label: 'Cloud density', min: 0.2, max: 8, step: 0.1, hint: 'Optical thickness. Higher blocks the sun and darkens the sky.' },
  { key: 'sunStrength', label: 'Direct sun', min: 0, max: 1.5, step: 0.01, hint: 'How much of the sun survives the overcast. Drives shadows and shafts.' },
  { key: 'ambient', label: 'Sky light', min: 0, max: 2, step: 0.01, hint: 'Strength of the light the sky and clouds cast on the level.' },
  { key: 'groundBounce', label: 'Ground bounce', min: 0, max: 1, step: 0.01, hint: 'Light coming back up from the ground. Lower makes undersides darker.' },
  { key: 'shafts', label: 'Sun shafts', min: 0, max: 8, step: 0.05, hint: 'Strength of sunlight scattered through the fog behind trees and walls.' },
  { key: 'exposure', label: 'Exposure (EV)', min: -3, max: 3, step: 0.05, hint: 'Offset from automatic exposure.' },
  { key: 'saturation', label: 'Saturation', min: 0, max: 1.5, step: 0.01, hint: 'Colour strength. Warm bright lights keep their colour.' },
  { key: 'coolness', label: 'Cool palette', min: 0, max: 1, step: 0.01, hint: 'Pushes everything but warm bright lights toward blue-grey.' },
  { key: 'bloom', label: 'Bloom', min: 0, max: 1.5, step: 0.01, hint: 'Glow around bright lights such as flames.' },
  { key: 'grain', label: 'Film grain', min: 0, max: 0.3, step: 0.005, hint: 'Animated grain.' },
  { key: 'vignette', label: 'Vignette', min: 0, max: 2, step: 0.02, hint: 'Darkening toward the corners.' },
  { key: 'aberration', label: 'Chromatic aberration', min: 0, max: 2, step: 0.02, hint: 'Colour fringing toward the corners.' },
]

export function resolveTuning(atmosphere: Atmosphere, overrides: Partial<LookTuning> = {}): LookTuning {
  const physical = atmosphere.physical
  return {
    fogDensity: 1,
    fogHeight: physical?.heightFog?.scaleHeight ?? 100,
    haze: 1,
    cloudCoverage: physical?.clouds?.coverage ?? 0,
    cloudAltitude: physical?.clouds?.altitude ?? 2.2,
    cloudDensity: physical?.clouds?.density ?? 1,
    sunStrength: 1,
    ambient: 1,
    groundBounce: 1,
    shafts: 0,
    exposure: 0,
    saturation: atmosphere.grade.saturation ?? 1,
    coolness: 0,
    bloom: atmosphere.grade.bloom ?? 0,
    grain: atmosphere.grade.grain,
    vignette: atmosphere.grade.vignette,
    aberration: atmosphere.grade.aberration,
    ...overrides,
  }
}

const DEFAULT_CLOUDS: CloudSpec = { coverage: 0, altitude: 2.2, density: 1, scale: 1, wind: 0.6 }

export function withClouds(atmosphere: Atmosphere, tuning: LookTuning): Atmosphere {
  const physical = atmosphere.physical
  if (!physical) return atmosphere
  const clouds = { ...DEFAULT_CLOUDS, ...physical.clouds, coverage: tuning.cloudCoverage, altitude: tuning.cloudAltitude, density: tuning.cloudDensity }
  return { ...atmosphere, physical: { ...physical, clouds } }
}
