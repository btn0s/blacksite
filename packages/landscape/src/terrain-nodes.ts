import { MeshStandardNodeMaterial, type Node } from 'three/webgpu'
import { Fn, If, attribute, cameraViewMatrix, clamp, color, cross, dFdx, dFdy, dot, float, floor, fract, int, length, mat3, max, mix, normalize, normalLocal, output, positionGeometry, screenCoordinate, select, sin, smoothstep, texture, uniform, uniformArray, varying, vec2, vec3, vec4 } from 'three/tsl'
import type { Vector2, Vector3, DataArrayTexture } from 'three'
import type { TerrainOptions, TerrainUniforms } from './terrain'
import { createTerrainNodes, element, landscapeDither, landscapeNoise } from './nodes'
import { canopyCoverage, canopySurface } from './canopy-nodes'
import { forestRepresentationWeight } from './forest-coverage'
import { groundLayers, groundTone } from './ground'

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
  const band = morphs.element(int(info.w.add(0.5))) as unknown as Node<'vec2'>
  const factor = clamp(initialDistance.sub(band.x).div(max(band.y.sub(band.x), 1)), 0, 1)
  const grid = positionGeometry.xz.sub(fract(positionGeometry.xz.mul(0.5)).mul(2).mul(factor))
  const root = info.xy.add(grid.mul(info.z))
  const height = terrain.height(root)
  const distance = length(vec3(root.x, height, root.y).sub(eye))
  const canopy = options.canopy
  const canopyBlend = canopy ? float(1).sub(forestRepresentationWeight(canopy.forest, root, distance)) : float(0)
  const canopyWeight = canopy ? canopyCoverage(terrain.surface(root, 0).b, canopy).mul(canopyBlend) : float(0)
  const position = vec3(root.x, height.add(canopyWeight.mul(canopy?.height ?? 0)), root.y)
  const world = varying(position)
  const nodeLevel = varying(info.w)
  const lodView = uniform(false)
  const shade = Fn(() => {
    const surface = terrain.surface(world.xz)
    const base = terrain.normal(surface)
    const distance = length(world.sub(eye))
    const slope = float(1).sub(base.y)
    const { weights, macro, average, roughness } = groundLayers(options.layers.averages, options.layerSpecs, world.xz, surface, base)
    const detail = float(1).sub(smoothstep((options.detailDistance ?? 260) * 0.3, options.detailDistance ?? 260, distance))
    const albedo = average.toVar()
    const detailNormal = vec3(0, 0, 1).toVar()
    If(detail.greaterThan(0), () => {
      const sampledColor = vec3(0).toVar()
      const sampledNormal = vec3(0).toVar()
      for (let layer = 0; layer < 4; layer++) {
        const spec = options.layerSpecs[layer]!
        const weight = element<'float'>(weights, layer)
        const uv = world.xz.div(spec.tile)
        const color = tileSample(options.layers.color, uv, layer, vec4(vec3(...options.layers.averages[layer]!), 1))
        const normal = tileSample(options.layers.normal, uv, layer, vec4(0.5, 0.5, 1, 1)).xyz.mul(2).sub(1)
        sampledColor.addAssign(color.rgb.mul(vec3(...spec.tint)).mul(weight))
        sampledNormal.addAssign(vec3(normal.xy.mul(spec.normalScale), normal.z).mul(weight))
      }
      albedo.assign(mix(average, sampledColor, detail))
      detailNormal.assign(normalize(mix(vec3(0, 0, 1), sampledNormal, detail)))
    })
    albedo.assign(groundTone(albedo, world.xz, macro, weights))
    if (options.cover) {
      const ground = options.cover.ground({ root: world.xz, surface, slope, ground: world.y, distance })
      const mottle = landscapeNoise(world.xz.mul(1.9), 41).mul(0.6).add(landscapeNoise(world.xz.mul(5.3), 43).mul(0.4)).sub(0.5).mul(0.36).mul(detail)
      albedo.assign(mix(albedo, ground.rgb.mul(mottle.add(1)), ground.a))
      detailNormal.assign(normalize(mix(detailNormal, vec3(0, 0, 1), ground.a)))
    }
    const tangent = normalize(cross(base, vec3(0, 0, 1)))
    const bitangent = cross(tangent, base)
    const normal = normalize(tangent.mul(detailNormal.x).sub(bitangent.mul(detailNormal.y)).add(base.mul(detailNormal.z))).toVar()
    if (canopy) {
      const transition = float(1).sub(forestRepresentationWeight(canopy.forest, world.xz, length(vec3(world.x, terrain.height(world.xz), world.z).sub(eye))))
      If(transition.greaterThan(0), () => {
        const crown = canopySurface(world, base, eye, canopy)
        const coverage = canopyCoverage(surface.b, canopy)
        const handover = select(landscapeDither(screenCoordinate.xy).greaterThanEqual(float(1).sub(transition)), 1, 0).mul(coverage)
        albedo.assign(mix(albedo, crown.albedo, handover))
        normal.assign(normalize(mix(normal, crown.normal, handover)))
        roughness.assign(mix(roughness, 0.96, handover))
      })
    }
    return mat3(albedo, normal, vec3(roughness, 0, 0))
  })().toVar()
  const debug = select(nodeLevel.lessThan(0.5), color('#62d995'), select(nodeLevel.lessThan(1.5), color('#f2c45a'), color('#80a6ff')))
  const material = new MeshStandardNodeMaterial({ name: 'world-terrain', roughness: 1, metalness: 0, envMapIntensity: 0.55 })
  material.positionNode = Fn(() => {
    normalLocal.assign(terrain.normal(terrain.surface(root, 0)))
    return position
  })()
  material.colorNode = element<'vec3'>(shade, 0)
  material.outputNode = vec4(select(lodView, debug, output.rgb) as Node<'vec3'>, output.a)
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(element<'vec3'>(shade, 1), 0)).xyz)
  material.roughnessNode = element<'vec3'>(shade, 2).x
  return { material, lodView }
}
