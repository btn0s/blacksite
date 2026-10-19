import { Vector3 } from 'three/webgpu'
import type { DepthTexture, LightShadow, Node, OrthographicCamera, UniformNode } from 'three/webgpu'
import { Fn, float, int, interleavedGradientNoise, ivec2, max, reference, renderGroup, screenCoordinate, select, texture, textureLoad, uniform, vec2, vogelDiskSample } from 'three/tsl'
import type { SunLight } from 'three/addons/lights/SunLight.js'

type ShadowInputs = { depthTexture: DepthTexture; shadowCoord: Node<'vec3'>; shadow: LightShadow }

export function sunPenumbra(sun: SunLight, angle: UniformNode<'float', number>, blockers: number, taps: number) {
  const scales = [0, 1].map(index => {
    const value = new Vector3()
    return uniform(value).setGroup(renderGroup).onRenderUpdate(() => {
      const camera = sun.shadow.getCamera(index) as OrthographicCamera
      return value.set(0.5 / (camera.right - camera.left), 1 / (camera.top - camera.bottom), camera.far - camera.near)
    })
  })
  const reversed = uniform(false).setGroup(renderGroup).onRenderUpdate(() => sun.shadow.camera.reversedDepth)
  return Fn(({ depthTexture, shadowCoord, shadow }: ShadowInputs) => {
    const size = reference('mapSize', 'vec2', shadow)
    const texel = vec2(1).div(size)
    const far = shadowCoord.x.greaterThan(0.5)
    const scale = select(far, scales[1]!, scales[0]!)
    const low = vec2(select(far, float(0.5), float(0)), 0).add(texel.mul(2))
    const high = low.add(vec2(0.5, 1)).sub(texel.mul(4))
    const phi = interleavedGradientNoise(screenCoordinate.xy).mul(Math.PI * 2)
    const z = shadowCoord.z
    const search = scale.xy.mul(angle.mul(25))
    let total: Node<'float'> = float(0)
    let count: Node<'float'> = float(0)
    for (let index = 0; index < blockers; index++) {
      const at = vec2(shadowCoord.xy.add(vogelDiskSample(int(index), int(blockers), phi).mul(search)).clamp(low, high))
      const depth = textureLoad(texture(depthTexture), ivec2(at.mul(size))).x
      const blocks = select(select(reversed, depth.greaterThan(z), depth.lessThan(z)), float(1), float(0))
      total = total.add(depth.mul(blocks))
      count = count.add(blocks)
    }
    const blocker = total.div(max(count, 1))
    const separation = select(reversed, blocker.sub(z), z.sub(blocker))
    const distance = select(count.greaterThan(0), max(separation, 0).mul(scale.z), float(0))
    const radius = max(scale.xy.mul(distance.mul(angle).mul(0.5)), texel.mul(1.5))
    let lit: Node<'float'> = float(0)
    for (let index = 0; index < taps; index++) {
      const at = shadowCoord.xy.add(vogelDiskSample(int(index), int(taps), phi).mul(radius)).clamp(low, high)
      lit = lit.add(texture(depthTexture, at).compare(z) as unknown as Node<'float'>)
    }
    return lit.div(taps)
  })
}
