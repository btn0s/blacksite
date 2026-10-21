import { Vector3 } from 'three/webgpu'
import type { Camera, DepthTexture, Node, UniformNode } from 'three/webgpu'
import { Fn, If, Loop, exp, float, frameId, getViewPosition, interleavedGradientNoise, length, min, normalize, pow, renderGroup, screenCoordinate, screenUV, texture, uniform, vec2, vec3, vec4 } from 'three/tsl'
import type { SunLight } from 'three/addons/lights/SunLight.js'
import type { Rgb } from './atmosphere'

type CascadeShadow = SunLight['shadow'] & { _cascadeData: Array<{ x: number; y: number; z: number; w: number }> }

export interface SunShaftsOptions {
  readonly sun: SunLight
  readonly shadowMap: DepthTexture
  readonly camera: Camera
  readonly depth: Node
  readonly direction: Rgb
  readonly fog: UniformNode<'vec4', unknown>
  readonly fogAlbedo: UniformNode<'vec3', unknown>
  readonly sunTerm: Node<'float'>
  readonly color: Rgb
  readonly radianceScale: number
  readonly reversedShadow: boolean
  readonly steps?: number
  readonly reach?: number
}

export function sunShafts(options: SunShaftsOptions) {
  const { sun, shadowMap, camera, fog, fogAlbedo, sunTerm, reversedShadow } = options
  const depth = options.depth as unknown as Node<'float'>
  const steps = options.steps ?? 8
  const shadow = sun.shadow as CascadeShadow
  const cascades = shadow.getViewportCount()
  const reversed = camera.reversedDepth === true
  const strength = uniform(0).setGroup(renderGroup)
  const reach = uniform(options.reach ?? 150).setGroup(renderGroup)
  const tint = uniform(new Vector3(...options.color)).setGroup(renderGroup)
  const toSun = uniform(new Vector3(...options.direction).normalize()).setGroup(renderGroup)
  const cameraWorld = uniform(camera.matrixWorld).setGroup(renderGroup)
  const inverse = uniform(camera.projectionMatrixInverse).setGroup(renderGroup)
  const scale = uniform(options.radianceScale).setGroup(renderGroup)
  const matrices = Array.from({ length: cascades }, (_, index) => uniform('mat4').setGroup(renderGroup).onRenderUpdate(() => shadow.getMatrix(index)))
  const ranges = Array.from({ length: cascades }, (_, index) => uniform('vec4').setGroup(renderGroup).onRenderUpdate(() => shadow._cascadeData[index]))
  const bias = shadow.bias

  const phase = (cosine: Node<'float'>) => {
    const g = fog.w
    const g2 = g.mul(g)
    return float(1).sub(g2).div(pow(float(1).add(g2).sub(g.mul(cosine).mul(2)).max(1e-4), 1.5).mul(4 * Math.PI))
  }

  const occlusion = Fn(() => {
    const result = vec3(0).toVar()
    If(strength.greaterThan(0), () => {
      const hit = getViewPosition(screenUV, depth, inverse)
      const ray = normalize(getViewPosition(screenUV, float(0.5), inverse))
      const sky = reversed ? depth.lessThanEqual(1e-6) : depth.greaterThanEqual(0.999999)
      If(sky.not(), () => {
        const span = min(length(hit), reach)
        const jitter = interleavedGradientNoise(screenCoordinate.xy.add(frameId.mod(64).toFloat().mul(5.588238)))
        const optical = float(0).toVar()
        const blocked = float(0).toVar()
        Loop(steps, ({ i }) => {
          const u = float(i).add(jitter).div(steps)
          const point = ray.mul(u.mul(u).mul(span))
          const width = span.mul(u).mul(2 / steps)
          const world = cameraWorld.mul(vec4(point, 1)).xyz
          const weight = fog.x.mul(exp(world.y.sub(fog.y).max(0).negate().div(fog.z))).mul(width)
          const viewDepth = point.z.negate()
          const visibility = float(1).toVar()
          for (let index = cascades - 1; index >= 0; index--) {
            If(viewDepth.greaterThanEqual(ranges[index]!.x).and(viewDepth.lessThan(ranges[index]!.y)), () => {
              const clip = matrices[index]!.mul(vec4(world, 1))
              const coordinate = clip.xyz.div(clip.w)
              const inside = coordinate.x.greaterThan(index / cascades).and(coordinate.x.lessThan((index + 1) / cascades)).and(coordinate.y.greaterThan(0)).and(coordinate.y.lessThan(1)).and(coordinate.z.greaterThan(0)).and(coordinate.z.lessThan(1))
              If(inside, () => {
                visibility.assign(texture(shadowMap, vec2(coordinate.x, coordinate.y.oneMinus())).compare(reversedShadow ? coordinate.z.sub(bias) : coordinate.z.add(bias)).r)
              })
            })
          }
          blocked.addAssign(float(1).sub(visibility).mul(exp(optical.negate())).mul(weight))
          optical.addAssign(weight)
        })
        const cosine = normalize(cameraWorld.mul(vec4(ray, 0)).xyz).dot(toSun)
        result.assign(tint.mul(fogAlbedo).mul(phase(cosine)).mul(blocked).mul(scale).mul(sunTerm).mul(strength))
      })
    })
    return result
  })

  return { strength, reach, node: occlusion() as unknown as Node<'vec3'> }
}
