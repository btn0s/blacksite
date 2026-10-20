import type { PhysicalSkySpec, Rgb } from './atmosphere'
import { GROUND_RADIUS, MIE_HEIGHT, OZONE, OZONE_TIP, OZONE_WIDTH, RAYLEIGH, RAYLEIGH_HEIGHT, TOP_RADIUS } from './coefficients'

const VIEWER_HEIGHT = 0.5
const STEPS = 15

export function atmosphereTransmittance(spec: PhysicalSkySpec, sunElevation: number): Rgb {
  const mu = Math.sin(sunElevation)
  const sin = Math.cos(sunElevation)
  const radius = GROUND_RADIUS + VIEWER_HEIGHT
  const b = radius * mu
  const length = -b + Math.sqrt(b * b - radius * radius + TOP_RADIUS * TOP_RADIUS)
  const depth = [0, 0, 0]
  for (let step = 0; step < STEPS; step++) {
    const along = length * step / STEPS
    const height = Math.hypot(along * sin, radius + along * mu) - GROUND_RADIUS
    const mie = Math.exp(-height / MIE_HEIGHT) * (spec.mieScattering + spec.mieAbsorption)
    const rayleigh = Math.exp(-height / RAYLEIGH_HEIGHT)
    const ozone = Math.min(Math.max(1 - Math.abs(height - OZONE_TIP) / OZONE_WIDTH, 0), 1)
    for (let channel = 0; channel < 3; channel++) depth[channel]! += (mie + rayleigh * RAYLEIGH[channel]! * spec.rayleigh + ozone * OZONE[channel]! * spec.ozone) * length / STEPS
  }
  return [Math.exp(-depth[0]!), Math.exp(-depth[1]!), Math.exp(-depth[2]!)]
}
