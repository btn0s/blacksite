import * as THREE from 'three'
import { DEPTH, WIDTH } from './compound'

export type CameraMode = 'tactical' | 'follow'

const damp = (current: number, target: number, rate: number, dt: number) => current + (target - current) * (1 - Math.exp(-rate * dt))
const dampAngle = (current: number, target: number, rate: number, dt: number) => current + Math.atan2(Math.sin(target - current), Math.cos(target - current)) * (1 - Math.exp(-rate * dt))

export class CameraRig {
  mode: CameraMode = 'tactical'
  readonly target = new THREE.Vector3(0, 0, 0)
  private goal = new THREE.Vector3()
  private azimuth = typeof innerWidth === 'number' && innerWidth < innerHeight ? Math.PI / 2 - 0.35 : -0.5
  private elevation = 0.74
  private distance = 40
  private zoom = 1
  private manualUntil = 0
  private panned = false
  private pointers = new Map<number, { x: number; y: number; startX: number; startY: number; time: number; button: number }>()
  private pinch = 0
  private followYaw = 0
  private followOffset = 0
  private followPitch = 0.3
  private eye = new THREE.Vector3()
  private look = new THREE.Vector3()
  private lookGoal = new THREE.Vector3()
  private forward = new THREE.Vector3()
  private right = new THREE.Vector3()
  private initialized = false
  onTap: (x: number, y: number) => void = () => {}
  onInput: () => void = () => {}

  constructor(private readonly element: HTMLElement) {
    element.addEventListener('pointerdown', this.down)
    element.addEventListener('pointermove', this.move)
    element.addEventListener('pointerup', this.up)
    element.addEventListener('pointercancel', this.up)
    element.addEventListener('wheel', this.wheel, { passive: false })
    element.addEventListener('contextmenu', this.menu)
  }

  dispose() {
    this.element.removeEventListener('pointerdown', this.down)
    this.element.removeEventListener('pointermove', this.move)
    this.element.removeEventListener('pointerup', this.up)
    this.element.removeEventListener('pointercancel', this.up)
    this.element.removeEventListener('wheel', this.wheel)
    this.element.removeEventListener('contextmenu', this.menu)
  }

  follow() { if (this.mode !== 'follow') { this.mode = 'follow'; this.followOffset = 0; this.followPitch = 0.3 } }

  tactical() { if (this.mode !== 'tactical') { this.mode = 'tactical'; this.panned = false; this.manualUntil = 0 } }

  private menu = (event: Event) => event.preventDefault()

  private touched() { this.manualUntil = performance.now() + 7000; this.onInput() }

  private down = (event: PointerEvent) => {
    this.element.setPointerCapture?.(event.pointerId)
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, time: performance.now(), button: event.button })
    if (this.pointers.size === 2) this.pinch = this.spread()
  }

  private spread() {
    const [a, b] = [...this.pointers.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  private move = (event: PointerEvent) => {
    const pointer = this.pointers.get(event.pointerId)
    if (!pointer) return
    const dx = event.clientX - pointer.x
    const dy = event.clientY - pointer.y
    pointer.x = event.clientX
    pointer.y = event.clientY
    if (Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) < 4) return
    this.touched()
    if (this.pointers.size >= 2) {
      const spread = this.spread()
      if (this.pinch > 0 && spread > 0) this.zoom = THREE.MathUtils.clamp(this.zoom * this.pinch / spread, 0.4, 1.6)
      this.pinch = spread
      if (this.mode === 'tactical') this.pan(dx / 2, dy / 2)
      return
    }
    if (pointer.button === 2 || event.shiftKey) { if (this.mode === 'tactical') this.pan(dx, dy); return }
    if (this.mode === 'follow') {
      this.followOffset -= dx * 0.006
      this.followPitch = THREE.MathUtils.clamp(this.followPitch + dy * 0.004, -0.2, 0.9)
    } else {
      this.azimuth -= dx * 0.0055
      this.elevation = THREE.MathUtils.clamp(this.elevation + dy * 0.004, 0.32, 1.38)
    }
  }

  private pan(dx: number, dy: number) {
    const scale = this.distance * this.zoom * 0.0018
    const cos = Math.cos(this.azimuth), sin = Math.sin(this.azimuth)
    this.goal.x -= (dx * cos + dy * sin) * scale
    this.goal.z -= (-dx * sin + dy * cos) * scale
    this.goal.x = THREE.MathUtils.clamp(this.goal.x, -WIDTH / 2, WIDTH / 2)
    this.goal.z = THREE.MathUtils.clamp(this.goal.z, -DEPTH / 2, DEPTH / 2)
    this.panned = true
  }

  private up = (event: PointerEvent) => {
    const pointer = this.pointers.get(event.pointerId)
    this.pointers.delete(event.pointerId)
    this.pinch = this.pointers.size === 2 ? this.spread() : 0
    if (!pointer || this.pointers.size) return
    if (Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) < 8 && performance.now() - pointer.time < 450) this.onTap(event.clientX, event.clientY)
  }

  private wheel = (event: WheelEvent) => {
    event.preventDefault()
    this.touched()
    this.zoom = THREE.MathUtils.clamp(this.zoom * Math.exp(event.deltaY * 0.0011), 0.4, 1.6)
  }

  update(camera: THREE.PerspectiveCamera, dt: number, action: THREE.Vector3, subject: { position: THREE.Vector3; yaw: number } | null) {
    const portrait = camera.aspect < 1
    if (this.mode === 'follow' && subject) {
      this.followYaw = dampAngle(this.followYaw, subject.yaw, 2.4, dt)
      const yaw = this.followYaw + this.followOffset
      this.forward.set(Math.sin(yaw), 0, Math.cos(yaw))
      this.right.set(-this.forward.z, 0, this.forward.x)
      const back = (portrait ? 4.8 : 3.8) * THREE.MathUtils.clamp(this.zoom, 0.6, 1.6)
      const height = 1.7 + Math.sin(this.followPitch) * back
      this.goal.copy(subject.position).addScaledVector(this.forward, -Math.cos(this.followPitch) * back).addScaledVector(this.right, -0.7)
      this.goal.y = subject.position.y + height
      this.lookGoal.copy(subject.position).addScaledVector(this.forward, 7).addScaledVector(this.right, -0.4)
      this.lookGoal.y = subject.position.y + 1.25
      const rate = this.initialized ? 7 : 1000
      this.eye.set(damp(this.eye.x, this.goal.x, rate, dt), damp(this.eye.y, this.goal.y, rate, dt), damp(this.eye.z, this.goal.z, rate, dt))
      this.look.set(damp(this.look.x, this.lookGoal.x, rate, dt), damp(this.look.y, this.lookGoal.y, rate, dt), damp(this.look.z, this.lookGoal.z, rate, dt))
      this.initialized = true
      camera.position.copy(this.eye)
      camera.lookAt(this.look)
      this.target.copy(subject.position)
      this.goal.copy(subject.position)
      return
    }
    const now = performance.now()
    if (!this.panned) this.goal.copy(action)
    if (now > this.manualUntil) this.azimuth = dampAngle(this.azimuth, (portrait ? Math.PI / 2 - 0.35 : -0.5) + Math.sin(now * 0.00005) * 0.4, 0.35, dt)
    this.distance = (portrait ? 50 : 32) * this.zoom
    this.target.set(damp(this.target.x, this.goal.x, 1.1, dt), 0, damp(this.target.z, this.goal.z, 1.1, dt))
    const horizontal = Math.cos(this.elevation) * this.distance
    this.lookGoal.set(this.target.x + Math.sin(this.azimuth) * horizontal, Math.sin(this.elevation) * this.distance, this.target.z + Math.cos(this.azimuth) * horizontal)
    const rate = this.initialized ? 3.2 : 1000
    this.eye.set(damp(this.eye.x, this.lookGoal.x, rate, dt), damp(this.eye.y, this.lookGoal.y, rate, dt), damp(this.eye.z, this.lookGoal.z, rate, dt))
    this.look.set(damp(this.look.x, this.target.x, rate, dt), damp(this.look.y, 0.5, rate, dt), damp(this.look.z, this.target.z, rate, dt))
    this.initialized = true
    camera.position.copy(this.eye)
    camera.lookAt(this.look)
  }
}
