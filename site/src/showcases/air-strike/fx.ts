import * as THREE from 'three'
import { SoftParticles } from '@blacksite/look/soft'
import type { DestructionEvent, SimulationFrame } from '@blacksite/cascade'

const DRAG = 0.9

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
  trail: new THREE.Color('#c9c4b8'),
  ember: new THREE.Color(0.85, 0.3, 0.1),
  fire: new THREE.Color(1, 0.5, 0.2),
}

export const STRIKE = { speed: 260, altitude: 260, dive: 0.62, bearing: 2.5, radius: 9, minRadius: 4.5, strength: 10, spacing: 8, stagger: 0.32, fireLife: 32, penetration: 4 }

export class StrikeEffects {
  readonly group = new THREE.Group()
  readonly smoke = new SoftParticles({ capacity: 1400 })
  readonly flames = new SoftParticles({ capacity: 700 })
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
  private seed = 1
  time = 0
  shake = 0

  constructor() {
    this.smoke.renderOrder = 3
    this.flames.renderOrder = 4
    this.group.add(this.smoke, this.flames, this.light, this.fireLight)
  }

  private random() {
    this.seed = (this.seed * 1664525 + 1013904223) >>> 0
    return this.seed / 4294967296
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
    const random = () => this.random()
    const out = () => this.scratch.set(random() * 2 - 1, random() * 1.4 - 0.2, random() * 2 - 1).normalize()
    for (let i = 0; i < 30; i++) {
      const dir = out().clone()
      this.flames.emit({ position: at.clone().addScaledVector(dir, random() * 2), velocity: dir.multiplyScalar(6 + random() * 9), acceleration: { x: 0, y: 2 * DRAG, z: 0 }, drag: DRAG, life: 0.7 + random() * 0.9, size: 3.6 + random() * 4, grow: 1.4, tint: colors.fire, glow: 0.9 })
    }
    for (let i = 0; i < 26; i++) {
      const dir = out().clone()
      this.smoke.emit({ position: at.clone().addScaledVector(dir, random() * 3), velocity: dir.multiplyScalar(4 + random() * 7), acceleration: { x: 0, y: (0.9 + random() * 0.8) * DRAG, z: 0 }, drag: DRAG, life: 12 + random() * 10, size: 6 + random() * 4.8, grow: 2.4, opacity: 0.5, tint: random() > 0.5 ? colors.smoke : colors.dust })
    }
    for (let i = 0; i < 18; i++) {
      const angle = random() * Math.PI * 2
      const speed = 9 + random() * 10
      this.smoke.emit({ position: { x: at.x + Math.cos(angle) * 2, y: 0.8 + random(), z: at.z + Math.sin(angle) * 2 }, velocity: { x: Math.cos(angle) * speed, y: 0.4 + random(), z: Math.sin(angle) * speed }, acceleration: { x: 0, y: 0.25 * DRAG, z: 0 }, drag: DRAG, life: 10 + random() * 8, size: 5.2 + random() * 4, grow: 2.8, opacity: 0.45, tint: colors.dust })
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
        const random = () => this.random()
        const angle = random() * Math.PI * 2
        const speed = low ? 2 + random() * 4 : 0.6 + random()
        this.smoke.emit({
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

  update(dt: number, camera: THREE.Camera) {
    this.time += dt
    this.smoke.advance(dt)
    this.flames.advance(dt)
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
        const back = this.random() * tail * 0.5
        this.smoke.emit({ position: head.clone().addScaledVector(missile.to.clone().sub(missile.from).normalize(), -back - 4), acceleration: { x: 0, y: 0.1 * DRAG, z: 0 }, drag: DRAG, life: 2.5 + this.random() * 2, size: 0.64, grow: 3.2, opacity: 0.32, tint: colors.trail })
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
      const random = () => this.random()
      while (fire.flames > 1) {
        fire.flames--
        const angle = random() * Math.PI * 2
        const distance = Math.sqrt(random()) * fire.spread
        this.flames.emit({ position: { x: fire.at.x + Math.cos(angle) * distance, y: fire.at.y + random() * 0.6, z: fire.at.z + Math.sin(angle) * distance }, velocity: { x: (random() - 0.5) * 0.6, y: 0.8, z: (random() - 0.5) * 0.6 }, acceleration: { x: 0, y: (2.4 + random() * 1.5) * DRAG, z: 0 }, drag: DRAG, life: 0.8 + random() * 0.8, size: 1.4 + random() * 1.8 * strength, grow: 0.4, tint: random() > 0.5 ? colors.fire : colors.ember, glow: 0.75 })
      }
      while (fire.smoke > 1) {
        fire.smoke--
        this.smoke.emit({ position: { x: fire.at.x + (random() - 0.5) * fire.spread, y: fire.at.y + 2.5, z: fire.at.z + (random() - 0.5) * fire.spread }, velocity: { x: 0.6 + random() * 0.4, y: 0.3, z: (random() - 0.5) * 0.4 }, acceleration: { x: 0, y: (1.7 + random()) * DRAG, z: 0 }, drag: DRAG, life: 11 + random() * 6, size: 3.2 + random() * 2, grow: 3, opacity: 0.42, tint: random() > 0.5 ? colors.smoke : colors.dust })
      }
    }
    if (glow > 0) this.fireLight.position.copy(center.divideScalar(glow)).add(new THREE.Vector3(0, 2.5, 3))
    this.fireLight.intensity = Math.min(1.6, glow) * (900 + Math.sin(this.time * 23) * 140 + Math.sin(this.time * 7.3) * 220)
    this.shake = Math.max(0, this.shake - dt * 1.4)
    void camera
  }

  clear() {
    for (const missile of this.missiles) this.group.remove(missile.streak, missile.head)
    for (const flash of this.flashes) this.group.remove(flash.core, flash.ring)
    this.missiles.length = this.flashes.length = this.fires.length = 0
    this.smoke.reset()
    this.flames.reset()
    this.seen.clear()
    this.recent.clear()
    this.dust = 0
    this.flashLevel = 0
    this.light.intensity = this.fireLight.intensity = 0
  }

  dispose() {
    this.clear()
    this.smoke.dispose()
    this.flames.dispose()
  }
}
