import { wgslFn } from 'three/tsl'
import type { Node } from 'three/webgpu'

export type Vec4 = readonly [number, number, number, number]

export interface GradeGroup {
  readonly saturation: Vec4
  readonly contrast: Vec4
  readonly gamma: Vec4
  readonly gain: Vec4
  readonly offset: Vec4
}

export interface ToneCurve {
  readonly slope: number
  readonly toe: number
  readonly shoulder: number
  readonly blackClip: number
  readonly whiteClip: number
}

export interface ExposureSettings {
  readonly min: number
  readonly max: number
  readonly low: number
  readonly high: number
  readonly speedUp: number
  readonly speedDown: number
  readonly bias: number
  readonly histogram: readonly [number, number]
}

export interface FilmOptions {
  readonly exposure?: Partial<ExposureSettings>
  readonly tone?: Partial<ToneCurve>
  readonly blueCorrection?: number
  readonly expandGamut?: number
  readonly balance?: { readonly temperature?: number; readonly tint?: number }
  readonly grade?: {
    readonly global?: Partial<GradeGroup>
    readonly shadows?: Partial<GradeGroup>
    readonly midtones?: Partial<GradeGroup>
    readonly highlights?: Partial<GradeGroup>
    readonly shadowsMax?: number
    readonly highlightsMin?: number
    readonly highlightsMax?: number
  }
}

export const FILM_EXPOSURE: ExposureSettings = { min: -10, max: 20, low: 10, high: 90, speedUp: 3, speedDown: 1, bias: 0, histogram: [-10, 20] }
const FILM_TONE: ToneCurve = { slope: 0.88, toe: 0.55, shoulder: 0.26, blackClip: 0, whiteClip: 0.04 }
const IDENTITY: GradeGroup = { saturation: [1, 1, 1, 1], contrast: [1, 1, 1, 1], gamma: [1, 1, 1, 1], gain: [1, 1, 1, 1], offset: [0, 0, 0, 0] }

type Matrix = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]]

const AP0_2_XYZ: Matrix = [[0.9525523959, 0, 0.0000936786], [0.3439664498, 0.7281660966, -0.0721325464], [0, 0, 1.0088251844]]
const XYZ_2_AP0: Matrix = [[1.0498110175, 0, -0.0000974845], [-0.4959030231, 1.3733130458, 0.0982400361], [0, 0, 0.9912520182]]
const AP1_2_XYZ: Matrix = [[0.6624541811, 0.1340042065, 0.156187687], [0.2722287168, 0.6740817658, 0.0536895174], [-0.0055746495, 0.0040607335, 1.0103391003]]
const XYZ_2_AP1: Matrix = [[1.6410233797, -0.3248032942, -0.2364246952], [-0.6636628587, 1.6153315917, 0.0167563477], [0.0117218943, -0.008284442, 0.9883948585]]
const AP0_2_AP1: Matrix = [[1.4514393161, -0.2365107469, -0.2149285693], [-0.0765537734, 1.1762296998, -0.0996759264], [0.0083161484, -0.0060324498, 0.9977163014]]
const AP1_2_AP0: Matrix = [[0.6954522414, 0.1406786965, 0.1638690622], [0.0447945634, 0.8596711185, 0.0955343182], [-0.0055258826, 0.0040252103, 1.0015006723]]
const XYZ_2_SRGB: Matrix = [[3.2409699419, -1.5373831776, -0.4986107603], [-0.9692436363, 1.8759675015, 0.0415550574], [0.0556300797, -0.2039769589, 1.0569715142]]
const SRGB_2_XYZ: Matrix = [[0.4123907993, 0.3575843394, 0.1804807884], [0.2126390059, 0.7151686788, 0.0721923154], [0.0193308187, 0.1191947798, 0.9505321522]]
const D65_2_D60: Matrix = [[1.0130349146, 0.0061052578, -0.0149709436], [0.0076982301, 0.9981633521, -0.0050320385], [-0.0028413174, 0.0046851567, 0.9245061375]]
const D60_2_D65: Matrix = [[0.9872240087, -0.0061132286, 0.0159532883], [-0.0075983718, 1.0018614847, 0.0053300358], [0.0030725771, -0.0050959615, 1.0816806031]]
const WIDE_2_XYZ: Matrix = [[0.5441691, 0.2395926, 0.1666943], [0.2394656, 0.702153, 0.0583814], [-0.0023439, 0.0361834, 1.0552183]]
const BLUE: Matrix = [[0.9404372683, -0.0183068787, 0.0778696104], [0.0083786969, 0.8286599939, 0.1629613092], [0.0005471261, -0.0008833746, 1.0003362486]]
const BLUE_INVERSE: Matrix = [[1.06318, 0.0233956, -0.0865726], [-0.0106337, 1.20632, -0.19569], [-0.000590887, 0.00105248, 0.999538]]
const CONE: Matrix = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]]
const CONE_INVERSE: Matrix = [[0.9869929, -0.1470543, 0.1599627], [0.4323053, 0.5183603, 0.0492912], [-0.0085287, 0.0400428, 0.9684867]]

const multiply = (a: Matrix, b: Matrix): Matrix => a.map((_, row) => [0, 1, 2].map(column => a[row]![0]! * b[0]![column]! + a[row]![1]! * b[1]![column]! + a[row]![2]! * b[2]![column]!)) as unknown as Matrix
const apply = (m: Matrix, v: readonly [number, number, number]) => m.map(row => row[0]! * v[0] + row[1]! * v[1] + row[2]! * v[2]) as unknown as readonly [number, number, number]

function planckian(temperature: number, tint: number) {
  const t = temperature
  const u = (0.860117757 + 1.54118254e-4 * t + 1.28641212e-7 * t * t) / (1 + 8.42420235e-4 * t + 7.08145163e-7 * t * t)
  const v = (0.317398726 + 4.22806245e-5 * t + 4.20481691e-8 * t * t) / (1 - 2.89741816e-5 * t + 1.61456053e-7 * t * t)
  const ud = (-1.13758118e9 - 1.91615621e6 * t - 1.53177 * t * t) / (1.41213984e6 + 1189.62 * t + t * t) ** 2
  const vd = (1.97471536e9 - 705674 * t - 308.607 * t * t) / (6.19363586e6 - 179.456 * t + t * t) ** 2
  const length = Math.hypot(ud, vd)
  const up = u + (vd / length) * tint * 0.05
  const vp = v + (-ud / length) * tint * 0.05
  return [3 * up / (2 * up - 8 * vp + 4), 2 * vp / (2 * up - 8 * vp + 4)] as const
}

function daylight(temperature: number) {
  const t = temperature * 1.4388 / 1.438
  const inverse = 1 / t
  const x = t <= 7000
    ? 0.244063 + (0.09911e3 + (2.9678e6 - 4.607e9 * inverse) * inverse) * inverse
    : 0.23704 + (0.24748e3 + (1.9018e6 - 2.0064e9 * inverse) * inverse) * inverse
  return [x, -3 * x * x + 2.87 * x - 0.275] as const
}

function whiteBalance(temperature: number, tint: number): Matrix {
  const base = planckian(temperature, 0)
  const offset = planckian(temperature, tint)
  const source = temperature < 4000 ? base : daylight(temperature)
  const src = [source[0] + offset[0] - base[0], source[1] + offset[1] - base[1]] as const
  const xyz = (x: number, y: number) => [x / y, 1, (1 - x - y) / y] as const
  const from = apply(CONE, xyz(src[0], src[1]))
  const to = apply(CONE, xyz(0.3127, 0.329))
  const diagonal: Matrix = [[to[0] / from[0], 0, 0], [0, to[1] / from[1], 0], [0, 0, to[2] / from[2]]]
  return multiply(XYZ_2_SRGB, multiply(multiply(CONE_INVERSE, multiply(diagonal, CONE)), SRGB_2_XYZ))
}

const number = (value: number) => Number.isInteger(value) ? `${value}.0` : String(value)
const vec3 = (v: readonly number[]) => `vec3f(${v.slice(0, 3).map(number).join(', ')})`
const vec4 = (v: readonly number[]) => `vec4f(${v.map(number).join(', ')})`
const matrix = (m: Matrix) => `mat3x3f(${[0, 1, 2].map(column => vec3([m[0]![column]!, m[1]![column]!, m[2]![column]!])).join(', ')})`

function resolve<T extends object>(defaults: T, overrides: Partial<T> | undefined): T {
  return { ...defaults, ...Object.fromEntries(Object.entries(overrides ?? {}).filter(([, value]) => value !== undefined)) }
}

export interface Film {
  readonly exposure: ExposureSettings
  output(color: Node<'vec3'>, exposure: Node<'float'>): Node<'vec3'>
}

export function createFilm(options: FilmOptions): Film {
  const exposure = resolve(FILM_EXPOSURE, options.exposure)
  const tone = resolve(FILM_TONE, options.tone)
  const blueCorrection = options.blueCorrection ?? 0.6
  const expandGamut = options.expandGamut ?? 1
  const grade = options.grade ?? {}
  const global = resolve(IDENTITY, grade.global)
  const shadows = resolve(IDENTITY, grade.shadows)
  const midtones = resolve(IDENTITY, grade.midtones)
  const highlights = resolve(IDENTITY, grade.highlights)
  const sRGB_2_AP1 = multiply(XYZ_2_AP1, multiply(D65_2_D60, SRGB_2_XYZ))
  const AP1_2_sRGB = multiply(XYZ_2_SRGB, multiply(D60_2_D65, AP1_2_XYZ))
  const balance = options.balance ?? {}
  const temperature = balance.temperature ?? 6500
  const tint = balance.tint ?? 0
  const white = temperature === 6500 && tint === 0 ? multiply(XYZ_2_SRGB, SRGB_2_XYZ) : whiteBalance(temperature, tint)
  const blue = multiply(AP0_2_AP1, multiply(BLUE, AP1_2_AP0))
  const blueInverse = multiply(AP0_2_AP1, multiply(BLUE_INVERSE, AP1_2_AP0))
  const expand = multiply(multiply(XYZ_2_AP1, WIDE_2_XYZ), AP1_2_sRGB)
  const toeScale = 1 + tone.blackClip - tone.toe
  const shoulderScale = 1 + tone.whiteClip - tone.shoulder
  const toeMatch = tone.toe > 0.8
    ? (1 - tone.toe - 0.18) / tone.slope + Math.log10(0.18)
    : (() => { const bt = (0.18 + tone.blackClip) / toeScale - 1; return Math.log10(0.18) - 0.5 * Math.log((1 + bt) / (1 - bt)) * (toeScale / tone.slope) })()
  const straightMatch = (1 - tone.toe) / tone.slope - toeMatch
  const shoulderMatch = tone.shoulder / tone.slope - straightMatch
  const node = wgslFn(`
fn filmDisplay(scene: vec3f, exposure: f32) -> vec3f {
  var color = ${matrix(white)} * max(scene * exposure, vec3f(0.0));
  var ap1 = ${matrix(sRGB_2_AP1)} * color;
  let luma = max(dot(ap1, AP1_RGB2Y), 1e-8);
  let chroma = ap1 / luma - vec3f(1.0);
  let expandAmount = (1.0 - exp2(-4.0 * dot(chroma, chroma))) * (1.0 - exp2(-4.0 * ${number(expandGamut)} * luma * luma));
  ap1 = mix(ap1, ${matrix(expand)} * ap1, expandAmount);
  ap1 = filmGrade(ap1);
  ap1 = mix(ap1, ${matrix(blue)} * ap1, ${number(blueCorrection)});
  ap1 = filmTone(ap1);
  ap1 = mix(ap1, ${matrix(blueInverse)} * ap1, ${number(blueCorrection)});
  return clamp(${matrix(AP1_2_sRGB)} * ap1, vec3f(0.0), vec3f(1.0));
}
const AP1_RGB2Y = vec3f(0.2722287168, 0.6740817658, 0.0536895174);
fn filmCorrect(input: vec3f, saturation: vec4f, contrast: vec4f, gamma: vec4f, gain: vec4f, offset: vec4f) -> vec3f {
  let luma = dot(input, AP1_RGB2Y);
  var color = max(mix(vec3f(luma), input, saturation.xyz * saturation.w), vec3f(0.0));
  color = pow(color * (1.0 / 0.18), contrast.xyz * contrast.w) * 0.18;
  color = pow(color, vec3f(1.0) / (gamma.xyz * gamma.w));
  return color * (gain.xyz * gain.w) + (offset.xyz + offset.w);
}
fn filmGrade(input: vec3f) -> vec3f {
  let luma = dot(input, AP1_RGB2Y);
  let global_saturation = ${vec4(global.saturation)};
  let global_contrast = ${vec4(global.contrast)};
  let global_gamma = ${vec4(global.gamma)};
  let global_gain = ${vec4(global.gain)};
  let global_offset = ${vec4(global.offset)};
  let low = filmCorrect(input, ${vec4(shadows.saturation)} * global_saturation, ${vec4(shadows.contrast)} * global_contrast, ${vec4(shadows.gamma)} * global_gamma, ${vec4(shadows.gain)} * global_gain, ${vec4(shadows.offset)} + global_offset);
  let mid = filmCorrect(input, ${vec4(midtones.saturation)} * global_saturation, ${vec4(midtones.contrast)} * global_contrast, ${vec4(midtones.gamma)} * global_gamma, ${vec4(midtones.gain)} * global_gain, ${vec4(midtones.offset)} + global_offset);
  let high = filmCorrect(input, ${vec4(highlights.saturation)} * global_saturation, ${vec4(highlights.contrast)} * global_contrast, ${vec4(highlights.gamma)} * global_gamma, ${vec4(highlights.gain)} * global_gain, ${vec4(highlights.offset)} + global_offset);
  let weightLow = 1.0 - smoothstep(0.0, ${number(grade.shadowsMax ?? 0.09)}, luma);
  let weightHigh = smoothstep(${number(grade.highlightsMin ?? 0.5)}, ${number(grade.highlightsMax ?? 1)}, luma);
  return low * weightLow + mid * (1.0 - weightLow - weightHigh) + high * weightHigh;
}
fn rgbSaturation(rgb: vec3f) -> f32 {
  let low = min(min(rgb.x, rgb.y), rgb.z);
  let high = max(max(rgb.x, rgb.y), rgb.z);
  return (max(high, 1e-10) - max(low, 1e-10)) / max(high, 1e-2);
}
fn rgbLuma(rgb: vec3f) -> f32 {
  let chroma = sqrt(max(rgb.z * (rgb.z - rgb.y) + rgb.y * (rgb.y - rgb.x) + rgb.x * (rgb.x - rgb.z), 0.0));
  return (rgb.x + rgb.y + rgb.z + 1.75 * chroma) / 3.0;
}
fn sigmoidShaper(x: f32) -> f32 {
  let t = max(1.0 - abs(0.5 * x), 0.0);
  return 0.5 * (1.0 + sign(x) * (1.0 - t * t));
}
fn glowForward(luma: f32, gain: f32, middle: f32) -> f32 {
  if (luma <= 2.0 / 3.0 * middle) { return gain; }
  if (luma >= 2.0 * middle) { return 0.0; }
  return gain * (middle / luma - 0.5);
}
fn rgbHue(rgb: vec3f) -> f32 {
  var hue = 0.0;
  if (!(rgb.x == rgb.y && rgb.y == rgb.z)) { hue = degrees(atan2(sqrt(3.0) * (rgb.y - rgb.z), 2.0 * rgb.x - rgb.y - rgb.z)); }
  if (hue < 0.0) { hue = hue + 360.0; }
  return clamp(hue, 0.0, 360.0);
}
fn filmTone(input: vec3f) -> vec3f {
  var aces = ${matrix(AP1_2_AP0)} * input;
  let saturation = rgbSaturation(aces);
  let shaper = sigmoidShaper((saturation - 0.4) / 0.2);
  aces = aces * (1.0 + glowForward(rgbLuma(aces), 0.05 * shaper, 0.08));
  var centred = rgbHue(aces);
  if (centred < -180.0) { centred = centred + 360.0; } else if (centred > 180.0) { centred = centred - 360.0; }
  let weight = smoothstep(0.0, 1.0, 1.0 - abs(2.0 * centred / 135.0));
  aces.x = aces.x + weight * weight * saturation * (0.03 - aces.x) * (1.0 - 0.82);
  var working = max(${matrix(AP0_2_AP1)} * aces, vec3f(0.0));
  working = mix(vec3f(dot(working, AP1_RGB2Y)), working, 0.96);
  let logColor = log(max(working, vec3f(1e-10))) / 2.302585092994046;
  let straight = ${number(tone.slope)} * (logColor + ${number(straightMatch)});
  let toeColor = ${number(-tone.blackClip)} + ${number(2 * toeScale)} / (1.0 + exp(${number(-2 * tone.slope / toeScale)} * (logColor - ${number(toeMatch)})));
  let shoulderColor = ${number(1 + tone.whiteClip)} - ${number(2 * shoulderScale)} / (1.0 + exp(${number(2 * tone.slope / shoulderScale)} * (logColor - ${number(shoulderMatch)})));
  let toeSelected = select(straight, toeColor, logColor < vec3f(${number(toeMatch)}));
  let shoulderSelected = select(straight, shoulderColor, logColor > vec3f(${number(shoulderMatch)}));
  var t = clamp((logColor - ${number(toeMatch)}) / ${number(shoulderMatch - toeMatch)}, vec3f(0.0), vec3f(1.0));
  ${shoulderMatch < toeMatch ? 't = vec3f(1.0) - t;' : ''}
  t = (vec3f(3.0) - 2.0 * t) * t * t;
  var mapped = mix(toeSelected, shoulderSelected, t);
  mapped = mix(vec3f(dot(mapped, AP1_RGB2Y)), mapped, 0.93);
  return max(mapped, vec3f(0.0));
}`)
  return { exposure, output: (color, scale) => node({ scene: color, exposure: scale }) as unknown as Node<'vec3'> }
}
