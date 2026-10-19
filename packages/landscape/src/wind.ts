import { Vector2, Vector4 } from 'three'
import { hash2 } from './random'

export interface WindSpec {
  readonly direction: readonly [number, number]
  readonly strength: number
  readonly gust: number
  readonly gustScale: number
  readonly gustSpeed: number
}

export const BREEZE: WindSpec = { direction: [0.8, -0.6], strength: 0.45, gust: 0.75, gustScale: 38, gustSpeed: 7 }

export interface WindUniforms {
  windDirection: { value: Vector2 }
  windParams: { value: Vector4 }
  windTime: { value: number }
  [name: string]: { value: unknown }
}

export interface Wind {
  readonly uniforms: WindUniforms
  readonly spec: WindSpec
  time: number
  frozen: boolean
  update(dt: number): void
  sample(x: number, z: number): number
  gust(x: number, z: number): number
  set(spec: Partial<WindSpec>): void
}

function noise(x: number, z: number, seed: number) {
  const ix = Math.floor(x)
  const iz = Math.floor(z)
  const fx = x - ix
  const fz = z - iz
  const ux = fx * fx * (3 - 2 * fx)
  const uz = fz * fz * (3 - 2 * fz)
  const a = hash2(ix, iz, seed)
  const b = hash2(ix + 1, iz, seed)
  const c = hash2(ix, iz + 1, seed)
  const d = hash2(ix + 1, iz + 1, seed)
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function createWind(initial: WindSpec = BREEZE): Wind {
  let spec: WindSpec = { ...initial }
  const direction = new Vector2(...spec.direction).normalize()
  const uniforms: WindUniforms = {
    windDirection: { value: direction },
    windParams: { value: new Vector4(spec.strength, spec.gust, spec.gustScale, spec.gustSpeed) },
    windTime: { value: 0 },
  }
  const wind: Wind = {
    uniforms,
    get spec() { return spec },
    time: 0,
    frozen: false,
    update(dt) {
      if (!wind.frozen) wind.time += Math.min(dt, 0.1)
      uniforms.windTime.value = wind.time
    },
    gust(x, z) {
      const px = (x - direction.x * wind.time * spec.gustSpeed) / spec.gustScale
      const pz = (z - direction.y * wind.time * spec.gustSpeed) / spec.gustScale
      const n = noise(px, pz, 7) * 0.65 + noise(px * 2.7 + 3.1, pz * 2.7 + 3.1, 11) * 0.35
      return smooth(0.42, 0.86, n)
    },
    sample(x, z) {
      const sway = 0.75 + 0.25 * Math.sin(wind.time * 0.7 + (x * direction.x + z * direction.y) * 0.02)
      return spec.strength * sway + spec.gust * wind.gust(x, z)
    },
    set(next) {
      spec = { ...spec, ...next }
      direction.set(...spec.direction).normalize()
      uniforms.windParams.value.set(spec.strength, spec.gust, spec.gustScale, spec.gustSpeed)
    },
  }
  return wind
}
