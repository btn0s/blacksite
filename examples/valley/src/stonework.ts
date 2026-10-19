import { Matrix4, Quaternion, Vector3 } from 'three'
import { hash2 } from '@blacksite/landscape'
import type { ValleyWorld } from './world'
import { aqueductCurves, layout, sampleCurves } from './layout'

type Triple = [number, number, number]

export const ruinDimensions = {
  'masonry-block': [2.4, 1.2, 1.4],
  'wall-run': [6, 4, 1.2],
  'column-shaft': [1.6, 8, 1.6],
  'column-base': [2.4, 1.2, 2.4],
  'column-capital': [2.4, 1.4, 2.4],
  'arch-voussoir': [1.6, 1.8, 1.4],
  'ornament-panel': [3, 3, 0.4],
  'stair-flight': [4, 1.8, 4.8],
  'paving-slab': [2, 0.22, 1.6],
  'rubble-cluster': [3.5, 1.2, 2.8],
  'robed-statue': [1.6, 4.8, 1.4],
  'shrine-face': [7, 9, 3],
  'watchtower-wall': [5, 6, 0.9],
  'stratified-rock': [8, 6, 5],
  'standing-stone': [1.7, 6.5, 1.3],
} satisfies Record<string, Triple>

export type RuinPiece = keyof typeof ruinDimensions
export type Stonework = ReturnType<typeof buildStonework>

const up = new Vector3(0, 1, 0)
const front = new Vector3(0, 0, 1)
const right = new Vector3(1, 0, 0)
const boxFaces = [0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 4, 1, 5, 4, 2, 6, 3, 3, 6, 7, 0, 4, 2, 2, 4, 6, 1, 3, 5, 3, 7, 5]

export function buildStonework(world: ValleyWorld) {
  const pieces = Object.fromEntries(Object.keys(ruinDimensions).map(id => [id, []])) as Record<RuinPiece, Matrix4[]>
  const vertices: number[] = []
  const indices: number[] = []
  const fieldRocks: Matrix4[] = []
  const point = new Vector3()
  const collider = (matrix: Matrix4, dimensions: Triple, ramp = false) => {
    const offset = vertices.length / 3
    for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
      point.set((x - 0.5) * dimensions[0], y * dimensions[1] * (ramp ? 1 - z : 1), (z - 0.5) * dimensions[2]).applyMatrix4(matrix)
      vertices.push(point.x, point.y, point.z)
    }
    indices.push(...boxFaces.map(index => offset + index))
  }
  const transform = (at: Triple, yaw: number, tilt = 0, pitch = 0) => new Matrix4().compose(
    new Vector3(...at), new Quaternion().setFromAxisAngle(up, yaw).multiply(new Quaternion().setFromAxisAngle(front, tilt)).multiply(new Quaternion().setFromAxisAngle(right, pitch)), new Vector3(1, 1, 1),
  )
  const place = (id: RuinPiece, at: Triple, size: Triple = ruinDimensions[id], yaw = 0, solid = false, tilt = 0, pitch = 0) => {
    const matrix = transform(at, yaw, tilt, pitch)
    if (solid) collider(matrix, size)
    const base = ruinDimensions[id]
    matrix.scale(new Vector3(size[0] / base[0], size[1] / base[1], size[2] / base[2]))
    pieces[id].push(matrix)
  }
  const local = (x: number, y: number, z: number, yaw: number, dx: number, dy: number, dz = 0): Triple => [x + Math.cos(yaw) * dx + Math.sin(yaw) * dz, y + dy, z - Math.sin(yaw) * dx + Math.cos(yaw) * dz]
  const arch = (x: number, y: number, z: number, radius: number, spring: number, depth: number, thickness: number, yaw = 0, solid = true) => {
    for (const sign of [-1, 1]) {
      const courses = Math.ceil(spring / (thickness * 0.7))
      for (let course = 0; course < courses; course++) place('masonry-block', local(x, y, z, yaw, sign * (radius + thickness / 2), course * spring / courses), [thickness, spring / courses, depth], yaw)
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
    const columns = Math.ceil(width / 4.8), rows = Math.ceil(depth / 4)
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
        for (let course = 0; top - course * 4 > ground; course++) place('wall-run', [x, top - (course + 1) * 4, z], [span / count + 0.04, 4.02, 3], yaw)
      }
    }
    collider(transform([(minX + maxX) / 2, bottom, (minZ + maxZ) / 2], 0), [maxX - minX, top - bottom, maxZ - minZ])
  }
  const rubble = (cx: number, cz: number, count: number, radius: number, seed: number, floor?: number) => {
    for (let i = 0; i < count; i++) {
      const a = hash2(i, seed, 911) * Math.PI * 2, r = Math.sqrt(hash2(i, seed, 919)) * radius
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r
      if (world.pathDistance(x, z) < 3) continue
      const scale = 0.45 + hash2(i, seed, 929) * 1.5
      place('rubble-cluster', [x, floor ?? world.heightAt(x, z), z], [3.5 * scale, 1.2 * scale, 2.8 * scale], a)
    }
  }

  const towerY = world.heightAt(-1500, 150)
  for (let i = 0; i < 14; i++) {
    const angle = i / 16 * Math.PI * 2 + 0.55
    const x = -1500 + Math.sin(angle) * 12, z = 150 + Math.cos(angle) * 12
    const h = i < 5 ? 9 : 3.5 + hash2(i, 2, 937) * 3
    place('watchtower-wall', [x, towerY - 0.4, z], [5.4, h, 2.1], angle, true)
  }
  rubble(-1500, 150, 26, 21, 17)

  for (let i = 0; i < 7; i++) {
    const angle = i / 7 * Math.PI * 2
    const x = -1100 + Math.cos(angle) * 16, z = 300 + Math.sin(angle) * 12
    const h = 6 + hash2(i, 7, 941) * 5
    place('standing-stone', [x, world.heightAt(x, z) - 0.25, z], [2.5, h, 2], angle + 0.25, true, (hash2(i, 9, 947) - 0.5) * 0.09)
  }
  rubble(-1100, 300, 16, 28, 23)

  const archY = world.heightAt(-500, -150), archYaw = -0.86
  arch(-500, archY, -150, 6, 8, 4.5, 2.4, archYaw)
  for (const side of [-1, 1]) for (let i = 0; i < 4; i++) {
    const at = local(-500, archY, -150, archYaw, side * (11 + i * 5), 0)
    place('wall-run', at, [5.2, 9 - i * 1.6, 2.8], archYaw, true)
  }
  place('ornament-panel', local(-500, archY, -150, archYaw, 0, 14, 1.8), [4, 4, 0.6], archYaw)
  rubble(-500, -150, 42, 34, 31)

  const aqueduct = sampleCurves(aqueductCurves, 31)
  let segment = 0
  for (let span = 0; span < aqueduct.length - 1; span++) {
    const a = aqueduct[span], b = aqueduct[span + 1], length = Math.hypot(b[0] - a[0], b[1] - a[1])
    const count = Math.max(1, Math.round(length / 30)), step = length / count
    const yaw = Math.atan2(-(b[1] - a[1]), b[0] - a[0])
    for (let i = 0; i < count; i++, segment++) {
      const t = (i + 0.5) / count, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t
      const y = world.heightAt(x, z), broken = segment % 11 === 5 || segment % 17 === 9
      const height = 26 + 8 * Math.sin(segment * 0.14)
      if (!broken) {
        arch(x, y, z, step * 0.39, height - step * 0.39, 5, step * 0.11, yaw)
        place('wall-run', [x, y + height + step * 0.11, z], [step + 0.2, 4.5, 6.4], yaw)
      } else {
        place('wall-run', local(x, y, z, yaw, -step * 0.4, 0), [step * 0.2, height * 0.7, 5], yaw, true)
        rubble(x, z, 7, 14, segment + 71)
      }
    }
  }

  const bridgeA = new Vector3(...layout.bridge.start), bridgeB = new Vector3(...layout.bridge.end)
  const bridgeLength = Math.hypot(bridgeB.x - bridgeA.x, bridgeB.z - bridgeA.z), bridgeYaw = Math.atan2(bridgeA.x - bridgeB.x, bridgeA.z - bridgeB.z)
  const bridgePitch = Math.atan2(bridgeB.y - bridgeA.y, bridgeLength), bridgeSpan = bridgeA.distanceTo(bridgeB)
  const bridgeSteps = 70
  for (let i = 0; i < bridgeSteps; i++) {
    const t = (i + 0.5) / bridgeSteps, at = bridgeA.clone().lerp(bridgeB, t)
    for (let lane = -1; lane <= 1; lane++) place('paving-slab', local(at.x, at.y - 0.2, at.z, bridgeYaw, lane * 4.5, 0), [4.5, 0.4, bridgeSpan / bridgeSteps + 0.08], bridgeYaw, false, 0, bridgePitch)
    if (i % 2 === 0) for (const side of [-1, 1]) place('wall-run', local(at.x, at.y, at.z, bridgeYaw, side * 7, 0), [1.3, 1.8, bridgeLength / bridgeSteps * 2], bridgeYaw)
  }
  const bridgeMiddle = bridgeA.clone().lerp(bridgeB, 0.5)
  const bridgeMatrix = transform([bridgeMiddle.x, bridgeMiddle.y - 0.2, bridgeMiddle.z], bridgeYaw, 0, bridgePitch)
  collider(bridgeMatrix, [13.5, 0.4, bridgeSpan])
  for (let i = 1; i < 6; i++) {
    const t = i / 6, at = bridgeA.clone().lerp(bridgeB, t), floor = world.heightAt(at.x, at.z)
    place('wall-run', [at.x, floor, at.z], [9, Math.max(1, at.y - floor - 1), 13], bridgeYaw)
  }
  for (let i = 0; i < 6; i++) {
    const at = bridgeA.clone().lerp(bridgeB, (i + 0.5) / 6)
    arch(at.x, at.y - 39, at.z, bridgeLength / 14, 10, 12, 4.2, bridgeYaw + Math.PI / 2, false)
  }

  const templeX = 1190, templeZ = -95, base = 234, facing = -Math.PI / 2
  const temple = (id: RuinPiece, u: number, y: number, depth: number, dimensions: Triple, solid = false) => place(id, [templeX + depth, base + y, templeZ + u], dimensions, facing, solid)
  paving(1022, templeZ, 218, 144, 209.98, facing)
  paving(1262, templeZ, 174, 176, base - 0.22, facing)
  paving(1212, -251, 138, 76, base - 0.22, facing)
  podium(1174, -182, 1350, -8, base - 0.22)
  podium(1174, -320, 1250, -182, base - 0.22)
  const stairTop = templeX - 16, stairDepth = 80, stairRise = 24, flights = 16, lanes = 14
  for (let flight = 0; flight < flights; flight++) for (let lane = 0; lane < lanes; lane++) {
    place('stair-flight', [stairTop - stairDepth + (flight + 0.5) * stairDepth / flights, 210 + flight * stairRise / flights, templeZ + (lane + 0.5 - lanes / 2) * 6], [6.02, stairRise / flights, stairDepth / flights + 0.04], facing)
  }
  collider(transform([stairTop - stairDepth / 2, 210, templeZ], facing), [84, stairRise, stairDepth], true)
  for (const side of [-1, 1]) for (let flight = 0; flight < flights; flight += 2) {
    place('wall-run', [stairTop - stairDepth + (flight + 1) * stairDepth / flights, 210 + flight * stairRise / flights, templeZ + side * 44], [3.4, 4.8, stairDepth / flights * 2], facing)
  }
  for (let u = -81; u <= 81; u += 6) for (let course = 0; course < 21; course++) {
    const y = course * 4
    const opening = Math.abs(u) < 15 && (y < 37 || (y < 53 && u * u + (y - 37) ** 2 < 15 ** 2))
    if (!opening && !(course > 17 && hash2(u, course, 953) > 0.66)) temple('wall-run', u, y, 4, [6.08, 4.02, 9], y < 8)
  }
  arch(templeX - 1.5, base, templeZ, 14, 35, 11, 3.8, facing)
  temple('ornament-panel', 0, 59, -1.3, [18, 18, 2])
  for (const u of [-72, -48, -25, 25, 48, 72]) {
    temple('column-base', u, 0, -9, [8.4, 4.2, 8.4], true)
    for (let tier = 0; tier < 3; tier++) temple('column-shaft', u, 4.2 + tier * 19, -9, [5.6, 19, 5.6], true)
    temple('column-capital', u, 61.2, -9, [8.4, 4.9, 8.4])
    temple('masonry-block', u, 66.1, -9, [9, 4, 9])
  }
  for (const u of [-37, 37]) {
    arch(templeX - 1, base + 5, templeZ + u, 5.5, 17, 2.4, 1.8, facing, false)
    temple('column-base', u, 3, -4.8, [6, 2.5, 5.5], true)
    temple('robed-statue', u, 5.5, -5, [4.8, 14.4, 4.2], true)
  }
  for (let u = -78; u <= 78; u += 12) temple('wall-run', u, 72, -2, [12.1, 7, 11])
  for (let depth = 20; depth < 160; depth += 20) for (const side of [-1, 1]) {
    const u = side * 65
    temple('column-base', u, 0, depth, [6, 3, 6], true)
    for (let tier = 0; tier < 2; tier++) temple('column-shaft', u, 3 + tier * 20, depth, [4, 20, 4], true)
    temple('column-capital', u, 43, depth, [6, 3.5, 6])
  }
  const towerU = -112
  for (let level = 0; level < 29; level++) for (let side = 0; side < 4; side++) for (let panel = -1; panel <= 1; panel++) {
    if (level > 20 && hash2(level, side * 3 + panel, 967) > 0.62) continue
    const angle = side * Math.PI / 2
    const pos = local(templeX + 30, base, templeZ + towerU, angle, panel * 10, level * 4, 15)
    if (level > 13 && level < 19 && panel === 0) continue
    place('wall-run', pos, [10.1, 4.05, 3], angle, level < 3)
  }
  for (let bay = 0; bay < 5; bay++) for (let tier = 0; tier < 2; tier++) {
    const z = templeZ - 100 - bay * 24
    arch(templeX + 14, base + tier * 23, z, 9, 9, 5, 2.8, facing)
    place('wall-run', [templeX + 14, base + tier * 23 + 21, z], [24, 3, 6], facing)
  }
  rubble(templeX + 35, templeZ - 105, 32, 30, 101, base)
  rubble(templeX - 55, templeZ - 75, 25, 35, 103, 210)
  rubble(templeX + 80, templeZ + 65, 35, 45, 107, base)

  const shrineY = layout.shrine.ground
  place('shrine-face', [50, shrineY + 8, 1267], [19, 25, 8], Math.PI)
  arch(50, shrineY, 1280, 6, 6, 4, 2.5, Math.PI)
  for (const side of [-1, 1]) {
    place('column-base', [50 + side * 10, shrineY, 1274], [4, 2, 4], Math.PI, true)
    place('column-shaft', [50 + side * 10, shrineY + 2, 1274], [2.7, 13.5, 2.7], Math.PI, true)
    place('column-capital', [50 + side * 10, shrineY + 15.5, 1274], [4, 2.3, 4], Math.PI)
  }
  rubble(50, 1260, 24, 32, 109)

  const geology = (x: number, z: number, seed: number, magnitude: number, expose = 0.45) => {
    if (world.pathDistance(x, z) < 10 || (x > 910 && x < 1450 && z > -280 && z < 130)) return
    const h = magnitude * (0.65 + hash2(x, z, seed) * 0.6)
    place('stratified-rock', [x, world.heightAt(x, z) - h * (1 - expose), z], [h * 1.6, h, h * 1.1], hash2(z, x, seed + 1) * Math.PI * 2)
  }
  for (let z = -1800; z < 1700; z += 22) geology(-1620 + Math.sin(z / 190) * 32, z, 113, 9)
  for (let z = -680; z < 640; z += 16) for (const side of [620, 850]) {
    geology(side + Math.sin(z / 43) * 13, z, 127, 27, 0.76)
    if (z % 3 < 1) geology(side + (side === 620 ? -30 : 30), z, 131, 10)
  }
  for (let x = -650; x < 720; x += 20) geology(x, 1370 + Math.sin(x / 110) * 28, 137, 22, 0.75)
  for (let i = 0; i < 150; i++) {
    const a = i / 150 * Math.PI * 2
    geology(1180 + Math.cos(a) * 300, -50 + Math.sin(a) * 460, 139, 24, 0.68)
  }
  for (let field = 0; field < 24; field++) {
    const side = field % 3
    const cx = side === 0 ? -1540 : side === 1 ? 565 : -600 + hash2(field, 1, 149) * 1300
    const cz = side === 2 ? 1220 : -1500 + hash2(field, 3, 151) * 3000
    for (let i = 0; i < 12; i++) {
      const a = hash2(i, field, 157) * Math.PI * 2, r = Math.sqrt(hash2(i, field, 163)) * 45
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r
      if (world.pathDistance(x, z) < 4) continue
      const size = 0.6 + hash2(i, field, 167) ** 2 * 3.4
      fieldRocks.push(transform([x, world.heightAt(x, z) - size * 0.12, z], a).scale(new Vector3(size, size, size)))
    }
  }
  return { pieces, fieldRocks, collider: { vertices: new Float32Array(vertices), indices: new Uint32Array(indices) } }
}
