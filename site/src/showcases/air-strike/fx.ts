import * as THREE from 'three'
import type { DestructionEvent, SimulationFrame } from '@blacksite/cascade'

const cloudVertex = `
attribute vec3 cloudOrigin;
attribute vec3 cloudVelocity;
attribute vec2 cloudLife;
attribute vec4 cloudShape;
attribute vec4 cloudColor;
uniform float time;
varying vec2 vUv;
varying vec4 vColor;
varying float vSeed;
varying float vT;
#include <fog_pars_vertex>
void main() {
  float age = time - cloudLife.x;
  float t = clamp(age / cloudLife.y, 0.0, 1.0);
  float travel = (1.0 - exp(-age * 0.9)) / 0.9;
  vec3 center = cloudOrigin + cloudVelocity * travel + vec3(0.0, cloudShape.w * age, 0.0);
  float radius = cloudShape.x * (1.0 + cloudShape.y * sqrt(t));
  vec4 mvPosition = modelViewMatrix * vec4(center, 1.0);
  float angle = cloudShape.z * 6.2831853 + age * 0.25 * (fract(cloudShape.z * 7.0) - 0.5);
  vec2 corner = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * position.xy;
  mvPosition.xy += corner * radius;
  gl_Position = projectionMatrix * mvPosition;
  vUv = position.xy;
  vColor = cloudColor;
  vColor.a *= smoothstep(0.0, 0.06, t) * pow(1.0 - t, 1.4) * step(0.0, age) * step(age, cloudLife.y);
  vSeed = cloudShape.z;
  vT = t;
  #include <fog_vertex>
}`

const cloudFragment = `
varying vec2 vUv;
varying vec4 vColor;
varying float vSeed;
varying float vT;
uniform sampler2D noise;
#include <fog_pars_fragment>
void main() {
  float r = dot(vUv, vUv);
  vec2 bands = texture2D(noise, vUv * 0.4 + vSeed * vec2(3.7, 5.3)).rg;
  float n = bands.r * 0.6 + bands.g * 0.4;
  float alpha = vColor.a * (1.0 - smoothstep(0.15, 1.0, r)) * smoothstep(0.12, 0.7, n + 0.3 * (1.0 - r));
  if (alpha < 0.003) discard;
#ifdef FLAME
  vec3 color = mix(vec3(1.0, 0.82, 0.45), vColor.rgb, smoothstep(0.0, 0.7, vT)) * (1.2 + n);
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #ifdef USE_FOG
    gl_FragColor.a *= exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  #endif
#else
  vec3 color = vColor.rgb * (0.72 + 0.38 * (vUv.y * 0.5 + 0.5)) * (0.86 + n * 0.28);
  gl_FragColor = vec4(color, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
#endif
}`

function noiseTexture() {
  const size = 64
  const data = new Uint8Array(size * size * 4)
  const lattice = (cells: number, seed: number) => {
    const grid = Array.from({ length: cells * cells }, (_, i) => { const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453; return x - Math.floor(x) })
    return (x: number, y: number) => {
      const fx = x * cells / size, fy = y * cells / size
      const ix = Math.floor(fx), iy = Math.floor(fy)
      const tx = fx - ix, ty = fy - iy
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty)
      const at = (a: number, b: number) => grid[((b % cells) * cells) + (a % cells)]!
      return (at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx) * (1 - sy) + (at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx) * sy
    }
  }
  const low = lattice(6, 1), high = lattice(16, 2)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4
    data[i] = low(x, y) * 255
    data[i + 1] = high(x, y) * 255
    data[i + 3] = 255
  }
  const texture = new THREE.DataTexture(data, size, size)
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.magFilter = texture.minFilter = THREE.LinearFilter
  texture.needsUpdate = true
  return texture
}

const noise = noiseTexture()

export type Puff = { at: THREE.Vector3; velocity?: THREE.Vector3; life: number; size: number; growth: number; rise?: number; color: THREE.Color; alpha: number }

export class Clouds {
  readonly mesh: THREE.Mesh
  private readonly geometry = new THREE.InstancedBufferGeometry()
  private readonly material: THREE.ShaderMaterial
  private readonly attributes: Record<'origin' | 'velocity' | 'life' | 'shape' | 'color', THREE.InstancedBufferAttribute>
  private cursor = 0
  private count = 0
  private seed = 1

  constructor(readonly capacity: number, flame: boolean) {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3))
    this.geometry.setIndex([0, 1, 2, 0, 2, 3])
    const attribute = (name: string, size: number) => {
      const value = new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size).setUsage(THREE.DynamicDrawUsage)
      this.geometry.setAttribute(name, value)
      return value
    }
    this.attributes = { origin: attribute('cloudOrigin', 3), velocity: attribute('cloudVelocity', 3), life: attribute('cloudLife', 2), shape: attribute('cloudShape', 4), color: attribute('cloudColor', 4) }
    this.geometry.instanceCount = 0
    this.material = new THREE.ShaderMaterial({
      uniforms: { ...THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { time: { value: 0 } }]), noise: { value: noise } },
      vertexShader: cloudVertex,
      fragmentShader: cloudFragment,
      defines: flame ? { FLAME: '' } : {},
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: flame ? THREE.AdditiveBlending : THREE.NormalBlending,
    })
    this.mesh = new THREE.Mesh(this.geometry, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = flame ? 4 : 3
  }

  random() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0
    return this.seed / 4294967296
  }

  spawn(time: number, puff: Puff) {
    const slot = this.cursor
    this.cursor = (this.cursor + 1) % this.capacity
    this.count = Math.min(this.capacity, this.count + 1)
    const { origin, velocity, life, shape, color } = this.attributes
    origin.setXYZ(slot, puff.at.x, puff.at.y, puff.at.z)
    velocity.setXYZ(slot, puff.velocity?.x ?? 0, puff.velocity?.y ?? 0, puff.velocity?.z ?? 0)
    life.setXY(slot, time, puff.life)
    shape.setXYZW(slot, puff.size, puff.growth, this.random(), puff.rise ?? 0)
    color.setXYZW(slot, puff.color.r, puff.color.g, puff.color.b, puff.alpha)
    for (const value of [origin, velocity, life, shape, color]) {
      value.addUpdateRange(slot * value.itemSize, value.itemSize)
      value.needsUpdate = true
    }
    this.geometry.instanceCount = this.count
  }

  update(time: number) { this.material.uniforms.time!.value = time }

  clear() {
    this.cursor = this.count = 0
    this.geometry.instanceCount = 0
  }

  dispose() {
    this.geometry.dispose()
    this.material.dispose()
  }
}

function glowTexture() {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')!
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.25, 'rgba(255,220,160,0.7)')
  gradient.addColorStop(1, 'rgba(255,160,60,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(canvas)
}

const streakVertex = `
varying float vAlong;
void main() {
  vAlong = uv.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`
const streakFragment = `
varying float vAlong;
void main() {
  gl_FragColor = vec4(vec3(1.0, 0.9, 0.7) * 2.0, pow(vAlong, 2.2));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

type Missile = { from: THREE.Vector3; to: THREE.Vector3; length: number; travelled: number; delay: number; streak: THREE.Mesh; head: THREE.Sprite; trail: number; onImpact: (missile: Missile) => void }
type Flash = { core: THREE.Mesh; ring: THREE.Mesh; age: number }
type Fire = { at: THREE.Vector3; spread: number; age: number; life: number; flames: number; smoke: number }

const colors = {
  dust: new THREE.Color('#7a7366'),
  pale: new THREE.Color('#8f887a'),
  smoke: new THREE.Color('#4a463f'),
  soot: new THREE.Color('#25231f'),
  trail: new THREE.Color('#c9c4b8'),
  ember: new THREE.Color('#d2421a'),
  fire: new THREE.Color('#ff7a26'),
}

export const STRIKE = { speed: 260, altitude: 260, dive: 0.62, bearing: 2.5, radius: 9, minRadius: 4.5, strength: 10, spacing: 8, stagger: 0.32, fireLife: 32, penetration: 4 }

export class StrikeEffects {
  readonly group = new THREE.Group()
  readonly smoke = new Clouds(1400, false)
  readonly flames = new Clouds(700, true)
  readonly light = new THREE.PointLight('#ff9a4a', 0, 140, 1.4)
  private readonly fireLight = new THREE.PointLight('#ff7b30', 0, 70, 1.6)
  private readonly missiles: Missile[] = []
  private readonly flashes: Flash[] = []
  private readonly fires: Fire[] = []
  private readonly streakGeometry = new THREE.CylinderGeometry(0.32, 0.04, 1, 6, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2)
  private readonly streakMaterial = new THREE.ShaderMaterial({ vertexShader: streakVertex, fragmentShader: streakFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  private readonly glow = new THREE.SpriteMaterial({ map: glowTexture(), color: '#ffd9a0', blending: THREE.AdditiveBlending, depthWrite: false, fog: false })
  private readonly flashGeometry = new THREE.SphereGeometry(1, 16, 12)
  private readonly ringGeometry = new THREE.RingGeometry(0.88, 1, 48).rotateX(-Math.PI / 2)
  private readonly scratch = new THREE.Vector3()
  private readonly seen = new Set<string>()
  private readonly recent = new Map<string, number>()
  private dust = 0
  private flashLevel = 0
  time = 0
  shake = 0

  constructor() {
    this.group.add(this.smoke.mesh, this.flames.mesh, this.light, this.fireLight)
  }

  get busy() { return this.missiles.length > 0 }

  warm(camera: THREE.Camera, at: THREE.Vector3, draw: () => void) {
    this.detonate(at, new THREE.Vector3(0, -1, 0), camera)
    const streak = new THREE.Mesh(this.streakGeometry, this.streakMaterial)
    const head = new THREE.Sprite(this.glow)
    streak.position.copy(at)
    head.position.copy(at)
    this.group.add(streak, head)
    this.update(0.2, camera)
    draw()
    this.group.remove(streak, head)
    this.clear()
  }

  launch(targets: THREE.Vector3[], onImpact: (target: THREE.Vector3, direction: THREE.Vector3) => void) {
    const horizontal = STRIKE.altitude / Math.tan(STRIKE.dive)
    targets.forEach((to, index) => {
      const bearing = STRIKE.bearing + (index - (targets.length - 1) / 2) * 0.06
      const from = new THREE.Vector3(to.x + Math.cos(bearing) * horizontal, to.y + STRIKE.altitude, to.z + Math.sin(bearing) * horizontal)
      const streak = new THREE.Mesh(this.streakGeometry, this.streakMaterial)
      streak.frustumCulled = false
      streak.visible = false
      const head = new THREE.Sprite(this.glow)
      head.scale.setScalar(5)
      head.visible = false
      this.group.add(streak, head)
      this.missiles.push({ from, to: to.clone(), length: from.distanceTo(to), travelled: 0, delay: index * STRIKE.stagger, streak, head, trail: 0, onImpact: missile => onImpact(missile.to, missile.to.clone().sub(missile.from).normalize()) })
    })
  }

  detonate(at: THREE.Vector3, direction: THREE.Vector3, camera: THREE.Camera) {
    const core = new THREE.Mesh(this.flashGeometry, new THREE.MeshBasicMaterial({ color: '#ffe0a8', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }))
    core.position.copy(at)
    const ring = new THREE.Mesh(this.ringGeometry, new THREE.MeshBasicMaterial({ color: '#ffc58a', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }))
    ring.position.set(at.x, 0.15, at.z)
    this.group.add(core, ring)
    this.flashes.push({ core, ring, age: 0 })
    this.light.position.copy(at).addScaledVector(direction, -3)
    this.flashLevel = 1
    this.shake = Math.min(1.6, this.shake + 80 / Math.max(25, camera.position.distanceTo(at)))
    const random = () => this.smoke.random()
    const out = () => this.scratch.set(random() * 2 - 1, random() * 1.4 - 0.2, random() * 2 - 1).normalize()
    for (let i = 0; i < 30; i++) {
      const dir = out().clone()
      this.flames.spawn(this.time, { at: at.clone().addScaledVector(dir, random() * 2), velocity: dir.multiplyScalar(6 + random() * 9), life: 0.7 + random() * 0.9, size: 1.8 + random() * 2, growth: 1.4, rise: 2, color: colors.fire, alpha: 0.55 })
    }
    for (let i = 0; i < 26; i++) {
      const dir = out().clone()
      this.smoke.spawn(this.time, { at: at.clone().addScaledVector(dir, random() * 3), velocity: dir.multiplyScalar(4 + random() * 7), life: 12 + random() * 10, size: 3 + random() * 2.4, growth: 2.4, rise: 0.9 + random() * 0.8, color: random() > 0.5 ? colors.smoke : colors.dust, alpha: 0.55 })
    }
    for (let i = 0; i < 18; i++) {
      const angle = random() * Math.PI * 2
      const speed = 9 + random() * 10
      this.smoke.spawn(this.time, { at: new THREE.Vector3(at.x + Math.cos(angle) * 2, 0.8 + random(), at.z + Math.sin(angle) * 2), velocity: new THREE.Vector3(Math.cos(angle) * speed, 0.4 + random(), Math.sin(angle) * speed), life: 10 + random() * 8, size: 2.6 + random() * 2, growth: 2.8, rise: 0.25, color: colors.dust, alpha: 0.45 })
    }
    this.fires.push({ at: new THREE.Vector3(at.x, Math.max(0.6, at.y * 0.35), at.z), spread: 4.5, age: 0, life: STRIKE.fireLife, flames: 0, smoke: 0 })
  }

  ingest(frame: SimulationFrame) {
    for (let i = 0; i < frame.events.length && this.dust >= 1; i++) {
      const event = frame.events[i] as DestructionEvent
      if (event.type !== 'heavyImpact' && event.type !== 'islandDetached' && event.type !== 'rubbleSettled') continue
      const mass = event.mass ?? 0
      if (mass < 1500) continue
      const key = `${event.tick}:${i}:${event.type}`
      if (this.seen.has(key)) continue
      this.seen.add(key)
      const cell = `${Math.round(event.position[0] / 6)}:${Math.round(event.position[1] / 6)}:${Math.round(event.position[2] / 6)}`
      if (this.time - (this.recent.get(cell) ?? -9) < 1.2) continue
      this.recent.set(cell, this.time)
      const low = event.position[1] < 5
      const count = Math.min(4, Math.max(1, Math.round(Math.log10(mass) - 2)))
      for (let n = 0; n < count && this.dust >= 1; n++, this.dust--) {
        const random = () => this.smoke.random()
        const angle = random() * Math.PI * 2
        const speed = low ? 2 + random() * 4 : 0.6 + random()
        this.smoke.spawn(this.time, {
          at: new THREE.Vector3(event.position[0] + (random() - 0.5) * 3, Math.max(0.6, event.position[1]), event.position[2] + (random() - 0.5) * 3),
          velocity: new THREE.Vector3(Math.cos(angle) * speed, low ? 0.3 : -0.4, Math.sin(angle) * speed),
          life: 9 + random() * 9, size: 1.6 + random() * 1.8 + (low ? 1 : 0), growth: 3, rise: low ? 0.5 : 0.2,
          color: random() > 0.4 ? colors.dust : colors.pale, alpha: 0.4,
        })
      }
    }
    if (this.seen.size > 4000) this.seen.clear()
    if (this.recent.size > 2000) this.recent.clear()
  }

  update(dt: number, camera: THREE.Camera) {
    this.time += dt
    this.dust = Math.min(14, this.dust + dt * 10)
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const missile = this.missiles[i]!
      if (missile.delay > 0) { missile.delay -= dt; continue }
      missile.travelled = Math.min(missile.length, missile.travelled + STRIKE.speed * dt)
      const t = missile.travelled / missile.length
      const head = this.scratch.lerpVectors(missile.from, missile.to, t)
      const tail = Math.min(missile.travelled, 46)
      missile.streak.visible = missile.head.visible = true
      missile.streak.position.copy(head).addScaledVector(missile.to.clone().sub(missile.from).normalize(), -tail)
      missile.streak.lookAt(head)
      missile.streak.scale.set(1, 1, tail)
      missile.head.position.copy(head)
      missile.trail += dt
      while (missile.trail > 0.006) {
        missile.trail -= 0.006
        const back = this.smoke.random() * tail * 0.5
        this.smoke.spawn(this.time, { at: head.clone().addScaledVector(missile.to.clone().sub(missile.from).normalize(), -back - 4), life: 2.5 + this.smoke.random() * 2, size: 0.32, growth: 3.2, rise: 0.1, color: colors.trail, alpha: 0.32 })
      }
      if (t >= 1) {
        this.group.remove(missile.streak, missile.head)
        this.missiles.splice(i, 1)
        missile.onImpact(missile)
      }
    }
    for (let i = this.flashes.length - 1; i >= 0; i--) {
      const flash = this.flashes[i]!
      flash.age += dt
      const k = flash.age / 0.4
      flash.core.scale.setScalar(1.5 + k * 8)
      ;(flash.core.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k)
      flash.ring.scale.setScalar(2 + Math.min(1, flash.age / 0.9) * 48)
      ;(flash.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.8 * (1 - flash.age / 0.9))
      if (flash.age > 0.9) {
        this.group.remove(flash.core, flash.ring)
        ;(flash.core.material as THREE.Material).dispose()
        ;(flash.ring.material as THREE.Material).dispose()
        this.flashes.splice(i, 1)
      }
    }
    this.flashLevel = Math.max(0, this.flashLevel - dt * 2.2)
    this.light.intensity = 9000 * this.flashLevel * this.flashLevel
    let glow = 0
    const center = new THREE.Vector3()
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const fire = this.fires[i]!
      fire.age += dt
      const strength = Math.min(1, fire.age * 2) * Math.max(0, 1 - fire.age / fire.life) ** 0.6
      if (strength <= 0) { this.fires.splice(i, 1); continue }
      glow += strength
      center.addScaledVector(fire.at, strength)
      fire.flames += dt * 34 * strength
      fire.smoke += dt * 2.5 * strength
      const random = () => this.flames.random()
      while (fire.flames > 1) {
        fire.flames--
        const angle = random() * Math.PI * 2
        const distance = Math.sqrt(random()) * fire.spread
        this.flames.spawn(this.time, { at: new THREE.Vector3(fire.at.x + Math.cos(angle) * distance, fire.at.y + random() * 0.6, fire.at.z + Math.sin(angle) * distance), velocity: new THREE.Vector3((random() - 0.5) * 0.6, 0.8, (random() - 0.5) * 0.6), life: 0.8 + random() * 0.8, size: 0.7 + random() * 0.9 * strength, growth: 0.4, rise: 2.4 + random() * 1.5, color: random() > 0.5 ? colors.fire : colors.ember, alpha: 0.42 })
      }
      while (fire.smoke > 1) {
        fire.smoke--
        this.smoke.spawn(this.time, { at: new THREE.Vector3(fire.at.x + (random() - 0.5) * fire.spread, fire.at.y + 2.5, fire.at.z + (random() - 0.5) * fire.spread), velocity: new THREE.Vector3(0.6 + random() * 0.4, 0.3, (random() - 0.5) * 0.4), life: 11 + random() * 6, size: 1.6 + random(), growth: 3, rise: 1.7 + random(), color: random() > 0.5 ? colors.smoke : colors.dust, alpha: 0.42 })
      }
    }
    if (glow > 0) this.fireLight.position.copy(center.divideScalar(glow)).add(new THREE.Vector3(0, 2.5, 3))
    this.fireLight.intensity = Math.min(1.6, glow) * (900 + Math.sin(this.time * 23) * 140 + Math.sin(this.time * 7.3) * 220)
    this.smoke.update(this.time)
    this.flames.update(this.time)
    this.shake = Math.max(0, this.shake - dt * 1.4)
    void camera
  }

  clear() {
    for (const missile of this.missiles) this.group.remove(missile.streak, missile.head)
    for (const flash of this.flashes) this.group.remove(flash.core, flash.ring)
    this.missiles.length = this.flashes.length = this.fires.length = 0
    this.smoke.clear()
    this.flames.clear()
    this.seen.clear()
    this.recent.clear()
    this.dust = 0
    this.flashLevel = 0
    this.light.intensity = this.fireLight.intensity = 0
  }
}
