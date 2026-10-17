import * as THREE from 'three'
import { SoftParticles } from '@blacksite/look/soft'
import type { Vec3 } from '@blacksite/warden'

const TRACERS = 96
const PARTICLES = 160
const SPEED = 240
const STREAK = 2.4

type Tracer = { from: THREE.Vector3; dir: THREE.Vector3; length: number; born: number; live: boolean }

const flashColor = new THREE.Color().setRGB(1, 0.69, 0.31)
const impactColor = new THREE.Color().setRGB(1, 0.79, 0.5)
const dustColor = new THREE.Color('#8f8a7b')

export class ShotFx {
  readonly group = new THREE.Group()
  private tracers: Tracer[] = []
  private tracerMesh: THREE.InstancedMesh
  private particles = new SoftParticles({ capacity: PARTICLES })
  private matrix = new THREE.Matrix4()
  private quaternion = new THREE.Quaternion()
  private scale = new THREE.Vector3()
  private position = new THREE.Vector3()
  private forward = new THREE.Vector3(0, 0, 1)
  private dir = new THREE.Vector3()
  private muzzle = new THREE.Vector3()
  private cursor = 0
  private last = 0

  constructor() {
    const tracerGeometry = new THREE.BoxGeometry(1, 1, 1)
    tracerGeometry.translate(0, 0, 0.5)
    this.tracerMesh = new THREE.InstancedMesh(tracerGeometry, new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(3.6, 2.6, 1.3), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, toneMapped: false }), TRACERS)
    this.tracerMesh.frustumCulled = false
    this.tracerMesh.count = 0
    this.tracerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    this.group.add(this.tracerMesh, this.particles)
    for (let i = 0; i < TRACERS; i++) this.tracers.push({ from: new THREE.Vector3(), dir: new THREE.Vector3(), length: 0, born: 0, live: false })
  }

  shot(origin: Vec3, end: Vec3, now: number, traced: boolean) {
    this.sync(now)
    const dir = this.dir.set(end.x - origin.x, end.y - origin.y, end.z - origin.z)
    const length = dir.length()
    if (length < 0.5) return
    dir.divideScalar(length)
    const muzzle = this.muzzle.set(origin.x, origin.y - 0.14, origin.z).addScaledVector(dir, 0.75)
    if (traced) {
      const tracer = this.tracers[this.cursor]!
      this.cursor = (this.cursor + 1) % TRACERS
      tracer.dir.copy(dir)
      tracer.from.copy(muzzle)
      tracer.length = Math.max(0, length - 0.75)
      tracer.born = now
      tracer.live = true
    }
    this.particles.emit({ position: muzzle, life: 0.05, size: 0.22 + Math.random() * 0.12, grow: 1.5, tint: flashColor, glow: 9 })
    if (length >= 64) return
    const delay = length / SPEED
    this.position.set(end.x, end.y, end.z)
    this.particles.emit({ position: this.position, delay, life: 0.09, size: 0.12, grow: 2, tint: impactColor, glow: 1.4 })
    this.particles.emit({ position: this.position, delay, acceleration: { x: 0, y: 0.3, z: 0 }, drag: 2, life: 0.55, size: 0.2, grow: 1.5, opacity: 0.6, tint: dustColor })
  }

  private sync(now: number) {
    if (this.last) this.particles.advance(Math.max(0, now - this.last) / 1000)
    this.last = now
  }

  update(now: number) {
    this.sync(now)
    let count = 0
    for (const tracer of this.tracers) {
      if (!tracer.live) continue
      const head = Math.min(tracer.length, ((now - tracer.born) / 1000) * SPEED)
      const tail = Math.max(0, head - STREAK)
      if (tail >= tracer.length) { tracer.live = false; continue }
      if (head <= 0) continue
      this.position.copy(tracer.from).addScaledVector(tracer.dir, tail)
      this.quaternion.setFromUnitVectors(this.forward, tracer.dir)
      this.scale.set(0.022, 0.022, head - tail)
      this.matrix.compose(this.position, this.quaternion, this.scale)
      this.tracerMesh.setMatrixAt(count++, this.matrix)
    }
    this.tracerMesh.count = count
    this.tracerMesh.instanceMatrix.needsUpdate = true
  }

  clear() {
    for (const tracer of this.tracers) tracer.live = false
    this.particles.reset()
  }

  dispose() {
    this.tracerMesh.geometry.dispose()
    ;(this.tracerMesh.material as THREE.Material).dispose()
    this.particles.dispose()
  }
}

export class Gunfire {
  private context: AudioContext | null = null
  private noise: AudioBuffer | null = null
  private voices = 0
  private listener = new THREE.Vector3()

  unlock() {
    if (this.context) { void this.context.resume(); return }
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return
    this.context = new AudioContextClass()
    const length = Math.floor(this.context.sampleRate * 0.4)
    this.noise = this.context.createBuffer(1, length, this.context.sampleRate)
    const data = this.noise.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.2)
  }

  hear(position: THREE.Vector3) { this.listener.copy(position) }

  shot(origin: Vec3, suppressed: boolean) {
    const context = this.context
    if (!context || !this.noise || context.state !== 'running' || this.voices > 14) return
    const distance = Math.hypot(origin.x - this.listener.x, origin.y - this.listener.y, origin.z - this.listener.z)
    const delay = distance / 343
    const at = context.currentTime + delay
    const source = context.createBufferSource()
    source.buffer = this.noise
    source.playbackRate.value = 0.82 + Math.random() * 0.14
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = Math.max(700, 7000 / (1 + distance / 9))
    filter.Q.value = 0.7
    const gain = context.createGain()
    const level = (suppressed ? 0.42 : 0.55) / (1 + distance / 7)
    gain.gain.setValueAtTime(level, at)
    gain.gain.exponentialRampToValueAtTime(0.0008, at + 0.35)
    source.connect(filter).connect(gain).connect(context.destination)
    source.start(at)
    source.stop(at + 0.4)
    this.voices++
    source.onended = () => { this.voices--; source.disconnect(); filter.disconnect(); gain.disconnect() }
  }

  dispose() { void this.context?.close(); this.context = null }
}
