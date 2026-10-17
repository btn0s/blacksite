import {
  BufferAttribute, BufferGeometry, Color, DataTexture, DynamicDrawUsage, Frustum, Group, InstancedBufferAttribute, InstancedMesh,
  Matrix4, MeshDepthMaterial, MeshStandardMaterial, RGBADepthPacking, Sphere, Vector2, Vector3, Vector4,
} from 'three'
import type { Camera, DataArrayTexture, Material } from 'three'
import { heightAt as fieldHeight, heightTexture, type Heightfield } from './heightfield'
import { patchMaterial, replaceChunk } from './patch'
import { NOISE_GLSL } from './wind'
import { ANTI_TILING_GLSL } from './tiling'

export interface TerrainSources {
  readonly near: Heightfield
  readonly far: Heightfield
  readonly nearSurface: DataTexture
  readonly farSurface: DataTexture
  readonly band?: number
}

export const TERRAIN_GLSL = /* glsl */ `
uniform sampler2D terrainHeightNear;
uniform sampler2D terrainHeightFar;
uniform sampler2D terrainSurfaceNear;
uniform sampler2D terrainSurfaceFar;
uniform vec4 terrainNear;
uniform vec4 terrainFar;
uniform float terrainBand;
float terrainFetch(sampler2D tex, vec4 info, vec2 xz) {
  float n = info.w;
  vec2 g = clamp((xz - info.xy) / info.z * (n - 1.0), vec2(0.0), vec2(n - 1.001));
  ivec2 i = ivec2(floor(g));
  vec2 f = g - vec2(i);
  float a = texelFetch(tex, i, 0).r;
  float b = texelFetch(tex, i + ivec2(1, 0), 0).r;
  float c = texelFetch(tex, i + ivec2(0, 1), 0).r;
  float d = texelFetch(tex, i + ivec2(1, 1), 0).r;
  return a + (b - a) * f.x + (c - a) * f.y + (a - b - c + d) * f.x * f.y;
}
float terrainNearWeight(vec2 xz) {
  vec2 u = xz - terrainNear.xy;
  float edge = min(min(u.x, u.y), min(terrainNear.z - u.x, terrainNear.z - u.y));
  return smoothstep(0.0, terrainBand, edge);
}
float terrainHeight(vec2 xz) {
  float w = terrainNearWeight(xz);
  float far = terrainFetch(terrainHeightFar, terrainFar, xz);
  if (w <= 0.0) return far;
  return mix(far, terrainFetch(terrainHeightNear, terrainNear, xz), w);
}
vec2 terrainUv(vec4 info, vec2 xz) {
  return ((xz - info.xy) / info.z * (info.w - 1.0) + 0.5) / info.w;
}
vec4 terrainSurfaceLod(vec2 xz, float lod) {
  float w = terrainNearWeight(xz);
  vec4 far = textureLod(terrainSurfaceFar, terrainUv(terrainFar, xz), lod);
  if (w <= 0.0) return far;
  return mix(far, textureLod(terrainSurfaceNear, terrainUv(terrainNear, xz), lod), w);
}
vec4 terrainSurface(vec2 xz) {
  float w = terrainNearWeight(xz);
  vec4 far = texture(terrainSurfaceFar, terrainUv(terrainFar, xz));
  vec4 near = texture(terrainSurfaceNear, terrainUv(terrainNear, xz));
  return mix(far, near, w);
}
vec3 terrainNormalOf(vec4 surface) {
  vec2 xz = surface.xy * 2.0 - 1.0;
  return normalize(vec3(xz.x, sqrt(max(1.0 - dot(xz, xz), 0.02)), xz.y));
}
`

export interface TerrainUniforms {
  terrainHeightNear: { value: DataTexture }
  terrainHeightFar: { value: DataTexture }
  terrainSurfaceNear: { value: DataTexture }
  terrainSurfaceFar: { value: DataTexture }
  terrainNear: { value: Vector4 }
  terrainFar: { value: Vector4 }
  terrainBand: { value: number }
  [name: string]: { value: unknown }
}

export function terrainUniforms(sources: TerrainSources): TerrainUniforms {
  const { near, far } = sources
  return {
    terrainHeightNear: { value: heightTexture(near) },
    terrainHeightFar: { value: heightTexture(far) },
    terrainSurfaceNear: { value: sources.nearSurface },
    terrainSurfaceFar: { value: sources.farSurface },
    terrainNear: { value: new Vector4(near.origin[0], near.origin[1], near.extent, near.size) },
    terrainFar: { value: new Vector4(far.origin[0], far.origin[1], far.extent, far.size) },
    terrainBand: { value: sources.band ?? 240 },
  }
}

export function terrainHeightAt(sources: TerrainSources, x: number, z: number): number {
  const { near, far } = sources
  const band = sources.band ?? 240
  const u = x - near.origin[0]
  const v = z - near.origin[1]
  const edge = Math.min(u, v, near.extent - u, near.extent - v)
  const t = Math.min(1, Math.max(0, edge / band))
  const w = t * t * (3 - 2 * t)
  const farHeight = fieldHeight(far, x, z)
  return w <= 0 ? farHeight : farHeight + (fieldHeight(near, x, z) - farHeight) * w
}

export interface TerrainLayerSpec {
  readonly tile: number
  readonly tint: readonly [number, number, number]
  readonly roughness: number
  readonly normalScale: number
}

export interface CanopySpec {
  readonly height: number
  readonly start: number
  readonly end: number
  readonly color: readonly [number, number, number]
  readonly shade: readonly [number, number, number]
  readonly crown: number
  readonly dither?: boolean
}

export interface TerrainOptions {
  readonly sources: TerrainSources
  readonly uniforms?: TerrainUniforms
  readonly layers: { readonly color: DataArrayTexture; readonly normal: DataArrayTexture; readonly averages: readonly (readonly [number, number, number])[] }
  readonly layerSpecs: readonly [TerrainLayerSpec, TerrainLayerSpec, TerrainLayerSpec, TerrainLayerSpec]
  readonly canopy: CanopySpec
  readonly leafSize?: number
  readonly grid?: number
  readonly rangeFactor?: number
  readonly detailDistance?: number
  readonly shadowDistance?: number
  readonly coverShade?: { readonly distance: number; readonly strength: number }
}

export interface Terrain {
  readonly object: Group
  readonly uniforms: TerrainUniforms
  readonly material: MeshStandardMaterial
  readonly materials: readonly Material[]
  readonly stats: { nodes: number }
  update(camera: Camera): void
  heightAt(x: number, z: number): number
  dispose(): void
}

function gridGeometry(cells: number) {
  const geometry = new BufferGeometry()
  const vertices = new Float32Array((cells + 1) * (cells + 1) * 3)
  let cursor = 0
  for (let j = 0; j <= cells; j++) for (let i = 0; i <= cells; i++) { vertices[cursor++] = i; vertices[cursor++] = 0; vertices[cursor++] = j }
  const indices = new Uint32Array(cells * cells * 6)
  cursor = 0
  for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
    const a = j * (cells + 1) + i
    const b = a + 1
    const c = a + cells + 1
    const d = c + 1
    if ((i + j) % 2 === 0) { indices.set([a, c, b, b, c, d], cursor) } else { indices.set([a, c, d, a, d, b], cursor) }
    cursor += 6
  }
  geometry.setAttribute('position', new BufferAttribute(vertices, 3))
  geometry.setIndex(new BufferAttribute(indices, 1))
  return geometry
}

const MAX_LEVELS = 14

const VERTEX_HEAD = /* glsl */ `
attribute vec4 nodeInfo;
uniform vec3 terrainViewer;
uniform vec2 terrainMorph[${MAX_LEVELS}];
uniform vec4 canopyParams;
varying vec3 vTerrainWorld;
varying float vTerrainCanopy;
`

const VERTEX_BODY = /* glsl */ `
vec2 bsGrid = position.xz;
vec2 bsXZ = nodeInfo.xy + bsGrid * nodeInfo.z;
float bsHeight = terrainHeight(bsXZ);
float bsDistance = distance(vec3(bsXZ.x, bsHeight, bsXZ.y), terrainViewer);
vec2 bsMorph = terrainMorph[int(nodeInfo.w + 0.5)];
float bsK = clamp((bsDistance - bsMorph.x) / max(bsMorph.y - bsMorph.x, 1.0), 0.0, 1.0);
bsGrid -= fract(bsGrid * 0.5) * 2.0 * bsK;
bsXZ = nodeInfo.xy + bsGrid * nodeInfo.z;
bsHeight = terrainHeight(bsXZ);
bsDistance = distance(vec3(bsXZ.x, bsHeight, bsXZ.y), terrainViewer);
float bsForest = terrainSurfaceLod(bsXZ, 2.0).b;
float bsCanopy = smoothstep(0.35, 0.75, bsForest) * smoothstep(canopyParams.y, canopyParams.z, bsDistance);
vTerrainCanopy = bsCanopy;
vec3 transformed = vec3(bsXZ.x, bsHeight + bsCanopy * canopyParams.x, bsXZ.y);
vTerrainWorld = transformed;
`

const FRAGMENT_HEAD = /* glsl */ `
uniform sampler2DArray layerColor;
uniform sampler2DArray layerNormal;
uniform vec4 layerTile;
uniform vec3 layerTint[4];
uniform vec3 layerAverage[4];
uniform vec4 layerRoughness;
uniform vec4 layerNormalScale;
uniform vec3 terrainViewer;
uniform vec4 canopyParams;
uniform vec3 canopyColor;
uniform vec3 canopyShade;
vec4 bsCrowns(vec2 p, uint salt, vec3 view, float fill, out float cover) {
  vec2 cell = floor(p);
  vec2 local = p - cell;
  vec2 along = view.xy;
  vec2 side = vec2(-along.y, along.x);
  float sine = view.z;
  float cosine = sqrt(max(1.0 - sine * sine, 0.0));
  float squash = max(sine, 0.3);
  vec2 stretch = vec2(sqrt(squash), inversesqrt(squash));
  float top = -1e9;
  cover = -1.0;
  vec4 result = vec4(0.0, 1.0, 0.0, 0.5);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    ivec2 id = ivec2(cell) + ivec2(i, j);
    vec2 centre = vec2(float(i), float(j)) + 0.2 + 0.6 * vec2(bsHash(id, salt), bsHash(id, salt + 2u));
    float radius = (0.4 + 0.3 * bsHash(id, salt + 4u)) * fill;
    vec2 r = local - centre;
    vec2 e = vec2(dot(r, side), dot(r, along)) / (radius * stretch);
    float d2 = dot(e, e);
    float z = sqrt(max(1.0 - d2, 0.0));
    float key = (z * radius + bsHash(id, salt + 6u) * 0.35) * sine - dot(centre, along) * cosine;
    if (d2 < 1.0 && key > top) { top = key; cover = z; result = vec4(e, max(z, 0.14), bsHash(id, salt + 8u)); }
  }
  if (cover < 0.0) return result;
  vec3 c = vec3(-along.x * cosine, sine, -along.y * cosine);
  vec3 u = vec3(along.x * sine, cosine, along.y * sine);
  vec3 s = vec3(side.x, 0.0, side.y);
  return vec4(normalize(s * result.x + u * result.y + c * result.z), result.w);
}
uniform float terrainDetail;
uniform vec2 terrainCoverShade;
varying vec3 vTerrainWorld;
varying float vTerrainCanopy;
`

const FRAGMENT_SPLAT = /* glsl */ `
vec4 bsSurface = terrainSurface(vTerrainWorld.xz);
vec3 bsBase = terrainNormalOf(bsSurface);
float bsDist = distance(vTerrainWorld, terrainViewer);
float bsVariation = bsNoise(vTerrainWorld.xz * 0.045, 21u);
float bsMacro = bsNoise(vTerrainWorld.xz * 0.011, 23u) * 0.6 + bsNoise(vTerrainWorld.xz * 0.06, 29u) * 0.4;
float bsSlope = 1.0 - bsBase.y;
vec4 bsWeights = vec4(1.0, 0.0, 0.0, 0.0);
bsWeights.y = smoothstep(0.3, 0.75, bsSurface.b + (bsVariation - 0.5) * 0.25);
bsWeights.z = smoothstep(0.25, 0.65, bsSurface.a + (bsVariation - 0.5) * 0.2);
bsWeights.w = smoothstep(0.24, 0.42, bsSlope + (bsMacro - 0.5) * 0.12) * (1.0 - 0.85 * smoothstep(0.3, 0.6, bsSurface.b));
bsWeights.x = 1.0;
bsWeights.x *= (1.0 - bsWeights.y);
bsWeights.y *= (1.0 - bsWeights.z);
bsWeights.x *= (1.0 - bsWeights.z);
bsWeights.xyz *= (1.0 - bsWeights.w);
bsWeights /= max(dot(bsWeights, vec4(1.0)), 1e-4);
vec3 bsAlbedo = vec3(0.0);
vec3 bsDetailNormal = vec3(0.0, 0.0, 1.0);
float bsRough = dot(bsWeights, layerRoughness);
float bsDetailFade = 1.0 - smoothstep(terrainDetail * 0.3, terrainDetail, bsDist);
if (bsDetailFade > 0.0) {
  vec3 tn = vec3(0.0);
  vec3 col = vec3(0.0);
  for (int layer = 0; layer < 4; layer++) {
    float w = bsWeights[layer];
    if (w < 0.01) continue;
    vec2 uv = vTerrainWorld.xz / layerTile[layer];
    BsTiles tiles = bsTilesAt(uv, float(layer));
    col += bsTileSample(layerColor, uv, float(layer), tiles, vec4(layerAverage[layer], 1.0)).rgb * layerTint[layer] * w;
    vec3 n = bsTileSample(layerNormal, uv, float(layer), tiles, vec4(0.5, 0.5, 1.0, 1.0)).xyz * 2.0 - 1.0;
    tn += vec3(n.xy * layerNormalScale[layer], n.z) * w;
  }
  vec3 avg = vec3(0.0);
  for (int layer = 0; layer < 4; layer++) avg += layerAverage[layer] * layerTint[layer] * bsWeights[layer];
  bsAlbedo = mix(avg, col, bsDetailFade);
  bsDetailNormal = normalize(mix(vec3(0.0, 0.0, 1.0), tn, bsDetailFade));
} else {
  for (int layer = 0; layer < 4; layer++) bsAlbedo += layerAverage[layer] * layerTint[layer] * bsWeights[layer];
}
bsAlbedo *= 0.82 + bsMacro * 0.36;
float bsDry = smoothstep(0.45, 0.85, bsNoise(vTerrainWorld.xz * 0.018, 31u) * 0.7 + bsNoise(vTerrainWorld.xz * 0.09, 37u) * 0.3);
bsAlbedo = mix(bsAlbedo, bsAlbedo * vec3(1.3, 1.04, 0.6), bsDry * bsWeights.x * 0.7);
bsAlbedo *= 1.0 - terrainCoverShade.y * bsWeights.x * (1.0 - smoothstep(terrainCoverShade.x * 0.55, terrainCoverShade.x, bsDist));
vec3 bsT = normalize(cross(bsBase, vec3(0.0, 0.0, 1.0)));
vec3 bsB = cross(bsT, bsBase);
vec3 bsWorldNormal = normalize(bsT * bsDetailNormal.x - bsB * bsDetailNormal.y + bsBase * bsDetailNormal.z);
if (vTerrainCanopy > 0.001) {
  float footprint = length(fwidth(vTerrainWorld.xz));
  float level = log2(footprint / (canopyParams.w * 0.3));
  float lumpFade = 1.0 - smoothstep(3.6, 4.8, level);
  level = clamp(level, 0.0, 3.0);
  float l0 = min(floor(level), 2.0);
  float lf = level - l0;
  float s0 = canopyParams.w * exp2(l0);
  vec3 bsToEye = cameraPosition - vTerrainWorld;
  vec2 bsAway = -bsToEye.xz / max(length(bsToEye.xz), 1e-3);
  vec3 bsGeo = normalize(cross(dFdx(vTerrainWorld), dFdy(vTerrainWorld)));
  bsGeo *= sign(bsGeo.y + 1e-4);
  vec3 bsEye = bsToEye / max(length(bsToEye), 1e-3);
  float bsSteep = smoothstep(0.25, 0.65, 1.0 - min(bsGeo.y, bsBase.y));
  vec3 bsView = vec3(bsAway, clamp(max(max(dot(bsEye, bsBase), dot(bsEye, bsGeo)), mix(0.3, 0.75, bsSteep)), 0.0, 1.0));
  float bsStand = smoothstep(0.42, 0.62, bsNoise(vTerrainWorld.xz * 0.0024, 91u));
  float bsLight = smoothstep(0.5, 0.72, bsNoise(vTerrainWorld.xz * 0.0041, 93u)) * (1.0 - bsStand);
  float bsFill = mix(0.78, 1.08, bsNoise(vTerrainWorld.xz * 0.0031, 95u));
  float k0;
  float k1;
#ifdef CANOPY_DITHER
  float pick = step(fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))), lf);
  vec4 c0 = bsCrowns(vTerrainWorld.xz / (s0 * (1.0 + pick)), pick > 0.5 ? 74u + uint(l0) * 13u : 61u + uint(l0) * 13u, bsView, bsFill, k0);
  vec4 c1 = c0;
  k1 = k0;
#else
  vec4 c0 = bsCrowns(vTerrainWorld.xz / s0, 61u + uint(l0) * 13u, bsView, bsFill, k0);
  vec4 c1 = bsCrowns(vTerrainWorld.xz / (s0 * 2.0), 74u + uint(l0) * 13u, bsView, bsFill, k1);
#endif
  vec3 lump = normalize(mix(c0.xyz, c1.xyz, lf));
  float top = mix(k0, k1, lf);
  float rim = mix(max(k0, 0.0), max(k1, 0.0), lf);
  float tone = mix(fract(c0.w), fract(c1.w), lf);
  float covered = smoothstep(-0.6, 0.2, top);
  float relief = 1.0 / (1.0 + level * 0.3);
  vec3 canopyNormal = normalize(mix(bsBase, lump, (0.68 * covered + 0.15) * lumpFade * relief + 0.1));
  float sunSide = 1.0;
#if NUM_DIR_LIGHTS > 0
  sunSide = smoothstep(-0.25, 0.55, dot(normalize((viewMatrix * vec4(lump, 0.0)).xyz), directionalLights[0].direction));
#endif
  float crownAo = mix(0.52 - 0.48 * relief, mix(0.16, 1.0, smoothstep(0.0, 0.75, rim)) * mix(0.28, 1.0, sunSide), covered);
  vec3 standColor = canopyColor * mix(mix(vec3(1.0), vec3(1.22, 1.16, 0.8), bsLight), vec3(0.5, 0.68, 0.9), bsStand);
  vec3 cellAlbedo = mix(canopyShade, standColor * (0.62 + tone * 0.76), crownAo);
  vec3 meanAlbedo = mix(canopyShade, standColor * 0.95, 0.5 * bsFill);
  vec3 canopyAlbedo = mix(meanAlbedo, cellAlbedo, lumpFade);
  canopyAlbedo *= (0.85 + bsMacro * 0.3) * mix(0.84, 1.0, smoothstep(canopyParams.y, canopyParams.z + 450.0, bsDist));
  bsAlbedo = mix(bsAlbedo, canopyAlbedo, vTerrainCanopy);
  bsWorldNormal = normalize(mix(bsWorldNormal, canopyNormal, vTerrainCanopy));
  bsRough = mix(bsRough, 0.9, vTerrainCanopy);
}
diffuseColor.rgb *= bsAlbedo;
`

export function createTerrain(options: TerrainOptions): Terrain {
  const { sources, layers, layerSpecs, canopy } = options
  const leafSize = options.leafSize ?? 32
  const grid = options.grid ?? 32
  const rangeFactor = options.rangeFactor ?? 2.4
  const far = sources.far
  const rootSize = (() => { let size = leafSize; while (size < far.extent) size *= 2; return size })()
  const maxLevel = Math.round(Math.log2(rootSize / leafSize))
  if (maxLevel + 1 > MAX_LEVELS) throw new Error(`Terrain needs ${maxLevel + 1} levels; at most ${MAX_LEVELS}`)
  const rootOrigin = new Vector2(far.origin[0] + far.extent / 2 - rootSize / 2, far.origin[1] + far.extent / 2 - rootSize / 2)
  const ranges = Array.from({ length: maxLevel + 1 }, (_, level) => level === maxLevel ? Infinity : leafSize * 2 ** level * rangeFactor)
  const morph = Array.from({ length: MAX_LEVELS }, (_, level) => {
    if (level > maxLevel) return new Vector2(1e9, 1e9 + 1)
    const end = level === maxLevel ? 1e9 : ranges[level]!
    const start = level === 0 ? end * 0.7 : ranges[level - 1]! + (end - ranges[level - 1]!) * 0.55
    return new Vector2(start, level === maxLevel ? 1e9 + 1 : end * 0.97)
  })

  const cellsPerSide = rootSize / leafSize
  const pyramid: { min: Float32Array; max: Float32Array; side: number }[] = []
  {
    const side = cellsPerSide
    const corners = new Float32Array((side + 1) * (side + 1))
    for (let j = 0; j <= side; j++) for (let i = 0; i <= side; i++) corners[j * (side + 1) + i] = terrainHeightAt(sources, rootOrigin.x + i * leafSize, rootOrigin.y + j * leafSize)
    const min = new Float32Array(side * side)
    const max = new Float32Array(side * side)
    for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) {
      const a = corners[j * (side + 1) + i]!
      const b = corners[j * (side + 1) + i + 1]!
      const c = corners[(j + 1) * (side + 1) + i]!
      const d = corners[(j + 1) * (side + 1) + i + 1]!
      const centre = terrainHeightAt(sources, rootOrigin.x + (i + 0.5) * leafSize, rootOrigin.y + (j + 0.5) * leafSize)
      min[j * side + i] = Math.min(a, b, c, d, centre) - 6
      max[j * side + i] = Math.max(a, b, c, d, centre) + 6 + canopy.height
    }
    pyramid.push({ min, max, side })
    let current = pyramid[0]!
    while (current.side > 1) {
      const next = current.side / 2
      const nmin = new Float32Array(next * next)
      const nmax = new Float32Array(next * next)
      for (let j = 0; j < next; j++) for (let i = 0; i < next; i++) {
        let lo = Infinity
        let hi = -Infinity
        for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) {
          const index = (j * 2 + dj) * current.side + i * 2 + di
          lo = Math.min(lo, current.min[index]!)
          hi = Math.max(hi, current.max[index]!)
        }
        nmin[j * next + i] = lo
        nmax[j * next + i] = hi
      }
      current = { min: nmin, max: nmax, side: next }
      pyramid.push(current)
    }
  }

  const uniforms = options.uniforms ?? terrainUniforms(sources)
  const viewer = new Vector3()
  const shared = {
    terrainViewer: { value: viewer },
    terrainMorph: { value: morph },
    canopyParams: { value: new Vector4(canopy.height, canopy.start, canopy.end, canopy.crown) },
  }
  const fragmentUniforms = {
    layerColor: { value: layers.color },
    layerNormal: { value: layers.normal },
    layerTile: { value: new Vector4(...layerSpecs.map(spec => spec.tile)) },
    layerTint: { value: layerSpecs.map(spec => new Vector3(...spec.tint)) },
    layerAverage: { value: layers.averages.map(average => new Vector3(...average)) },
    layerRoughness: { value: new Vector4(...layerSpecs.map(spec => spec.roughness)) },
    layerNormalScale: { value: new Vector4(...layerSpecs.map(spec => spec.normalScale)) },
    canopyColor: { value: new Vector3(...canopy.color) },
    canopyShade: { value: new Vector3(...canopy.shade) },
    terrainDetail: { value: options.detailDistance ?? 260 },
    terrainCoverShade: { value: new Vector2(options.coverShade?.distance ?? 0, options.coverShade?.strength ?? 0) },
  }

  const material = new MeshStandardMaterial({ name: 'world-terrain', color: new Color(1, 1, 1), roughness: 1, metalness: 0, envMapIntensity: 0.55 })
  if (canopy.dither) material.defines = { CANOPY_DITHER: '' }
  patchMaterial(material, 'world-terrain-v3', shader => {
    Object.assign(shader.uniforms, uniforms, shared, fragmentUniforms)
    shader.vertexShader = `${NOISE_GLSL}\n${TERRAIN_GLSL}\n${VERTEX_HEAD}\n${shader.vertexShader}`
    shader.vertexShader = replaceChunk(shader.vertexShader, 'beginnormal_vertex', `${VERTEX_BODY}\nvec3 objectNormal = mix(terrainNormalOf(terrainSurfaceLod(bsXZ, 0.0)), vec3(0.0, 1.0, 0.0), bsCanopy);`)
    shader.vertexShader = replaceChunk(shader.vertexShader, 'begin_vertex', '')
    shader.fragmentShader = `${NOISE_GLSL}\n${TERRAIN_GLSL}\n${ANTI_TILING_GLSL}\n${FRAGMENT_HEAD}\n${shader.fragmentShader}`
    shader.fragmentShader = replaceChunk(shader.fragmentShader, 'map_fragment', FRAGMENT_SPLAT)
    shader.fragmentShader = replaceChunk(shader.fragmentShader, 'roughnessmap_fragment', 'float roughnessFactor = roughness * bsRough;')
    shader.fragmentShader = replaceChunk(shader.fragmentShader, 'normal_fragment_begin', `
      vec3 normal = normalize((viewMatrix * vec4(bsWorldNormal, 0.0)).xyz);
      vec3 nonPerturbedNormal = normalize((viewMatrix * vec4(bsBase, 0.0)).xyz);
      float faceDirection = 1.0;
    `)
  })

  const depth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking })
  patchMaterial(depth, 'world-terrain-depth-v1', shader => {
    Object.assign(shader.uniforms, uniforms, shared)
    shader.vertexShader = `${NOISE_GLSL}\n${TERRAIN_GLSL}\n${VERTEX_HEAD}\n${shader.vertexShader}`
    shader.vertexShader = replaceChunk(shader.vertexShader, 'begin_vertex', VERTEX_BODY)
  })

  const capacity = 1024
  const makeMesh = (cells: number) => {
    const geometry = gridGeometry(cells)
    const info = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
    info.setUsage(DynamicDrawUsage)
    geometry.setAttribute('nodeInfo', info)
    const mesh = new InstancedMesh(geometry, material, capacity)
    mesh.count = 0
    mesh.frustumCulled = false
    mesh.receiveShadow = true
    mesh.castShadow = true
    mesh.customDepthMaterial = depth
    mesh.matrixAutoUpdate = false
    for (let index = 0; index < capacity; index++) mesh.setMatrixAt(index, identity)
    return { mesh, info, cells }
  }
  const identity = new Matrix4()
  const full = makeMesh(grid)
  const quad = makeMesh(grid / 2)
  full.mesh.name = 'world-terrain'
  quad.mesh.name = 'world-terrain-quadrants'
  const object = new Group()
  object.name = 'world-terrain-root'
  object.add(full.mesh, quad.mesh)

  const frustum = new Frustum()
  const projection = new Matrix4()
  const sphere = new Sphere()
  const box = { min: new Vector3(), max: new Vector3() }
  const shadowDistance = options.shadowDistance ?? 220
  const stats = { nodes: 0 }

  const nodeBounds = (level: number, i: number, j: number) => {
    const layer = pyramid[level]!
    const index = j * layer.side + i
    const size = leafSize * 2 ** level
    box.min.set(rootOrigin.x + i * size, layer.min[index]!, rootOrigin.y + j * size)
    box.max.set(box.min.x + size, layer.max[index]!, box.min.z + size)
  }
  const distanceToBox = () => {
    const dx = Math.max(box.min.x - viewer.x, 0, viewer.x - box.max.x)
    const dy = Math.max(box.min.y - viewer.y, 0, viewer.y - box.max.y)
    const dz = Math.max(box.min.z - viewer.z, 0, viewer.z - box.max.z)
    return Math.hypot(dx, dy, dz)
  }
  const visible = () => {
    if (distanceToBox() < shadowDistance) return true
    sphere.center.set((box.min.x + box.max.x) / 2, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2)
    sphere.radius = box.min.distanceTo(box.max) / 2
    return frustum.intersectsSphere(sphere)
  }
  const push = (target: typeof full, x: number, z: number, spacing: number, level: number) => {
    if (target.mesh.count >= capacity) return
    const offset = target.mesh.count * 4
    const array = target.info.array as Float32Array
    array[offset] = x
    array[offset + 1] = z
    array[offset + 2] = spacing
    array[offset + 3] = level
    target.mesh.count++
  }
  const select = (level: number, i: number, j: number): boolean => {
    nodeBounds(level, i, j)
    const distance = distanceToBox()
    if (distance > ranges[level]!) return false
    if (!visible()) return true
    const size = leafSize * 2 ** level
    const x = rootOrigin.x + i * size
    const z = rootOrigin.y + j * size
    const spacing = size / grid
    if (level === 0) { push(full, x, z, spacing, level); return true }
    nodeBounds(level, i, j)
    if (distanceToBox() > ranges[level - 1]!) { push(full, x, z, spacing, level); return true }
    for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) {
      if (!select(level - 1, i * 2 + di, j * 2 + dj)) push(quad, x + di * size / 2, z + dj * size / 2, spacing, level)
    }
    return true
  }

  return {
    object,
    uniforms,
    material,
    materials: [material, depth],
    stats,
    update(camera) {
      viewer.setFromMatrixPosition(camera.matrixWorld)
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      frustum.setFromProjectionMatrix(projection)
      full.mesh.count = 0
      quad.mesh.count = 0
      select(maxLevel, 0, 0)
      full.info.needsUpdate = true
      quad.info.needsUpdate = true
      full.info.clearUpdateRanges()
      full.info.addUpdateRange(0, full.mesh.count * 4)
      quad.info.clearUpdateRanges()
      quad.info.addUpdateRange(0, quad.mesh.count * 4)
      stats.nodes = full.mesh.count + quad.mesh.count
    },
    heightAt: (x, z) => terrainHeightAt(sources, x, z),
    dispose() {
      for (const mesh of [full.mesh, quad.mesh]) { mesh.geometry.dispose(); mesh.dispose() }
      material.dispose()
      depth.dispose()
    },
  }
}
