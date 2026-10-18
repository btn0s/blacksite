import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

export type ClutterRect = { min: [number, number]; max: [number, number] }
export type ClutterOptions = { area: ClutterRect; blocked?: ClutterRect[]; clear?: ClutterRect[]; seed?: number; density?: number; floor?: number }

const PALETTE = {
  card: ['#7a6248', '#86704f', '#6b573f', '#917a58'],
  sack: ['#6c6a62', '#5b5f52', '#7a776c'],
  paper: ['#b9b8b2', '#c9c7c0', '#a9a8a3', '#d4d2cb'],
  rubble: ['#6a6a68', '#7a7977', '#5c5c5a', '#878684'],
  wood: ['#6e5038', '#7c5c40', '#5d4430'],
  cable: ['#121212', '#1b1b1b'],
}

const inside = (x: number, z: number, rect: ClutterRect, pad = 0) => x > rect.min[0] - pad && x < rect.max[0] + pad && z > rect.min[1] - pad && z < rect.max[1] + pad

const gap = (x: number, z: number, rect: ClutterRect) => {
  const dx = Math.max(rect.min[0] - x, 0, x - rect.max[0])
  const dz = Math.max(rect.min[1] - z, 0, z - rect.max[1])
  return Math.hypot(dx, dz)
}

function painted(geometry: THREE.BufferGeometry, color: string, random: () => number, floor: number, shade = 0.12) {
  const base = new THREE.Color(color).multiplyScalar(1 - shade / 2 + random() * shade)
  const flat = geometry.index ? geometry.toNonIndexed() : geometry
  const position = flat.getAttribute('position')
  const count = position.count
  const colors = new Float32Array(count * 3)
  const tone = new THREE.Color()
  for (let vertex = 0; vertex < count; vertex++) {
    const lift = Math.min(Math.max((position.getY(vertex) - floor) / 0.35, 0), 1)
    tone.copy(base).multiplyScalar(0.45 + 0.55 * lift * lift * (3 - 2 * lift)).toArray(colors, vertex * 3)
  }
  flat.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  for (const name of Object.keys(flat.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'color') flat.deleteAttribute(name)
  return flat
}

export function clutter({ area, blocked = [], clear = [], seed = 1, density = 1, floor = 0 }: ClutterOptions) {
  let state = seed * 9301 + 49297
  const random = () => {
    state = (state * 16807) % 2147483647
    return (state - 1) / 2147483646
  }
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]!
  const width = area.max[0] - area.min[0]
  const depth = area.max[1] - area.min[1]
  const wall = (x: number, z: number) => Math.min(x - area.min[0], area.max[0] - x, z - area.min[1], area.max[1] - z)
  const lee = (x: number, z: number) => Math.min(wall(x, z), ...blocked.map(rect => gap(x, z, rect)))
  const free = (x: number, z: number, radius: number) => inside(x, z, area, -radius) && !blocked.some(rect => inside(x, z, rect, radius)) && !clear.some(rect => inside(x, z, rect, radius))
  const spot = (radius: number, band: number, tries = 24, edge = lee): [number, number] | null => {
    for (let attempt = 0; attempt < tries; attempt++) {
      const x = area.min[0] + random() * width
      const z = area.min[1] + random() * depth
      if (!free(x, z, radius)) continue
      if (edge(x, z) > band) continue
      return [x, z]
    }
    return null
  }
  const parts: THREE.BufferGeometry[] = []
  const place = (geometry: THREE.BufferGeometry, color: string, x: number, y: number, z: number, yaw: number, tilt: [number, number] = [0, 0]) => {
    geometry.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(tilt[0], yaw, tilt[1])))
    geometry.translate(x, floor + y, z)
    parts.push(painted(geometry, color, random, floor))
  }
  const count = (perSquareMetre: number) => Math.round(width * depth * perSquareMetre * density)

  for (let index = 0; index < count(0.12); index++) {
    const at = spot(0.35, 0.7, 32, wall)
    if (!at) continue
    const crushed = random() < 0.35
    const size: [number, number, number] = [0.3 + random() * 0.35, 0.22 + random() * 0.3, 0.25 + random() * 0.3]
    if (crushed) size[1] *= 0.45
    const yaw = random() * Math.PI
    const tilt: [number, number] = crushed ? [(random() - 0.5) * 0.3, (random() - 0.5) * 0.3] : [0, 0]
    place(new THREE.BoxGeometry(...size), pick(PALETTE.card), at[0], size[1] / 2, at[1], yaw, tilt)
    if (!crushed && random() < 0.35) {
      const top: [number, number, number] = [size[0] * (0.6 + random() * 0.3), size[1] * (0.6 + random() * 0.4), size[2] * (0.6 + random() * 0.3)]
      place(new THREE.BoxGeometry(...top), pick(PALETTE.card), at[0] + (random() - 0.5) * 0.08, size[1] + top[1] / 2, at[1] + (random() - 0.5) * 0.08, yaw + (random() - 0.5) * 0.5)
    }
  }
  for (let index = 0; index < count(0.03); index++) {
    const at = spot(0.35, 0.7, 32, wall)
    if (!at) continue
    const sack = new THREE.SphereGeometry(0.5, 9, 6)
    sack.scale(0.55 + random() * 0.2, 0.22 + random() * 0.08, 0.36 + random() * 0.1)
    place(sack, pick(PALETTE.sack), at[0], 0.1, at[1], random() * Math.PI, [(random() - 0.5) * 0.2, (random() - 0.5) * 0.2])
  }
  for (let index = 0; index < count(0.04); index++) {
    const at = spot(0.6, 1.2)
    if (!at) continue
    const length = 0.9 + random() * 1.4
    const plank = new THREE.BoxGeometry(length, 0.025, 0.1 + random() * 0.08)
    const lean = random() < 0.3
    place(plank, pick(PALETTE.wood), at[0], lean ? 0.14 : 0.0125, at[1], random() * Math.PI, lean ? [0, 0.18] : [0, 0])
  }
  for (let index = 0; index < count(0.22); index++) {
    const at = spot(0.15, random() < 0.6 ? 1.0 : 99)
    if (!at) continue
    const sheet = new THREE.PlaneGeometry(0.21, 0.297).rotateX(-Math.PI / 2)
    place(sheet, pick(PALETTE.paper), at[0], 0.004 + random() * 0.003, at[1], random() * Math.PI * 2, [(random() - 0.5) * 0.06, (random() - 0.5) * 0.06])
  }
  for (let index = 0; index < count(1.4); index++) {
    const at = spot(0.04, random() < 0.8 ? 0.45 : 99)
    if (!at) continue
    const radius = 0.015 + Math.pow(random(), 3) * 0.11
    const chip = new THREE.DodecahedronGeometry(radius, 0)
    chip.scale(1, 0.45 + random() * 0.4, 0.7 + random() * 0.6)
    place(chip, pick(PALETTE.rubble), at[0], radius * 0.25, at[1], random() * Math.PI * 2, [(random() - 0.5) * 0.6, (random() - 0.5) * 0.6])
  }
  for (let index = 0; index < Math.max(1, Math.round(count(0.012))); index++) {
    const start = spot(0.1, 0.4, 48)
    if (!start) continue
    const points: THREE.Vector3[] = []
    let [x, z] = start
    let heading = random() * Math.PI * 2
    for (let step = 0; step < 18; step++) {
      points.push(new THREE.Vector3(x, 0.012, z))
      heading += (random() - 0.5) * 0.7
      const nx = x + Math.cos(heading) * 0.35
      const nz = z + Math.sin(heading) * 0.35
      if (!free(nx, nz, 0.05)) heading += Math.PI * (0.5 + random() * 0.5)
      else [x, z] = [nx, nz]
    }
    if (points.length < 3) continue
    place(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), points.length * 3, 0.012, 5), pick(PALETTE.cable), 0, 0, 0, 0)
  }

  const geometry = parts.length ? mergeGeometries(parts) : new THREE.BufferGeometry()
  for (const part of parts) part.dispose()
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }))
  mesh.name = 'clutter'
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}
