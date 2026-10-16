import * as THREE from 'three'
import { LevelBuilder, apartmentBlock, deadTree, groundMaterial, lada, puddleMaterial, shed, worldPlaneGeometry, type SurfaceName } from '@blacksite/look/world'
import { feet } from './model'
import type { Gate } from './race'

type Vec3 = [number, number, number]
type Mat = { name: SurfaceName; color?: string; ao?: false }

export type Ledge = { height: number; base: number; approach: Vec3; yaw: number; label: string }
export type Ramp = { degrees: number; from: Vec3; to: Vec3; label: string }
export type Bookmark = { name: string; position: Vec3; target: Vec3; fov: number; stand: Vec3; yaw: number }
export type Light = { kind: 'tube' | 'sodium' | 'fire'; at: Vec3; color: string; intensity: number; distance: number }
export type Emitter = { kind: 'buzz' | 'fire' | 'drip' | 'tarp'; at: Vec3 }
export type Zone = { kind: 'stairwell' | 'arch'; min: Vec3; max: Vec3 }

const cast: Mat = { name: 'cast' }
const panel: Mat = { name: 'panel' }
const brick: Mat = { name: 'brick' }
const rust: Mat = { name: 'rust' }
const stained: Mat = { name: 'stained' }
const slab: Mat = { name: 'slab' }
const corrugated: Mat = { name: 'corrugated', color: '#7d7a64' }
const metal: Mat = { name: 'metal', color: '#4a4d43' }

function random(seed: number) {
  let state = seed >>> 0
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296 }
}

const degrees = (value: number) => value * Math.PI / 180

export function buildRoute() {
  const level = new LevelBuilder()
  const rand = random(11)
  const ledges: Ledge[] = []
  const ramps: Ramp[] = []
  const lights: Light[] = []
  const emitters: Emitter[] = []
  const zones: Zone[] = []
  const stairs: { from: Vec3; to: Vec3 }[] = []
  const box = (size: Vec3, material: Mat, at: Vec3, rotate?: number | Vec3, collide = true, shadow = true) => level.box(size, material, { at, rotate, collide, shadow })
  const ledge = (label: string, height: number, size: [number, number], material: Mat, center: [number, number], approachYaw: number, base = 0) => {
    box([size[0], height, size[1]], material, [center[0], base + height / 2, center[1]])
    const back = Math.max(size[0], size[1]) / 2 + 3.2
    const dir = [Math.cos(approachYaw), Math.sin(approachYaw)] as const
    ledges.push({ label, height, base, yaw: approachYaw, approach: [center[0] - dir[0] * (Math.abs(dir[0]) > 0.5 ? size[0] / 2 + 3.2 : back), base, center[1] - dir[1] * (Math.abs(dir[1]) > 0.5 ? size[1] / 2 + 3.2 : back)] })
  }
  const ramp = (label: string, start: Vec3, length: number, angle: number, width: number, material: Mat, record = true) => {
    const t = degrees(angle)
    const thick = 0.4
    const center: Vec3 = [start[0] + length / 2 * Math.cos(t) + thick / 2 * Math.sin(t), start[1] + length / 2 * Math.sin(t) - thick / 2 * Math.cos(t), start[2]]
    box([length, thick, width], material, center, [0, 0, t])
    const end: Vec3 = [start[0] + length * Math.cos(t), start[1] + length * Math.sin(t), start[2]]
    if (record) ramps.push({ degrees: Math.abs(angle), from: start, to: end, label })
    return end
  }
  const flight = (from: Vec3, direction: 1 | -1, z: [number, number], steps: number) => {
    const width = z[1] - z[0]
    for (let index = 0; index < steps; index++) {
      const top = from[1] + feet.stairRiser * (index + 1)
      const x = from[0] + direction * feet.stairTread * (index + 0.5)
      box([feet.stairTread, top - from[1] + 0.02, width], cast, [x, from[1] + (top - from[1]) / 2 - 0.01, (z[0] + z[1]) / 2])
      box([feet.stairTread + 0.02, 0.035, width + 0.02], { name: 'metal', color: '#3e3f38' }, [x - direction * feet.stairTread * 0.42, top + 0.006, (z[0] + z[1]) / 2], undefined, false, false)
    }
    const to: Vec3 = [from[0] + direction * feet.stairTread * steps, from[1] + feet.stairRiser * steps, from[2]]
    stairs.push({ from: [from[0], from[1], (z[0] + z[1]) / 2], to: [to[0], to[1], (z[0] + z[1]) / 2] })
    return to
  }

  const ground = new THREE.Mesh(worldPlaneGeometry(460, 460, 4), groundMaterial())
  ground.position.set(80, 0, 0)
  ground.receiveShadow = true
  level.mesh(ground)
  level.collider({ kind: 'box', half: [230, 0.5, 230], position: [80, -0.5, 0], rotation: [0, 0, 0] })
  level.plane(36, 22, { name: 'asphalt', ao: false }, { at: [20, 0.012, 0] })
  level.plane(30, 22, { name: 'slab', ao: false }, { at: [76, 0.014, -2] })
  level.plane(34, 24, { name: 'asphalt', ao: false }, { at: [148, 0.012, -2] })

  apartmentBlock(level, { at: [10, 0, -20.2], floors: 5, bays: 10, seed: 3, facing: Math.PI })
  apartmentBlock(level, { at: [10, 0, 20.2], floors: 5, bays: 10, seed: 4, facing: Math.PI })
  box([12, 15, 36], panel, [4, 7.5, -20.2], undefined, true, false)
  box([12, 15, 36], panel, [4, 7.5, 20.2], undefined, true, false)
  box([12, 11.6, 4.4], panel, [4, 9.2, 0])
  box([12, 0.3, 4.4], cast, [4, 3.25, 0], undefined, false, false)
  box([12, 0.06, 4.4], stained, [4, 0.03, 0], undefined, false, false)
  zones.push({ kind: 'arch', min: [-2, 0, -2.2], max: [10, 3.4, 2.2] })
  lights.push({ kind: 'sodium', at: [9.6, 3.0, 0], color: '#ffb35c', intensity: 9, distance: 14 })
  box([0.25, 0.3, 0.5], metal, [9.9, 3.0, 0], undefined, false, false)

  box([0.3, 2.4, 0.3], cast, [11, 1.2, -9.4])
  for (let index = 0; index < 6; index++) box([3, 2, 0.12], corrugated, [12.6 + index * 3.05, 1, -9.6], [0, 0, (rand() - 0.5) * 0.06], true)
  for (let index = 0; index < 6; index++) box([3, 2, 0.12], { name: 'corrugated', color: '#6d6a58' }, [12.6 + index * 3.05, 1, 9.6], [0, 0, (rand() - 0.5) * 0.06], true)

  ledge('kerb wall', 0.5, [0.45, 19], cast, [15, 0], 0)
  ledge('planter', 0.75, [2.6, 19], stained, [20.5, 0], 0)
  for (let index = 0; index < 7; index++) deadTree(level, [19.6 + (index % 2) * 1.6, 0.75, -8 + index * 2.6], 3.2 + rand() * 1.6, rand() * 6, false)
  ledge('brick wall', 1, [0.4, 19], brick, [26, 0], 0)
  box([0.46, 0.08, 19.1], cast, [26, 1.04, 0], undefined, false, false)

  const garageRoof = 2.75
  const garages: number[] = []
  for (let index = 0; index < 3; index++) garages.push(34 + index * 3.2)
  for (let index = 0; index < 5; index++) garages.push(45.2 + index * 3.2)
  garages.forEach((x, index) => {
    box([3.2, garageRoof, 6], brick, [x + 1.6, garageRoof / 2, -5.6])
    box([3.3, 0.14, 6.3], { name: 'metal', color: '#3f3d34' }, [x + 1.6, garageRoof + 0.07, -5.55], undefined, true, false)
    box([2.5, 2.1, 0.08], { name: 'rust', color: index % 3 === 0 ? '#5c6a5c' : index % 3 === 1 ? '#6b5442' : '#4f5550' }, [x + 1.6, 1.05, -2.57], undefined, false, false)
  })
  ledge('dumpster', 1.25, [2.2, 1.4], { name: 'metal', color: '#3d5245' }, [40, -1.75], -Math.PI / 2)
  ledges.push({ label: 'garage roof', height: garageRoof - 1.25, base: 1.25, yaw: -Math.PI / 2, approach: [40, 1.25, -1.2] })
  box([0.2, 3.2, 12], corrugated, [47.2, 1.6, 3.4])
  box([0.3, 3.4, 0.3], cast, [47.2, 1.7, -2.4])
  box([0.4, 3, 0.4], cast, [47.2, 1.5, 9.4])
  for (const [x, z, r] of [[31, 5, 0.4], [35.4, 6.4, 2.1]] as const) lada(level, [x, 0, z], r, x > 33 ? '#4a3b30' : '#3b342d')
  for (let index = 0; index < 4; index++) box([0.9, 0.9, 0.9], rust, [42.5 + (index % 2) * 1.0, 0.45 + Math.floor(index / 2) * 0.9, 1.4 + (index % 2) * 0.2], rand() * 0.4, true)

  for (let index = 0; index < 3; index++) box([0.8, 0.5, 0.8], { name: 'rust', color: '#333029' }, [36 + index * 0.9, 0.25, 7.6], rand(), true)

  const boilerYard = { x0: 61.2, x1: 92 }
  box([0.4, 3.4, 22], brick, [boilerYard.x0 - 0.2 + 30.8 + 0.4, 1.7, -12.2], [0, Math.PI / 2, 0])
  box([0.4, 2.2, 31], brick, [76.6, 1.1, 8.6], [0, Math.PI / 2, 0])
  box([0.4, 2.8, 8], brick, [61.0, 1.4, 4.4])
  const rampWidth = 5
  const top = ramp('rubble slope', [68, 0, -4], 6, 20, rampWidth, { name: 'gravel' as SurfaceName, color: '#8d877a' })
  box([3, top[1], rampWidth], stained, [top[0] + 1.5, top[1] / 2, -4])
  for (let index = 0; index < 5; index++) box([2.2, 1, rampWidth], stained, [68 + index * 1.2 + 2.4, 0.5 * Math.min(1, index * 0.5), -4], undefined, false, false)
  const slabStart: Vec3 = [top[0] + 3, top[1], -4]
  ramp('fallen slab', slabStart, top[1] / Math.sin(degrees(30)), -30, rampWidth, slab)
  for (let index = 0; index < 18; index++) {
    const size = 0.2 + rand() * 0.55
    box([size * 1.4, size * 0.6, size], index % 2 ? cast : stained, [65 + rand() * 24, size * 0.25, -11 + rand() * 4], [rand() * 0.4, rand() * 3, rand() * 0.4], false)
  }
  for (const [x, z] of [[84, 4.6], [84.7, 5.4], [85.4, 4.4], [84.3, 5.9]] as const) level.cylinder(0.3, 0.9, rust, { at: [x, 0.45, z] }, 14)
  level.cylinder(0.3, 0.9, { name: 'rust', color: '#5a3c2c' }, { at: [72, 0.45, 4.8] }, 14)
  lights.push({ kind: 'fire', at: [72, 1.25, 4.8], color: '#ff8a3a', intensity: 14, distance: 11 })
  emitters.push({ kind: 'fire', at: [72, 1.0, 4.8] })
  shed(level, [80, 0, -16], [12, 4.5, 6], 0.03)
  level.cylinder(1.3, 26, { name: 'brick', color: '#7a6a5f' }, { at: [110, 13, -14], collide: false }, 16)
  level.cylinder(1.6, 1.2, cast, { at: [110, 0.6, -14], collide: true }, 16)
  emitters.push({ kind: 'drip', at: [66, 2.4, -11.6] })
  box([0.12, 0.12, 6], rust, [66, 2.6, -9], undefined, false, false)

  const tower = { x0: 92, x1: 100, z0: -6.4, z1: 0 }
  const wall = 0.3
  box([wall, 7.4, tower.z1 - tower.z0], panel, [tower.x0 + wall / 2, 3.7 + 0, (tower.z0 + tower.z1) / 2 + 0], undefined, true)
  zones.push({ kind: 'stairwell', min: [tower.x0, 0, tower.z0], max: [tower.x1, 7.4, tower.z1] })
  const doorZ: [number, number] = [-6.1, -4.5]
  box([wall, 7.4 - 2.3, doorZ[1] - doorZ[0]], panel, [tower.x0 - 0.01, 2.3 + (7.4 - 2.3) / 2, (doorZ[0] + doorZ[1]) / 2], undefined, false, false)
  box([tower.x1 - tower.x0, 7.4, wall], panel, [(tower.x0 + tower.x1) / 2, 3.7, tower.z0 + wall / 2 - 0.3])
  box([tower.x1 - tower.x0, 7.4, wall], panel, [(tower.x0 + tower.x1) / 2, 3.7, tower.z1 - wall / 2])
  box([tower.x1 - tower.x0, 0.25, tower.z1 - tower.z0], cast, [(tower.x0 + tower.x1) / 2, 7.5, (tower.z0 + tower.z1) / 2])
  const inner = { x0: tower.x0 + wall, x1: tower.x1 - wall, z0: tower.z0, z1: tower.z1 - wall }
  const south: [number, number] = [inner.z0, inner.z0 + 1.5]
  const north: [number, number] = [inner.z1 - 1.5, inner.z1]
  const stepsPerFlight = 8
  const run = feet.stairTread * stepsPerFlight
  const landingDepth = 1.5
  const flightStartX = inner.x1 - landingDepth - run
  const a = flight([flightStartX, 0, 0], 1, south, stepsPerFlight)
  box([landingDepth, 0.25, inner.z1 - inner.z0], cast, [inner.x1 - landingDepth / 2, a[1] - 0.125, (inner.z0 + inner.z1) / 2])
  const b = flight([inner.x1 - landingDepth, a[1], 0], -1, north, stepsPerFlight)
  box([b[0] - inner.x0, 0.25, inner.z1 - inner.z0], cast, [(inner.x0 + b[0]) / 2, b[1] - 0.125, (inner.z0 + inner.z1) / 2])
  const c = flight([flightStartX, b[1], 0], 1, south, stepsPerFlight)
  box([landingDepth, 0.25, inner.z1 - inner.z0], cast, [inner.x1 - landingDepth / 2, c[1] - 0.125, (inner.z0 + inner.z1) / 2])
  box([0.12, 1.0, run + 0.1], metal, [flightStartX + run / 2, a[1] / 2 + 0.6, south[1] + 0.06], [0, Math.PI / 2, 0], false, false)
  const holeZ: [number, number] = [-5.6, -2.2]
  box([wall, c[1], tower.z1 - tower.z0], panel, [tower.x1 - wall / 2, c[1] / 2, (tower.z0 + tower.z1) / 2])
  box([wall, 7.4 - c[1] - 2.4, tower.z1 - tower.z0], panel, [tower.x1 - wall / 2, c[1] + 2.4 + (7.4 - c[1] - 2.4) / 2, (tower.z0 + tower.z1) / 2])
  box([wall, 2.4, holeZ[0] - tower.z0], panel, [tower.x1 - wall / 2, c[1] + 1.2, (tower.z0 + holeZ[0]) / 2])
  box([wall, 2.4, tower.z1 - holeZ[1]], panel, [tower.x1 - wall / 2, c[1] + 1.2, (holeZ[1] + tower.z1) / 2])
  for (let index = 0; index < 6; index++) box([0.5 + rand() * 0.4, 0.25 + rand() * 0.2, 0.5 + rand() * 0.5], panel, [tower.x1 + 0.8 + rand() * 2, 4.1 + 0.1, holeZ[0] + rand() * 3.4], [rand() * 0.5, rand() * 3, rand() * 0.5], false)
  lights.push({ kind: 'tube', at: [inner.x1 - 0.75, a[1] + 2.25, (inner.z0 + inner.z1) / 2], color: '#d9f0e6', intensity: 5, distance: 7 })
  lights.push({ kind: 'tube', at: [inner.x1 - 0.75, c[1] + 2.25, (inner.z0 + inner.z1) / 2], color: '#d9f0e6', intensity: 5, distance: 7 })
  for (const light of lights.slice(-2)) {
    box([0.12, 0.06, 1.2], { name: 'metal', color: '#2a2b26' }, [light.at[0], light.at[1] + 0.06, light.at[2]], undefined, false, false)
    emitters.push({ kind: 'buzz', at: light.at })
  }

  const roof = 4.1
  const boiler = { x0: 100, x1: 122, z0: -10, z1: 4 }
  box([boiler.x1 - boiler.x0, roof, boiler.z1 - boiler.z0], brick, [(boiler.x0 + boiler.x1) / 2, roof / 2, (boiler.z0 + boiler.z1) / 2])
  box([boiler.x1 - boiler.x0 + 0.3, 0.12, boiler.z1 - boiler.z0 + 0.3], { name: 'slab', color: '#7d7b70' }, [(boiler.x0 + boiler.x1) / 2, roof + 0.06, (boiler.z0 + boiler.z1) / 2], undefined, true, false)
  for (let index = 0; index < 7; index++) box([1.6, 1.4, 0.1], { name: 'metal', color: index === 3 ? '#4b4434' : '#1a1b16', ao: false }, [102.5 + index * 2.8, 2.2, boiler.z1 + 0.03], undefined, false, false)
  ledge('lean-to barrels', 1, [1.6, 1.4], { name: 'rust', color: '#4d4237' }, [94.2, 2.4], 0)
  box([4, 2.1, 3.6], corrugated, [98, 1.05, 2.2])
  ledges.push({ label: 'boiler roof (shortcut)', height: roof - 2.1, base: 2.1, yaw: 0, approach: [97, 2.1, 2.2] })
  const upper = 5.85
  box([10, upper - roof, boiler.z1 - boiler.z0], brick, [117, roof + (upper - roof) / 2, (boiler.z0 + boiler.z1) / 2])
  ledges.push({ label: 'parapet', height: upper - roof, base: roof, yaw: 0, approach: [108.8, roof, -3] })
  box([10.3, 0.1, boiler.z1 - boiler.z0 + 0.3], { name: 'slab', color: '#7d7b70' }, [117, upper + 0.05, (boiler.z0 + boiler.z1) / 2], undefined, true, false)
  const plant = 2
  box([4, plant, boiler.z1 - boiler.z0], { name: 'panel', color: '#a29d8a' }, [118, upper + plant / 2, (boiler.z0 + boiler.z1) / 2])
  ledges.push({ label: 'plant room', height: plant, base: upper, yaw: 0, approach: [112.8, upper, -3] })
  level.cylinder(1.3, 2.4, rust, { at: [118, upper + plant + 1.2, -7.5] }, 14)
  for (let index = 0; index < 3; index++) box([0.08, 2.4 + index, 0.08], metal, [118.5 + index * 0.6, upper + plant + 1.2 + index / 2, 1.5], undefined, false, false)
  emitters.push({ kind: 'tarp', at: [118, upper + plant + 0.5, 2] })
  for (let index = 0; index < 8; index++) box([0.6 + rand(), 0.25, 0.6 + rand()], cast, [102 + rand() * 9, roof + 0.12, -9 + rand() * 12], [0, rand() * 3, 0], false)

  const slabTop: Vec3 = [boiler.x1, upper, -3]
  const slabEnd = ramp('roof slab', slabTop, upper / Math.sin(degrees(30)), -30, 4, slab)
  for (let index = 0; index < 4; index++) box([2.5, 0.2, 0.3], rust, [boiler.x1 + 1 + index * 2.4, upper - 1.3 - index * 1.4, -5.3], [0, 0, degrees(-30)], false, false)

  const dockStart: Vec3 = [slabEnd[0] + 6, 0, -3]
  const dockTop = ramp('loading ramp', dockStart, 1.2 / Math.sin(degrees(10)), 10, 4, { name: 'cast', color: '#8d8a7c' })
  box([7, dockTop[1], 8], cast, [dockTop[0] + 3.5, dockTop[1] / 2, -3])
  box([7.2, 0.12, 8.2], { name: 'metal', color: '#3f3d34' }, [dockTop[0] + 3.5, dockTop[1] + 0.03, -3], undefined, false, false)
  shed(level, [dockTop[0] + 3.5, 0, -11.5], [10, 5, 7], 0)
  lada(level, [140, 0, 5], 1.2, '#55452f')
  for (const [x, z] of [[142, -9.5], [142.8, -9.1]] as const) level.cylinder(0.3, 0.9, rust, { at: [x, 0.45, z] }, 14)

  const finishX = 164
  apartmentBlock(level, { at: [finishX, 0, -21.2], floors: 7, bays: 10, seed: 21 })
  apartmentBlock(level, { at: [finishX, 0, 19.2], floors: 7, bays: 10, seed: 22 })
  box([12, 21, 36], panel, [finishX + 6, 10.5, -21.2], undefined, true, false)
  box([12, 21, 36], panel, [finishX + 6, 10.5, 19.2], undefined, true, false)
  box([12, 17.6, 4.4], panel, [finishX + 6, 12.2, -1], undefined, true)
  box([12, 0.3, 4.4], cast, [finishX + 6, 3.25, -1], undefined, false, false)
  lights.push({ kind: 'sodium', at: [finishX + 0.4, 3.0, -1], color: '#ffb35c', intensity: 9, distance: 14 })
  zones.push({ kind: 'arch', min: [finishX, 0, -3.2], max: [finishX + 12, 3.4, 1.2] })

  apartmentBlock(level, { at: [60, 0, 40], floors: 9, bays: 12, seed: 5, facing: Math.PI / 2 })
  apartmentBlock(level, { at: [110, 0, -44], floors: 9, bays: 12, seed: 9, facing: -Math.PI / 2 })
  apartmentBlock(level, { at: [-30, 0, -10], floors: 9, bays: 9, seed: 13 })
  for (const [x, z, h, r] of [[30, 14, 7, 0.3], [52, 12, 8.5, 1.4], [88, 14, 7.5, 2.2], [128, 12, 6.5, 0.8], [150, 12, 8, 3.1], [70, -24, 9, 1.9], [140, -22, 7, 0.2]] as const) deadTree(level, [x, 0, z], h, r, false)
  for (let index = 0; index < 10; index++) {
    const x = -6 + index * 20
    box([0.28, 9, 0.28], cast, [x, 4.5, 16.5], undefined, false)
    box([2.4, 0.16, 0.18], cast, [x, 8.55, 16.5], [0, Math.PI / 2, 0], false, false)
  }

  const puddles = puddleMaterial()
  for (const [x, z, w, d, r] of [[17, 4, 2.6, 1.4, 0.3], [30.5, -1.2, 3.4, 1.8, -0.2], [64, 2, 4.2, 2.4, 0.6], [80, 4, 2.2, 1.3, 1.2], [146, 2, 3, 1.5, 0.1], [152, -6, 3.6, 2, 0.4]] as const) {
    for (const [ox, oz, k] of [[0, 0, 1], [w * 0.32, d * 0.18, 0.62], [-w * 0.28, -d * 0.12, 0.55]] as const) {
      const puddle = new THREE.Mesh(new THREE.CircleGeometry(0.5, 18), puddles)
      puddle.rotation.set(-Math.PI / 2, 0, r + k)
      puddle.scale.set(w * k, d * k, 1)
      puddle.position.set(x + ox, 0.03, z + oz)
      puddle.receiveShadow = true
      puddle.renderOrder = 2
      level.mesh(puddle)
    }
  }

  const gates: Gate[] = [
    { name: 'Start', at: [9.5, 1.5, 0], half: [0.6, 2, 2.4], yaw: 0 },
    { name: 'Yard', at: [29, 1.5, 0], half: [0.6, 2.5, 9.5], yaw: 0 },
    { name: 'Garages', at: [43, garageRoof + 1.2, -5.6], half: [0.6, 1.6, 3.2], yaw: 0 },
    { name: 'Boiler yard', at: [66, 1.5, -2], half: [0.8, 2.5, 10], yaw: 0 },
    { name: 'Stairwell', at: [104, roof + 1.4, -3], half: [0.8, 2, 7.2], yaw: 0 },
    { name: 'Plant room', at: [118, upper + plant + 1.3, -3], half: [2.1, 1.6, 7.2], yaw: 0 },
    { name: 'Slab', at: [slabEnd[0] + 2, 1.5, -3], half: [0.8, 2.5, 6], yaw: 0 },
    { name: 'Dock', at: [dockTop[0] + 4, dockTop[1] + 1.4, -3], half: [0.8, 2, 4.2], yaw: 0 },
    { name: 'Finish', at: [finishX + 4, 1.5, -1], half: [0.8, 2.5, 2.4], yaw: 0 },
  ]

  const bookmarks: Bookmark[] = [
    { name: 'gate', position: [24, 3.2, 6.5], target: [9, 3.4, -0.5], fov: 55, stand: [12.5, 0, 0], yaw: 0 },
    { name: 'garages', position: [30, 2.6, 6], target: [42, 1.8, -4], fov: 55, stand: [38, 0, -0.4], yaw: -Math.PI / 2 },
    { name: 'roofs', position: [36.5, 4.6, -5.6], target: [50, 3, -5.6], fov: 55, stand: [39, garageRoof, -5.6], yaw: 0 },
    { name: 'boiler-yard', position: [64, 3.6, 5.5], target: [78, 1.4, -5], fov: 55, stand: [69, 0, -1], yaw: 0 },
    { name: 'stairwell', position: [inner.x0 + 0.5, 3.4, inner.z1 - 0.4], target: [inner.x1 - 1, 1.2, inner.z0 + 1], fov: 62, stand: [flightStartX + 1.2, 0.7, -5.2], yaw: 0 },
    { name: 'rooftop', position: [103, 6.4, 3], target: [116, 6.4, -5], fov: 55, stand: [107, roof, -3], yaw: 0 },
    { name: 'finish', position: [143, 3.4, 6], target: [finishX, 3, -1], fov: 55, stand: [150, 0, -2], yaw: 0 },
    { name: 'hero', position: [36.6, 2.2, 1.6], target: [39.6, 1.3, -1.4], fov: 50, stand: [39.6, 0, -0.2], yaw: -Math.PI / 2 },
  ]

  const group = level.build()
  return { group, colliders: level.colliders, spawn: [2.5, 0, 0] as Vec3, spawnYaw: 0, gates, ledges, ramps, stairs, lights, emitters, zones, bookmarks }
}

export type Route = ReturnType<typeof buildRoute>
