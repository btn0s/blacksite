import { NoToneMapping, Vector3 } from 'three/webgpu'
import type { Node, UniformNode } from 'three/webgpu'
import { float, luminance, max, mix, renderGroup, renderOutput, smoothstep, texture3D, uniform, uv, vec2, vec3, vec4 } from 'three/tsl'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { film as grain } from 'three/addons/tsl/display/FilmNode.js'
import { lut3D } from 'three/addons/tsl/display/Lut3DNode.js'
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js'
import { circle } from 'three/addons/tsl/display/Shape.js'
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js'
import type { Atmosphere } from './atmosphere'
import type { Film } from './film'
import type { LoadedLut } from './lut'
import type { QualityTier } from './quality'
import type { LookTuning } from './tuning'

export interface CameraGrade {
  readonly temperature?: number
  readonly tint?: number
  readonly contrast?: number
  readonly toe?: number
  readonly shoulder?: number
  readonly lensSoftness?: number
}

export interface GradingStages {
  readonly bloom: boolean
  readonly lens: boolean
  readonly grain: boolean
}

export interface GradingOptions {
  readonly film: Film | null
  readonly quality: QualityTier
  readonly atmosphere: Atmosphere
  readonly camera: CameraGrade
  readonly lut: LoadedLut | null
  readonly filmScale: UniformNode<'float', number>
  readonly tuning: LookTuning
}

const COOL = new Vector3(0.92, 1, 1.1)

export function createGrading(options: GradingOptions) {
  const { film, quality, atmosphere, camera, lut, tuning } = options
  const disposables: Array<{ dispose(): void }> = []
  const values = {
    ev: uniform(2 ** tuning.exposure).setGroup(renderGroup),
    bloom: uniform(tuning.bloom).setGroup(renderGroup),
    saturation: uniform(tuning.saturation).setGroup(renderGroup),
    coolness: uniform(tuning.coolness).setGroup(renderGroup),
    vignette: uniform(tuning.vignette).setGroup(renderGroup),
    grain: uniform(tuning.grain).setGroup(renderGroup),
    aberration: uniform(tuning.aberration).setGroup(renderGroup),
  }
  const cool = uniform(COOL).setGroup(renderGroup)
  const exposureScale = options.filmScale.mul(values.ev)

  const mood = (rgb: Node<'vec3'>, desaturate: boolean): Node<'vec3'> => {
    const peak = max(rgb.r, max(rgb.g, rgb.b))
    const warmth = rgb.r.sub(rgb.b).div(peak.max(0.05)).clamp(0, 1)
    const accent = smoothstep(0.35, 0.8, warmth).mul(smoothstep(0.55, 0.9, peak))
    const tone = desaturate ? mix(vec3(luminance(rgb)), rgb, mix(values.saturation, float(1), accent)) : rgb
    return mix(tone, tone.mul(cool), values.coolness.mul(float(1).sub(accent)))
  }

  const grade = (input: Node<'vec4'>, stages: GradingStages): Node<'vec4'> => {
    let color = input
    if (stages.lens) color = chromaticAberration(color, values.aberration, vec2(0.5, 0.5) as never, float(1.1)) as unknown as Node<'vec4'>
    if (stages.bloom) {
      const glow = bloom(color, values.bloom as never, 0.6, (film ? float(1.4).div(exposureScale) : float(1.35)) as never)
      glow.smoothWidth = (film ? float(1).div(exposureScale) : float(0.5)) as never
      disposables.push(glow)
      color = vec4(color.rgb.add(glow.rgb), color.a)
    }
    if (quality !== 'low' && (camera.lensSoftness ?? 0) > 0) {
      const soft = gaussianBlur(color, null, 3)
      disposables.push(soft)
      color = mix(color, soft, float(1).sub(circle(float(1.5), float(0.75), uv())).mul(camera.lensSoftness ?? 0))
    }
    let shaped: Node<'vec3'>
    if (film) shaped = mood(renderOutput(vec4(film.output(color.rgb, exposureScale), 1), NoToneMapping).rgb, true)
    else {
      const balance = new Vector3(1 + 0.25 * (camera.temperature ?? 0), 1 + 0.12 * (camera.tint ?? 0), 1 - 0.25 * (camera.temperature ?? 0))
      balance.multiplyScalar(1 / (0.2126 * balance.x + 0.7152 * balance.y + 0.0722 * balance.z))
      const balanced = color.rgb.mul(uniform(balance).setGroup(renderGroup)).mul(atmosphere.exposure).mul(values.ev)
      const saturated = mix(vec3(luminance(balanced)), balanced, values.saturation)
      const display = renderOutput(vec4(saturated, 1)).rgb
      const rolled = display.sub(display.pow(3).mul(camera.shoulder ?? 0))
      const toe = camera.toe ?? 0
      const lifted = rolled.mul(1 - toe).add(toe)
      shaped = mood(lifted.sub(0.5).mul(camera.contrast ?? 1).add(0.5).clamp(0, 1), false)
    }
    let graded: Node<'vec4'> = vec4(shaped, 1)
    if (lut) graded = lut3D(graded, texture3D(lut.texture), lut.size, float(1)) as unknown as Node<'vec4'>
    const centred = uv().sub(0.5)
    graded = vec4(graded.rgb.mul(float(1).sub(centred.dot(centred).mul(values.vignette))), 1)
    if (stages.grain) graded = grain(graded, values.grain) as unknown as Node<'vec4'>
    return graded
  }

  return { values, exposureScale, grade, disposables }
}
