import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { LevelBuilder, groundMaterial, worldBoxGeometry, worldPlaneGeometry, apartmentBlock, deadTree, lada, shed, waterTower, type SurfaceName } from '@blacksite/look/world'
import { staticSolid, type Solid, type Surface } from './hits'
import { markerTexture, paperTarget, rangeMaterial, type RangeMaterial } from './materials'

type Vec3 = [number, number, number]
type Place = { at: Vec3; rotate?: number | Vec3; collide?: boolean; shadow?: boolean; cast?: boolean }

const surfaceOf: Record<SurfaceName, Surface> = {
  cast: 'concrete', panel: 'concrete', slab: 'concrete', stained: 'concrete', paint: 'concrete', brick: 'concrete', asphalt: 'concrete',
  rust: 'metal', metal: 'metal', corrugated: 'metal', dirt: 'dirt', grass: 'dirt', gravel: 'dirt',
}
const rangeSurface: Record<RangeMaterial, Surface> = { osb: 'wood', canvas: 'canvas', planks: 'wood', plate: 'steel' }

export type PaperTarget = { id: string; center: THREE.Vector3; normal: THREE.Vector3; radius: number; mesh: THREE.Mesh }

function random(seed: number) {
  let state = seed >>> 0
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296 }
}

export const BOUNDS = { minX: -9.2, maxX: 9.2, minZ: -0.55, maxZ: 6.4 }

export function buildRange() {
  const level = new LevelBuilder()
  const solids: Solid[] = []
  const custom = new Map<RangeMaterial, THREE.BufferGeometry[]>()
  const extra: THREE.Object3D[] = []
  const papers: PaperTarget[] = []
  const rand = random(11)
  let serial = 0
  const euler = new THREE.Euler()
  const rotationOf = (rotate: Place['rotate']): Vec3 => typeof rotate === 'number' ? [0, rotate, 0] : rotate ?? [0, 0, 0]

  const box = (size: Vec3, material: { name: SurfaceName; color?: string; ao?: false }, place: Place) => {
    const before = level.colliders.length
    level.box(size, material, place)
    if (level.colliders.length > before) solids.push(staticSolid(`level:${serial++}`, surfaceOf[material.name], 'box', [size[0] / 2, size[1] / 2, size[2] / 2], place.at, rotationOf(place.rotate)))
  }
  const cylinder = (radius: number, height: number, material: { name: SurfaceName; color?: string }, place: Place, segments = 12) => {
    const before = level.colliders.length
    level.cylinder(radius, height, material, place, segments)
    if (level.colliders.length > before) solids.push(staticSolid(`level:${serial++}`, surfaceOf[material.name], 'cylinder', [radius, height / 2, radius], place.at, rotationOf(place.rotate)))
  }
  const kit = (size: Vec3, material: RangeMaterial, place: Place) => {
    const geometry = worldBoxGeometry(size[0], size[1], size[2], rangeMaterial(material).userData.tile as number)
    const rotation = rotationOf(place.rotate)
    geometry.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...place.at), new THREE.Quaternion().setFromEuler(euler.set(...rotation)), new THREE.Vector3(1, 1, 1)))
    let list = custom.get(material)
    if (!list) { list = []; custom.set(material, list) }
    list.push(geometry.index ? geometry.toNonIndexed() : geometry)
    if (place.collide !== false) solids.push(staticSolid(`kit:${serial++}`, rangeSurface[material], 'box', [size[0] / 2, size[1] / 2, size[2] / 2], place.at, rotation))
    if (place.shadow !== false && place.at[1] - size[1] / 2 < 0.2) level.contact(size[0], size[2], [place.at[0], place.at[2]], rotation[1])
  }

  const ground = new THREE.Mesh(worldPlaneGeometry(320, 320, 4), groundMaterial())
  ground.position.set(0, 0, -60)
  ground.receiveShadow = true
  level.mesh(ground)
  solids.push(staticSolid('ground', 'dirt', 'box', [160, 0.5, 160], [0, -0.5, -60], [0, 0, 0]))

  level.plane(21, 9.2, { name: 'slab', ao: false }, { at: [0, 0.02, 2.9] })
  level.plane(21, 1.2, { name: 'cast', ao: false }, { at: [0, 0.025, -2.0] })
  box([21, 0.12, 0.3], { name: 'cast' }, { at: [0, 0.06, -1.55], shadow: false })

  kit([18.6, 0.07, 0.72], 'planks', { at: [0, 0.98, -1.12] })
  for (const x of [-8.8, -5, -2.5, 0, 2.5, 5, 8.8]) box([0.5, 0.94, 0.5], { name: 'cast', color: '#a29d8d' }, { at: [x, 0.47, -1.12] })
  for (const x of [-7.5, -2.5, 2.5, 7.5]) {
    kit([0.05, 1.5, 1.25], 'osb', { at: [x, 1.85, -0.92], collide: false, shadow: false })
    box([0.08, 2.1, 0.08], { name: 'metal', color: '#3e4038' }, { at: [x, 2.05, -0.3], collide: false, shadow: false })
  }

  for (const x of [-10, -3.4, 3.4, 10]) {
    cylinder(0.09, 3.2, { name: 'metal', color: '#4b4d44' }, { at: [x, 1.6, -1.55] }, 8)
    cylinder(0.09, 3.6, { name: 'metal', color: '#4b4d44' }, { at: [x, 1.8, 6.9] }, 8)
  }
  box([20.6, 0.16, 0.16], { name: 'rust' }, { at: [0, 3.22, -1.55], collide: false })
  box([20.6, 0.16, 0.16], { name: 'rust' }, { at: [0, 3.62, 6.9], collide: false })
  for (const x of [-10, -3.4, 3.4, 10]) box([0.12, 0.14, 8.6], { name: 'rust' }, { at: [x, 3.42, 2.67], rotate: [Math.atan2(0.4, 8.45), 0, 0], collide: false })
  box([21.4, 0.06, 9.4], { name: 'corrugated', color: '#6d6a58' }, { at: [0, 3.5, 2.6], rotate: [Math.atan2(0.4, 8.45), 0, 0], collide: false })

  box([21, 3.6, 0.3], { name: 'brick' }, { at: [0, 1.8, 7.25] })
  for (const side of [-1, 1]) {
    box([0.3, 1.25, 8.8], { name: 'panel' }, { at: [side * 10.4, 0.62, 2.85] })
    box([0.25, 2.6, 0.25], { name: 'cast' }, { at: [side * 10.4, 1.3, -1.55] })
  }

  const bag = (x: number, y: number, z: number, yaw: number) => kit([0.62 + rand() * 0.08, 0.17, 0.34], 'canvas', { at: [x, y, z], rotate: [rand() * 0.05 - 0.025, yaw + rand() * 0.12 - 0.06, rand() * 0.06 - 0.03], collide: false, shadow: y < 0.2 })
  for (let layer = 0; layer < 3; layer++) for (let x = -10; x <= 10; x += 0.66) bag(x + (layer % 2) * 0.33, 0.09 + layer * 0.17, -2.15, 0)
  solids.push(staticSolid('sandbags-front', 'canvas', 'box', [10.4, 0.26, 0.18], [0, 0.26, -2.15], [0, 0, 0]))

  for (const side of [-1, 1]) {
    box([6, 3.2, 66], { name: 'dirt', color: '#6f6b58' }, { at: [side * 16, 1.1, -34], rotate: [0, 0, side * 0.5], collide: true })
    for (let index = 0; index < 4; index++) box([1.2 + rand(), 0.6 + rand() * 0.6, 1.2 + rand()], { name: 'stained' }, { at: [side * (11.5 + rand() * 1.5), 0.3, -8 - index * 13 - rand() * 4], rotate: [rand() * 0.2, rand() * 3, rand() * 0.2] })
  }
  box([44, 8, 7], { name: 'dirt', color: '#6f6b58' }, { at: [0, 2.6, -64], rotate: [0.42, 0, 0] })
  box([44, 4, 4], { name: 'dirt', color: '#6a6754' }, { at: [0, 4.6, -67.5] })

  for (const [z, label] of [[-10, '10'], [-15, '15'], [-25, '25'], [-50, '50']] as const) {
    box([0.22, 1.1, 0.22], { name: 'cast', color: '#9a9585' }, { at: [-11.2, 0.55, z] })
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.52), new THREE.MeshStandardMaterial({ map: markerTexture(label), roughness: 0.9 }))
    sign.position.set(-11.05, 1.25, z)
    sign.rotation.y = Math.PI / 2 - 0.35
    extra.push(sign)
    box([0.06, 0.6, 0.8], { name: 'metal', color: '#3c3e36', ao: false }, { at: [-11.12, 1.25, z], rotate: Math.PI / 2 - 0.35 + Math.PI / 2, collide: false, shadow: false })
  }

  const paperTexture = paperTarget()
  for (const [x, z, yaw, id] of [[-5.6, -10, 0.05, 'paper-a'], [-4.1, -15, -0.04, 'paper-b'], [-6.3, -25, 0.08, 'paper-c']] as const) {
    kit([0.95, 1.25, 0.04], 'osb', { at: [x, 1.12, z], rotate: yaw })
    kit([0.07, 1.3, 0.07], 'planks', { at: [x - 0.38, 0.65, z + 0.05], rotate: yaw, collide: false })
    kit([0.07, 1.3, 0.07], 'planks', { at: [x + 0.38, 0.65, z + 0.05], rotate: yaw, collide: false })
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.72, 0.9), new THREE.MeshStandardMaterial({ map: paperTexture, roughness: 0.95 }))
    paper.position.set(x + Math.sin(yaw) * 0.025, 1.14, z + Math.cos(yaw) * 0.025)
    paper.rotation.y = yaw
    paper.receiveShadow = true
    extra.push(paper)
    const normal = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw))
    const solid = staticSolid(id, 'paper', 'box', [0.36, 0.45, 0.004], [paper.position.x, 1.14, paper.position.z], [0, yaw, 0])
    solid.targetId = id
    solids.unshift(solid)
    papers.push({ id, center: new THREE.Vector3(paper.position.x, 1.14 - 0.45 + 0.9 * 0.44, paper.position.z), normal, radius: 0.72 * 0.06 * 5, mesh: paper })
  }

  for (let layer = 0; layer < 2; layer++) for (let x = -1.8; x <= 1.8; x += 0.62) bag(x + (layer % 2) * 0.3, 0.09 + layer * 0.17, -14.2, 0)
  solids.push(staticSolid('sandbags-poppers', 'canvas', 'box', [2.0, 0.17, 0.18], [0, 0.17, -14.2], [0, 0, 0]))
  for (let layer = 0; layer < 3; layer++) for (let x = -1.6; x <= 1.6; x += 0.62) bag(x + (layer % 2) * 0.3, 0.09 + layer * 0.17, -48.8, 0)
  solids.push(staticSolid('sandbags-far', 'canvas', 'box', [1.9, 0.26, 0.18], [0, 0.26, -48.8], [0, 0, 0]))

  for (const [x, z] of [[-8.6, 0.4], [-8.0, 1.1], [8.7, 5.6]] as const) cylinder(0.3, 0.9, { name: 'rust', color: x > 0 ? '#3f5a4c' : undefined }, { at: [x, 0.45, z] }, 14)
  kit([0.8, 0.4, 0.5], 'planks', { at: [-6.4, 0.2, 5.8], rotate: 0.2 })
  kit([0.8, 0.4, 0.5], 'planks', { at: [-6.3, 0.6, 5.85], rotate: 0.12 })
  kit([0.8, 0.4, 0.5], 'planks', { at: [7.2, 0.2, 0.6], rotate: -0.3 })
  kit([1.2, 0.1, 0.8], 'planks', { at: [4.0, 0.05, 5.2], rotate: 0.4, collide: false })

  apartmentBlock(level, { at: [-24, 0, -108], floors: 9, bays: 12, seed: 4, facing: Math.PI / 2 })
  apartmentBlock(level, { at: [48, 0, -92], floors: 6, bays: 8, seed: 12, facing: Math.PI / 2 + 0.5 })
  apartmentBlock(level, { at: [-62, 0, -40], floors: 5, bays: 7, seed: 19, facing: 0.2 })
  waterTower(level, [-38, 0, -82])
  shed(level, [30, 0, -58], [18, 6, 10], 0.2)
  shed(level, [-34, 0, 14], [16, 5, 9], -0.3, '#6c6e5d')
  lada(level, [14.5, 0, 3.5], 1.2, '#4a3b30')
  for (const [x, z, h, r] of [[-20, -20, 7, 0.3], [22, -18, 8, 1.4], [-24, -46, 6.5, 2.2], [26, -40, 7.5, 0.8], [-18, 8, 7, 3.1], [20, 12, 8.5, 1.9], [8, -76, 9, 0.2], [-12, -80, 7, 1.1]] as const) deadTree(level, [x, 0, z], h, r, false)
  level.cylinder(1.6, 46, { name: 'brick', color: '#7a6a5f' }, { at: [70, 23, -130], collide: false }, 16)
  for (let index = 0; index < 7; index++) {
    const z = 10 - index * 24
    level.box([0.26, 9, 0.26], { name: 'cast' }, { at: [-22, 4.5, z], collide: false })
    level.box([2.2, 0.14, 0.16], { name: 'cast' }, { at: [-22, 8.5, z], collide: false, shadow: false })
  }

  const group = level.build()
  for (const [material, geometries] of custom) {
    const mesh = new THREE.Mesh(mergeGeometries(geometries, false), rangeMaterial(material))
    for (const geometry of geometries) geometry.dispose()
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.matrixAutoUpdate = false
    group.add(mesh)
  }
  for (const object of extra) group.add(object)
  return { group, solids, papers }
}
