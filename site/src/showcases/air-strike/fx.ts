import * as THREE from 'three'
import { SoftParticles } from '@blacksite/look/soft'
import type { DestructionEvent, SimulationFrame } from '@blacksite/cascade'

const DRAG = 0.9

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

type Missile = { from: THREE.Vector3; to: THREE.Vector3; direction: THREE.Vector3; length: number; travelled: number; fuse: number; munition: Munition; streak: THREE.Mesh; onImpact: (at: THREE.Vector3, direction: THREE.Vector3, munition: Munition) => void }
type Fire = { at: THREE.Vector3; spread: number; age: number; life: number; flames: number }

const colors = {
  dust: new THREE.Color('#7a7366'),
  pale: new THREE.Color('#8f887a'),
  white: new THREE.Color(1, 1, 1),
}
const hot = { r: 1, g: 0.86, b: 0.62 }
const orange = { r: 1, g: 0.38, b: 0.09 }
const soot = new THREE.Color('#4a463f')
const haze = new THREE.Color('#7a7569')

export type Munition = { readonly name: string; readonly speed: number; readonly flight: number; readonly dive: number; readonly charge: number; readonly depth: number }

export const MUNITIONS = {
  missile: { name: 'Cruise missile', speed: 250, flight: 1.1, dive: 0.1, charge: 200, depth: 0 },
  bomb: { name: 'Penetrating bomb', speed: 300, flight: 1, dive: 1.25, charge: 250, depth: 3 },
} satisfies Record<string, Munition>

const UNIT_FIREBALL_CHARGE = 150

export const fireball = (munition: Munition) => Math.cbrt(munition.charge / UNIT_FIREBALL_CHARGE)

const FIRE_LIFE = 12

export class StrikeEffects {
  readonly group = new THREE.Group()
  readonly clouds = new SoftParticles({ capacity: 1600 })
  readonly light = new THREE.PointLight('#ff9a4a', 0, 140, 1.4)
  private readonly fireLight = new THREE.PointLight('#ff7b30', 0, 40, 2)
  private readonly fireball = this.clouds.curve([
    { at: 0, color: hot, glow: 1.6, opacity: 0.15 },
    { at: 0.015, color: orange, glow: 1 },
    { at: 0.05, color: soot, glow: 0, opacity: 1 },
    { at: 0.75, opacity: 0.8 },
    { at: 1, color: haze, opacity: 0 },
  ])
  private readonly flame = this.clouds.curve([
    { at: 0, color: hot, glow: 1.2, opacity: 0 },
    { at: 0.04, color: orange, glow: 1 },
    { at: 0.14, color: soot, glow: 0, opacity: 1 },
    { at: 0.7, opacity: 0.7 },
    { at: 1, color: haze, opacity: 0 },
  ])
  private readonly missiles: Missile[] = []
  private readonly fires: Fire[] = []
  private readonly streakGeometry = new THREE.CylinderGeometry(0.32, 0.04, 1, 6, 1, true).translate(0, 0.5, 0).rotateX(Math.PI / 2)
  private readonly streakMaterial = new THREE.ShaderMaterial({ vertexShader: streakVertex, fragmentShader: streakFragment, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
  private readonly scratch = new THREE.Vector3()
  private readonly seen = new Set<string>()
  private readonly recent = new Map<string, number>()
  private dust = 0
  private flashLevel = 0
  private seed = 1
  time = 0

  constructor() {
    this.group.add(this.clouds, this.light, this.fireLight)
  }

  private random() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0
    return this.seed / 4294967296
  }

  get inbound() { return this.missiles.length }

  warm(at: THREE.Vector3, draw: () => void) {
    this.detonate(at, new THREE.Vector3(0, -1, 0), MUNITIONS.missile)
    const streak = new THREE.Mesh(this.streakGeometry, this.streakMaterial)
    streak.position.copy(at)
    this.group.add(streak)
    this.update(0.2)
    draw()
    this.group.remove(streak)
    this.clear()
  }

  launch(to: THREE.Vector3, heading: THREE.Vector3, munition: Munition, onImpact: Missile['onImpact']) {
    const direction = new THREE.Vector3(heading.x, 0, heading.z).normalize().multiplyScalar(Math.cos(munition.dive)).setY(-Math.sin(munition.dive))
    const length = munition.speed * munition.flight
    const streak = new THREE.Mesh(this.streakGeometry, this.streakMaterial)
    streak.frustumCulled = false
    streak.visible = false
    this.group.add(streak)
    this.missiles.push({ from: to.clone().addScaledVector(direction, -length), to: to.clone(), direction, length, travelled: 0, fuse: munition.depth / munition.speed, munition, streak, onImpact })
  }

  detonate(at: THREE.Vector3, direction: THREE.Vector3, munition: Munition) {
    const scale = fireball(munition)
    this.light.position.copy(at).addScaledVector(direction, -3)
    this.flashLevel = Math.min(1, this.flashLevel + scale)
    const random = () => this.random()
    const out = () => this.scratch.set(random() * 2 - 1, random() * 1.4 - 0.2, random() * 2 - 1).normalize()
    for (let i = 0; i < Math.round(16 * scale); i++) {
      const dir = out().clone()
      this.clouds.emit({ position: at.clone().addScaledVector(dir, random() * 1.5 * scale), velocity: dir.multiplyScalar((4 + random() * 7) * scale), acceleration: { x: 0, y: (1.2 + random() * 0.8) * DRAG, z: 0 }, drag: DRAG, life: 12 + random() * 6, size: (3 + random() * 2.5) * scale, grow: 2.2, opacity: 0.55, tint: colors.white, curve: this.fireball })
    }
    if (at.y < 4) {
      for (let i = 0; i < 10; i++) {
        const angle = (i + random()) / 10 * Math.PI * 2
        const speed = (7 + random() * 6) * scale
        this.clouds.emit({ position: { x: at.x + Math.cos(angle) * 2, y: 0.8 + random(), z: at.z + Math.sin(angle) * 2 }, velocity: { x: Math.cos(angle) * speed, y: 0.4 + random(), z: Math.sin(angle) * speed }, acceleration: { x: 0, y: 0.25 * DRAG, z: 0 }, drag: DRAG, life: 10 + random() * 8, size: (4 + random() * 3) * scale, grow: 2.8, opacity: 0.45, tint: colors.dust })
      }
    }
    this.fires.push({ at: at.clone(), spread: 1.5 * scale, age: 0, life: FIRE_LIFE, flames: 0 })
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
        const random = () => this.random()
        const angle = random() * Math.PI * 2
        const speed = low ? 2 + random() * 4 : 0.6 + random()
        this.clouds.emit({
          position: { x: event.position[0] + (random() - 0.5) * 3, y: Math.max(0.6, event.position[1]), z: event.position[2] + (random() - 0.5) * 3 },
          velocity: { x: Math.cos(angle) * speed, y: low ? 0.3 : -0.4, z: Math.sin(angle) * speed },
          acceleration: { x: 0, y: (low ? 0.5 : 0.2) * DRAG, z: 0 }, drag: DRAG,
          life: 9 + random() * 9, size: 3.2 + random() * 3.6 + (low ? 2 : 0), grow: 3,
          opacity: 0.4, tint: random() > 0.4 ? colors.dust : colors.pale,
        })
      }
    }
    if (this.seen.size > 4000) this.seen.clear()
    if (this.recent.size > 2000) this.recent.clear()
  }

  update(dt: number) {
    this.time += dt
    this.clouds.advance(dt)
    this.dust = Math.min(14, this.dust + dt * 10)
    for (let i = this.missiles.length - 1; i >= 0; i--) {
      const missile = this.missiles[i]!
      if (missile.travelled < missile.length) {
        missile.travelled = Math.min(missile.length, missile.travelled + missile.munition.speed * dt)
        const head = this.scratch.lerpVectors(missile.from, missile.to, missile.travelled / missile.length)
        const tail = Math.min(missile.travelled, 46)
        missile.streak.visible = true
        missile.streak.position.copy(head).addScaledVector(missile.direction, -tail)
        missile.streak.lookAt(head)
        missile.streak.scale.set(1, 1, tail)
        continue
      }
      missile.streak.visible = false
      missile.fuse -= dt
      if (missile.fuse > 0) continue
      this.group.remove(missile.streak)
      this.missiles.splice(i, 1)
      const at = missile.to.clone().addScaledVector(missile.direction, missile.munition.depth)
      at.y = Math.max(0.6, at.y)
      this.detonate(at, missile.direction, missile.munition)
      missile.onImpact(at, missile.direction, missile.munition)
    }
    this.flashLevel = Math.max(0, this.flashLevel - dt * 2.2)
    this.light.intensity = 9000 * this.flashLevel * this.flashLevel
    let glow = 0
    let latest: Fire | null = null
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const fire = this.fires[i]!
      fire.age += dt
      const strength = Math.min(1, fire.age * 2) * Math.max(0, 1 - fire.age / fire.life) ** 0.6
      if (strength <= 0) { this.fires.splice(i, 1); continue }
      glow += strength
      latest ??= fire
      fire.flames += dt * 9 * strength
      const random = () => this.random()
      while (fire.flames > 1) {
        fire.flames--
        const angle = random() * Math.PI * 2
        const distance = Math.sqrt(random()) * fire.spread
        this.clouds.emit({ position: { x: fire.at.x + Math.cos(angle) * distance, y: fire.at.y + random() * 0.6, z: fire.at.z + Math.sin(angle) * distance }, velocity: { x: (random() - 0.5) * 0.6, y: 0.8, z: (random() - 0.5) * 0.6 }, acceleration: { x: 0.5 * DRAG, y: (2.2 + random() * 1.2) * DRAG, z: 0 }, drag: DRAG, life: 7 + random() * 4, size: 1.6 + random() * 1.6 * strength, grow: 4, opacity: 0.4, tint: colors.white, curve: this.flame })
      }
    }
    if (latest) this.fireLight.position.copy(latest.at).add(new THREE.Vector3(0, 2.5, 3))
    this.fireLight.intensity = Math.min(1.6, glow) * (40 + Math.sin(this.time * 7.3) * 5)
  }

  clear() {
    for (const missile of this.missiles) this.group.remove(missile.streak)
    this.missiles.length = this.fires.length = 0
    this.clouds.reset()
    this.seen.clear()
    this.recent.clear()
    this.dust = 0
    this.flashLevel = 0
    this.light.intensity = this.fireLight.intensity = 0
  }

  dispose() {
    this.clear()
    this.clouds.dispose()
  }
}
