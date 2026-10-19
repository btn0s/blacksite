import { MeshStandardNodeMaterial, type Node } from 'three/webgpu'
import { Fn, If, attribute, cameraViewMatrix, clamp, color, cross, dFdx, dFdy, dot, float, floor, fract, int, length, mat3, max, mix, normalize, normalLocal, output, positionGeometry, select, sin, smoothstep, texture, uniform, uniformArray, varying, vec2, vec3, vec4 } from 'three/tsl'
import type { Vector2, Vector3, DataArrayTexture } from 'three'
import type { TerrainOptions, TerrainUniforms } from './terrain'
import { createTerrainNodes, landscapeNoise } from './nodes'

function tileSample(image: DataArrayTexture, uv: Node<'vec2'>, layer: number, mean: Node<'vec4'>) {
  const p = uv.mul(3.4641016)
  const skewed = vec2(p.x.sub(p.y.mul(0.57735027)), p.y.mul(1.15470054))
  const base = floor(skewed)
  const f = fract(skewed)
  const z = float(1).sub(f.x).sub(f.y)
  const upper = z.greaterThan(0)
  const a = select(upper, base, base.add(1))
  const b = base.add(select(upper, vec2(0, 1), vec2(1, 0)))
  const c = base.add(select(upper, vec2(1, 0), vec2(0, 1)))
  const weights = select(upper, vec3(z, f.y, f.x), vec3(z.negate(), float(1).sub(f.y), float(1).sub(f.x))).pow(3)
  const w = weights.div(dot(weights, vec3(1)))
  const offset = (cell: Node<'vec2'>) => {
    const p = cell.add(layer * 17.13)
    return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))).mul(43758.5453))
  }
  const sample = (cell: Node<'vec2'>) => texture(image, uv.add(offset(cell))).depth(int(layer)).grad(dFdx(uv), dFdy(uv)).sub(mean)
  return mean.add(sample(a).mul(w.x).add(sample(b).mul(w.y)).add(sample(c).mul(w.z)).mul(dot(w, w).max(1e-4).inverseSqrt()))
}

export function createTerrainMaterial(options: TerrainOptions, source: TerrainUniforms, viewer: Vector3, morph: Vector2[]) {
  const terrain = createTerrainNodes(source)
  const eye = uniform(viewer)
  const morphs = uniformArray(morph, 'vec2')
  const info = attribute('nodeInfo', 'vec4')
  const initial = info.xy.add(positionGeometry.xz.mul(info.z))
  const initialHeight = terrain.height(initial)
  const initialDistance = length(vec3(initial.x, initialHeight, initial.y).sub(eye))
  const band = morphs.element(int(info.w.add(0.5)))
  const factor = clamp(initialDistance.sub(band.x).div(max(band.y.sub(band.x), 1)), 0, 1)
  const grid = positionGeometry.xz.sub(fract(positionGeometry.xz.mul(0.5)).mul(2).mul(factor))
  const root = info.xy.add(grid.mul(info.z))
  const height = terrain.height(root)
  const position = vec3(root.x, height, root.y)
  const world = varying(position)
  const nodeLevel = varying(info.w)
  const lodView = uniform(false)
  const shade = Fn(() => {
    const surface = terrain.surface(world.xz)
    const base = terrain.normal(surface)
    const distance = length(world.sub(eye))
    const variation = landscapeNoise(world.xz.mul(0.045), 21)
    const macro = landscapeNoise(world.xz.mul(0.011), 23).mul(0.6).add(landscapeNoise(world.xz.mul(0.06), 29).mul(0.4))
    const slope = float(1).sub(base.y)
    const forest = smoothstep(0.3, 0.75, surface.b.add(variation.sub(0.5).mul(0.25)))
    const path = smoothstep(0.25, 0.65, surface.a.add(variation.sub(0.5).mul(0.2)))
    const rock = smoothstep(0.24, 0.42, slope.add(macro.sub(0.5).mul(0.12))).mul(float(1).sub(smoothstep(0.3, 0.6, surface.b).mul(0.85)))
    const rawWeights = vec4(float(1).sub(forest).mul(float(1).sub(path)).mul(float(1).sub(rock)), forest.mul(float(1).sub(path)).mul(float(1).sub(rock)), path.mul(float(1).sub(rock)), rock)
    const weights = rawWeights.div(max(dot(rawWeights, vec4(1)), 1e-4))
    const average = vec3(0).toVar()
    const roughness = float(0).toVar()
    for (let layer = 0; layer < 4; layer++) {
      const spec = options.layerSpecs[layer]!
      average.addAssign(vec3(...options.layers.averages[layer]!).mul(vec3(...spec.tint)).mul(weights.element(layer)))
      roughness.addAssign(weights.element(layer).mul(spec.roughness))
    }
    const detail = float(1).sub(smoothstep((options.detailDistance ?? 260) * 0.3, options.detailDistance ?? 260, distance))
    const albedo = average.toVar()
    const detailNormal = vec3(0, 0, 1).toVar()
    If(detail.greaterThan(0), () => {
      const sampledColor = vec3(0).toVar()
      const sampledNormal = vec3(0).toVar()
      for (let layer = 0; layer < 4; layer++) {
        const spec = options.layerSpecs[layer]!
        const weight = weights.element(layer)
        const uv = world.xz.div(spec.tile)
        const color = tileSample(options.layers.color, uv, layer, vec4(vec3(...options.layers.averages[layer]!), 1))
        const normal = tileSample(options.layers.normal, uv, layer, vec4(0.5, 0.5, 1, 1)).xyz.mul(2).sub(1)
        sampledColor.addAssign(color.rgb.mul(vec3(...spec.tint)).mul(weight))
        sampledNormal.addAssign(vec3(normal.xy.mul(spec.normalScale), normal.z).mul(weight))
      }
      albedo.assign(mix(average, sampledColor, detail))
      detailNormal.assign(normalize(mix(vec3(0, 0, 1), sampledNormal, detail)))
    })
    albedo.mulAssign(macro.mul(0.36).add(0.82))
    const dry = smoothstep(0.45, 0.85, landscapeNoise(world.xz.mul(0.018), 31).mul(0.7).add(landscapeNoise(world.xz.mul(0.09), 37).mul(0.3)))
    albedo.assign(mix(albedo, albedo.mul(vec3(1.3, 1.04, 0.6)), dry.mul(weights.x).mul(0.7)))
    if (options.cover) {
      const ground = options.cover.ground({ root: world.xz, surface, slope, ground: world.y, distance })
      const mottle = landscapeNoise(world.xz.mul(1.9), 41).mul(0.6).add(landscapeNoise(world.xz.mul(5.3), 43).mul(0.4)).sub(0.5).mul(0.36).mul(detail)
      albedo.assign(mix(albedo, ground.rgb.mul(mottle.add(1)), ground.a))
      detailNormal.assign(normalize(mix(detailNormal, vec3(0, 0, 1), ground.a)))
    }
    const tangent = normalize(cross(base, vec3(0, 0, 1)))
    const bitangent = cross(tangent, base)
    const normal = normalize(tangent.mul(detailNormal.x).sub(bitangent.mul(detailNormal.y)).add(base.mul(detailNormal.z)))
    return mat3(albedo, normal, vec3(roughness, 0, 0))
  })().toVar()
  const debug = select(nodeLevel.lessThan(0.5), color('#62d995'), select(nodeLevel.lessThan(1.5), color('#f2c45a'), color('#80a6ff')))
  const material = new MeshStandardNodeMaterial({ name: 'world-terrain', roughness: 1, metalness: 0, envMapIntensity: 0.55 })
  material.positionNode = Fn(() => {
    normalLocal.assign(terrain.normal(terrain.surface(root, 0)))
    return position
  })()
  material.colorNode = shade.element(0)
  material.outputNode = vec4(select(lodView, debug, output.rgb), output.a)
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(shade.element(1), 0)).xyz)
  material.roughnessNode = shade.element(2).x
  return { material, lodView }
}
