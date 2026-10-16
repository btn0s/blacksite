import * as THREE from 'three'
import type { Vec3 } from '@blacksite/warden'

const TRACERS = 96
const SPARKS = 160
const SPEED = 240
const STREAK = 2.4

type Tracer = { from: THREE.Vector3; dir: THREE.Vector3; length: number; born: number; live: boolean }
type Spark = { at: THREE.Vector3; born: number; life: number; size: number; grow: number; color: THREE.Color; live: boolean }

const flashColor = new THREE.Color().setRGB(9, 6.2, 2.8)
const impactColor = new THREE.Color().setRGB(1.4, 1.1, 0.7)
const dustColor = new THREE.Color().setRGB(0.32, 0.3, 0.26)

export class ShotFx {
  readonly group = new THREE.Group()
  private tracers: Tracer[] = []
  private sparks: Spark[] = []
  private tracerMesh: THREE.InstancedMesh
  private sparkMesh: THREE.InstancedMesh
  private matrix = new THREE.Matrix4()
  private quaternion = new THREE.Quaternion()
  private scale = new THREE.Vector3()
  private position = new THREE.Vector3()
  private forward = new THREE.Vector3(0, 0, 1)
  private dir = new THREE.Vector3()
  private muzzle = new THREE.Vector3()
  private color = new THREE.Color()
  private cursor = 0
  private sparkCursor = 0

  constructor() {
    const tracerGeometry = new THREE.BoxGeometry(1, 1, 1)
    tracerGeometry.translate(0, 0, 0.5)
    this.tracerMesh = new THREE.InstancedMesh(tracerGeometry, new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(3.6, 2.6, 1.3), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, toneMapped: false }), TRACERS)
    this.sparkMesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, toneMapped: false }), SPARKS)
    for (const mesh of [this.tracerMesh, this.sparkMesh]) {
      mesh.frustumCulled = false
      mesh.count = 0
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      this.group.add(mesh)
    }
    this.sparkMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SPARKS * 3), 3)
    for (let i = 0; i < TRACERS; i++) this.tracers.push({ from: new THREE.Vector3(), dir: new THREE.Vector3(), length: 0, born: 0, live: false })
    for (let i = 0; i < SPARKS; i++) this.sparks.push({ at: new THREE.Vector3(), born: 0, life: 0, size: 0, grow: 0, color: new THREE.Color(), live: false })
  }

  shot(origin: Vec3, end: Vec3, now: number, traced: boolean) {
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
    this.spark(muzzle, now, 0.05, 0.11 + Math.random() * 0.06, 1.5, flashColor)
    const hit = new THREE.Vector3(end.x, end.y, end.z)
    if (length < 64) {
      this.spark(hit, now + length / SPEED * 1000, 0.09, 0.06, 2, impactColor)
      this.spark(hit, now + length / SPEED * 1000, 0.55, 0.12, 0.9, dustColor)
    }
  }

  private spark(at: THREE.Vector3, born: number, life: number, size: number, grow: number, color: THREE.Color) {
    const spark = this.sparks[this.sparkCursor]!
    this.sparkCursor = (this.sparkCursor + 1) % SPARKS
    spark.at.copy(at)
    spark.born = born
    spark.life = life * 1000
    spark.size = size
    spark.grow = grow
    spark.color.copy(color)
    spark.live = true
  }

  update(now: number) {
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
    count = 0
    this.quaternion.identity()
    for (const spark of this.sparks) {
      if (!spark.live) continue
      const age = now - spark.born
      if (age < 0) continue
      if (age > spark.life) { spark.live = false; continue }
      const k = age / spark.life
      this.scale.setScalar(spark.size * (1 + k * spark.grow))
      this.matrix.compose(spark.at, this.quaternion, this.scale)
      this.sparkMesh.setMatrixAt(count, this.matrix)
      this.sparkMesh.setColorAt(count++, this.color.copy(spark.color).multiplyScalar((1 - k) * (1 - k)))
    }
    this.sparkMesh.count = count
    this.sparkMesh.instanceMatrix.needsUpdate = true
    if (this.sparkMesh.instanceColor) this.sparkMesh.instanceColor.needsUpdate = true
  }

  clear() {
    for (const tracer of this.tracers) tracer.live = false
    for (const spark of this.sparks) spark.live = false
  }

  dispose() {
    for (const mesh of [this.tracerMesh, this.sparkMesh]) { mesh.geometry.dispose(); (mesh.material as THREE.Material).dispose() }
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
