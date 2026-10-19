import { useEffect, useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute, Group, Mesh } from 'three'
import { MeshPhysicalNodeMaterial } from 'three/webgpu'
import { Fn, clamp, cos, dot, float, mix, normalLocal, normalize, positionLocal, positionWorld, sin, smoothstep, transformNormalToView, vec2, vec3 } from 'three/tsl'
import { createTerrainNodes, createWindNodes, landscapeNoise, terrainUniforms, type Wind } from '@blacksite/landscape'
import { layout, riverCurves, riverLevel, sampleCurves } from './layout'
import type { ValleyWorld } from './world'

function ribbon() {
  const points = sampleCurves(riverCurves, 6)
  const positions: number[] = []
  const indices: number[] = []
  const width = layout.river.halfWidth + layout.river.bankWidth
  for (let index = 0; index < points.length; index++) {
    const p = points[index]!
    const before = points[Math.max(0, index - 1)]!
    const after = points[Math.min(points.length - 1, index + 1)]!
    const length = Math.hypot(after[0] - before[0], after[1] - before[1])
    const nx = -(after[1] - before[1]) / length
    const nz = (after[0] - before[0]) / length
    for (const side of [-1, 1]) {
      const x = p[0] + nx * width * side
      const z = p[1] + nz * width * side
      positions.push(x, riverLevel(p[1]), z)
    }
    if (index > 0) {
      const a = (index - 1) * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

function pool() {
  const { centre, radius, level } = layout.shrine.pool
  const positions = [centre[0], level, centre[1]]
  const indices: number[] = []
  for (let index = 0; index <= 64; index++) {
    const angle = index * Math.PI / 32
    positions.push(centre[0] + Math.cos(angle) * radius[0] * 1.2, level, centre[1] + Math.sin(angle) * radius[1] * 1.2)
    if (index > 0) indices.push(0, index + 1, index)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

function spring() {
  const positions: number[] = []
  const indices: number[] = []
  for (let index = 0; index <= 32; index++) {
    const t = index / 32
    const halfWidth = 0.75 + t * 0.8
    const y = 87 - t * 18.2
    const z = 1262 - t * 7 - Math.sin(t * Math.PI) * 1.4
    positions.push(50 - halfWidth, y, z, 50 + halfWidth, y, z)
    if (index > 0) {
      const a = (index - 1) * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingSphere()
  return geometry
}

function waterMaterial(world: ValleyWorld, wind: Wind, falling = false) {
  const material = new MeshPhysicalNodeMaterial({ roughness: 0.12, metalness: 0, ior: 1.333, transmission: 0.93, thickness: 1, attenuationDistance: 2.5 })
  material.name = falling ? 'Spring water' : 'Valley water'
  material.attenuationColor.setRGB(0.38, 0.61, 0.55)
  const terrain = createTerrainNodes(terrainUniforms(world.sources))
  const breeze = createWindNodes(wind)
  const p = positionWorld.xz
  const along = dot(p, breeze.direction)
  const across = dot(p, vec2(breeze.direction.y.negate(), breeze.direction.x))
  const phaseA = along.mul(1.6).sub(breeze.time.mul(0.9))
  const phaseB = across.mul(2.2).add(breeze.time.mul(0.7))
  const rippleA = cos(phaseA).mul(0.04)
  const rippleB = cos(phaseB).mul(0.035)
  const ripple = breeze.direction.mul(rippleA).add(vec2(breeze.direction.y.negate(), breeze.direction.x).mul(rippleB))
  const depth = clamp(positionWorld.y.sub(terrain.height(p)), 0, 4)
  const landing = float(1).sub(smoothstep(1.1, 5, p.distance(vec2(50, 1255))))
  const churn = landscapeNoise(p.mul(1.7).add(vec2(breeze.time.mul(0.2), breeze.time.mul(-0.6))), 701)
  const foam = landing.mul(smoothstep(0.35, 0.72, churn)).mul(0.85)
  if (falling) {
    const streaks = landscapeNoise(vec2(positionWorld.x.mul(3), positionWorld.y.mul(0.45).add(breeze.time.mul(4))), 709)
    material.colorNode = mix(vec3(0.17, 0.29, 0.25), vec3(0.72, 0.77, 0.72), smoothstep(0.34, 0.74, streaks))
    material.roughnessNode = float(0.2)
    material.transmissionNode = float(0.55)
    material.thicknessNode = float(0.18)
    material.normalNode = transformNormalToView(normalize(normalLocal.add(vec3(sin(positionWorld.y.mul(3).add(breeze.time.mul(6))).mul(0.12), ripple.x, ripple.y))))
  } else {
    material.colorNode = mix(mix(vec3(0.2, 0.29, 0.18), vec3(0.035, 0.095, 0.085), smoothstep(0.15, 2.4, depth)), vec3(0.65, 0.7, 0.65), foam)
    material.roughnessNode = mix(float(0.095), float(0.3), foam)
    material.transmissionNode = mix(float(0.93), float(0.2), foam)
    material.thicknessNode = depth
    material.maskNode = depth.greaterThan(0.025)
    material.normalNode = transformNormalToView(normalize(normalLocal.add(vec3(ripple.x.negate(), 0, ripple.y.negate()))))
    material.positionNode = Fn(() => positionLocal.add(vec3(0, sin(dot(positionLocal.xz, breeze.direction).mul(1.6).sub(breeze.time.mul(0.9))).mul(0.025), 0)))()
  }
  return material
}

export function Water({ world, wind }: { world: ValleyWorld; wind: Wind }) {
  const water = useMemo(() => {
    const object = new Group()
    object.name = 'River and spring'
    const surface = waterMaterial(world, wind)
    const fall = waterMaterial(world, wind, true)
    for (const [geometry, material, name] of [[ribbon(), surface, 'River'], [pool(), surface, 'Spring pool'], [spring(), fall, 'Spring fall']] as const) {
      const mesh = new Mesh(geometry, material)
      mesh.name = name
      mesh.receiveShadow = true
      mesh.castShadow = false
      object.add(mesh)
    }
    return { object, dispose: () => { object.traverse(child => { if (child instanceof Mesh) child.geometry.dispose() }); surface.dispose(); fall.dispose() } }
  }, [world, wind])
  useEffect(() => () => water.dispose(), [water])
  return <primitive object={water.object} />
}
