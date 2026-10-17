import {
  BufferAttribute, BufferGeometry, Color, DoubleSide, DynamicDrawUsage, Frustum, FrontSide, Group, IcosahedronGeometry, InstancedBufferAttribute,
  InstancedBufferGeometry, Matrix4, Mesh, MeshStandardMaterial, SRGBColorSpace, Sphere, Vector2, Vector3, Vector4,
} from 'three'
import type { Camera, Texture } from 'three'
import { hash2 } from './random'
import { patchMaterial, replaceChunk } from './patch'
import { TERRAIN_GLSL, type TerrainUniforms } from './terrain'
import { NOISE_GLSL, WIND_GLSL, type Wind } from './wind'

export type CoverShape = 'clump' | 'flower' | 'card' | 'pebble'

export interface CoverFamily {
  readonly name: string
  readonly shape: CoverShape
  readonly perPatch: number
  readonly mask: string
  readonly height?: string
  readonly size: readonly [number, number]
  readonly width?: number
  readonly quads?: number
  readonly texture?: Texture
  readonly colors: readonly (readonly [number, number, number])[]
  readonly bend?: number
  readonly translucency?: number
  readonly roughness?: number
  readonly fade?: number
  readonly ao?: number
  readonly castShadow?: boolean
}

export interface CoverSun {
  readonly direction: Vector3
  readonly color: Color
}

export interface CoverOptions {
  readonly terrain: TerrainUniforms
  readonly wind: Wind
  readonly families: readonly CoverFamily[]
  readonly heightAt: (x: number, z: number) => number
  readonly sun?: CoverSun
  readonly patch?: number
  readonly distance?: number
  readonly rings?: readonly number[]
  readonly density?: number
  readonly alphaToCoverage?: boolean
  readonly seed?: number
}

export interface Cover {
  readonly object: Group
  readonly materials: readonly MeshStandardMaterial[]
  readonly ground: string
  readonly stats: { patches: number; instances: number }
  update(camera: Camera): void
  dispose(): void
}

interface Part {
  readonly position: number[]
  readonly normal: number[]
  readonly uv: number[]
  readonly index: number[]
}

function quadClump(quads: number, width: number): Part {
  const part: Part = { position: [], normal: [], uv: [], index: [] }
  for (let q = 0; q < quads; q++) {
    const angle = q / quads * Math.PI
    const cx = Math.cos(angle) * width / 2
    const cz = Math.sin(angle) * width / 2
    const base = part.position.length / 3
    for (let row = 0; row < 3; row++) {
      const v = row / 2
      part.position.push(-cx, v, -cz, cx, v, cz)
      part.normal.push(0, 1, 0, 0, 1, 0)
      part.uv.push(0, v, 1, v)
    }
    for (let row = 0; row < 2; row++) {
      const a = base + row * 2
      part.index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  return part
}

function groundCard(): Part {
  return {
    position: [-0.5, 0.02, -0.5, 0.5, 0.02, -0.5, -0.5, 0.02, 0.5, 0.5, 0.02, 0.5],
    normal: [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
    uv: [0, 0, 1, 0, 0, 1, 1, 1],
    index: [0, 2, 1, 1, 2, 3],
  }
}

function pebble(): Part {
  const geometry = new IcosahedronGeometry(0.5, 0).toNonIndexed()
  geometry.computeVertexNormals()
  const position = Array.from(geometry.getAttribute('position').array as Float32Array)
  for (let index = 1; index < position.length; index += 3) position[index] = position[index]! * 0.5 + 0.12
  const temp = new BufferGeometry()
  temp.setAttribute('position', new BufferAttribute(new Float32Array(position), 3))
  temp.computeVertexNormals()
  const normal = Array.from(temp.getAttribute('normal').array as Float32Array)
  const count = position.length / 3
  geometry.dispose()
  temp.dispose()
  return { position, normal, uv: new Array(count * 2).fill(0.5), index: Array.from({ length: count }, (_, index) => index) }
}

function partFor(family: CoverFamily): Part {
  if (family.shape === 'clump') return quadClump(family.quads ?? 3, family.width ?? 1)
  if (family.shape === 'flower') return quadClump(family.quads ?? 2, family.width ?? 0.6)
  if (family.shape === 'card') return groundCard()
  return pebble()
}

const STAMP = 64
const HUE_TO_THIRD = 0.85 * (0.05 + 0.33 / 2)
const GRAZING = 4

const linear = (value: number) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
const rise = (value: number) => { const t = Math.min(1, Math.max(0, value / 0.85)); return t * t * (3 - 2 * t) }

function bladeLook(family: CoverFamily, part: Part) {
  const ao = family.ao ?? 0.5
  const shade = (y: number) => ao + (1 - ao) * rise(y)
  const flat = family.shape === 'card' || family.shape === 'pebble'
  const image = family.texture?.image as CanvasImageSource | undefined
  if (!image || typeof OffscreenCanvas === 'undefined') {
    let sum = 0
    for (let index = 1; index < part.position.length; index += 3) sum += shade(part.position[index]!)
    return { albedo: [1, 1, 1].map(() => sum / (part.position.length / 3)), fill: 1 }
  }
  const canvas = new OffscreenCanvas(STAMP, STAMP)
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(image, 0, 0, STAMP, STAMP)
  const data = context.getImageData(0, 0, STAMP, STAMP).data
  const decode = family.texture!.colorSpace === SRGBColorSpace ? (value: number) => linear(value / 255) : (value: number) => value / 255
  const albedo = [0, 0, 0]
  let alpha = 0
  for (let row = 0; row < STAMP; row++) {
    const factor = shade(flat ? 0.02 : 1 - (row + 0.5) / STAMP)
    for (let column = 0; column < STAMP; column++) {
      const offset = (row * STAMP + column) * 4
      const a = data[offset + 3]! / 255
      for (let channel = 0; channel < 3; channel++) albedo[channel]! += decode(data[offset + channel]!) * a * factor
      alpha += a
    }
  }
  return { albedo: albedo.map(value => value / Math.max(alpha, 1e-6)), fill: alpha / (STAMP * STAMP) }
}

function bladeArea(family: CoverFamily) {
  const size = (family.size[0] + family.size[1]) / 2
  if (family.shape === 'card') return size * size
  if (family.shape === 'pebble') return size * size * 0.5
  return (family.quads ?? (family.shape === 'flower' ? 2 : 3)) * (family.width ?? (family.shape === 'flower' ? 0.6 : 1)) * size * size
}

const glslNumber = (value: number) => Number.isInteger(value) ? `${value}.0` : `${+value.toFixed(6)}`
const glslVec3 = (value: readonly number[]) => `vec3(${value.map(glslNumber).join(', ')})`

const R2_A = 0.7548776662466927
const R2_B = 0.5698402909980532

function patchGeometry(part: Part, count: number, patch: number, seed: number) {
  const vertices = part.position.length / 3
  const position = new Float32Array(count * vertices * 3)
  const normal = new Float32Array(count * vertices * 3)
  const uv = new Float32Array(count * vertices * 2)
  const blade = new Float32Array(count * vertices * 3)
  const random = new Float32Array(count * vertices * 4)
  const index = new Uint32Array(count * part.index.length)
  const offsetX = hash2(seed, 1, 91)
  const offsetZ = hash2(seed, 2, 91)
  for (let item = 0; item < count; item++) {
    const jitterX = (hash2(item, seed, 3) - 0.5) * 0.35 / Math.sqrt(count)
    const jitterZ = (hash2(item, seed, 5) - 0.5) * 0.35 / Math.sqrt(count)
    const x = ((offsetX + (item + 1) * R2_A + jitterX) % 1 + 1) % 1 * patch
    const z = ((offsetZ + (item + 1) * R2_B + jitterZ) % 1 + 1) % 1 * patch
    const rank = (item + hash2(item, seed, 7)) / count
    const yaw = hash2(item, seed, 11) * Math.PI * 2
    const scale = hash2(item, seed, 13)
    const hue = hash2(item, seed, 17)
    const phase = hash2(item, seed, 19)
    for (let vertex = 0; vertex < vertices; vertex++) {
      const target = item * vertices + vertex
      position.set(part.position.slice(vertex * 3, vertex * 3 + 3), target * 3)
      normal.set(part.normal.slice(vertex * 3, vertex * 3 + 3), target * 3)
      uv.set(part.uv.slice(vertex * 2, vertex * 2 + 2), target * 2)
      blade.set([x, z, rank], target * 3)
      random.set([yaw, scale, hue, phase], target * 4)
    }
    for (let i = 0; i < part.index.length; i++) index[item * part.index.length + i] = part.index[i]! + item * vertices
  }
  return {
    position: new BufferAttribute(position, 3),
    normal: new BufferAttribute(normal, 3),
    uv: new BufferAttribute(uv, 2),
    blade: new BufferAttribute(blade, 3),
    random: new BufferAttribute(random, 4),
    index: new BufferAttribute(index, 1),
    indicesPerItem: part.index.length,
  }
}

const VERTEX_HEAD = /* glsl */ `
attribute vec3 coverBlade;
attribute vec4 coverRandom;
attribute vec3 coverPatch;
uniform vec3 coverViewer;
uniform vec4 coverFade;
uniform vec4 coverShape;
uniform float coverPatchSize;
varying vec3 coverData;
varying vec3 coverRoot;
`

const vertexBody = (family: CoverFamily) => /* glsl */ `
vec2 bsLocal = coverBlade.xy - coverPatchSize * 0.5;
uint bsSeed = uint(coverPatch.z);
if ((bsSeed & 1u) == 1u) bsLocal = vec2(-bsLocal.y, bsLocal.x);
if ((bsSeed & 2u) == 2u) bsLocal = -bsLocal;
if ((bsSeed & 4u) == 4u) bsLocal.x = -bsLocal.x;
vec2 bsRoot = coverPatch.xy + coverPatchSize * 0.5 + bsLocal;
float bsGround = terrainHeight(bsRoot);
vec4 bsSurface = terrainSurfaceLod(bsRoot, 0.0);
vec3 bsTerrainNormal = terrainNormalOf(bsSurface);
float bsSlope = 1.0 - bsTerrainNormal.y;
float bsDistance = distance(vec3(bsRoot.x, bsGround, bsRoot.y), coverViewer);
float bsReach = 1.0 - smoothstep(coverFade.x, coverFade.y, bsDistance);
float bsMask = clamp(${family.mask}, 0.0, 1.0);
float bsDensity = bsMask * bsReach;
float bsKeep = clamp((bsDensity - coverBlade.z) / 0.07, 0.0, 1.0);
float bsWiden = mix(1.0, coverFade.z, 1.0 - bsReach);
float bsScale = mix(coverShape.x, coverShape.y, coverRandom.y) * bsKeep * max(${family.height ?? '1.0'}, 0.0);
vec3 bsP = position;
bsP.xz *= bsWiden * bsScale;
bsP.y *= bsScale;
float bsYaw = coverRandom.x;
float bsC = cos(bsYaw);
float bsS = sin(bsYaw);
bsP.xz = vec2(bsC * bsP.x - bsS * bsP.z, bsS * bsP.x + bsC * bsP.z);
float bsHeightFrac = clamp(position.y, 0.0, 1.0);
float bsWind = windAt(bsRoot);
float bsFlutter = sin(windTime * (2.3 + coverRandom.w * 1.7) + coverRandom.w * 6.283 + dot(bsRoot, vec2(0.7, 0.4))) * (0.25 + bsWind * 0.35);
vec2 bsBend = (windDirection * bsWind + vec2(-windDirection.y, windDirection.x) * bsFlutter * 0.35) * coverShape.z * bsHeightFrac * bsHeightFrac * bsScale;
bsP.xz += bsBend;
bsP.y -= length(bsBend) * 0.35 * bsHeightFrac;
vec3 transformed = vec3(bsRoot.x, bsGround, bsRoot.y) + bsP;
coverData = vec3(bsHeightFrac, coverRandom.z, bsDistance);
coverRoot = vec3(bsRoot.x, bsMask, bsRoot.y);
`

const NORMAL_SOFT = /* glsl */ `
vec2 bsRootN = coverPatch.xy + coverPatchSize * 0.5;
vec3 objectNormal = normalize(mix(vec3(0.0, 1.0, 0.0), terrainNormalOf(terrainSurfaceLod(bsRootN, 2.0)), 0.7));
`

const NORMAL_ROTATED = /* glsl */ `
vec3 objectNormal = normal;
float bsYawN = coverRandom.x;
objectNormal.xz = vec2(cos(bsYawN) * objectNormal.x - sin(bsYawN) * objectNormal.z, sin(bsYawN) * objectNormal.x + cos(bsYawN) * objectNormal.z);
`

const FRAGMENT_HEAD = /* glsl */ `
uniform vec3 coverColors[3];
uniform vec4 coverLight;
uniform vec3 coverSunDirection;
uniform vec3 coverSunColor;
uniform vec2 coverTextureSize;
varying vec3 coverData;
varying vec3 coverRoot;
`

const FRAGMENT_COLOR = (textured: boolean) => /* glsl */ `
${textured ? `
vec4 bsTexel = texture2D(map, vMapUv);
vec2 bsTexelScale = max(abs(dFdx(vMapUv * coverTextureSize)), abs(dFdy(vMapUv * coverTextureSize)));
float bsMip = max(log2(max(bsTexelScale.x, bsTexelScale.y)), 0.0);
bsTexel.a *= 1.0 + bsMip * 0.3;
diffuseColor *= bsTexel;
` : ''}
float bsPatchTone = bsNoise(coverRoot.xz * 0.035, 61u) * 0.7 + bsNoise(coverRoot.xz * 0.12, 67u) * 0.3;
vec3 bsTint = mix(coverColors[0], coverColors[1], smoothstep(0.25, 0.75, bsPatchTone));
bsTint = mix(bsTint, coverColors[2], smoothstep(0.62, 0.95, coverData.y) * 0.85);
diffuseColor.rgb *= bsTint * (0.88 + coverData.y * 0.24);
diffuseColor.rgb *= mix(coverLight.z, 1.0, smoothstep(0.0, 0.85, coverData.x));
`

const ALPHA_AA = /* glsl */ `
#ifdef COVER_A2C
diffuseColor.a = clamp((diffuseColor.a - 0.5) / max(fwidth(diffuseColor.a), 0.0001) + 0.5, 0.0, 1.0);
if (diffuseColor.a < 0.02) discard;
#else
if (diffuseColor.a < 0.5) discard;
diffuseColor.a = 1.0;
#endif
`

const NORMAL_UP = /* glsl */ `
float faceDirection = 1.0;
vec3 normal = normalize(vNormal);
vec3 nonPerturbedNormal = normal;
`

const TRANSLUCENCY = /* glsl */ `
#include <emissivemap_fragment>
vec3 bsSunView = normalize((viewMatrix * vec4(coverSunDirection, 0.0)).xyz);
float bsBack = pow(max(dot(normalize(-vViewPosition), bsSunView), 0.0), 3.0);
totalEmissiveRadiance += diffuseColor.rgb * coverSunColor * coverLight.x * (bsBack * 0.85 + 0.15) * coverData.x;
`

interface Ring {
  readonly mesh: Mesh
  readonly patch: InstancedBufferAttribute
  readonly geometry: InstancedBufferGeometry
}

export function createCover(options: CoverOptions): Cover {
  const patchSize = options.patch ?? 8
  const distance = options.distance ?? 75
  const density = options.density ?? 1
  const ringEdges = options.rings ?? [distance * 0.3, distance * 0.62, distance]
  const seed = options.seed ?? 1
  const sun = options.sun ?? { direction: new Vector3(0.4, 0.8, 0.3).normalize(), color: new Color(1, 0.95, 0.85) }
  const object = new Group()
  object.name = 'world-cover'
  const viewer = new Vector3()
  const span = Math.ceil(distance / patchSize) + 1
  const maxPatches = (span * 2 + 1) ** 2
  const fadeStart = distance * 0.45
  const reach = (d: number) => {
    const t = Math.min(1, Math.max(0, (d - fadeStart) / (distance - fadeStart)))
    return 1 - t * t * (3 - 2 * t)
  }
  const materials: MeshStandardMaterial[] = []
  const familyRings: { family: CoverFamily; rings: Ring[]; per: number }[] = []
  const groundTerms: string[] = []

  for (const [familyIndex, family] of options.families.entries()) {
    const per = Math.max(1, Math.round(family.perPatch * density))
    const part = partFor(family)
    const fade = family.fade ?? 1
    const look = bladeLook(family, part)
    const palette = [0, 1, 2].map(index => family.colors[Math.min(index, family.colors.length - 1)] ?? [1, 1, 1])
    const toned = (index: number) => palette[index]!.map((value, channel) => (value * (1 - HUE_TO_THIRD) + palette[2]![channel]! * HUE_TO_THIRD) * look.albedo[channel]!)
    const weight = per * bladeArea(family) * look.fill / (patchSize * patchSize)
    groundTerms.push(`bsMask = clamp(${family.mask}, 0.0, 1.0) * ${glslNumber(weight)};
  bsSum += bsMask * mix(${glslVec3(toned(0))}, ${glslVec3(toned(1))}, bsTone) * mix(${glslNumber(family.ao ?? 0.5)}, 1.0, smoothstep(${glslNumber(fadeStart * fade)}, ${glslNumber(distance * fade)}, bsDistance));
  bsWeight += bsMask;`)
    const shared = patchGeometry(part, per, patchSize, seed * 31 + familyIndex)
    const textured = Boolean(family.texture)
    const material = new MeshStandardMaterial({
      name: `world-cover-${family.name}`,
      color: 0xffffff,
      map: family.texture ?? null,
      roughness: family.roughness ?? 0.85,
      metalness: 0,
      side: family.shape === 'pebble' ? FrontSide : DoubleSide,
      alphaToCoverage: textured && options.alphaToCoverage === true,
    })
    if (textured && options.alphaToCoverage) material.defines = { COVER_A2C: '' }
    const colors = [0, 1, 2].map(index => new Vector3(...(family.colors[Math.min(index, family.colors.length - 1)] ?? [1, 1, 1])))
    const uniforms = {
      coverViewer: { value: viewer },
      coverFade: { value: new Vector4(fadeStart * fade, distance * fade, family.shape === 'pebble' || family.shape === 'card' ? 1.2 : 1.9, 0) },
      coverShape: { value: new Vector4(family.size[0], family.size[1], family.bend ?? 0, 0) },
      coverPatchSize: { value: patchSize },
      coverColors: { value: colors },
      coverLight: { value: new Vector4(family.translucency ?? 0, 0, family.ao ?? 0.5, 0) },
      coverSunDirection: { value: sun.direction },
      coverSunColor: { value: sun.color },
      coverTextureSize: { value: new Vector2((family.texture?.image as { width?: number } | undefined)?.width ?? 256, (family.texture?.image as { height?: number } | undefined)?.height ?? 256) },
    }
    patchMaterial(material, `world-cover-${family.shape}-${textured ? 't' : 'p'}-${family.mask}-${family.height ?? ''}`, shader => {
      Object.assign(shader.uniforms, options.terrain, options.wind.uniforms, uniforms)
      shader.vertexShader = `${NOISE_GLSL}\n${WIND_GLSL}\n${TERRAIN_GLSL}\n${VERTEX_HEAD}\n${shader.vertexShader}`
      shader.vertexShader = replaceChunk(shader.vertexShader, 'beginnormal_vertex', family.shape === 'pebble' ? NORMAL_ROTATED : NORMAL_SOFT)
      shader.vertexShader = replaceChunk(shader.vertexShader, 'begin_vertex', vertexBody(family))
      shader.fragmentShader = `${NOISE_GLSL}\n${FRAGMENT_HEAD}\n${shader.fragmentShader}`
      shader.fragmentShader = replaceChunk(shader.fragmentShader, 'map_fragment', FRAGMENT_COLOR(textured))
      shader.fragmentShader = replaceChunk(shader.fragmentShader, 'alphatest_fragment', textured ? ALPHA_AA : '')
      if (family.shape !== 'pebble') shader.fragmentShader = replaceChunk(shader.fragmentShader, 'normal_fragment_begin', NORMAL_UP)
      if ((family.translucency ?? 0) > 0) shader.fragmentShader = replaceChunk(shader.fragmentShader, 'emissivemap_fragment', TRANSLUCENCY)
    })
    materials.push(material)

    const rings: Ring[] = ringEdges.map((edge, ringIndex) => {
      const start = ringIndex === 0 ? 0 : ringEdges[ringIndex - 1]!
      const prefix = ringIndex === 0 ? per : Math.max(1, Math.min(per, Math.ceil(per * reach(start) * 1.02)))
      const geometry = new InstancedBufferGeometry()
      geometry.setAttribute('position', shared.position)
      geometry.setAttribute('normal', shared.normal)
      geometry.setAttribute('uv', shared.uv)
      geometry.setAttribute('coverBlade', shared.blade)
      geometry.setAttribute('coverRandom', shared.random)
      geometry.setIndex(shared.index)
      geometry.setDrawRange(0, prefix * shared.indicesPerItem)
      const patch = new InstancedBufferAttribute(new Float32Array(maxPatches * 3), 3)
      patch.setUsage(DynamicDrawUsage)
      geometry.setAttribute('coverPatch', patch)
      geometry.instanceCount = 0
      const mesh = new Mesh(geometry, material)
      mesh.name = `world-cover-${family.name}-${ringIndex}`
      mesh.frustumCulled = false
      mesh.receiveShadow = true
      mesh.castShadow = false
      mesh.userData.edge = edge
      object.add(mesh)
      return { mesh, patch, geometry }
    })
    familyRings.push({ family, rings, per })
  }

  const frustum = new Frustum()
  const projection = new Matrix4()
  const sphere = new Sphere()
  const stats = { patches: 0, instances: 0 }
  const counts = new Int32Array(ringEdges.length)

  const ground = /* glsl */ `
vec4 coverGround(vec2 bsRoot, vec4 bsSurface, float bsSlope, float bsGround, float bsDistance) {
  float bsTone = smoothstep(0.25, 0.75, bsNoise(bsRoot * 0.035, 61u) * 0.7 + bsNoise(bsRoot * 0.12, 67u) * 0.3);
  vec3 bsSum = vec3(0.0);
  float bsWeight = 0.0;
  float bsMask;
  ${groundTerms.join('\n  ')}
  return vec4(bsSum / max(bsWeight, 1e-4), 1.0 - exp(-bsWeight * ${glslNumber(GRAZING)}));
}
`

  return {
    object,
    materials,
    ground,
    stats,
    update(camera) {
      viewer.setFromMatrixPosition(camera.matrixWorld)
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      frustum.setFromProjectionMatrix(projection)
      const cx = Math.floor(viewer.x / patchSize)
      const cz = Math.floor(viewer.z / patchSize)
      counts.fill(0)
      let patches = 0
      for (let j = -span; j <= span; j++) for (let i = -span; i <= span; i++) {
        const px = (cx + i) * patchSize
        const pz = (cz + j) * patchSize
        const dx = Math.max(px - viewer.x, 0, viewer.x - (px + patchSize))
        const dz = Math.max(pz - viewer.z, 0, viewer.z - (pz + patchSize))
        const near = Math.hypot(dx, dz)
        if (near > distance) continue
        const centreX = px + patchSize / 2
        const centreZ = pz + patchSize / 2
        sphere.center.set(centreX, options.heightAt(centreX, centreZ) + 1, centreZ)
        sphere.radius = patchSize * 0.75 + 3
        if (!frustum.intersectsSphere(sphere)) continue
        let ring = 0
        while (ring < ringEdges.length - 1 && near > ringEdges[ring]!) ring++
        const patchSeed = Math.floor(hash2(cx + i, cz + j, seed + 77) * 8)
        for (const entry of familyRings) {
          const target = entry.rings[ring]!
          const array = target.patch.array as Float32Array
          const offset = counts[ring]! * 3
          array[offset] = px
          array[offset + 1] = pz
          array[offset + 2] = patchSeed
        }
        counts[ring]!++
        patches++
      }
      let instances = 0
      for (const entry of familyRings) {
        entry.rings.forEach((ring, index) => {
          ring.geometry.instanceCount = counts[index]!
          ring.mesh.visible = counts[index]! > 0
          ring.patch.clearUpdateRanges()
          ring.patch.addUpdateRange(0, counts[index]! * 3)
          ring.patch.needsUpdate = true
          instances += counts[index]! * (ring.geometry.drawRange.count / (ring.geometry.index!.count / entry.per))
        })
      }
      stats.patches = patches
      stats.instances = Math.round(instances)
    },
    dispose() {
      for (const entry of familyRings) for (const ring of entry.rings) ring.geometry.dispose()
      for (const material of materials) material.dispose()
    },
  }
}
