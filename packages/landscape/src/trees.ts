import { BufferAttribute, BufferGeometry, Sphere, Vector3 } from 'three'
import { createRandom } from './random'

export type TreeForm = 'broadleaf' | 'conifer' | 'birch'

export interface TreeSpecies {
  readonly name: string
  readonly form: TreeForm
  readonly height: number
  readonly trunk: number
  readonly crown: number
  readonly leafSize: number
  readonly leafCount: number
  readonly bark: readonly [number, number, number]
  readonly leaves: readonly [number, number, number]
  readonly seed: number
}

export interface TreeModel {
  readonly species: TreeSpecies
  readonly wood: BufferGeometry
  readonly leaves: BufferGeometry
  readonly bounds: Sphere
  readonly crownCentre: Vector3
  readonly crownRadius: number
  readonly height: number
}

export const OAK: TreeSpecies = { name: 'oak', form: 'broadleaf', height: 15, trunk: 0.42, crown: 5.2, leafSize: 1.5, leafCount: 520, bark: [0.78, 0.72, 0.66], leaves: [1, 1, 1], seed: 3 }
export const PINE: TreeSpecies = { name: 'pine', form: 'conifer', height: 21, trunk: 0.36, crown: 3.8, leafSize: 1.6, leafCount: 1000, bark: [0.7, 0.62, 0.56], leaves: [1, 1, 1], seed: 7 }
export const BIRCH: TreeSpecies = { name: 'birch', form: 'birch', height: 16, trunk: 0.22, crown: 3.4, leafSize: 1.05, leafCount: 460, bark: [1.7, 1.66, 1.58], leaves: [1, 1, 1], seed: 11 }

interface Builder {
  position: number[]
  normal: number[]
  uv: number[]
  color: number[]
  wind: number[]
  index: number[]
}

const builder = (): Builder => ({ position: [], normal: [], uv: [], color: [], wind: [], index: [] })

function toGeometry(data: Builder): BufferGeometry {
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(data.position), 3))
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(data.normal), 3))
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(data.uv), 2))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(data.color), 3))
  geometry.setAttribute('treeWind', new BufferAttribute(new Float32Array(data.wind), 3))
  geometry.setIndex(data.index)
  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  return geometry
}

interface Branch {
  readonly points: Vector3[]
  readonly radii: number[]
  readonly level: number
  readonly phase: number
  readonly length: number
}

interface GrowSpec {
  readonly start: Vector3
  readonly direction: Vector3
  readonly length: number
  readonly radius: readonly [number, number]
  readonly sections: number
  readonly level: number
  readonly gnarl: number
  readonly tropism: Vector3
}

const randomUnit = (random: () => number, out = new Vector3()) => {
  const z = random() * 2 - 1
  const angle = random() * Math.PI * 2
  const r = Math.sqrt(1 - z * z)
  return out.set(r * Math.cos(angle), z, r * Math.sin(angle))
}

function grow(spec: GrowSpec, random: () => number): Branch {
  const points = [spec.start.clone()]
  const radii = [spec.radius[0]]
  const direction = spec.direction.clone().normalize()
  const step = spec.length / spec.sections
  const jitter = new Vector3()
  for (let index = 1; index <= spec.sections; index++) {
    direction.addScaledVector(randomUnit(random, jitter), spec.gnarl).add(spec.tropism).normalize()
    points.push(points[index - 1]!.clone().addScaledVector(direction, step))
    const t = index / spec.sections
    radii.push(spec.radius[0] + (spec.radius[1] - spec.radius[0]) * t)
  }
  return { points, radii, level: spec.level, phase: random(), length: spec.length }
}

function pointAt(branch: Branch, t: number, out = new Vector3()) {
  const scaled = Math.min(branch.points.length - 1.0001, Math.max(0, t * (branch.points.length - 1)))
  const index = Math.floor(scaled)
  return out.copy(branch.points[index]!).lerp(branch.points[index + 1]!, scaled - index)
}

function radiusAt(branch: Branch, t: number) {
  const scaled = Math.min(branch.radii.length - 1.0001, Math.max(0, t * (branch.radii.length - 1)))
  const index = Math.floor(scaled)
  return branch.radii[index]! + (branch.radii[index + 1]! - branch.radii[index]!) * (scaled - index)
}

function directionAt(branch: Branch, t: number, out = new Vector3()) {
  const scaled = Math.min(branch.points.length - 1.0001, Math.max(0, t * (branch.points.length - 1)))
  const index = Math.floor(scaled)
  return out.subVectors(branch.points[index + 1]!, branch.points[index]!).normalize()
}

function tube(data: Builder, branch: Branch, radial: number, height: number, flare: number) {
  const base = data.position.length / 3
  const { points, radii } = branch
  const tangent = new Vector3()
  const normal = new Vector3()
  const binormal = new Vector3()
  const previous = new Vector3()
  const offset = new Vector3()
  directionAt(branch, 0, tangent)
  normal.set(1, 0, 0)
  if (Math.abs(tangent.x) > 0.9) normal.set(0, 0, 1)
  binormal.crossVectors(tangent, normal).normalize()
  normal.crossVectors(binormal, tangent).normalize()
  const around = Math.max(1, Math.round(Math.PI * 2 * radii[0]! / 0.7))
  let travelled = 0
  for (let ring = 0; ring < points.length; ring++) {
    if (ring > 0) {
      travelled += points[ring]!.distanceTo(points[ring - 1]!)
      previous.copy(tangent)
      if (ring < points.length - 1) tangent.subVectors(points[ring + 1]!, points[ring - 1]!).normalize()
      else tangent.subVectors(points[ring]!, points[ring - 1]!).normalize()
      binormal.crossVectors(tangent, normal).normalize()
      normal.crossVectors(binormal, tangent).normalize()
    }
    const t = ring / (points.length - 1)
    const flareScale = 1 + flare * Math.max(0, 1 - t * 6) ** 2
    const radius = radii[ring]! * flareScale
    const point = points[ring]!
    const heightFrac = Math.max(0, point.y) / height
    const ao = branch.level === 0 ? 0.5 + 0.5 * Math.min(1, heightFrac * 2.2) : 0.72 + 0.28 * t
    const bend = heightFrac * heightFrac
    const sway = branch.level === 0 ? 0 : (branch.level === 1 ? 0.4 : 0.8) * t
    for (let side = 0; side <= radial; side++) {
      const angle = side / radial * Math.PI * 2
      offset.copy(normal).multiplyScalar(Math.cos(angle)).addScaledVector(binormal, Math.sin(angle))
      data.position.push(point.x + offset.x * radius, point.y + offset.y * radius, point.z + offset.z * radius)
      data.normal.push(offset.x, offset.y, offset.z)
      data.uv.push(side / radial * around, travelled / 0.7)
      data.color.push(ao, ao, ao)
      data.wind.push(bend, sway, branch.phase)
    }
  }
  for (let ring = 0; ring < points.length - 1; ring++) {
    for (let side = 0; side < radial; side++) {
      const a = base + ring * (radial + 1) + side
      const b = a + radial + 1
      data.index.push(a, b, a + 1, a + 1, b, b + 1)
    }
  }
}

function card(data: Builder, centre: Vector3, facing: Vector3, axis: Vector3, size: number, aspect: number, crown: Vector3, crownRadius: number, height: number, phase: number) {
  const base = data.position.length / 3
  const n = facing.clone().normalize()
  const u = axis.clone().addScaledVector(n, -axis.dot(n)).normalize()
  const v = new Vector3().crossVectors(n, u)
  const spherical = centre.clone().sub(crown).normalize()
  const shade = new Vector3().copy(n).lerp(spherical, 0.8).normalize()
  const depth = Math.min(1, centre.distanceTo(crown) / crownRadius)
  const ao = 0.42 + 0.58 * depth ** 1.4 * (0.75 + 0.25 * Math.min(1, centre.y / height + 0.3))
  const heightFrac = Math.max(0, centre.y) / height
  const corners: [number, number][] = [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]
  for (const [cu, cv] of corners) {
    const x = centre.x + u.x * cu * size + v.x * cv * size * aspect
    const y = centre.y + u.y * cu * size + v.y * cv * size * aspect
    const z = centre.z + u.z * cu * size + v.z * cv * size * aspect
    data.position.push(x, y, z)
    data.normal.push(shade.x, shade.y, shade.z)
    data.uv.push(cu + 0.5, cv + 0.5)
    data.color.push(ao, ao, ao)
    data.wind.push(heightFrac * heightFrac, 1, phase)
  }
  data.index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
}

function broadleaf(species: TreeSpecies, random: () => number, wood: Builder, leaves: Builder) {
  const H = species.height
  const up = new Vector3(0, 1, 0)
  const trunk = grow({ start: new Vector3(), direction: up, length: H * 0.5, radius: [species.trunk, species.trunk * 0.62], sections: 9, level: 0, gnarl: 0.06, tropism: new Vector3(0, 0.02, 0) }, random)
  const leader = grow({ start: trunk.points.at(-1)!.clone(), direction: directionAt(trunk, 1), length: H * 0.36, radius: [species.trunk * 0.62, species.trunk * 0.08], sections: 6, level: 0, gnarl: 0.12, tropism: new Vector3(0, 0.03, 0) }, random)
  tube(wood, trunk, 9, H, 0.55)
  tube(wood, leader, 6, H, 0)
  const crown = new Vector3(0, H * 0.62, 0)
  const crownRadius = species.crown
  const twigs: Branch[] = []
  const count = 9
  for (let index = 0; index < count; index++) {
    const t = 0.36 + index / count * 0.6 + random() * 0.04
    const parent = t < 0.58 ? trunk : leader
    const local = parent === trunk ? t / 0.58 : (t - 0.58) / 0.42
    const start = pointAt(parent, local)
    const azimuth = index * 2.39996 + random() * 0.5
    const pitch = (0.95 - local * 0.35) + random() * 0.25
    const direction = new Vector3(Math.cos(azimuth) * Math.sin(pitch), Math.cos(pitch), Math.sin(azimuth) * Math.sin(pitch))
    const length = crownRadius * (1.05 - t * 0.45) * (0.85 + random() * 0.3)
    const limb = grow({ start, direction, length, radius: [radiusAt(parent, local) * 0.55, 0.03], sections: 6, level: 1, gnarl: 0.16, tropism: new Vector3(0, 0.035, 0) }, random)
    tube(wood, limb, 5, H, 0)
    const twigCount = 5
    for (let twig = 0; twig < twigCount; twig++) {
      const tt = 0.3 + twig / twigCount * 0.65 + random() * 0.05
      const twigStart = pointAt(limb, tt)
      const twigDirection = directionAt(limb, tt).add(randomUnit(random).multiplyScalar(0.9)).add(new Vector3(0, 0.25, 0)).normalize()
      const branch = grow({ start: twigStart, direction: twigDirection, length: length * (0.32 + random() * 0.22), radius: [radiusAt(limb, tt) * 0.5, 0.012], sections: 3, level: 2, gnarl: 0.2, tropism: new Vector3(0, 0.02, 0) }, random)
      tube(wood, branch, 3, H, 0)
      twigs.push(branch)
    }
    twigs.push(limb)
  }
  twigs.push(leader)
  scatterLeaves(species, random, leaves, twigs, crown, crownRadius, (centre, branch) => {
    const outward = centre.clone().sub(crown).normalize()
    return outward.add(randomUnit(random).multiplyScalar(0.85)).add(new Vector3(0, 0.35, 0)).normalize()
  })
  return { crown, crownRadius }
}

function birch(species: TreeSpecies, random: () => number, wood: Builder, leaves: Builder) {
  const H = species.height
  const trunk = grow({ start: new Vector3(), direction: new Vector3(0.04, 1, 0), length: H * 0.62, radius: [species.trunk, species.trunk * 0.55], sections: 10, level: 0, gnarl: 0.05, tropism: new Vector3(0, 0.01, 0) }, random)
  const leader = grow({ start: trunk.points.at(-1)!.clone(), direction: directionAt(trunk, 1), length: H * 0.36, radius: [species.trunk * 0.55, species.trunk * 0.06], sections: 6, level: 0, gnarl: 0.1, tropism: new Vector3(0, 0.01, 0) }, random)
  tube(wood, trunk, 8, H, 0.3)
  tube(wood, leader, 5, H, 0)
  const crown = new Vector3(0, H * 0.66, 0)
  const crownRadius = species.crown
  const twigs: Branch[] = [leader]
  const count = 11
  for (let index = 0; index < count; index++) {
    const t = 0.4 + index / count * 0.56
    const parent = t < 0.63 ? trunk : leader
    const local = parent === trunk ? t / 0.63 : (t - 0.63) / 0.37
    const start = pointAt(parent, local)
    const azimuth = index * 2.39996 + random() * 0.4
    const pitch = 0.5 + random() * 0.3
    const direction = new Vector3(Math.cos(azimuth) * Math.sin(pitch), Math.cos(pitch), Math.sin(azimuth) * Math.sin(pitch))
    const length = crownRadius * (1.1 - (t - 0.4) * 0.9) * (0.8 + random() * 0.35)
    const limb = grow({ start, direction, length, radius: [radiusAt(parent, local) * 0.5, 0.02], sections: 5, level: 1, gnarl: 0.12, tropism: new Vector3(0, -0.035, 0) }, random)
    tube(wood, limb, 4, H, 0)
    twigs.push(limb)
    for (let twig = 0; twig < 4; twig++) {
      const tt = 0.35 + twig * 0.16 + random() * 0.05
      const twigDirection = directionAt(limb, tt).add(randomUnit(random).multiplyScalar(0.6)).add(new Vector3(0, -0.5, 0)).normalize()
      const branch = grow({ start: pointAt(limb, tt), direction: twigDirection, length: length * (0.35 + random() * 0.2), radius: [radiusAt(limb, tt) * 0.45, 0.008], sections: 3, level: 2, gnarl: 0.15, tropism: new Vector3(0, -0.06, 0) }, random)
      tube(wood, branch, 3, H, 0)
      twigs.push(branch)
    }
  }
  scatterLeaves(species, random, leaves, twigs, crown, crownRadius, centre => {
    const outward = centre.clone().sub(crown).normalize()
    return outward.add(randomUnit(random).multiplyScalar(1.1)).normalize()
  })
  return { crown, crownRadius }
}

function conifer(species: TreeSpecies, random: () => number, wood: Builder, leaves: Builder) {
  const H = species.height
  const trunk = grow({ start: new Vector3(), direction: new Vector3(0, 1, 0), length: H, radius: [species.trunk, 0.02], sections: 14, level: 0, gnarl: 0.015, tropism: new Vector3() }, random)
  tube(wood, trunk, 7, H, 0.4)
  const crown = new Vector3(0, H * 0.55, 0)
  const crownRadius = Math.max(species.crown, H * 0.45)
  const branches: Branch[] = []
  const lowest = 0.2
  const whorls = Math.round(H / 0.75)
  for (let whorl = 0; whorl < whorls; whorl++) {
    const t = lowest + (whorl + random() * 0.4) / whorls * (0.97 - lowest)
    const start = pointAt(trunk, t)
    const remaining = (0.98 - t) / (0.98 - lowest)
    const perWhorl = 4 + Math.floor(random() * 2)
    for (let index = 0; index < perWhorl; index++) {
      const azimuth = (index / perWhorl) * Math.PI * 2 + whorl * 1.3 + random() * 0.5
      const slope = -0.28 + (1 - remaining) * 0.5 + (random() - 0.5) * 0.12
      const direction = new Vector3(Math.cos(azimuth), slope, Math.sin(azimuth)).normalize()
      const length = (species.crown * remaining ** 0.95 + 0.25) * (0.82 + random() * 0.3)
      const limb = grow({ start, direction, length, radius: [Math.max(0.015, radiusAt(trunk, t) * 0.38), 0.01], sections: 4, level: 1, gnarl: 0.07, tropism: new Vector3(0, -0.03, 0) }, random)
      tube(wood, limb, 3, H, 0)
      branches.push(limb)
    }
  }
  const total = species.leafCount
  const lengthSum = branches.reduce((sum, branch) => sum + branch.length, 0)
  const centre = new Vector3()
  const forward = new Vector3()
  const side = new Vector3()
  const facing = new Vector3()
  for (const branch of branches) {
    const cards = Math.max(1, Math.round(total * branch.length / lengthSum))
    for (let index = 0; index < cards; index++) {
      const t = 0.2 + (index + random() * 0.6) / cards * 0.85
      pointAt(branch, Math.min(1, t), centre)
      directionAt(branch, Math.min(1, t), forward)
      side.set(-forward.z, 0, forward.x).normalize()
      facing.crossVectors(forward, side).normalize()
      if (facing.y < 0) facing.negate()
      facing.addScaledVector(randomUnit(random), 0.45).normalize()
      const size = species.leafSize * (0.75 + random() * 0.45) * (0.7 + 0.3 * (1 - t * 0.3))
      card(leaves, centre.clone().addScaledVector(facing, 0.05), facing, forward, size, 0.85, crown, crownRadius, H, branch.phase)
    }
  }
  for (let index = 0; index < 6; index++) {
    const top = pointAt(trunk, 0.94 + index * 0.01)
    const facing = randomUnit(random)
    facing.y = Math.abs(facing.y) * 0.3
    card(leaves, top, facing.normalize(), new Vector3(0, 1, 0), species.leafSize * 0.9, 1.1, crown, crownRadius, H, 0.5)
  }
  return { crown, crownRadius }
}

function scatterLeaves(species: TreeSpecies, random: () => number, leaves: Builder, branches: Branch[], crown: Vector3, crownRadius: number, facing: (centre: Vector3, branch: Branch) => Vector3) {
  const eligible = branches.filter(branch => branch.level > 0 || branch.radii[0]! < species.trunk * 0.7)
  const weights = eligible.map(branch => branch.length * (branch.level === 2 ? 1.6 : branch.level === 1 ? 0.6 : 0.4))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const centre = new Vector3()
  const axis = new Vector3()
  const offset = new Vector3()
  const placed: { centre: Vector3; normal: Vector3; size: number }[] = []
  const crowded = (normal: Vector3, size: number) => placed.some(other => {
    if (Math.abs(other.normal.dot(normal)) < 0.94) return false
    offset.subVectors(centre, other.centre)
    const gap = Math.abs(offset.dot(other.normal))
    return gap < 0.2 && offset.lengthSq() - gap * gap < ((size + other.size) * 0.5) ** 2
  })
  eligible.forEach((branch, branchIndex) => {
    const cards = Math.max(1, Math.round(species.leafCount * weights[branchIndex]! / total))
    for (let index = 0; index < cards; index++) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const t = 0.35 + (index + random()) / cards * 0.7
        pointAt(branch, Math.min(1, t), centre)
        centre.addScaledVector(randomUnit(random), species.leafSize * 0.35)
        axis.copy(randomUnit(random))
        const size = species.leafSize * (0.7 + random() * 0.55)
        const normal = facing(centre, branch).normalize()
        if (crowded(normal, size)) continue
        placed.push({ centre: centre.clone(), normal, size })
        card(leaves, centre, normal, axis, size, 1, crown, crownRadius, species.height, branch.phase)
        break
      }
    }
  })
}

export function generateTree(species: TreeSpecies): TreeModel {
  const random = createRandom(species.seed * 7919 + 13)
  const wood = builder()
  const leaves = builder()
  const shape = species.form === 'conifer' ? conifer(species, random, wood, leaves) : species.form === 'birch' ? birch(species, random, wood, leaves) : broadleaf(species, random, wood, leaves)
  const woodGeometry = toGeometry(wood)
  const leafGeometry = toGeometry(leaves)
  const box = leafGeometry.boundingBox!.clone().union(woodGeometry.boundingBox!)
  const bounds = new Sphere()
  box.getBoundingSphere(bounds)
  return { species, wood: woodGeometry, leaves: leafGeometry, bounds, crownCentre: shape.crown, crownRadius: shape.crownRadius, height: box.max.y }
}
