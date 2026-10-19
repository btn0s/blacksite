import { ConeGeometry, DynamicDrawUsage, Frustum, Group, IcosahedronGeometry, InstancedBufferAttribute, InstancedBufferGeometry, InstancedMesh, Matrix4, Mesh, PlaneGeometry, Quaternion, Sphere, Vector3 } from 'three'
import type { BufferGeometry, Camera, Color, Material } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import type { WebGPURenderer } from 'three/webgpu'
import { uniform } from 'three/tsl'
import { createImpostorMaterial, bakeImpostor, type ImpostorAtlas, type TreeTextures } from './impostor'
import { createTreeMaterial } from './tree-nodes'
import { hash2 } from './random'
import type { TreeModel } from './trees'
import type { Wind } from './wind'

export interface ForestSpecies {
  readonly model: TreeModel
  readonly textures: TreeTextures
  readonly scale?: readonly [number, number]
}

export interface ForestOptions {
  readonly renderer: WebGPURenderer
  readonly wind: Wind
  readonly species: readonly ForestSpecies[]
  readonly density: (x: number, z: number) => number
  readonly choose: (x: number, z: number, random: number) => number
  readonly priority?: (x: number, z: number) => number
  readonly heightAt: (x: number, z: number) => number
  readonly bounds: { readonly min: readonly [number, number]; readonly max: readonly [number, number] }
  readonly spacing: number
  readonly count: number
  readonly near: readonly [number, number]
  readonly far: readonly [number, number]
  readonly shadowDistance: number
  readonly frames?: number
  readonly frameSize?: number
  readonly alphaToCoverage?: boolean
  readonly singleFrame?: boolean
  readonly impostorBlur?: number
  readonly impostorFarTint?: readonly [number, number, number]
  readonly proxyLayer?: number
  readonly sun?: { readonly direction: Vector3; readonly color: Color }
  readonly seed?: number
}

export interface Forest {
  readonly object: Group
  readonly materials: readonly Material[]
  readonly atlases: readonly ImpostorAtlas[]
  readonly stats: { trees: number; candidates: number; near: number; proxies: number; impostors: number; bakeMs: number; sceneTriangles: number; drawnTriangles: number; fullDetailTriangles: number; candidateInstances: number; drawnInstances: number; culledInstances: number }
  readonly fallbackCap: number
  readonly positions: Float32Array
  setLodView(enabled: boolean): void
  setLodEnabled(enabled: boolean): void
  update(camera: Camera): void
  dispose(): void
}

function proxyGeometry(model: TreeModel): BufferGeometry {
  const crown = model.crownCentre
  if (model.species.form === 'conifer') {
    const height = model.height * 0.82
    const geometry = new ConeGeometry(model.species.crown * 1.05, height, 7, 1)
    geometry.translate(0, model.height - height / 2 - model.height * 0.02, 0)
    return geometry
  }
  const geometry = new IcosahedronGeometry(1, 1)
  geometry.scale(model.crownRadius * 0.95, (model.height - crown.y) * 1.25, model.crownRadius * 0.95)
  geometry.translate(crown.x, crown.y + model.height * 0.04, crown.z)
  return geometry
}

export function createForest(options: ForestOptions): Forest {
  const { wind, species } = options
  const seed = options.seed ?? 5
  const stats = { trees: 0, candidates: 0, near: 0, proxies: 0, impostors: 0, bakeMs: 0, sceneTriangles: 0, drawnTriangles: 0, fullDetailTriangles: 0, candidateInstances: 0, drawnInstances: 0, culledInstances: 0 }
  const [minX, minZ] = options.bounds.min
  const [maxX, maxZ] = options.bounds.max
  const spacing = options.spacing
  const candidates: { x: number; z: number; rank: number; species: number; yaw: number; scale: number }[] = []
  for (let gz = Math.floor(minZ / spacing); gz * spacing < maxZ; gz++) {
    for (let gx = Math.floor(minX / spacing); gx * spacing < maxX; gx++) {
      const x = (gx + 0.15 + hash2(gx, gz, seed) * 0.7) * spacing
      const z = (gz + 0.15 + hash2(gx, gz, seed + 1) * 0.7) * spacing
      if (x < minX || x > maxX || z < minZ || z > maxZ) continue
      const density = options.density(x, z)
      if (density <= 0.02 || hash2(gx, gz, seed + 2) > density) continue
      const kind = options.choose(x, z, hash2(gx, gz, seed + 3))
      const range = species[kind]?.scale ?? [0.8, 1.2]
      candidates.push({ x, z, rank: hash2(gx, gz, seed + 4) * (options.priority?.(x, z) ?? 1), species: kind, yaw: hash2(gx, gz, seed + 5) * Math.PI * 2, scale: range[0] + (range[1] - range[0]) * hash2(gx, gz, seed + 6) })
    }
  }
  stats.candidates = candidates.length
  if (candidates.length > options.count) candidates.sort((a, b) => a.rank - b.rank).length = options.count
  const total = candidates.length
  stats.trees = total
  const cellSize = 64
  const cellsX = Math.ceil((maxX - minX) / cellSize)
  const cellsZ = Math.ceil((maxZ - minZ) / cellSize)
  const cellOf = (x: number, z: number) => Math.min(cellsZ - 1, Math.max(0, Math.floor((z - minZ) / cellSize))) * cellsX + Math.min(cellsX - 1, Math.max(0, Math.floor((x - minX) / cellSize)))
  candidates.sort((a, b) => cellOf(a.x, a.z) - cellOf(b.x, b.z))
  const positions = new Float32Array(total * 4)
  const scales = new Float32Array(total)
  const kinds = new Uint8Array(total)
  candidates.forEach((tree, index) => {
    positions[index * 4] = tree.x
    positions[index * 4 + 1] = options.heightAt(tree.x, tree.z) - 0.15
    positions[index * 4 + 2] = tree.z
    positions[index * 4 + 3] = tree.yaw
    scales[index] = tree.scale
    kinds[index] = tree.species
  })

  const object = new Group()
  object.name = 'world-forest'
  const materials: Material[] = []
  const atlases: ImpostorAtlas[] = []
  const fallbackCap = 256
  const nearCapacity = Math.max(fallbackCap, Math.ceil(Math.PI * options.near[1] ** 2 / (spacing * spacing) * 1.6))
  const proxyCapacity = Math.max(64, Math.ceil(Math.PI * options.shadowDistance ** 2 / (spacing * spacing) * 1.4))
  const viewer = new Vector3()
  const lodView = uniform(0)
  const fullDetail = uniform(0)
  const proxyMaterial = new MeshBasicNodeMaterial({ colorWrite: false, depthWrite: true })
  const layer = options.proxyLayer ?? 2
  let lodEnabled = true
  let dirty = true
  const kindsData = species.map((entry, kind) => {
    const { model, textures } = entry
    const roots = new InstancedBufferAttribute(new Float32Array(nearCapacity * 3), 3).setUsage(DynamicDrawUsage)
    const nearScales = new InstancedBufferAttribute(new Float32Array(nearCapacity), 1).setUsage(DynamicDrawUsage)
    const nearMeshes = [false, true].map(leaf => {
      const geometry = (leaf ? model.leaves : model.wood).clone()
      geometry.setAttribute('treeRoot', roots)
      geometry.setAttribute('treeScale', nearScales)
      const material = createTreeMaterial({ model, textures, wind, leaf, alphaToCoverage: options.alphaToCoverage === true, range: options.near, viewer, lodView, fullDetail, sun: options.sun })
      const mesh = new InstancedMesh(geometry, material, nearCapacity)
      mesh.count = 0
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.frustumCulled = false
      mesh.instanceMatrix.setUsage(DynamicDrawUsage)
      mesh.name = material.name
      materials.push(material)
      object.add(mesh)
      return mesh
    })
    const proxy = new InstancedMesh(proxyGeometry(model), proxyMaterial, proxyCapacity)
    proxy.count = 0
    proxy.castShadow = true
    proxy.frustumCulled = false
    proxy.layers.set(layer)
    proxy.instanceMatrix.setUsage(DynamicDrawUsage)
    proxy.name = `world-tree-${model.species.name}-shadow`
    object.add(proxy)
    const atlas = bakeImpostor(options.renderer, model, textures, { frames: options.frames, frameSize: options.frameSize })
    stats.bakeMs += atlas.milliseconds
    atlases.push(atlas)
    const impostorMaterial = createImpostorMaterial({ atlas, wind, range: [options.near[0], options.near[1], options.far[0], options.far[1]], alphaToCoverage: options.alphaToCoverage, singleFrame: options.singleFrame, blur: options.impostorBlur, farTint: options.impostorFarTint, lodView })
    let population = 0
    for (let i = 0; i < total; i++) if (kinds[i] === kind) population++
    const plane = new PlaneGeometry(1, 1)
    const geometry = new InstancedBufferGeometry()
    geometry.index = plane.index
    geometry.setAttribute('position', plane.getAttribute('position'))
    geometry.setAttribute('normal', plane.getAttribute('normal'))
    geometry.setAttribute('uv', plane.getAttribute('uv'))
    const instances = new InstancedBufferAttribute(new Float32Array(population * 4), 4).setUsage(DynamicDrawUsage)
    const impostorScales = new InstancedBufferAttribute(new Float32Array(population), 1).setUsage(DynamicDrawUsage)
    geometry.setAttribute('treeInstance', instances)
    geometry.setAttribute('treeScale', impostorScales)
    geometry.instanceCount = 0
    const impostors = new Mesh(geometry, impostorMaterial)
    impostors.frustumCulled = false
    impostors.receiveShadow = true
    impostors.name = `world-tree-${model.species.name}-impostors`
    object.add(impostors)
    materials.push(impostorMaterial)
    const triangles = ((model.wood.index?.count ?? model.wood.getAttribute('position').count) + (model.leaves.index?.count ?? model.leaves.getAttribute('position').count)) / 3
    stats.fullDetailTriangles += triangles * population
    return { model, nearMeshes, roots, nearScales, proxy, impostors, instances, impostorScales, triangles }
  })
  const matrix = new Matrix4()
  const projection = new Matrix4()
  const previousProjection = new Matrix4().makeScale(0, 0, 0)
  const frustum = new Frustum()
  const sphere = new Sphere()
  const quaternion = new Quaternion()
  const up = new Vector3(0, 1, 0)
  const position = new Vector3()
  const scaleVector = new Vector3()
  const nearCounts = new Int32Array(species.length)
  const proxyCounts = new Int32Array(species.length)
  const impostorCounts = new Int32Array(species.length)
  const fallbackOrder = Array.from({ length: total }, (_, index) => index)
  const fallbackSelection = new Uint8Array(total)
  const lastSelection = new Vector3(Infinity, 0, 0)
  const distanceOf = (i: number) => (positions[i * 4]! - viewer.x) ** 2 + (positions[i * 4 + 1]! - viewer.y) ** 2 + (positions[i * 4 + 2]! - viewer.z) ** 2
  const upload = (attribute: InstancedBufferAttribute, count: number) => {
    attribute.clearUpdateRanges()
    if (count > 0) attribute.addUpdateRange(0, count * attribute.itemSize)
    attribute.needsUpdate = true
  }
  return {
    object, materials, atlases, stats, positions, fallbackCap,
    setLodView(enabled) { lodView.value = enabled ? 1 : 0 },
    setLodEnabled(enabled) {
      if (lodEnabled === enabled) return
      lodEnabled = enabled
      fullDetail.value = enabled ? 0 : 1
      dirty = true
    },
    update(camera) {
      viewer.setFromMatrixPosition(camera.matrixWorld)
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      if (!dirty && projection.equals(previousProjection)) return
      previousProjection.copy(projection)
      frustum.setFromProjectionMatrix(projection, camera.coordinateSystem)
      if (!lodEnabled && (dirty || viewer.distanceToSquared(lastSelection) > 0.25)) {
        fallbackOrder.sort((a, b) => distanceOf(a) - distanceOf(b))
        fallbackSelection.fill(0)
        for (let i = 0; i < Math.min(total, fallbackCap); i++) fallbackSelection[fallbackOrder[i]!] = 1
        lastSelection.copy(viewer)
      }
      dirty = false
      nearCounts.fill(0)
      proxyCounts.fill(0)
      impostorCounts.fill(0)
      stats.sceneTriangles = 0
      stats.drawnTriangles = 0
      stats.candidateInstances = 0
      stats.drawnInstances = 0
      const nearSq = options.near[1] ** 2
      const nearStartSq = options.near[0] ** 2
      const shadowSq = options.shadowDistance ** 2
      const farSq = options.far[1] ** 2
      for (let index = 0; index < total; index++) {
        const x = positions[index * 4]!
        const y = positions[index * 4 + 1]!
        const z = positions[index * 4 + 2]!
        const distanceSq = distanceOf(index)
        const kind = kinds[index]!
        const data = kindsData[kind]!
        const scale = scales[index]!
        const yaw = positions[index * 4 + 3]!
        const meshSelected = lodEnabled ? distanceSq <= nearSq : fallbackSelection[index] === 1
        if (meshSelected && nearCounts[kind]! < nearCapacity) {
          const target = nearCounts[kind]!
          position.set(x, y, z)
          quaternion.setFromAxisAngle(up, yaw)
          matrix.compose(position, quaternion, scaleVector.setScalar(scale))
          for (const mesh of data.nearMeshes) mesh.setMatrixAt(target, matrix)
          data.roots.setXYZ(target, x, y, z)
          data.nearScales.setX(target, scale)
          nearCounts[kind]!++
          stats.sceneTriangles += data.triangles
          stats.drawnTriangles += data.triangles
          stats.candidateInstances++
          stats.drawnInstances++
        } else if (lodEnabled && distanceSq <= shadowSq && proxyCounts[kind]! < proxyCapacity) {
          position.set(x, y, z)
          quaternion.setFromAxisAngle(up, yaw)
          matrix.compose(position, quaternion, scaleVector.setScalar(scale))
          data.proxy.setMatrixAt(proxyCounts[kind]!, matrix)
          proxyCounts[kind]!++
        }
        if (!lodEnabled || distanceSq < nearStartSq || distanceSq > farSq) continue
        stats.sceneTriangles += 2
        stats.candidateInstances++
        const centre = data.model.bounds.center
        const c = Math.cos(yaw)
        const s = Math.sin(yaw)
        sphere.center.set(x + (centre.x * c + centre.z * s) * scale, y + centre.y * scale, z + (-centre.x * s + centre.z * c) * scale)
        sphere.radius = data.model.bounds.radius * scale * 1.05
        if (!frustum.intersectsSphere(sphere)) continue
        const target = impostorCounts[kind]!
        data.instances.setXYZW(target, x, y, z, yaw)
        data.impostorScales.setX(target, scale)
        impostorCounts[kind]!++
        stats.drawnTriangles += 2
        stats.drawnInstances++
      }
      stats.near = 0
      stats.proxies = 0
      stats.impostors = 0
      for (let kind = 0; kind < kindsData.length; kind++) {
        const data = kindsData[kind]!
        const near = nearCounts[kind]!
        for (const mesh of data.nearMeshes) {
          mesh.count = near
          upload(mesh.instanceMatrix, near)
        }
        upload(data.roots, near)
        upload(data.nearScales, near)
        data.proxy.count = proxyCounts[kind]!
        upload(data.proxy.instanceMatrix, data.proxy.count)
        data.impostors.geometry.instanceCount = impostorCounts[kind]!
        upload(data.instances, impostorCounts[kind]!)
        upload(data.impostorScales, impostorCounts[kind]!)
        stats.near += near
        stats.proxies += data.proxy.count
        stats.impostors += impostorCounts[kind]!
      }
      stats.culledInstances = stats.candidateInstances - stats.drawnInstances
    },
    dispose() {
      for (const data of kindsData) {
        for (const mesh of data.nearMeshes) { mesh.geometry.dispose(); mesh.dispose() }
        data.proxy.geometry.dispose()
        data.proxy.dispose()
        data.impostors.geometry.dispose()
      }
      for (const material of materials) material.dispose()
      proxyMaterial.dispose()
      for (const atlas of atlases) atlas.dispose()
    },
  }
}
