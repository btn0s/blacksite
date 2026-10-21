import {
  BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Frustum, Group, IcosahedronGeometry, InstancedBufferAttribute,
  InstancedBufferGeometry, Matrix4, Mesh, SRGBColorSpace, Sphere, Vector3,
} from 'three'
import type { Camera, Texture } from 'three'
import { hash2 } from './random'
import { MeshStandardNodeMaterial, type Node } from 'three/webgpu'
import { Fn, clamp, exp, float, max, mix, smoothstep, vec3, vec4 } from 'three/tsl'
import { createCoverMaterial } from './cover-nodes'
import { landscapeNoise, type CoverMask, type CoverGround, type CoverSample } from './nodes'
import type { TerrainUniforms } from './terrain'
import type { Wind } from './wind'

export type CoverShape = 'clump' | 'flower' | 'card' | 'pebble'

export interface CoverFamily {
  readonly name: string
  readonly shape: CoverShape
  readonly perPatch: number
  readonly mask: CoverMask
  readonly height?: CoverMask
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
  readonly near?: number
  readonly density?: number
  readonly alphaToCoverage?: boolean
  readonly seed?: number
}

export interface Cover {
  readonly object: Group
  readonly materials: readonly MeshStandardNodeMaterial[]
  readonly ground: CoverGround
  readonly stats: { patches: number; instances: number; candidates: number; sceneTriangles: number; drawnTriangles: number }
  setCullingEnabled(enabled: boolean): void
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
const END = 0.75
const SHRINK = 0.15
const RING = 1.4

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

interface Ring {
  readonly mesh: Mesh
  readonly geometry: InstancedBufferGeometry
}

export function createCover(options: CoverOptions): Cover {
  const patchSize = options.patch ?? 8
  const distance = options.distance ?? 75
  const near = Math.min(options.near ?? 15, distance)
  const density = options.density ?? 1
  const ringEdges = [near]
  while (ringEdges[ringEdges.length - 1]! < distance) ringEdges.push(Math.min(distance, ringEdges[ringEdges.length - 1]! * RING))
  const seed = options.seed ?? 1
  const sun = options.sun ?? { direction: new Vector3(0.4, 0.8, 0.3).normalize(), color: new Color(1, 0.95, 0.85) }
  const object = new Group()
  object.name = 'world-cover'
  const viewer = new Vector3()
  const span = Math.ceil(distance / patchSize) + 1
  const maxPatches = (span * 2 + 1) ** 2
  const patchAttributes = ringEdges.map(() => {
    const attribute = new InstancedBufferAttribute(new Float32Array(maxPatches * 3), 3)
    attribute.setUsage(DynamicDrawUsage)
    return attribute
  })
  const reach = (d: number, end: number) => {
    const t = Math.min(1, Math.max(0, (d - end * END) / (end - end * END)))
    return near / Math.max(d, near) * (1 - t * t * (3 - 2 * t))
  }
  const materials: MeshStandardNodeMaterial[] = []
  const familyRings: { family: CoverFamily; rings: Ring[]; per: number }[] = []
  const groundTerms: ((sample: CoverSample) => { color: Node<'vec3'>; weight: Node<'float'> })[] = []

  for (const [familyIndex, family] of options.families.entries()) {
    const per = Math.max(1, Math.round(family.perPatch * density))
    const part = partFor(family)
    const end = distance * (family.fade ?? 1)
    const look = bladeLook(family, part)
    const palette = [0, 1, 2].map(index => family.colors[Math.min(index, family.colors.length - 1)] ?? [1, 1, 1])
    const toned = (index: number) => palette[index]!.map((value, channel) => (value * (1 - HUE_TO_THIRD) + palette[2]![channel]! * HUE_TO_THIRD) * look.albedo[channel]!)
    const weight = per * bladeArea(family) * look.fill / (patchSize * patchSize)
    groundTerms.push(sample => {
      const mask = clamp(family.mask(sample), 0, 1).mul(weight)
      const tone = smoothstep(0.25, 0.75, landscapeNoise(sample.root.mul(0.035), 61).mul(0.7).add(landscapeNoise(sample.root.mul(0.12), 67).mul(0.3)))
      const first = toned(0)
      const second = toned(1)
      const color = mix(vec3(first[0]!, first[1]!, first[2]!), vec3(second[0]!, second[1]!, second[2]!), tone)
        .mul(mix(family.ao ?? 0.5, 1, smoothstep(end * END, end, sample.distance)))
      return { color: color.mul(mask), weight: mask }
    })
    const shared = patchGeometry(part, per, patchSize, seed * 31 + familyIndex)
    const material = createCoverMaterial(family, { terrain: options.terrain, wind: options.wind, viewer, sun, near, end, patchSize, alphaToCoverage: options.alphaToCoverage === true, albedo: look.albedo })
    materials.push(material)

    const rings: Ring[] = ringEdges.flatMap((edge, ringIndex) => {
      const start = ringIndex === 0 ? 0 : ringEdges[ringIndex - 1]!
      const prefix = Math.min(per, Math.ceil(per * reach(start, end) * (1 + SHRINK)))
      if (prefix === 0) return []
      const geometry = new InstancedBufferGeometry()
      geometry.setAttribute('position', shared.position)
      geometry.setAttribute('normal', shared.normal)
      geometry.setAttribute('uv', shared.uv)
      geometry.setAttribute('coverBlade', shared.blade)
      geometry.setAttribute('coverRandom', shared.random)
      geometry.setIndex(shared.index)
      geometry.setDrawRange(0, prefix * shared.indicesPerItem)
      geometry.setAttribute('coverPatch', patchAttributes[ringIndex]!)
      geometry.instanceCount = 0
      const mesh = new Mesh(geometry, material)
      mesh.name = `world-cover-${family.name}-${ringIndex}`
      mesh.frustumCulled = false
      mesh.receiveShadow = true
      mesh.castShadow = false
      mesh.userData.edge = edge
      mesh.visible = false
      object.add(mesh)
      return [{ mesh, geometry }]
    })
    familyRings.push({ family, rings, per })
  }

  const frustum = new Frustum()
  const projection = new Matrix4()
  const sphere = new Sphere()
  const stats = { patches: 0, instances: 0, candidates: 0, sceneTriangles: 0, drawnTriangles: 0 }
  let cullingEnabled = true
  const counts = new Int32Array(ringEdges.length)

  const ground: CoverGround = sample => Fn(() => {
    const sum = vec3(0).toVar()
    const weight = float(0).toVar()
    for (const term of groundTerms) {
      const contribution = term(sample)
      sum.addAssign(contribution.color)
      weight.addAssign(contribution.weight)
    }
    return vec4(sum.div(max(weight, 1e-4)), float(1).sub(exp(weight.mul(-GRAZING))))
  })()

  return {
    object,
    materials,
    ground,
    stats,
    setCullingEnabled(enabled) { cullingEnabled = enabled },
    update(camera) {
      viewer.setFromMatrixPosition(camera.matrixWorld)
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      frustum.setFromProjectionMatrix(projection, camera.coordinateSystem)
      const cx = Math.floor(viewer.x / patchSize)
      const cz = Math.floor(viewer.z / patchSize)
      counts.fill(0)
      let patches = 0
      let candidates = 0
      let sceneTriangles = 0
      for (let j = -span; j <= span; j++) for (let i = -span; i <= span; i++) {
        const px = (cx + i) * patchSize
        const pz = (cz + j) * patchSize
        const dx = Math.max(px - viewer.x, 0, viewer.x - (px + patchSize))
        const dz = Math.max(pz - viewer.z, 0, viewer.z - (pz + patchSize))
        const gap = Math.hypot(dx, dz)
        if (gap > distance) continue
        const centreX = px + patchSize / 2
        const centreZ = pz + patchSize / 2
        sphere.center.set(centreX, options.heightAt(centreX, centreZ) + 1, centreZ)
        sphere.radius = patchSize * 0.75 + 3
        let ring = 0
        while (ring < ringEdges.length - 1 && gap > ringEdges[ring]!) ring++
        candidates++
        for (const entry of familyRings) sceneTriangles += (entry.rings[ring]?.geometry.drawRange.count ?? 0) / 3
        if (cullingEnabled && !frustum.intersectsSphere(sphere)) continue
        const array = patchAttributes[ring]!.array as Float32Array
        const offset = counts[ring]! * 3
        array[offset] = px
        array[offset + 1] = pz
        array[offset + 2] = Math.floor(hash2(cx + i, cz + j, seed + 77) * 8)
        counts[ring]!++
        patches++
      }
      patchAttributes.forEach((attribute, index) => {
        attribute.clearUpdateRanges()
        attribute.addUpdateRange(0, counts[index]! * 3)
        attribute.needsUpdate = true
      })
      let instances = 0
      let drawnTriangles = 0
      for (const entry of familyRings) {
        entry.rings.forEach((ring, index) => {
          ring.geometry.instanceCount = counts[index]!
          ring.mesh.visible = counts[index]! > 0
          drawnTriangles += counts[index]! * ring.geometry.drawRange.count / 3
          instances += counts[index]! * (ring.geometry.drawRange.count / (ring.geometry.index!.count / entry.per))
        })
      }
      stats.patches = patches
      stats.instances = Math.round(instances)
      stats.candidates = candidates
      stats.sceneTriangles = sceneTriangles
      stats.drawnTriangles = drawnTriangles
    },
    dispose() {
      for (const entry of familyRings) for (const ring of entry.rings) ring.geometry.dispose()
      for (const material of materials) material.dispose()
    },
  }
}
