import { Matrix4, Quaternion, Vector3 } from 'three'
import { hash2 } from '@blacksite/landscape'
import type { ValleyWorld } from './world'
import { aqueductCurves, layout, sampleCurves } from './layout'

export type Triple = [number, number, number]

export const ruinPieces = [
  'masonry-block', 'masonry-block-mossy', 'wall-run', 'wall-run-damaged', 'column-shaft', 'column-base', 'column-capital', 'column-drums-fallen',
  'arch-voussoir', 'ornament-panel', 'entablature-segment', 'statue-niche', 'door-arch-keystone', 'tower-top-broken', 'stair-flight', 'paving-slab',
  'rubble-cluster', 'robed-statue', 'shrine-face', 'watchtower-wall', 'watchtower-stump', 'standing-stone', 'gateway-ornate',
  'aqueduct-pier-arch', 'aqueduct-channel', 'aqueduct-collapsed', 'bridge-deck-span', 'bridge-pier',
  'stratified-rock', 'cliff-face', 'boulder-rounded', 'boulder-angular', 'boulder-slab',
] as const

export type RuinPiece = typeof ruinPieces[number]
export type RuinKit = Record<RuinPiece, { dimensions: Triple }>
export type Stonework = ReturnType<typeof buildStonework>

const up = new Vector3(0, 1, 0)
const front = new Vector3(0, 0, 1)
const right = new Vector3(1, 0, 0)
const boxFaces = [0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5]
const debrisKinds: RuinPiece[] = ['rubble-cluster', 'masonry-block-mossy', 'masonry-block', 'column-drums-fallen', 'boulder-rounded']
const fieldKinds: RuinPiece[] = ['boulder-rounded', 'boulder-angular', 'boulder-slab', 'boulder-rounded']
const crestKinds: RuinPiece[] = ['stratified-rock', 'boulder-angular', 'stratified-rock']

export function buildStonework(world: ValleyWorld, kit: RuinKit) {
  const pieces = Object.fromEntries(ruinPieces.map(id => [id, []])) as unknown as Record<RuinPiece, Matrix4[]>
  const vertices: number[] = []
  const indices: number[] = []
  const point = new Vector3()
  const dimensions = (id: RuinPiece) => kit[id].dimensions
  const fit = (id: RuinPiece, height: number): Triple => dimensions(id).map(value => value * height / dimensions(id)[1]) as Triple
  const scaled = (id: RuinPiece, scale: number): Triple => dimensions(id).map(value => value * scale) as Triple
  const collider = (matrix: Matrix4, size: Triple, ramp = false) => {
    const offset = vertices.length / 3
    for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      point.set((x - 0.5) * size[0], y * size[1] * (ramp ? 1 - z : 1), (z - 0.5) * size[2]).applyMatrix4(matrix)
      vertices.push(point.x, point.y, point.z)
    }
    indices.push(...boxFaces.map(index => offset + index))
  }
  const transform = (at: Triple, yaw: number, tilt = 0, pitch = 0) => new Matrix4().compose(
    new Vector3(...at), new Quaternion().setFromAxisAngle(up, yaw).multiply(new Quaternion().setFromAxisAngle(front, tilt)).multiply(new Quaternion().setFromAxisAngle(right, pitch)), new Vector3(1, 1, 1),
  )
  const place = (id: RuinPiece, at: Triple, size: Triple = dimensions(id), yaw = 0, solid = false, tilt = 0, pitch = 0) => {
    const matrix = transform(at, yaw, tilt, pitch)
    if (solid) collider(matrix, size)
    const base = dimensions(id)
    matrix.scale(new Vector3(size[0] / base[0], size[1] / base[1], size[2] / base[2]))
    pieces[id].push(matrix)
  }
  const local = (x: number, y: number, z: number, yaw: number, dx: number, dy: number, dz = 0): Triple => [x + Math.cos(yaw) * dx + Math.sin(yaw) * dz, y + dy, z - Math.sin(yaw) * dx + Math.cos(yaw) * dz]
  const arch = (x: number, y: number, z: number, radius: number, spring: number, depth: number, thickness: number, yaw = 0, solid = true) => {
    for (const sign of [-1, 1]) {
      const courses = Math.ceil(spring / (thickness * 0.7))
      for (let course = 0; course < courses; course++) place(hash2(x + sign, course, 971) > 0.7 ? 'masonry-block-mossy' : 'masonry-block', local(x, y, z, yaw, sign * (radius + thickness / 2), course * spring / courses), [thickness, spring / courses, depth], yaw)
      if (solid) collider(transform(local(x, y, z, yaw, sign * (radius + thickness / 2), 0), yaw), [thickness, spring, depth])
    }
    const segments = Math.max(9, Math.ceil(Math.PI * (radius + thickness / 2) / (thickness * 0.85)))
    for (let i = 0; i < segments; i++) {
      const angle = Math.PI * (i + 0.5) / segments
      const width = 2 * (radius + thickness / 2) * Math.sin(Math.PI / segments / 2) * 1.04
      place('arch-voussoir', local(x, y, z, yaw, Math.cos(angle) * radius, spring + Math.sin(angle) * radius), [width, thickness, depth], yaw, false, angle - Math.PI / 2)
    }
  }
  const paving = (cx: number, cz: number, width: number, depth: number, height: number, yaw = 0) => {
    const columns = Math.ceil(width / 6), rows = Math.ceil(depth / 5)
    const sx = width / columns, sz = depth / rows
    for (let column = 0; column < columns; column++) for (let row = 0; row < rows; row++) {
      const x = (column + 0.5) * sx - width / 2, z = (row + 0.5) * sz - depth / 2
      place('paving-slab', local(cx, height, cz, yaw, x, hash2(x, z, 903) * 0.04, z), [sx - 0.035, 0.22, sz - 0.035], yaw)
    }
    collider(transform([cx, height - 0.2, cz], yaw), [width, 0.4, depth])
  }
  const podium = (minX: number, minZ: number, maxX: number, maxZ: number, top: number) => {
    const edges: Array<[Triple, Triple]> = [
      [[minX, 0, minZ + 1.5], [maxX, 0, minZ + 1.5]],
      [[minX, 0, maxZ - 1.5], [maxX, 0, maxZ - 1.5]],
      [[minX + 1.5, 0, minZ], [minX + 1.5, 0, maxZ]],
      [[maxX - 1.5, 0, minZ], [maxX - 1.5, 0, maxZ]],
    ]
    let bottom = top
    for (const [a, b] of edges) {
      const span = Math.hypot(b[0] - a[0], b[2] - a[2]), count = Math.ceil(span / 6)
      const yaw = Math.atan2(-(b[2] - a[2]), b[0] - a[0])
      for (let panel = 0; panel < count; panel++) {
        const t = (panel + 0.5) / count, x = a[0] + (b[0] - a[0]) * t, z = a[2] + (b[2] - a[2]) * t
        const ground = world.heightAt(x, z) - 0.5
        bottom = Math.min(bottom, ground)
        for (let course = 0; top - course * 4 > ground; course++) place(course === 0 && hash2(x, z, 977) > 0.6 ? 'wall-run-damaged' : 'wall-run', [x, top - (course + 1) * 4, z], [span / count + 0.04, 4.02, 3], yaw)
      }
    }
    collider(transform([(minX + maxX) / 2, bottom, (minZ + maxZ) / 2], 0), [maxX - minX, top - bottom, maxZ - minZ])
  }
  const debris = (cx: number, cz: number, count: number, radius: number, seed: number, kinds = debrisKinds, scale: [number, number] = [0.5, 1.6], floor?: number) => {
    for (let i = 0; i < count; i++) {
      const a = hash2(i, seed, 911) * Math.PI * 2, r = Math.sqrt(hash2(i, seed, 919)) * radius
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r
      if (world.pathDistance(x, z) < 3) continue
      const id = kinds[Math.floor(hash2(i, seed, 923) * kinds.length)]!
      const size = scaled(id, scale[0] + hash2(i, seed, 929) * (scale[1] - scale[0]))
      place(id, [x, (floor ?? world.heightAt(x, z)) - size[1] * 0.12, z], size, a)
    }
  }

  const tower = layout.watchtower.at, towerY = world.heightAt(...tower)
  place('watchtower-stump', [tower[0], towerY - 0.8, tower[1]], fit('watchtower-stump', 11.5), 0.4, true)
  debris(tower[0], tower[1], 34, 24, 17, ['rubble-cluster', 'masonry-block-mossy', 'boulder-rounded', 'boulder-slab', 'masonry-block'])

  for (let i = 0; i < 9; i++) {
    const angle = i / 9 * Math.PI * 2 + hash2(i, 5, 939) * 0.3
    const radius = 15 + hash2(i, 6, 943) * 6
    const x = layout.stones.at[0] + Math.cos(angle) * radius, z = layout.stones.at[1] + Math.sin(angle) * radius * 0.8
    const size = fit('standing-stone', 5 + hash2(i, 7, 941) * 4.5)
    place('standing-stone', [x, world.heightAt(x, z) - 0.3, z], size, angle + 0.25, true, (hash2(i, 9, 947) - 0.5) * 0.12)
  }
  debris(layout.stones.at[0], layout.stones.at[1], 26, 40, 23, ['boulder-slab', 'boulder-rounded', 'masonry-block-mossy', 'boulder-angular'], [0.4, 1.1])

  const [archX, archZ] = layout.arch.at, archY = world.heightAt(archX, archZ), archYaw = -0.86
  const gateway = fit('gateway-ornate', 24)
  place('gateway-ornate', [archX, archY - 0.6, archZ], gateway, archYaw)
  for (const side of [-1, 1]) {
    collider(transform(local(archX, archY - 0.6, archZ, archYaw, side * gateway[0] * 0.36, 0), archYaw), [gateway[0] * 0.28, gateway[1], gateway[2]])
    for (let i = 0; i < 4; i++) place(i % 2 ? 'wall-run-damaged' : 'wall-run', local(archX, archY - 0.4, archZ, archYaw, side * (gateway[0] / 2 + 3 + i * 5.6), 0), [5.8, 10 - i * 2, 2.8], archYaw, true)
  }
  debris(archX, archZ, 46, 34, 31)

  const aqueduct = sampleCurves(aqueductCurves, 31)
  let segment = 0
  for (let span = 0; span < aqueduct.length - 1; span++) {
    const a = aqueduct[span]!, b = aqueduct[span + 1]!, length = Math.hypot(b[0] - a[0], b[1] - a[1])
    const count = Math.max(1, Math.round(length / 30)), step = length / count
    const yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0])
    for (let i = 0; i < count; i++, segment++) {
      const t = (i + 0.5) / count, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t
      const ends = [-0.5, 0, 0.5].map(offset => { const [px, , pz] = local(x, 0, z, yaw, offset * step, 0); return world.heightAt(px, pz) })
      const y = Math.min(...ends) - 1.5, height = world.heightAt(x, z) - y + 24 + 6 * Math.sin(segment * 0.14)
      const broken = segment % 11 === 5 || segment % 17 === 9
      if (!broken) {
        place('aqueduct-pier-arch', [x, y, z], [step + 0.3, height, 5.5], yaw)
        place('aqueduct-channel', [x, y + height - 0.2, z], [step + 0.3, 2.6, 5.5], yaw)
        for (const sign of [-1, 1]) collider(transform(local(x, y, z, yaw, sign * step * 0.42, 0), yaw), [step * 0.16, height, 5.5])
      } else {
        place('aqueduct-collapsed', [x, y, z], [step + 0.3, height * 0.6, 8], yaw)
        collider(transform(local(x, y, z, yaw, -step * 0.38, 0), yaw), [step * 0.2, height * 0.5, 5.5])
        debris(x, z, 6, 14, segment + 71, ['rubble-cluster', 'masonry-block-mossy', 'arch-voussoir'])
      }
    }
  }

  const bridgeA = new Vector3(...layout.bridge.start), bridgeB = new Vector3(...layout.bridge.end)
  const bridgeLength = Math.hypot(bridgeB.x - bridgeA.x, bridgeB.z - bridgeA.z), bridgeYaw = Math.atan2(bridgeA.x - bridgeB.x, bridgeA.z - bridgeB.z)
  const bridgePitch = Math.atan2(bridgeB.y - bridgeA.y, bridgeLength), bridgeSpan = bridgeA.distanceTo(bridgeB)
  const deckSpans = Math.ceil(bridgeSpan / 12)
  for (let i = 0; i < deckSpans; i++) {
    const at = bridgeA.clone().lerp(bridgeB, (i + 0.5) / deckSpans)
    place('bridge-deck-span', [at.x, at.y - 2.2, at.z], [layout.bridge.width + 1.5, 2.4, bridgeSpan / deckSpans + 0.1], bridgeYaw, false, 0, bridgePitch)
  }
  const bridgeMiddle = bridgeA.clone().lerp(bridgeB, 0.5)
  collider(transform([bridgeMiddle.x, bridgeMiddle.y - 0.2, bridgeMiddle.z], bridgeYaw, 0, bridgePitch), [layout.bridge.width - 0.5, 0.4, bridgeSpan])
  for (let i = 1; i < 7; i++) {
    const at = bridgeA.clone().lerp(bridgeB, i / 7), floor = world.heightAt(at.x, at.z) - 3
    if (at.y - floor < 12) continue
    place('bridge-pier', [at.x, floor, at.z], [11, at.y - 2 - floor, 13], bridgeYaw)
  }

  const templeX = layout.temple.frontX, templeZ = layout.temple.at[1], base = layout.temple.platform, facing = -Math.PI / 2
  const temple = (id: RuinPiece, u: number, y: number, depth: number, size: Triple, solid = false) => place(id, [templeX + depth, base + y, templeZ + u], size, facing, solid)
  paving(1022, templeZ, 218, 144, layout.temple.ground - 0.02, facing)
  paving(1262, templeZ, 174, 176, base - 0.22, facing)
  paving(1212, -251, 138, 76, base - 0.22, facing)
  podium(1174, -182, 1350, -8, base - 0.22)
  podium(1174, -320, 1250, -182, base - 0.22)
  const stairTop = templeX - 16, stairDepth = 80, stairRise = base - layout.temple.ground, flights = 16, lanes = 7
  for (let flight = 0; flight < flights; flight++) for (let lane = 0; lane < lanes; lane++) {
    place('stair-flight', [stairTop - stairDepth + (flight + 0.5) * stairDepth / flights, layout.temple.ground + flight * stairRise / flights, templeZ + (lane + 0.5 - lanes / 2) * 12], [12.02, stairRise / flights, stairDepth / flights + 0.04], facing)
  }
  collider(transform([stairTop - stairDepth / 2, layout.temple.ground, templeZ], facing), [84, stairRise, stairDepth], true)
  for (const side of [-1, 1]) for (let flight = 0; flight < flights; flight += 2) {
    place('wall-run', [stairTop - stairDepth + (flight + 1) * stairDepth / flights, layout.temple.ground + flight * stairRise / flights, templeZ + side * 44], [3.4, 4.8, stairDepth / flights * 2], facing)
  }
  for (let u = -81; u <= 81; u += 6) for (let course = 0; course < 18; course++) {
    const y = course * 4
    const opening = Math.abs(u) < 17 && y < 54
    if (opening || (course > 15 && hash2(u, course, 953) > 0.7)) continue
    temple(course < 12 ? 'masonry-block' : hash2(u, course, 957) > 0.5 ? 'wall-run-damaged' : 'wall-run', u, y, 4, [6.08, 4.02, 9], y < 8)
  }
  const door = [40, 54, 12] as Triple
  temple('door-arch-keystone', 0, 0, -1.5, door)
  for (const side of [-1, 1]) collider(transform([templeX - 1.5, base, templeZ + side * door[0] * 0.39], facing), [door[0] * 0.22, door[1], door[2]])
  temple('ornament-panel', 0, 55, -1.5, [15, 15, 2])
  for (const u of [-72, -48, -25, 25, 48, 72]) {
    temple('column-base', u, 0, -9, [8.4, 4.2, 8.4], true)
    for (let tier = 0; tier < 3; tier++) temple('column-shaft', u, 4.2 + tier * 19, -9, [5.6, 19, 5.6], true)
    temple('column-capital', u, 61.2, -9, [8.4, 4.9, 8.4])
  }
  for (const u of [-37, 37]) {
    temple('statue-niche', u, 1, -2.4, [11, 27, 5])
    temple('column-base', u, 3, -5.2, [6, 2.5, 5.5], true)
    temple('robed-statue', u, 5.5, -5.4, fit('robed-statue', 15), true)
  }
  for (let u = -78; u <= 78; u += 12) temple('entablature-segment', u, 66, -6, [12.1, 7, 14])
  const towerAt: Triple = [templeX + 30, base, templeZ - 112]
  for (let level = 0; level < 21; level++) for (let side = 0; side < 4; side++) for (let panel = -1; panel <= 1; panel++) {
    if (level > 13 && level < 19 && panel === 0) continue
    const angle = side * Math.PI / 2
    place(level > 10 && hash2(level, side * 3 + panel, 961) > 0.6 ? 'wall-run-damaged' : 'wall-run', local(...towerAt, angle, panel * 10, level * 4, 15), [10.1, 4.05, 3], angle, level < 3)
  }
  place('tower-top-broken', [towerAt[0], base + 84, towerAt[2]], [33, 30, 33], 0.02)
  for (let bay = 0; bay < 5; bay++) for (let tier = 0; tier < 2; tier++) {
    const z = templeZ - 100 - bay * 24
    arch(templeX + 14, base + tier * 23, z, 9, 9, 5, 2.8, facing)
    place('entablature-segment', [templeX + 14, base + tier * 23 + 19, z], [24, 4, 6], facing)
  }
  for (let depth = 20; depth < 160; depth += 20) for (const side of [-1, 1]) {
    const u = side * 65
    temple('column-base', u, 0, depth, [6, 3, 6], true)
    for (let tier = 0; tier < 2; tier++) temple('column-shaft', u, 3 + tier * 20, depth, [4, 20, 4], true)
    temple('column-capital', u, 43, depth, [6, 3.5, 6])
  }
  debris(templeX + 35, templeZ - 105, 32, 30, 101, debrisKinds, [0.6, 2], base)
  debris(templeX - 55, templeZ - 75, 28, 35, 103, ['column-drums-fallen', 'rubble-cluster', 'masonry-block-mossy'], [0.8, 2.2], layout.temple.ground)
  debris(templeX + 80, templeZ + 65, 35, 45, 107, debrisKinds, [0.6, 2], base)
  debris(templeX - 80, templeZ + 40, 10, 50, 113, ['column-drums-fallen', 'masonry-block-mossy'], [1.2, 2.4], layout.temple.ground)

  const [shrineX, shrineZ] = layout.shrine.at, shrineY = layout.shrine.ground
  place('shrine-face', [shrineX, shrineY + 6, shrineZ + 12], fit('shrine-face', 30), Math.PI)
  for (const side of [-1, 1]) place('cliff-face', [shrineX + side * 26, shrineY - 2, shrineZ + 16], [30, 44, 14], Math.PI + side * 0.25)
  for (let i = 0; i < 5; i++) place('stair-flight', [shrineX - 8 + i * 4, shrineY - 0.4, shrineZ - 4], [4, 1.2, 3.2], Math.PI)
  debris(shrineX, shrineZ - 10, 26, 30, 109, ['masonry-block-mossy', 'boulder-rounded', 'boulder-slab', 'rubble-cluster'], [0.4, 1.2])

  const downhill = (x: number, z: number) => {
    const dx = world.heightAt(x + 6, z) - world.heightAt(x - 6, z), dz = world.heightAt(x, z + 6) - world.heightAt(x, z - 6)
    const length = Math.hypot(dx, dz) || 1
    return [-dx / length, -dz / length] as const
  }
  const sheltered = (x: number, z: number) => world.pathDistance(x, z) < 10 || (x > 910 && x < 1450 && z > -280 && z < 130) || Math.hypot(x - shrineX, z - shrineZ) < 40
  const cliff = (x: number, z: number, seed: number) => {
    if (sheltered(x, z)) return
    const [nx, nz] = downhill(x, z)
    const foot = world.heightAt(x + nx * 22, z + nz * 22), crest = world.heightAt(x - nx * 22, z - nz * 22)
    if (crest - foot < 10) return
    const width = 22 + hash2(x, z, seed) * 14
    place('cliff-face', [x, foot - 5, z], [width, crest - foot + 7, 12 + hash2(z, x, seed) * 8], Math.atan2(nx, nz) + (hash2(x, z, seed + 3) - 0.5) * 0.35)
  }
  const outcrop = (x: number, z: number, seed: number, kinds: RuinPiece[], magnitude: number, expose: number) => {
    if (sheltered(x, z)) return
    const id = kinds[Math.floor(hash2(x, z, seed + 5) * kinds.length)]!
    const size = fit(id, magnitude * (0.6 + hash2(x, z, seed) * 0.7))
    place(id, [x, world.heightAt(x, z) - size[1] * (1 - expose), z], size, hash2(z, x, seed + 1) * Math.PI * 2)
  }
  for (let z = -1800; z < 1700; z += 20) outcrop(-1620 + Math.sin(z / 190) * 32, z, 113, crestKinds, 7, 0.55)
  for (let z = -700; z < 660; z += 18) for (const side of [655, 830]) cliff(side + Math.sin(z / 43) * 10, z, 127)
  for (let x = -650; x < 720; x += 22) cliff(x, 1330 + Math.sin(x / 110) * 20, 137)
  for (let i = 0; i < 130; i++) {
    const a = i / 130 * Math.PI * 2
    cliff(1195 + Math.cos(a) * 390 * 0.93, -65 + Math.sin(a) * 700 * 0.93, 139)
  }
  for (let field = 0; field < 30; field++) {
    const side = field % 3
    const cx = side === 0 ? -1560 : side === 1 ? 560 : -600 + hash2(field, 1, 149) * 1300
    const cz = side === 2 ? 1250 : -1500 + hash2(field, 3, 151) * 3000
    for (let i = 0; i < 14; i++) {
      const a = hash2(i, field, 157) * Math.PI * 2, r = Math.sqrt(hash2(i, field, 163)) * 45
      outcrop(cx + Math.cos(a) * r, cz + Math.sin(a) * r, field * 31 + i, fieldKinds, 0.8 + hash2(i, field, 167) ** 2 * 3.5, 0.8)
    }
  }
  return { pieces, collider: { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) } }
}
