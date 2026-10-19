import { Color, DoubleSide, FrontSide, Vector3 } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { attribute, cameraViewMatrix, cameraPosition, clamp, cos, dFdx, dFdy, dot, float, fwidth, length, max, mix, normalize, normalGeometry, positionGeometry, pow, select, sin, smoothstep, texture, uint, uniform, uv, varying, vec2, vec3, vec4 } from 'three/tsl'
import type { CoverFamily, CoverSun } from './cover'
import type { TerrainUniforms } from './terrain'
import type { Wind } from './wind'
import { createTerrainNodes, createWindNodes, landscapeNoise } from './nodes'

export function createCoverMaterial(family: CoverFamily, options: {
  terrain: TerrainUniforms
  wind: Wind
  viewer: Vector3
  sun: CoverSun
  near: number
  end: number
  patchSize: number
  alphaToCoverage: boolean
  albedo: readonly number[]
}) {
  const terrain = createTerrainNodes(options.terrain)
  const wind = createWindNodes(options.wind)
  const viewer = uniform(options.viewer)
  const blade = attribute('coverBlade', 'vec3')
  const random = attribute('coverRandom', 'vec4')
  const patch = attribute('coverPatch', 'vec3')
  const seed = uint(patch.z)
  const initial = blade.xy.sub(options.patchSize * 0.5)
  const rotated = select(seed.bitAnd(uint(1)).equal(uint(1)), vec2(initial.y.negate(), initial.x), initial)
  const turned = select(seed.bitAnd(uint(2)).equal(uint(2)), rotated.negate(), rotated)
  const local = vec2(select(seed.bitAnd(uint(4)).equal(uint(4)), turned.x.negate(), turned.x), turned.y)
  const root = patch.xy.add(options.patchSize * 0.5).add(local)
  const ground = terrain.height(root)
  const surface = terrain.surface(root, 0)
  const slope = float(1).sub(terrain.normal(surface).y)
  const distance = length(vec3(root.x, ground, root.y).sub(viewer))
  const thin = float(options.near).div(max(distance, options.near))
  const reach = thin.mul(float(1).sub(smoothstep(options.end * 0.75, options.end, distance)))
  const sample = { root, surface, slope, ground, distance }
  const mask = clamp(family.mask(sample), 0, 1)
  const density = mask.mul(reach)
  const keep = clamp(density.mul(1.15).sub(blade.z).div(max(density.mul(0.15), 1e-5)), 0, 1)
  const scale = mix(family.size[0], family.size[1], random.y).mul(keep).mul(max(family.height?.(sample) ?? float(1), 0))
  const p = positionGeometry.mul(vec3(scale.div(thin), scale, scale.div(thin)))
  const c = cos(random.x)
  const s = sin(random.x)
  const xz = vec2(c.mul(p.x).sub(s.mul(p.z)), s.mul(p.x).add(c.mul(p.z)))
  const height = clamp(positionGeometry.y, 0, 1)
  const strength = wind.sample(root)
  const flutter = sin(wind.time.mul(float(2.3).add(random.w.mul(1.7))).add(random.w.mul(6.283)).add(dot(root, vec2(0.7, 0.4)))).mul(float(0.25).add(strength.mul(0.35)))
  const bend = wind.direction.mul(strength).add(vec2(wind.direction.y.negate(), wind.direction.x).mul(flutter).mul(0.35)).mul(family.bend ?? 0).mul(height.mul(height)).mul(scale)
  const position = vec3(root.x.add(xz.x).add(bend.x), ground.add(p.y).sub(length(bend).mul(0.35).mul(height)), root.y.add(xz.y).add(bend.y))
  const data = varying(vec3(height, random.z, distance))
  const worldRoot = varying(root)
  const palette = [0, 1, 2].map(index => vec3(...(family.colors[Math.min(index, family.colors.length - 1)] ?? [1, 1, 1])))
  const tone = landscapeNoise(worldRoot.mul(0.035), 61).mul(0.7).add(landscapeNoise(worldRoot.mul(0.12), 67).mul(0.3))
  const tint = mix(mix(palette[0]!, palette[1]!, smoothstep(0.25, 0.75, tone)), palette[2]!, smoothstep(0.62, 0.95, data.y).mul(0.85)).mul(data.y.mul(0.24).add(0.88))
  const rootShade = mix(family.ao ?? 0.5, 1, smoothstep(0, 0.85, data.x))
  const texel = family.texture ? texture(family.texture, uv()) : vec4(1)
  const textureSize = (family.texture?.image as { width?: number; height?: number } | undefined)
  const texelUv = uv().mul(vec2(textureSize?.width ?? 256, textureSize?.height ?? 256))
  const footprint = max(dFdx(texelUv).abs(), dFdy(texelUv).abs())
  const mip = max(max(footprint.x, footprint.y).log2(), 0)
  const coverage = family.texture ? texel.a.mul(mip.mul(0.3).add(1)) : float(1)
  const albedo = family.texture?.premultiplyAlpha ? texel.rgb.div(max(texel.a, 1e-4)) : texel.rgb
  const color = family.texture ? mix(albedo.mul(rootShade), vec3(options.albedo[0]!, options.albedo[1]!, options.albedo[2]!), smoothstep(4, 6, mip)).mul(tint) : tint.mul(rootShade)
  const alphaToCoverage = Boolean(family.texture && options.alphaToCoverage)
  const opacity = alphaToCoverage ? clamp(coverage.sub(0.5).div(max(fwidth(coverage), 1e-4)).add(0.5), 0, 1) : coverage
  const material = new MeshStandardNodeMaterial({
    name: `world-cover-${family.name}`,
    color: new Color(1, 1, 1),
    roughness: family.roughness ?? 0.85,
    metalness: 0,
    side: family.shape === 'pebble' ? FrontSide : DoubleSide,
    alphaToCoverage,
    alphaTest: alphaToCoverage ? 0.02 : family.texture ? 0.5 : 0,
  })
  material.positionNode = position
  material.colorNode = color
  material.opacityNode = opacity
  const normal = family.shape === 'pebble'
    ? vec3(c.mul(normalGeometry.x).sub(s.mul(normalGeometry.z)), normalGeometry.y, s.mul(normalGeometry.x).add(c.mul(normalGeometry.z)))
    : normalize(mix(vec3(0, 1, 0), terrain.normal(terrain.surface(patch.xy.add(options.patchSize * 0.5), 2)), 0.7))
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(varying(normal), 0)).xyz)
  if ((family.translucency ?? 0) > 0) {
    const back = pow(max(dot(normalize(varying(position).sub(cameraPosition)), uniform(options.sun.direction)), 0), 3)
    material.emissiveNode = color.mul(uniform(options.sun.color)).mul(family.translucency ?? 0).mul(back.mul(0.85).add(0.15)).mul(data.x)
  }
  return material
}
