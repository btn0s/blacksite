import { Vector3 } from 'three'
import { MeshStandardNodeMaterial, type Node } from 'three/webgpu'
import { Fn, If, attribute, cameraPosition, cameraViewMatrix, clamp, color, cross, dFdx, dFdy, dot, exp2, float, floor, fract, fwidth, int, length, log2, mat3, max, min, mix, normalize, normalLocal, output, positionGeometry, screenCoordinate, select, sign, sin, smoothstep, texture, uint, uniform, uniformArray, varying, vec2, vec3, vec4, wgslFn } from 'three/tsl'
import type { Vector2, DataArrayTexture } from 'three'
import type { TerrainOptions, TerrainUniforms } from './terrain'
import { createTerrainNodes, landscapeDither, landscapeHashFunction, landscapeNoise } from './nodes'

const crowns = wgslFn(`
fn landscapeCrowns(p: vec2f, salt: u32, view: vec3f, fill: f32) -> mat3x3f {
  let cell = floor(p);
  let local = p - cell;
  let along = view.xy;
  let side = vec2f(-along.y, along.x);
  let sine = view.z;
  let cosine = sqrt(max(1.0 - sine * sine, 0.0));
  let squash = max(sine, 0.3);
  let stretch = vec2f(sqrt(squash), inverseSqrt(squash));
  var top = -1e9;
  var cover = -1.0;
  var result = vec4f(0.0, 1.0, 0.0, 0.5);
  for (var j = -1; j <= 1; j++) {
    for (var i = -1; i <= 1; i++) {
      let id = vec2i(cell) + vec2i(i, j);
      let centre = vec2f(f32(i), f32(j)) + 0.2 + 0.6 * vec2f(landscapeHash(id, salt), landscapeHash(id, salt + 2u));
      let radius = (0.4 + 0.3 * landscapeHash(id, salt + 4u)) * fill;
      let r = local - centre;
      let e = vec2f(dot(r, side), dot(r, along)) / (radius * stretch);
      let d2 = dot(e, e);
      let z = sqrt(max(1.0 - d2, 0.0));
      let depth = (z * radius + landscapeHash(id, salt + 6u) * 0.35) * sine - dot(centre, along) * cosine;
      if (d2 < 1.0 && depth > top) {
        top = depth;
        cover = z;
        result = vec4f(e, max(z, 0.14), landscapeHash(id, salt + 8u));
      }
    }
  }
  if (cover < 0.0) { return mat3x3f(result.xyz, vec3f(result.w, cover, 0.0), vec3f(0.0)); }
  let c = vec3f(-along.x * cosine, sine, -along.y * cosine);
  let u = vec3f(along.x * sine, cosine, along.y * sine);
  let s = vec3f(side.x, 0.0, side.y);
  return mat3x3f(normalize(s * result.x + u * result.y + c * result.z), vec3f(result.w, cover, 0.0), vec3f(0.0));
}`, [landscapeHashFunction])

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
  const distance = length(vec3(root.x, height, root.y).sub(eye))
  const canopy = options.canopy
  const canopyWeight = smoothstep(0.35, 0.75, terrain.surface(root, 2).b).mul(smoothstep(canopy.start, canopy.end, distance))
  const position = vec3(root.x, height.add(canopyWeight.mul(canopy.height)), root.y)
  const world = varying(position)
  const canopyAmount = varying(canopyWeight)
  const nodeLevel = varying(info.w)
  const lodView = uniform(false)
  const sunDirection = uniform(new Vector3(0.4, 0.8, 0.3).normalize())
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
    const normal = normalize(tangent.mul(detailNormal.x).sub(bitangent.mul(detailNormal.y)).add(base.mul(detailNormal.z))).toVar()
    If(canopyAmount.greaterThan(0.001), () => {
      const footprint = length(fwidth(world.xz))
      const rawLevel = log2(footprint.div(canopy.crown * 0.3))
      const lumpFade = float(1).sub(smoothstep(3.6, 4.8, rawLevel))
      const level = clamp(rawLevel, 0, 3)
      const low = min(floor(level), 2)
      const fraction = level.sub(low)
      const scale = exp2(low).mul(canopy.crown)
      const toEye = cameraPosition.sub(world)
      const away = toEye.xz.negate().div(max(length(toEye.xz), 1e-3))
      const geometric = normalize(cross(dFdx(world), dFdy(world))).toVar()
      geometric.mulAssign(sign(geometric.y.add(1e-4)))
      const viewDirection = toEye.div(max(length(toEye), 1e-3))
      const steep = smoothstep(0.25, 0.65, float(1).sub(min(geometric.y, base.y)))
      const view = vec3(away, clamp(max(max(dot(viewDirection, base), dot(viewDirection, geometric)), mix(0.3, 0.75, steep)), 0, 1))
      const stand = smoothstep(0.42, 0.62, landscapeNoise(world.xz.mul(0.0024), 91))
      const light = smoothstep(0.5, 0.72, landscapeNoise(world.xz.mul(0.0041), 93)).mul(float(1).sub(stand))
      const fill = mix(0.78, 1.08, landscapeNoise(world.xz.mul(0.0031), 95))
      const pick = select(landscapeDither(screenCoordinate).greaterThanEqual(fraction), 1, 0)
      const c0 = mat3(crowns(world.xz.div(canopy.dither ? scale.mul(pick.add(1)) : scale), uint(low).mul(13).add(canopy.dither ? select(pick.greaterThan(0.5), uint(74), uint(61)) : uint(61)), view, fill))
      const c1 = canopy.dither ? c0 : mat3(crowns(world.xz.div(scale.mul(2)), uint(low).mul(13).add(74), view, fill))
      const lump = normalize(mix(c0.element(0), c1.element(0), fraction))
      const top = mix(c0.element(1).y, c1.element(1).y, fraction)
      const rim = mix(max(c0.element(1).y, 0), max(c1.element(1).y, 0), fraction)
      const tone = mix(fract(c0.element(1).x), fract(c1.element(1).x), fraction)
      const covered = smoothstep(-0.6, 0.2, top)
      const relief = float(1).div(level.mul(0.3).add(1))
      const canopyNormal = normalize(mix(base, lump, covered.mul(0.68).add(0.15).mul(lumpFade).mul(relief).add(0.1)))
      const sunSide = smoothstep(-0.25, 0.55, dot(lump, sunDirection))
      const ao = mix(float(0.52).sub(relief.mul(0.48)), mix(0.16, 1, smoothstep(0, 0.75, rim)).mul(mix(0.28, 1, sunSide)), covered)
      const standColor = vec3(...canopy.color).mul(mix(mix(vec3(1), vec3(1.22, 1.16, 0.8), light), vec3(0.5, 0.68, 0.9), stand))
      const cellAlbedo = mix(vec3(...canopy.shade), standColor.mul(tone.mul(0.76).add(0.62)), ao)
      const meanAlbedo = mix(vec3(...canopy.shade), standColor.mul(0.95), fill.mul(0.5))
      const canopyAlbedo = mix(meanAlbedo, cellAlbedo, lumpFade).mul(macro.mul(0.3).add(0.85)).mul(mix(0.84, 1, smoothstep(canopy.start, canopy.end + 450, distance)))
      albedo.assign(mix(albedo, canopyAlbedo, canopyAmount))
      normal.assign(normalize(mix(normal, canopyNormal, canopyAmount)))
      roughness.assign(mix(roughness, 0.9, canopyAmount))
    })
    return mat3(albedo, normal, vec3(roughness, 0, 0))
  })().toVar()
  const debug = select(nodeLevel.lessThan(0.5), color('#62d995'), select(nodeLevel.lessThan(1.5), color('#f2c45a'), color('#80a6ff')))
  const material = new MeshStandardNodeMaterial({ name: 'world-terrain', roughness: 1, metalness: 0, envMapIntensity: 0.55 })
  material.positionNode = Fn(() => {
    normalLocal.assign(mix(terrain.normal(terrain.surface(root, 0)), vec3(0, 1, 0), canopyWeight))
    return position
  })()
  material.colorNode = shade.element(0)
  material.outputNode = vec4(select(lodView, debug, output.rgb), output.a)
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(shade.element(1), 0)).xyz)
  material.roughnessNode = shade.element(2).x
  return { material, lodView, sunDirection }
}
