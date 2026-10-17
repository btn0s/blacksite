import {
  ConeGeometry, DoubleSide, DynamicDrawUsage, Group, IcosahedronGeometry, InstancedBufferAttribute, InstancedBufferGeometry, InstancedMesh,
  Matrix4, Mesh, MeshBasicMaterial, MeshDepthMaterial, MeshStandardMaterial, PlaneGeometry, Quaternion, RGBADepthPacking, Vector3, Vector4,
} from 'three'
import type { BufferGeometry, Camera, Color, Material, WebGLRenderer } from 'three'
import { createImpostorMaterial, bakeImpostor, type ImpostorAtlas, type TreeTextures } from './impostor'
import { hash2 } from './random'
import { patchMaterial, replaceChunk } from './patch'
import type { TreeModel } from './trees'
import { NOISE_GLSL, WIND_GLSL, type Wind } from './wind'

export interface ForestSpecies {
  readonly model: TreeModel
  readonly textures: TreeTextures
  readonly scale?: readonly [number, number]
}

export interface ForestOptions {
  readonly renderer: WebGLRenderer
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
  readonly stats: { trees: number; candidates: number; near: number; proxies: number; bakeMs: number }
  readonly positions: Float32Array
  update(camera: Camera): void
  dispose(): void
}

const TREE_HEAD = /* glsl */ `
attribute vec3 treeWind;
uniform vec4 treeRange;
varying float vTreeFade;
`

const TREE_BODY = /* glsl */ `
vec3 transformed = vec3(position);
vec3 bsRoot = vec3(instanceMatrix[3].xyz);
float bsW = windAt(bsRoot.xz);
vec3 bsDirLocal = transpose(mat3(instanceMatrix)) * vec3(windDirection.x, 0.0, windDirection.y);
bsDirLocal.y = 0.0;
bsDirLocal = normalize(bsDirLocal + vec3(0.0001, 0.0, 0.0));
float bsTrunk = treeWind.x * (bsW * 0.55 + sin(windTime * 0.75 + treeWind.z * 6.283 + bsRoot.x * 0.05) * 0.18 * (0.35 + bsW)) * treeRange.z;
float bsBranch = treeWind.y * sin(windTime * (1.6 + treeWind.z * 1.4) + treeWind.z * 12.0 + dot(position, vec3(0.35, 0.2, 0.3))) * (0.05 + bsW * 0.09);
transformed.xz += bsDirLocal.xz * bsTrunk;
transformed += objectNormal * bsBranch * 0.5;
transformed.y += bsBranch * 0.25;
vTreeFade = smoothstep(treeRange.x, treeRange.y, distance(cameraPosition, bsRoot));
`

const LEAF_ALPHA = /* glsl */ `
#ifdef TREE_A2C
diffuseColor.a = clamp((diffuseColor.a - 0.5) / max(fwidth(diffuseColor.a), 0.0001) + 0.5, 0.0, 1.0);
if (diffuseColor.a < 0.02) discard;
#else
if (diffuseColor.a < 0.5) discard;
diffuseColor.a = 1.0;
#endif
`

const LEAF_TRANSLUCENCY = /* glsl */ `
#include <emissivemap_fragment>
vec3 bsSunView = normalize((viewMatrix * vec4(treeSunDirection, 0.0)).xyz);
float bsBack = pow(max(dot(normalize(-vViewPosition), bsSunView), 0.0), 4.0);
totalEmissiveRadiance += diffuseColor.rgb * treeSunColor * (bsBack * 0.5 + 0.06);
`

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
  const sun = options.sun
  const stats = { trees: 0, candidates: 0, near: 0, proxies: 0, bakeMs: 0 }
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
  const cellStart = new Int32Array(cellsX * cellsZ + 1)
  for (const tree of candidates) cellStart[cellOf(tree.x, tree.z) + 1]!++
  for (let index = 0; index < cellsX * cellsZ; index++) cellStart[index + 1]! += cellStart[index]!
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
  const nearCapacity = Math.max(64, Math.ceil(Math.PI * options.near[1] ** 2 / (spacing * spacing) * 1.6))
  const proxyCapacity = Math.max(64, Math.ceil(Math.PI * options.shadowDistance ** 2 / (spacing * spacing) * 1.4))
  const treeRange = new Vector4(options.near[0], options.near[1], 0.55, 0)
  const sunUniforms = { treeSunDirection: { value: sun?.direction ?? new Vector3(0.4, 0.8, 0.3).normalize() }, treeSunColor: { value: sun?.color ?? null } }
  const proxyMaterial = new MeshBasicMaterial({ colorWrite: false, depthWrite: true })
  const layer = options.proxyLayer ?? 2

  const kindsData = species.map((entry, kind) => {
    const { model, textures } = entry
    const wood = new MeshStandardMaterial({ name: `world-tree-${model.species.name}-wood`, map: textures.bark, normalMap: textures.barkNormal ?? null, vertexColors: true, roughness: 0.95, metalness: 0 })
    wood.color.setRGB(...model.species.bark)
    const leaves = new MeshStandardMaterial({ name: `world-tree-${model.species.name}-leaves`, map: textures.leaf, vertexColors: true, roughness: 0.78, metalness: 0, side: DoubleSide, alphaToCoverage: options.alphaToCoverage === true })
    leaves.color.setRGB(...model.species.leaves)
    if (options.alphaToCoverage) leaves.defines = { TREE_A2C: '' }
    const shared = { treeRange: { value: treeRange } }
    for (const [material, isLeaf] of [[wood, false], [leaves, true]] as const) {
      patchMaterial(material, `world-tree-${isLeaf ? 'leaf' : 'wood'}`, shader => {
        Object.assign(shader.uniforms, wind.uniforms, shared, sunUniforms)
        shader.vertexShader = `${NOISE_GLSL}\n${WIND_GLSL}\n${TREE_HEAD}\n${shader.vertexShader}`
        shader.vertexShader = replaceChunk(shader.vertexShader, 'begin_vertex', TREE_BODY)
        shader.fragmentShader = `${NOISE_GLSL}\nuniform vec3 treeSunDirection;\nuniform vec3 treeSunColor;\nvarying float vTreeFade;\n${shader.fragmentShader}`
        shader.fragmentShader = replaceChunk(shader.fragmentShader, 'clipping_planes_fragment', '#include <clipping_planes_fragment>\nif (bsDither(gl_FragCoord.xy) < vTreeFade) discard;')
        if (isLeaf) {
          shader.fragmentShader = replaceChunk(shader.fragmentShader, 'alphatest_fragment', LEAF_ALPHA)
          if (sun) shader.fragmentShader = replaceChunk(shader.fragmentShader, 'emissivemap_fragment', LEAF_TRANSLUCENCY)
        }
      })
    }
    const leafDepth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, map: textures.leaf, alphaTest: 0.5, side: DoubleSide })
    const woodDepth = new MeshDepthMaterial({ depthPacking: RGBADepthPacking })
    for (const depth of [leafDepth, woodDepth]) {
      patchMaterial(depth, 'world-tree-depth', shader => {
        Object.assign(shader.uniforms, wind.uniforms, shared)
        shader.vertexShader = `${NOISE_GLSL}\n${WIND_GLSL}\n${TREE_HEAD}\n${shader.vertexShader}`
        shader.vertexShader = replaceChunk(shader.vertexShader, 'begin_vertex', `vec3 objectNormal = normal;\n${TREE_BODY}`)
      })
    }
    const woodMesh = new InstancedMesh(model.wood, wood, nearCapacity)
    const leafMesh = new InstancedMesh(model.leaves, leaves, nearCapacity)
    woodMesh.customDepthMaterial = woodDepth
    leafMesh.customDepthMaterial = leafDepth
    for (const mesh of [woodMesh, leafMesh]) {
      mesh.count = 0
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.frustumCulled = false
      mesh.instanceMatrix.setUsage(DynamicDrawUsage)
      object.add(mesh)
    }
    woodMesh.name = `world-tree-${model.species.name}-wood`
    leafMesh.name = `world-tree-${model.species.name}-leaves`

    const proxy = new InstancedMesh(proxyGeometry(model), proxyMaterial, proxyCapacity)
    proxy.count = 0
    proxy.castShadow = true
    proxy.receiveShadow = false
    proxy.frustumCulled = false
    proxy.layers.set(layer)
    proxy.instanceMatrix.setUsage(DynamicDrawUsage)
    proxy.name = `world-tree-${model.species.name}-shadow`
    object.add(proxy)

    const atlas = bakeImpostor(options.renderer, model, textures, { frames: options.frames, frameSize: options.frameSize })
    stats.bakeMs += atlas.milliseconds
    atlases.push(atlas)
    const impostorMaterial = createImpostorMaterial({ atlas, wind, range: [options.near[0], options.near[1], options.far[0], options.far[1]], alphaToCoverage: options.alphaToCoverage, singleFrame: options.singleFrame, blur: options.impostorBlur, farTint: options.impostorFarTint })
    const indices: number[] = []
    for (let index = 0; index < total; index++) if (kinds[index] === kind) indices.push(index)
    const plane = new PlaneGeometry(1, 1)
    const geometry = new InstancedBufferGeometry()
    geometry.index = plane.index
    geometry.setAttribute('position', plane.getAttribute('position'))
    geometry.setAttribute('normal', plane.getAttribute('normal'))
    geometry.setAttribute('uv', plane.getAttribute('uv'))
    const instance = new Float32Array(indices.length * 4)
    const scale = new Float32Array(indices.length)
    indices.forEach((source, target) => {
      instance.set(positions.subarray(source * 4, source * 4 + 4), target * 4)
      scale[target] = scales[source]!
    })
    geometry.setAttribute('treeInstance', new InstancedBufferAttribute(instance, 4))
    geometry.setAttribute('treeScale', new InstancedBufferAttribute(scale, 1))
    geometry.instanceCount = indices.length
    const impostors = new Mesh(geometry, impostorMaterial)
    impostors.frustumCulled = false
    impostors.receiveShadow = true
    impostors.name = `world-tree-${model.species.name}-impostors`
    object.add(impostors)
    materials.push(wood, leaves, impostorMaterial)
    return { woodMesh, leafMesh, proxy, depth: [leafDepth, woodDepth], impostors, impostorMaterial }
  })

  const matrix = new Matrix4()
  const quaternion = new Quaternion()
  const up = new Vector3(0, 1, 0)
  const position = new Vector3()
  const scaleVector = new Vector3()
  const viewer = new Vector3()
  const last = new Vector3(Infinity, 0, 0)
  const nearCounts = new Int32Array(species.length)
  const proxyCounts = new Int32Array(species.length)
  const reach = Math.max(options.near[1], options.shadowDistance)

  return {
    object,
    materials,
    atlases,
    stats,
    positions,
    update(camera) {
      viewer.setFromMatrixPosition(camera.matrixWorld)
      if (viewer.distanceToSquared(last) < 0.25) return
      last.copy(viewer)
      nearCounts.fill(0)
      proxyCounts.fill(0)
      const c0x = Math.max(0, Math.floor((viewer.x - reach - minX) / cellSize))
      const c1x = Math.min(cellsX - 1, Math.floor((viewer.x + reach - minX) / cellSize))
      const c0z = Math.max(0, Math.floor((viewer.z - reach - minZ) / cellSize))
      const c1z = Math.min(cellsZ - 1, Math.floor((viewer.z + reach - minZ) / cellSize))
      const nearSq = options.near[1] ** 2
      const shadowSq = options.shadowDistance ** 2
      for (let cz = c0z; cz <= c1z; cz++) for (let cx = c0x; cx <= c1x; cx++) {
        const cell = cz * cellsX + cx
        for (let index = cellStart[cell]!; index < cellStart[cell + 1]!; index++) {
          const x = positions[index * 4]!
          const y = positions[index * 4 + 1]!
          const z = positions[index * 4 + 2]!
          const dx = x - viewer.x
          const dy = y - viewer.y
          const dz = z - viewer.z
          const distanceSq = dx * dx + dy * dy + dz * dz
          if (distanceSq > shadowSq && distanceSq > nearSq) continue
          const kind = kinds[index]!
          const data = kindsData[kind]!
          position.set(x, y, z)
          quaternion.setFromAxisAngle(up, positions[index * 4 + 3]!)
          const s = scales[index]!
          scaleVector.set(s, s, s)
          matrix.compose(position, quaternion, scaleVector)
          if (distanceSq <= nearSq) {
            if (nearCounts[kind]! < nearCapacity) {
              data.woodMesh.setMatrixAt(nearCounts[kind]!, matrix)
              data.leafMesh.setMatrixAt(nearCounts[kind]!, matrix)
              nearCounts[kind]!++
            }
          } else if (proxyCounts[kind]! < proxyCapacity) {
            data.proxy.setMatrixAt(proxyCounts[kind]!, matrix)
            proxyCounts[kind]!++
          }
        }
      }
      let near = 0
      let proxies = 0
      kindsData.forEach((data, kind) => {
        for (const mesh of [data.woodMesh, data.leafMesh]) {
          mesh.count = nearCounts[kind]!
          mesh.instanceMatrix.clearUpdateRanges()
          mesh.instanceMatrix.addUpdateRange(0, nearCounts[kind]! * 16)
          mesh.instanceMatrix.needsUpdate = true
        }
        data.proxy.count = proxyCounts[kind]!
        data.proxy.instanceMatrix.clearUpdateRanges()
        data.proxy.instanceMatrix.addUpdateRange(0, proxyCounts[kind]! * 16)
        data.proxy.instanceMatrix.needsUpdate = true
        near += nearCounts[kind]!
        proxies += proxyCounts[kind]!
      })
      stats.near = near
      stats.proxies = proxies
    },
    dispose() {
      for (const data of kindsData) {
        data.woodMesh.dispose()
        data.leafMesh.dispose()
        data.proxy.geometry.dispose()
        data.proxy.dispose()
        data.impostors.geometry.dispose()
        for (const depth of data.depth) depth.dispose()
      }
      for (const material of materials) material.dispose()
      proxyMaterial.dispose()
      for (const atlas of atlases) atlas.dispose()
    },
  }
}
