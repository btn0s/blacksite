import * as THREE from 'three'
import { DestructionRenderer, DestructionSession, FIXED_DT_30HZ, FragmentState, type FragmentDef, type FragmentSurface } from '@blacksite/cascade'
import { attachPerfProbe, reportActiveBodies } from '@blacksite/ui/perf-overlay'
import { createLook, type Look } from '@blacksite/look'
import { createAtmosphere, internalPixelRatio, isTouchDevice, meterSurface, preloadSurfaces } from '@blacksite/look/world'
import { BLOCK, BLOCK_HEIGHT, BLOCK_LENGTH, createBlock } from './block'
import { STRIKE, StrikeEffects } from './fx'
import { buildYard } from './yard'

export type Phase = 'loading' | 'ready' | 'designating' | 'inbound' | 'impact'
export type AirStrikeState = { phase: Phase; countdown: number; progress: number; detached: number; error: string | null }

const designateSeconds = 1.4

function reticleTexture() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')!
  context.strokeStyle = '#ff4a2a'
  context.lineWidth = 5
  context.beginPath()
  context.arc(size / 2, size / 2, size * 0.4, 0, Math.PI * 2)
  context.stroke()
  context.lineWidth = 3
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2
    context.beginPath()
    context.moveTo(size / 2 + Math.cos(angle) * size * 0.16, size / 2 + Math.sin(angle) * size * 0.16)
    context.lineTo(size / 2 + Math.cos(angle) * size * 0.32, size / 2 + Math.sin(angle) * size * 0.32)
    context.stroke()
  }
  context.fillStyle = '#ff4a2a'
  context.beginPath()
  context.arc(size / 2, size / 2, 4, 0, Math.PI * 2)
  context.fill()
  return new THREE.CanvasTexture(canvas)
}

class OrbitRig {
  readonly target = new THREE.Vector3(0, 7.5, 0)
  yaw = -0.52
  pitch = 0.13
  distance = 64
  private readonly goal = { yaw: this.yaw, pitch: this.pitch, distance: this.distance }
  idle = 0

  constructor(readonly camera: THREE.PerspectiveCamera) {}

  orbit(dx: number, dy: number) {
    this.goal.yaw -= dx * 0.005
    this.goal.pitch = THREE.MathUtils.clamp(this.goal.pitch + dy * 0.004, 0.03, 0.62)
    this.idle = 0
  }

  zoom(factor: number) {
    this.goal.distance = THREE.MathUtils.clamp(this.goal.distance * factor, 34, 120)
    this.idle = 0
  }

  update(dt: number, shake: number) {
    this.idle += dt
    if (this.idle > 8) this.goal.yaw += dt * 0.025
    const k = 1 - Math.exp(-dt * 6)
    this.yaw += (this.goal.yaw - this.yaw) * k
    this.pitch += (this.goal.pitch - this.pitch) * k
    this.distance += (this.goal.distance - this.distance) * k
    const c = Math.cos(this.pitch)
    this.camera.position.set(Math.sin(this.yaw) * c, Math.sin(this.pitch), Math.cos(this.yaw) * c).multiplyScalar(this.distance).add(this.target)
    this.camera.lookAt(this.target)
    if (shake > 0) {
      const amount = shake * shake * 0.6
      this.camera.position.x += (Math.random() - 0.5) * amount
      this.camera.position.y += (Math.random() - 0.5) * amount
      this.camera.rotateZ((Math.random() - 0.5) * amount * 0.01)
    }
  }
}

export class AirStrikeScene {
  readonly renderer: THREE.WebGLRenderer
  private readonly look: Look
  readonly scene = new THREE.Scene()
  readonly camera = new THREE.PerspectiveCamera(42, 1, 0.3, 900)
  readonly rig = new OrbitRig(this.camera)
  readonly fx = new StrikeEffects()
  private session: DestructionSession | null = null
  private view: DestructionRenderer | null = null
  private ground: THREE.Mesh | null = null
  private readonly reticle = new THREE.Sprite(new THREE.SpriteMaterial({ map: reticleTexture(), depthTest: false, transparent: true, fog: false }))
  private readonly beam = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1, 6, 1, true).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: '#ff3a1a', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }))
  private readonly ray = new THREE.Raycaster()
  private readonly pointer = new THREE.Vector2()
  private designation: { point: THREE.Vector3; age: number } | null = null
  private shadowAt = 0
  private lastShadow = -1
  private mass = 1
  private leaves: number[] = []
  private indexOf = new Map<number, number>()
  private hudAt = 0
  private disposed = false
  private readonly clock = new THREE.Clock()
  private readonly materials = new Map<string, THREE.Material>()
  private fragmentSource: ReadonlyMap<number, string> = new Map()
  state: AirStrikeState = { phase: 'loading', countdown: 0, progress: 0.05, detached: 0, error: null }
  onState: (state: AirStrikeState) => void = () => {}

  constructor(readonly host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(internalPixelRatio())
    this.renderer.shadowMap.autoUpdate = false
    this.renderer.domElement.style.filter = 'none'
    host.prepend(this.renderer.domElement)
    attachPerfProbe(this.renderer)
    const atmosphere = createAtmosphere(this.scene, this.renderer, { fog: '#8a8b7e', density: 0.0068, sunDirection: [-0.62, 0.42, 0.5], sunIntensity: 2.4, ambient: 0.95, shadowSize: 44, shadowMap: isTouchDevice() ? 1024 : 2048 })
    atmosphere.follow(new THREE.Vector3(0, 0, 4))
    this.look = createLook(this.renderer, this.scene, this.camera, { atmosphere: 'zone', sky: false, fog: false })
    this.reticle.visible = false
    this.reticle.renderOrder = 10
    this.beam.visible = false
    this.beam.frustumCulled = false
    this.scene.add(this.camera, this.fx.group, this.reticle, this.beam)
    this.resize()
    addEventListener('resize', this.resize)
    this.renderer.setAnimationLoop(this.loop)
    void this.load()
  }

  private set(patch: Partial<AirStrikeState>) {
    this.state = { ...this.state, ...patch }
    this.onState(this.state)
  }

  private async load() {
    await preloadSurfaces()
    if (this.disposed) return
    this.set({ progress: 0.35 })
    const yard = buildYard()
    this.ground = yard.ground
    this.scene.add(yard.group)
    await new Promise(resolve => setTimeout(resolve, 30))
    const { manifest, fragmentSource } = createBlock()
    this.fragmentSource = fragmentSource
    const parents = new Set(manifest.fragments.map(fragment => fragment.parent))
    this.leaves = manifest.fragments.flatMap((fragment, index) => parents.has(fragment.id) ? [] : [index])
    this.indexOf = new Map(manifest.fragments.map((fragment, index) => [fragment.id, index]))
    this.mass = this.leaves.reduce((sum, index) => sum + manifest.fragments[index]!.mass, 0)
    this.set({ progress: 0.6 })
    this.session = new DestructionSession(manifest, {
      frame: frame => this.fx.ingest(frame),
      ready: () => { this.warm(); this.set({ phase: 'ready', progress: 1 }) },
    }, { timestep: FIXED_DT_30HZ, rest: { forceAfterSeconds: 2.5, forceSpeed: 0.5, forceSpin: 0.9 } })
    this.view = new DestructionRenderer(manifest, { materialFor: this.materialFor, cameraShake: 1, effects: false, secondaryAddsPerUpdate: 12, edgeFacesPerUpdate: 64 })
    this.scene.add(this.view.group)
    this.session.subscribe(() => { const error = this.session?.getSnapshot().error; if (error && error !== this.state.error) this.set({ error }) })
  }

  private materialFor = (fragment: FragmentDef, surface: FragmentSurface) => {
    const source = this.fragmentSource.get(fragment.id) ?? ''
    const kind = surface === 'fracture' ? 'fracture'
      : fragment.element === 'glass' ? 'glass'
      : source.startsWith('sill-') && source.includes('-f-') ? 'spandrel'
      : source.startsWith('rail-') ? 'rail'
      : fragment.element === 'slab' || fragment.element === 'roof' ? 'slab'
      : source.startsWith('gable') ? 'gable'
      : source.startsWith('parapet') || source.startsWith('stair') ? 'cast'
      : 'panel'
    const cached = this.materials.get(kind)
    if (cached) return cached
    const material = kind === 'glass' ? new THREE.MeshStandardMaterial({ color: '#191b16', roughness: 0.12, metalness: 0.6, envMapIntensity: 1.2 })
      : kind === 'fracture' ? meterSurface('cast', { color: '#c9c2b2', roughness: 1 })
      : kind === 'spandrel' ? meterSurface('paint', { color: '#9aa48c' })
      : kind === 'rail' ? meterSurface('rust', { color: '#6f5d4f' })
      : kind === 'slab' ? meterSurface('slab', { color: '#a7a293' })
      : kind === 'gable' ? meterSurface('panel', { color: '#aba693' })
      : kind === 'cast' ? meterSurface('cast', { color: '#9c978a' })
      : meterSurface('panel', { color: '#bcb6a4' })
    this.materials.set(kind, material)
    return material
  }

  private resize = () => {
    const width = this.host.clientWidth || innerWidth
    const height = this.host.clientHeight || innerHeight
    this.look.setSize(width, height)
    this.camera.aspect = width / height
    this.camera.fov = width < height ? Math.min(80, THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(22)) * height / width))) : 42
    this.camera.updateProjectionMatrix()
  }

  private pick(clientX: number, clientY: number) {
    const rect = this.renderer.domElement.getBoundingClientRect()
    this.pointer.set((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2)
    this.ray.setFromCamera(this.pointer, this.camera)
    const hit = this.view ? this.ray.intersectObject(this.view.group, true).find(item => item.object.name === 'cascade-fragments') : undefined
    if (hit) return hit.point
    const floor = this.ground ? this.ray.intersectObject(this.ground)[0] : undefined
    if (floor && Math.abs(floor.point.x) < BLOCK_LENGTH / 2 + 10 && Math.abs(floor.point.z) < BLOCK.depth / 2 + 10) return floor.point.setY(2)
    return null
  }

  hover(clientX: number, clientY: number) {
    if (this.state.phase !== 'ready' && this.state.phase !== 'impact') return
    const point = this.pick(clientX, clientY)
    this.reticle.visible = !!point
    if (point) this.placeReticle(point)
  }

  private placeReticle(point: THREE.Vector3) {
    this.reticle.position.copy(point)
    this.reticle.scale.setScalar(this.camera.position.distanceTo(point) * 0.07)
    this.beam.position.copy(point)
    this.beam.scale.set(1, 260, 1)
  }

  tap(clientX: number, clientY: number) {
    const point = this.pick(clientX, clientY)
    if (point) this.callStrike(point)
    return !!point
  }

  callStrike(point = new THREE.Vector3(-1, 4, BLOCK.depth / 2)) {
    if (!this.session || this.designation || this.fx.busy || this.state.phase === 'loading') return
    const target = point.clone()
    target.y = THREE.MathUtils.clamp(target.y, 2, BLOCK_HEIGHT - 3)
    this.designation = { point: target, age: 0 }
    this.placeReticle(target)
    this.reticle.visible = this.beam.visible = true
    this.set({ phase: 'designating', countdown: designateSeconds })
  }

  rebuild() {
    if (!this.session || this.state.phase === 'loading') return
    this.designation = null
    this.reticle.visible = this.beam.visible = false
    this.fx.clear()
    this.session.reset()
    this.set({ phase: 'ready', detached: 0 })
  }

  private release() {
    const designation = this.designation!
    const along = new THREE.Vector3(1, 0, 0)
    const half = BLOCK_LENGTH / 2 - 3
    const center = designation.point.clone()
    center.x = THREE.MathUtils.clamp(center.x, -half + STRIKE.spacing, half - STRIKE.spacing)
    const targets = [-1, 0, 1].map(offset => center.clone().addScaledVector(along, offset * STRIKE.spacing))
    this.fx.launch(targets, (hit, direction) => {
      const at = hit.clone().addScaledVector(direction, STRIKE.penetration)
      at.y = Math.max(1.2, at.y)
      this.session?.impact('explosion', [at.x, at.y, at.z], [direction.x, direction.y, direction.z], STRIKE.radius, STRIKE.strength, undefined, STRIKE.minRadius)
      this.fx.detonate(at, direction, this.camera)
      this.set({ phase: 'impact' })
    })
    this.set({ phase: 'inbound', countdown: STRIKE.altitude / Math.sin(STRIKE.dive) / STRIKE.speed })
  }

  private warm() {
    this.fx.warm(this.camera, this.rig.target.clone(), () => {
      this.reticle.visible = this.beam.visible = true
      this.reticle.position.copy(this.rig.target)
      this.look.render(0)
      this.reticle.visible = this.beam.visible = false
    })
  }

  private loop = () => {
    const dt = Math.min(0.05, this.clock.getDelta())
    if (this.designation) {
      this.designation.age += dt
      const pulse = 1 + Math.sin(this.designation.age * 18) * 0.08
      this.reticle.scale.setScalar(this.camera.position.distanceTo(this.designation.point) * 0.07 * pulse)
      ;(this.beam.material as THREE.MeshBasicMaterial).opacity = this.designation.age > designateSeconds * 0.6 ? (Math.sin(this.designation.age * 40) > 0 ? 0.85 : 0.25) : 0.45
      if (this.state.phase === 'designating') {
        const countdown = Math.max(0, designateSeconds - this.designation.age)
        if (countdown <= 0) this.release()
        else if (Math.abs(countdown - this.state.countdown) > 0.1) this.set({ countdown })
      } else if (this.state.phase === 'inbound') {
        const countdown = Math.max(0, this.state.countdown - dt)
        this.state.countdown = countdown
      }
      if (this.state.phase === 'impact') {
        this.designation = null
        this.reticle.visible = this.beam.visible = false
      }
    }
    this.fx.update(dt, this.camera)
    this.rig.update(dt, this.fx.shake)
    const session = this.session
    if (session?.frame && this.view) {
      this.view.update(session.frame, session.previous, session.interpolationAlpha())
      reportActiveBodies(session.frame.stats.activeBodies)
      if (this.view.shadowRevision !== this.lastShadow && performance.now() - this.shadowAt > 100) {
        this.lastShadow = this.view.shadowRevision
        this.shadowAt = performance.now()
        this.renderer.shadowMap.needsUpdate = true
      }
      const now = performance.now()
      if (now - this.hudAt > 400) {
        this.hudAt = now
        const states = session.frame.states
        let loose = 0
        const fragments = session.manifest.fragments
        for (const leaf of this.leaves) {
          let current: number | undefined = leaf
          while (current !== undefined && (states[current] === FragmentState.Hidden || states[current] === FragmentState.Retired)) current = this.indexOf.get(fragments[current]!.parent ?? -1)
          if (current === undefined) loose += fragments[leaf]!.mass
          else if (states[current] !== FragmentState.Supported && session.frame.transforms[current * 8 + 1]! < fragments[current]!.position[1] - 1.5) loose += fragments[leaf]!.mass
        }
        const detached = Math.round(loose / this.mass * 100)
        if (detached !== this.state.detached) this.set({ detached })
      }
    }
    if (this.state.phase === 'loading') this.renderer.shadowMap.needsUpdate = true
    this.look.render(dt)
  }

  dispose() {
    this.disposed = true
    removeEventListener('resize', this.resize)
    this.renderer.setAnimationLoop(null)
    this.view?.dispose()
    void this.session?.dispose()
    this.fx.clear()
    this.look.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
