import { NATURE, type Atmosphere } from '@blacksite/look'

type EnvironmentComponent = { class: string; transform: { matrix: number[]; position: number[] }; properties: Record<string, unknown> }

export function scanEnvironment(components: readonly EnvironmentComponent[]) {
  const component = (name: string) => {
    const value = components.find(entry => entry.class === name)
    if (!value) throw new Error(`Missing environment component: ${name}`)
    return value
  }
  const sun = component('DirectionalLightComponent')
  const sky = component('SkyAtmosphereComponent').properties
  const fog = component('ExponentialHeightFogComponent')
  const m = sun.transform.matrix
  const length = Math.hypot(m[0]!, m[1]!, m[2]!)
  const atmosphere: Atmosphere = {
    ...NATURE,
    exposure: 1,
    sun: { ...NATURE.sun, direction: [-m[0]! / length, -m[1]! / length, -m[2]! / length], color: [1, 1, 1] },
    grade: { ...NATURE.grade, lut: null, saturation: 1, bloom: 0, vignette: 0, grain: 0 },
    physical: {
      ...NATURE.physical!,
      rayleigh: Number(sky.rayleigh_scattering_scale) / 0.0331,
      mie: Number(sky.mie_scattering_scale) / 0.003996,
      mieAnisotropy: Number(sky.mie_anisotropy),
      ozone: Number(sky.other_absorption_scale) / 0.001881,
      elevation: 0,
      aerial: 1,
      sky: 1,
      clear: 0,
      clouds: null,
      heightFog: {
        density: Number(fog.properties.fog_density) * 0.1 * Math.LN2,
        base: fog.transform.position[1]!,
        falloff: 1 / (Number(fog.properties.fog_height_falloff) * 0.1 * Math.LN2),
        tint: (fog.properties.fog_inscattering_luminance as number[]).slice(0, 3) as [number, number, number],
      },
    },
  }
  return { atmosphere, sunlight: { sunLux: Number(sun.properties.intensity), skyLux: 16000 * Number(component('SkyLightComponent').properties.intensity), ev100: 13 } }
}
