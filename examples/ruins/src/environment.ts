import { Matrix4, Vector3 } from 'three'
import { NATURE, type Atmosphere } from '@blacksite/look'
import type { RuinsAsset } from './asset'

export function levelAtmosphere(environment: RuinsAsset['environment']) {
  const sun = environment.components.find(component => component.class === 'DirectionalLightComponent')!
  const sky = environment.components.find(component => component.class === 'SkyLightComponent')!
  const fog = environment.components.find(component => component.class === 'ExponentialHeightFogComponent')!
  const matrix = new Matrix4().fromArray(sun.transform.matrix)
  const direction = new Vector3(-1, 0, 0).transformDirection(matrix).toArray() as [number, number, number]
  const tint = fog.properties.fog_inscattering_luminance as [number, number, number, number]
  const atmosphere: Atmosphere = {
    ...NATURE,
    exposure: 1,
    sun: { ...NATURE.sun, direction, color: [1, 1, 1] },
    grade: { ...NATURE.grade, lut: null, saturation: 1, bloom: 0, vignette: 0, grain: 0 },
    physical: NATURE.physical && {
      ...NATURE.physical,
      clear: 100,
      heightFog: { density: Number(fog.properties.fog_density) * 0.001, base: fog.transform.position[1]!, falloff: 1 / (Number(fog.properties.fog_height_falloff) * 0.001), tint: tint.slice(0, 3) as [number, number, number] },
    },
  }
  return { atmosphere, sunlight: { sunLux: Number(sun.properties.intensity), skyLux: 16000 * Number(sky.properties.intensity), ev100: 13 } }
}
