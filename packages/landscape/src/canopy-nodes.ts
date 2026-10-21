import type { Node } from 'three/webgpu'
import { clamp, cross, dFdx, dFdy, dot, exp2, float, floor, fwidth, length, log2, mat3, max, min, mix, normalize, screenCoordinate, select, sign, smoothstep, uint, vec3, wgslFn } from 'three/tsl'
import type { CanopySpec } from './terrain'
import { element, landscapeDither, landscapeHashFunction, landscapeNoise } from './nodes'

const crowns = wgslFn(`
fn landscapeCrowns(p: vec2f, salt: u32, view: vec3f) -> mat3x3f {
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
      let radius = 0.46 + 0.22 * landscapeHash(id, salt + 4u);
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
  if (cover < 0.0) { return mat3x3f(vec3f(0.0, 1.0, 0.0), vec3f(result.w, cover, 0.0), vec3f(0.0)); }
  let c = vec3f(-along.x * cosine, sine, -along.y * cosine);
  let u = vec3f(along.x * sine, cosine, along.y * sine);
  let s = vec3f(side.x, 0.0, side.y);
  return mat3x3f(normalize(s * result.x + u * result.y + c * result.z), vec3f(result.w, cover, 0.0), vec3f(0.0));
}`, [landscapeHashFunction as never])

export function canopyCoverage(density: Node<'float'>, spec: CanopySpec) {
  return float(1).sub(density.clamp(0, 1).mul(-Math.PI * spec.crown * spec.crown * spec.forest.densityScale / (spec.forest.spacing * spec.forest.spacing)).exp())
}

export function canopySurface(world: Node<'vec3'>, base: Node<'vec3'>, eye: Node<'vec3'>, spec: CanopySpec) {
  const rawLevel = log2(max(length(fwidth(world.xz)), 0.001).div(spec.crown * 0.4))
  const relief = float(1).sub(smoothstep(2.8, 4.5, rawLevel))
  const level = clamp(rawLevel, 0, 3)
  const low = min(floor(level), 2)
  const fraction = level.sub(low)
  const scale = exp2(low).mul(spec.crown * 1.4)
  const toEye = eye.sub(world)
  const away = toEye.xz.negate().div(max(length(toEye.xz), 0.001))
  const geometric = normalize(cross(dFdx(world), dFdy(world)))
  const upward = geometric.mul(sign(geometric.y.add(0.0001)))
  const viewDirection = normalize(toEye)
  const steep = smoothstep(0.25, 0.65, float(1).sub(min(upward.y, base.y)))
  const view = vec3(away, clamp(max(max(dot(viewDirection, base), dot(viewDirection, upward)), mix(0.3, 0.75, steep)), 0, 1))
  const pick = select(landscapeDither(screenCoordinate.xy).greaterThanEqual(fraction), 0, 1)
  const first = mat3(crowns(world.xz.div(spec.dither ? scale.mul(exp2(pick)) : scale), uint(low.add(spec.dither ? pick : 0)).mul(13).add(61), view) as Node<'mat3'>)
  const second = spec.dither ? first : mat3(crowns(world.xz.div(scale.mul(2)), uint(low).mul(13).add(74), view) as Node<'mat3'>)
  const normal = normalize(mix(element<'vec3'>(first, 0), element<'vec3'>(second, 0), spec.dither ? 0 : fraction))
  const shape = mix(element<'vec3'>(first, 1), element<'vec3'>(second, 1), spec.dither ? 0 : fraction)
  const stand = landscapeNoise(world.xz.div(110), 509)
  const broadleafChance = float(spec.broadleaf ?? 0.22).mul(mix(1.2, 0.65, stand))
  const broadleaf = smoothstep(float(1).sub(broadleafChance).sub(0.025), float(1).sub(broadleafChance).add(0.025), shape.x)
  const foliage = mix(vec3(...spec.colors[0]), vec3(...spec.colors[1]), broadleaf)
  const cellShade = smoothstep(-0.1, 0.8, shape.y).mul(0.5).add(0.5)
  const albedo = foliage.mul(mix(0.82, cellShade, relief)).mul(stand.mul(0.22).add(0.89))
  return { albedo, normal: normalize(mix(base, normal, relief.mul(0.76))) }
}
