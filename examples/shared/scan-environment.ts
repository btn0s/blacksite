import { NATURE, atmosphereTransmittance, type Atmosphere, type FilmOptions } from '@blacksite/look'

type EnvironmentComponent = { class: string; transform: { matrix: number[]; position: number[] }; properties: Record<string, unknown> }
type Rgb = readonly [number, number, number]

const srgbToLinear = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4

function colour(value: unknown): Rgb {
  const text = String(value)
  const channel = (name: string) => srgbToLinear(Number(text.match(new RegExp(`${name}=([0-9.]+)`))![1]) / 255)
  return [channel('R'), channel('G'), channel('B')]
}

const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b

function parseStruct(text: string) {
  const trimmed = text.trim()
  const body = trimmed.startsWith('(') && trimmed.endsWith(')') ? trimmed.slice(1, -1) : trimmed
  const fields: Record<string, string> = {}
  let depth = 0
  let start = 0
  for (let index = 0; index <= body.length; index++) {
    const character = body[index]
    if (character === '(') depth++
    else if (character === ')') depth--
    else if ((character === ',' && depth === 0) || index === body.length) {
      const field = body.slice(start, index)
      const split = field.indexOf('=')
      fields[field.slice(0, split)] = field.slice(split + 1)
      start = index + 1
    }
  }
  return fields
}

function vector(value: string) {
  const fields = parseStruct(value)
  return [Number(fields.X), Number(fields.Y), Number(fields.Z), Number(fields.W)] as const
}

const GRADE_GROUPS = [['', 'global'], ['Shadows', 'shadows'], ['Midtones', 'midtones'], ['Highlights', 'highlights']] as const
const GRADE_PARAMETERS = [['Saturation', 'saturation'], ['Contrast', 'contrast'], ['Gamma', 'gamma'], ['Gain', 'gain'], ['Offset', 'offset']] as const

function scanFilm(components: readonly EnvironmentComponent[]): FilmOptions {
  const volume = components.find(entry => entry.class === 'PostProcessVolume' && entry.properties.unbound === true)
  if (!volume) throw new Error('Missing unbound PostProcessVolume')
  const settings = parseStruct(String(volume.properties.settings))
  const overridden = (name: string) => settings[`bOverride_${name}`] === 'True'
  const scalar = (name: string) => overridden(name) ? Number(settings[name]) : undefined
  const grade: Record<string, Record<string, readonly [number, number, number, number]>> = {}
  for (const [suffix, group] of GRADE_GROUPS) {
    for (const [parameter, key] of GRADE_PARAMETERS) {
      const name = `Color${parameter}${suffix}`
      if (overridden(name)) (grade[group] ??= {})[key] = vector(settings[name]!)
    }
  }
  const range = [scalar('HistogramLogMin'), scalar('HistogramLogMax')]
  return {
    exposure: {
      min: scalar('AutoExposureMinBrightness'),
      max: scalar('AutoExposureMaxBrightness'),
      low: scalar('AutoExposureLowPercent'),
      high: scalar('AutoExposureHighPercent'),
      speedUp: scalar('AutoExposureSpeedUp'),
      speedDown: scalar('AutoExposureSpeedDown'),
      bias: scalar('AutoExposureBias'),
      ...(range[0] !== undefined && range[1] !== undefined ? { histogram: [range[0], range[1]] as const } : {}),
    },
    balance: { temperature: scalar('WhiteTemp'), tint: scalar('WhiteTint') },
    grade,
  }
}

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
  const sunLux = Number(sun.properties.intensity)
  const metres = 0.1
  const direction = [-m[0]! / length, -m[1]! / length, -m[2]! / length] as const
  const physical = {
      ...NATURE.physical!,
      rayleigh: Number(sky.rayleigh_scattering_scale) / 0.0331,
      mieScattering: Number(sky.mie_scattering_scale),
      mieAbsorption: Number(sky.mie_absorption_scale),
      mieAnisotropy: Number(sky.mie_anisotropy),
      ozone: Number(sky.other_absorption_scale) / 0.001881,
      groundAlbedo: luminance(colour(sky.ground_albedo)),
      elevation: 0,
      aerial: Number(sky.aerial_pespective_view_distance_scale),
      sky: Number((sky.sky_luminance_factor as number[])[0]),
      clear: Number(sky.aerial_perspective_start_depth) * 1000,
      illuminance: 1,
      clouds: null,
      heightFog: {
        extinction: Number(fog.properties.fog_density) * metres * Math.LN2,
        base: fog.transform.position[1]!,
        scaleHeight: 1 / (Number(fog.properties.fog_height_falloff) * metres * Math.LN2),
        start: Number(fog.properties.start_distance) * 0.01,
        albedo: colour(fog.properties.volumetric_fog_albedo),
        phase: Number(fog.properties.volumetric_fog_scattering_distribution),
        emissive: (fog.properties.fog_inscattering_luminance as number[]).slice(0, 3).map(value => value / sunLux) as unknown as Rgb,
      },
    }
  const atmosphere: Atmosphere = {
    ...NATURE,
    exposure: 1,
    sun: { ...NATURE.sun, direction, color: atmosphereTransmittance(physical, Math.asin(direction[1])) },
    grade: { ...NATURE.grade, lut: null, saturation: 1, bloom: 0, vignette: 0, grain: 0 },
    physical,
  }
  return { atmosphere, sunlight: { sunLux, ev100: 13, sunSize: Number(sun.properties.light_source_angle) }, film: scanFilm(components) }
}
