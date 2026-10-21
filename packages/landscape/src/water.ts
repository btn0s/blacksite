import { BufferGeometry, Float32BufferAttribute, Mesh } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import type { Node } from 'three/webgpu'
import { Fn, abs, attribute, cameraPosition, clamp, float, fract, length, mix, normalize, positionLocal, positionWorld, select, smoothstep, time, transformNormalToView, uint, vec2, vec3 } from 'three/tsl'
import type { TerrainUniforms } from './terrain'
import { createTerrainNodes, landscapeNoise } from './nodes'
import type { RiverLayout, TarnLayout, WaterLayout } from './river'

export type RibbonPoint = readonly [x: number, y: number, z: number, halfWidth: number]

export function ribbonStrip(points: readonly RibbonPoint[], positions: number[], indices: number[]) {
  const base = positions.length / 3
  for (let index = 0; index < points.length; index++) {
    const p = points[index]!
    const before = points[Math.max(0, index - 1)]!
    const after = points[Math.min(points.length - 1, index + 1)]!
    const length = Math.hypot(after[0] - before[0], after[2] - before[2]) || 1
    const nx = -(after[2] - before[2]) / length
    const nz = (after[0] - before[0]) / length
    for (const side of [-1, 1]) positions.push(p[0] + nx * p[3] * side, p[1], p[2] + nz * p[3] * side)
    if (index > 0) {
      const a = base + (index - 1) * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  return base
}

export interface WaterOptions {
  readonly layout: WaterLayout
  readonly uniforms: TerrainUniforms
  readonly margin?: number
  readonly farLift?: number
}

export interface Water {
  readonly object: Mesh
  readonly material: MeshStandardNodeMaterial
  readonly triangles: number
  dispose(): void
}

const SEA = 0
const RIVER = 1
const POND = 2

function flowOf(river: RiverLayout, index: number) {
  const before = river.samples[Math.max(0, index - 1)]!
  const after = river.samples[Math.min(river.samples.length - 1, index + 1)]!
  const length = Math.hypot(after[0] - before[0], after[1] - before[1]) || 1
  return [(after[0] - before[0]) / length, (after[1] - before[1]) / length]
}

export function waterGeometry(layout: WaterLayout, margin: number) {
  const positions: number[] = []
  const flows: number[] = []
  const indices: number[] = []
  const { sea } = layout
  if (sea) {
    const base = positions.length / 3
    for (const [x, z] of [[sea.min[0], sea.min[1]], [sea.max[0], sea.min[1]], [sea.min[0], sea.max[1]], [sea.max[0], sea.max[1]]] as const) {
      positions.push(x, layout.seaLevel, z)
      flows.push(0, 0, 0, SEA)
    }
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3)
  }
  for (const feature of layout.features) {
    if (feature.kind === 'river') {
      const points = feature.samples.map((sample): RibbonPoint => [sample[0], sample[2], sample[1], sample[3] + margin])
      ribbonStrip(points, positions, indices)
      feature.samples.forEach((sample, index) => {
        const [dx, dz] = flowOf(feature, index)
        for (let side = 0; side < 2; side++) flows.push(dx!, dz!, sample[5], RIVER)
      })
    } else {
      appendDisc(feature, margin, positions, flows, indices)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('waterFlow', new Float32BufferAttribute(flows, 4))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

function appendDisc(tarn: TarnLayout, margin: number, positions: number[], flows: number[], indices: number[]) {
  const base = positions.length / 3
  const segments = 64
  positions.push(tarn.at[0], tarn.level, tarn.at[1])
  flows.push(0, 0, 0, POND)
  for (let index = 0; index < segments; index++) {
    const angle = index * Math.PI * 2 / segments
    positions.push(tarn.at[0] + Math.cos(angle) * (tarn.radius + margin), tarn.level, tarn.at[1] + Math.sin(angle) * (tarn.radius + margin))
    flows.push(0, 0, 0, POND)
    indices.push(base, base + 1 + (index + 1) % segments, base + 1 + index)
  }
}

const swell = Fn(([q]: [Node<'vec2'>]) => landscapeNoise(q, uint(811)).mul(0.5).add(landscapeNoise(q.mul(2.37).add(17.3), uint(821)).mul(0.3)).add(landscapeNoise(q.mul(5.71).add(41.9), uint(829)).mul(0.2)))

const slope = Fn(([q]: [Node<'vec2'>]) => {
  const e = 0.12
  const centre = swell(q)
  return vec2(swell(q.add(vec2(e, 0))).sub(centre), swell(q.add(vec2(0, e))).sub(centre)).div(e)
})

export function createWater(options: WaterOptions): Water {
  const { layout, uniforms } = options
  const terrain = createTerrainNodes(uniforms)
  const flow = attribute('waterFlow', 'vec4')
  const p = positionWorld.xz
  const span = length(positionWorld.sub(cameraPosition))
  const depth = positionWorld.y.sub(terrain.height(p)).max(0)
  const river = flow.w.greaterThan(0.5)
  const speed = flow.z
  const velocity = flow.xy.mul(speed.mul(0.5).add(0.35).min(3)).add(select(river, vec2(0), vec2(0.35, 0.2)))
  const cycle = float(3)
  const phase0 = fract(time.div(cycle))
  const phase1 = fract(time.div(cycle).add(0.5))
  const blend = abs(phase0.mul(2).sub(1))
  const ripples = (q: Node<'vec2'>) => slope(q.mul(0.4))
  const gradient = mix(ripples(p.sub(velocity.mul(phase0.mul(cycle)))), ripples(p.sub(velocity.mul(phase1.mul(cycle)))), blend).mul(0.4)
  const swellBroad = slope(p.mul(0.045).add(time.mul(0.012))).mul(0.045)
  const near = float(1).sub(smoothstep(60, 700, span))
  const tilt = gradient.mul(near).mul(0.55).add(swellBroad)
  const normal = normalize(vec3(tilt.x.negate(), 1, tilt.y.negate()))
  const edge = depth.add(landscapeNoise(p.mul(1.4).add(time.mul(0.3)), uint(839)).sub(0.5).mul(0.5))
  const lapping = float(1).sub(smoothstep(0, 0.8, edge)).mul(float(0.55).add(landscapeNoise(p.mul(3.1).sub(time.mul(0.9)), uint(851)).mul(0.45)))
  const streaks = landscapeNoise(vec2(p.x.mul(1.7).add(p.y.mul(0.9)), p.y.mul(0.35).sub(time.mul(speed.mul(0.8)))).mul(vec2(1, 1)), uint(857))
  const cascade = smoothstep(3.5, 7, speed).mul(smoothstep(0.32, 0.7, streaks)).mul(0.9)
  const foam = clamp(lapping.add(cascade), 0, 1)
  const clarity = smoothstep(0.15, 3.2, depth)
  const body = mix(vec3(0.075, 0.17, 0.15), vec3(0.012, 0.05, 0.062), clarity)
  const material = new MeshStandardNodeMaterial({ name: 'world-water', metalness: 0 })
  material.colorNode = mix(body, vec3(0.78, 0.82, 0.8), foam)
  material.roughnessNode = mix(float(0.05), float(0.55), foam).add(smoothstep(500, 5000, span).mul(0.28))
  material.normalNode = transformNormalToView(normalize(mix(normal, vec3(0, 1, 0), foam.mul(0.6))))
  const lift = smoothstep(300, 900, length(positionLocal.sub(cameraPosition))).mul(options.farLift ?? 3).mul(flow.w.greaterThan(0.5).select(1, 0))
  material.positionNode = positionLocal.add(vec3(0, lift, 0))
  const geometry = waterGeometry(layout, options.margin ?? 6)
  const object = new Mesh(geometry, material)
  object.name = 'World water'
  object.frustumCulled = false
  object.castShadow = false
  object.receiveShadow = true
  return {
    object, material, triangles: geometry.index!.count / 3,
    dispose() { geometry.dispose(); material.dispose() },
  }
}
