import type { Node, Texture } from 'three/webgpu'
import { Fn, If, clamp, dot, float, floor, fract, ivec2, max, min, mix, normalize, sin, smoothstep, sqrt, texture, textureLoad, uniform, vec2, vec3, wgslFn } from 'three/tsl'
import type { TerrainUniforms } from './terrain'
import type { Wind } from './wind'

export const landscapeHashFunction = wgslFn(`
fn landscapeHash(cell: vec2i, seed: u32) -> f32 {
  let x = bitcast<u32>(cell.x);
  let z = bitcast<u32>(cell.y);
  var h = ((x ^ 0x27d4eb2du) * 0x165667b1u) ^ ((z + seed * 0x9e3779b9u) * 0x85ebca77u);
  h = (h ^ (h >> 15u)) * 0x2c1b3c6du;
  h = (h ^ (h >> 12u)) * 0x297a2d39u;
  h = h ^ (h >> 15u);
  return f32(h) / 4294967296.0;
}`)

export function element<T extends string = 'vec4'>(node: unknown, index: number | Node): Node<T> {
  return (node as { element(index: number | Node): Node<T> }).element(index)
}

export const landscapeHash = (cell: Node<'vec2'> | Node<'ivec2'>, seed: Node<'uint'> | number) => float(landscapeHashFunction(ivec2(cell), seed as Node<'uint'>) as Node<'float'>)

export const landscapeNoise = Fn(([p, seed]: [Node<'vec2'>, Node<'uint'> | number]) => {
  const i = floor(p)
  const f = p.sub(i)
  const u = f.mul(f).mul(float(3).sub(f.mul(2)))
  const a = landscapeHash(i, seed)
  const b = landscapeHash(i.add(vec2(1, 0)), seed)
  const c = landscapeHash(i.add(vec2(0, 1)), seed)
  const d = landscapeHash(i.add(vec2(1, 1)), seed)
  return a.add(b.sub(a).mul(u.x)).add(c.sub(a).mul(u.y)).add(a.sub(b).sub(c).add(d).mul(u.x).mul(u.y))
})

export const landscapeDither = Fn(([pixel]: [Node<'vec2'>]) => fract(fract(dot(pixel, vec2(0.06711056, 0.00583715))).mul(52.9829189)))

export function createWindNodes(wind: Wind, timeNode?: Node<'float'>) {
  const direction = uniform(wind.uniforms.windDirection.value)
  const params = uniform(wind.uniforms.windParams.value)
  const time = timeNode ?? uniform(wind.time).onFrameUpdate(() => wind.time)
  const gust = Fn(([root]: [Node<'vec2'>]) => {
    const p = root.sub(direction.mul(time).mul(params.w)).div(params.z)
    return smoothstep(0.42, 0.86, landscapeNoise(p, 7).mul(0.65).add(landscapeNoise(p.mul(2.7).add(3.1), 11).mul(0.35)))
  })
  const sample = Fn(([root]: [Node<'vec2'>]) => {
    const sway = sin(time.mul(0.7).add(dot(root, direction).mul(0.02))).mul(0.25).add(0.75)
    return params.x.mul(sway).add(params.y.mul(gust(root)))
  })
  return { direction, params, time, gust, sample }
}

export function createTerrainNodes(source: TerrainUniforms) {
  const near = uniform(source.terrainNear.value)
  const far = uniform(source.terrainFar.value)
  const band = uniform(source.terrainBand.value)
  const weight = Fn(([root]: [Node<'vec2'>]) => {
    const u = root.sub(near.xy)
    return smoothstep(0, band, min(min(u.x, u.y), min(near.z.sub(u.x), near.z.sub(u.y))))
  })
  const fetchTexel = (image: Texture, info: Node<'vec4'>, root: Node<'vec2'>) => {
    const g = clamp(root.sub(info.xy).div(info.z).mul(info.w.sub(1)), vec2(0), vec2(info.w.sub(1.001)))
    const i = ivec2(floor(g))
    const f = fract(g)
    const a = textureLoad(image, i)
    const b = textureLoad(image, i.add(ivec2(1, 0)))
    const c = textureLoad(image, i.add(ivec2(0, 1)))
    const d = textureLoad(image, i.add(ivec2(1, 1)))
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y)
  }
  const fetchHeight = (image: Texture, info: Node<'vec4'>, root: Node<'vec2'>) => fetchTexel(image, info, root).r
  const height = Fn(([root]: [Node<'vec2'>]) => {
    const w = weight(root)
    const value = fetchHeight(source.terrainHeightFar.value, far, root).toVar()
    If(w.greaterThan(0), () => { value.assign(mix(value, fetchHeight(source.terrainHeightNear.value, near, root), w)) })
    return value
  })
  const uv = (info: Node<'vec4'>, root: Node<'vec2'>) => root.sub(info.xy).div(info.z).mul(info.w.sub(1)).add(0.5).div(info.w)
  const surface = (root: Node<'vec2'>, level?: Node<'float'> | number) => {
    const farSample = texture(source.terrainSurfaceFar.value, uv(far, root))
    const nearSample = texture(source.terrainSurfaceNear.value, uv(near, root))
    if (level === undefined) return mix(farSample, nearSample, weight(root))
    const lod = typeof level === 'number' ? float(level) : level
    return mix(farSample.level(lod), nearSample.level(lod), weight(root))
  }
  const nearHeight = Fn(([root]: [Node<'vec2'>]) => fetchHeight(source.terrainHeightNear.value, near, root))
  const nearSurface = (root: Node<'vec2'>) => fetchTexel(source.terrainSurfaceNear.value, near, root)
  const normal = Fn(([sample]: [Node<'vec4'>]) => {
    const xz = sample.xy.mul(2).sub(1)
    return normalize(vec3(xz.x, sqrt(max(float(1).sub(dot(xz, xz)), 0.02)), xz.y))
  })
  return { near, far, band, height, surface, normal, nearHeight, nearSurface }
}

export interface CoverSample {
  readonly root: Node<'vec2'>
  readonly surface: Node<'vec4'>
  readonly slope: Node<'float'>
  readonly ground: Node<'float'>
  readonly distance: Node<'float'>
}

export type CoverMask = (sample: CoverSample) => Node<'float'>
export type CoverGround = (sample: CoverSample) => Node<'vec4'>
