import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { DestructionRenderer } from '@blacksite/cascade'
import { DestructionSession } from '@blacksite/cascade/session'
import { createShowcaseFrame } from '@blacksite/cascade/showcase-frame'
import { CascadeWalkClient, WALK_TOOLS } from '@blacksite/cascade/walk-client'
import { attachTouchWalkControls } from '@blacksite/input/touch-walk'
import { attachPerfProbe } from '@blacksite/ui/perf-overlay'
import './showcase.css'

const root = document.querySelector<HTMLDivElement>('#root')!
root.innerHTML = `<div class="scene-ui"><div class="scene-heading"><span>BLACKSITE / CASCADE</span><h1>Last Light</h1><p>Take down a concrete frame, one bond at a time.</p></div><div class="scene-top"><button id="dev">Dev</button></div><div class="scene-controls"><span id="hint">Drag to orbit · Scroll to zoom · Click frame to place a charge</span><div><button id="detonate">Detonate</button><button id="walk">Walk in</button><button id="reset">Reset</button></div></div><div class="scene-dev" id="devPanel" hidden><strong>CASCADE</strong><span id="status">Preparing simulation…</span><span id="detail"></span></div><div class="scene-loading" id="loading">Preparing the frame…</div><div class="scene-reticle" id="reticle" hidden>+</div><div class="scene-touch" id="touch" hidden><div id="touchLook"></div><div id="touchStick"><div id="touchKnob"></div></div><div class="scene-touch-buttons"><button data-touch="use">Use</button><button data-touch="cycle">Tool</button><button data-touch="jump">Jump</button><button data-touch="crouch">Crouch</button><button data-touch="sprint">Sprint</button><button data-touch="exit">Orbit</button></div></div></div>`
const $ = (id: string) => document.getElementById(id)!
const scene = new THREE.Scene()
scene.background = new THREE.Color('#c7a685')
scene.fog = new THREE.FogExp2('#c7a685', 0.004)
const camera = new THREE.PerspectiveCamera(44, innerWidth / innerHeight, 0.08, 500)
camera.position.set(43, 27, 48)
const gl = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
gl.setSize(innerWidth, innerHeight)
gl.setPixelRatio(Math.min(devicePixelRatio, 1.5))
gl.outputColorSpace = THREE.SRGBColorSpace
gl.toneMapping = THREE.ACESFilmicToneMapping
gl.toneMappingExposure = 1.4
gl.shadowMap.enabled = true
gl.shadowMap.type = THREE.PCFSoftShadowMap
root.prepend(gl.domElement)
attachPerfProbe(gl)
const orbit = new OrbitControls(camera, gl.domElement)
orbit.target.set(0, 8, 0)
orbit.enableDamping = true
orbit.maxPolarAngle = Math.PI * 0.48
orbit.minDistance = 18
orbit.maxDistance = 105
orbit.update()
scene.add(new THREE.HemisphereLight('#d6e7f0', '#594534', 2.2))
const sun = new THREE.DirectionalLight('#ffe2ac', 3.1)
sun.position.set(-24, 42, -18)
sun.castShadow = true
sun.shadow.mapSize.set(1536, 1536)
Object.assign(sun.shadow.camera, { left: -46, right: 46, top: 46, bottom: -46, near: 1, far: 110 })
sun.shadow.bias = -0.0002
sun.shadow.normalBias = 0.035
scene.add(sun)
const materials = {
  earth: new THREE.MeshStandardMaterial({ color: '#79695a', roughness: 1 }),
  slab: new THREE.MeshStandardMaterial({ color: '#aaa497', roughness: 0.94 }),
  steel: new THREE.MeshStandardMaterial({ color: '#414d4d', metalness: 0.55, roughness: 0.62 }),
  accent: new THREE.MeshStandardMaterial({ color: '#d5a247', roughness: 0.72 }),
  warning: new THREE.MeshStandardMaterial({ color: '#bd6441', roughness: 0.84 }),
  concrete: new THREE.MeshStandardMaterial({ color: '#c0b9a9', roughness: 0.96 }),
  fracture: new THREE.MeshStandardMaterial({ color: '#988b79', roughness: 1 }),
}
function box(size: [number, number, number], position: [number, number, number], material: THREE.Material, rotation = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material)
  mesh.position.set(...position)
  mesh.rotation.y = rotation
  mesh.receiveShadow = mesh.castShadow = true
  scene.add(mesh)
  return mesh
}
box([160, 0.3, 160], [0, -0.2, 0], materials.earth)
box([33, 0.14, 27], [0, -0.04, 0], materials.slab)
for (const x of [-31, 31]) for (let z = -26; z <= 30; z += 7) {
  box([0.15, 2.2, 0.15], [x, 1.1, z], materials.steel)
  box([0.1, 0.1, 6.5], [x, 1.55, z + 3.25], materials.steel)
}
for (let i = 0; i < 6; i++) {
  const x = i % 2 ? 22 : -22
  const z = Math.floor(i / 2) * 7 - 15
  box([2.5, 0.65, 1.6], [x, 0.4, z], materials.concrete, i % 2 ? 0.06 : -0.07)
}
for (let i = 0; i < 5; i++) box([0.16, 0.025, 8], [-20 + i * 3, 0.01, 24], i % 2 ? materials.warning : materials.accent, -0.3)
for (const z of [-16, -5, 6, 17]) {
  box([0.18, 5.4, 0.18], [-17, 2.7, z], materials.steel)
  box([0.15, 0.15, 6], [-17, 5.1, z + 3], materials.steel)
  box([0.15, 0.15, 6], [-17, 2.4, z + 3], materials.steel)
}
box([0.55, 19, 0.55], [29, 9.5, -23], materials.accent)
box([27, 0.42, 0.5], [17, 18.8, -23], materials.accent)
box([0.18, 14, 0.18], [3.5, 11.5, -23], materials.steel)
box([0.75, 1.5, 0.75], [3.5, 4.1, -23], materials.steel)
for (const x of [-25, 25]) for (const z of [-20, 20]) {
  box([0.18, 4.6, 0.18], [x, 2.3, z], materials.steel)
  box([0.75, 0.35, 0.75], [x, 4.65, z], materials.accent)
}
for (const x of [-20, 20]) for (const z of [-21, 21]) {
  box([0.13, 3.2, 0.13], [x, 1.6, z], materials.accent)
  box([0.8, 0.8, 0.06], [x, 2.1, z], materials.accent)
}
box([1.6, 0.16, 33], [24, 0.16, 1], materials.slab)
const manifest = createShowcaseFrame({ name: 'last-light', baysX: 3, baysZ: 2, storeys: 4 })
const view = new DestructionRenderer(manifest, { camera, materialFor: (_fragment, surface) => surface === 'exterior' ? materials.concrete : materials.fracture })
scene.add(view.group)
const session = new DestructionSession(manifest, { ready: () => { $('loading').hidden = true; $('status').textContent = 'Ready to demolish' } })
const walk = new CascadeWalkClient(gl.domElement, session, syncWalk)
const touch = $('touch')
attachTouchWalkControls(touch, { move: (forward, right) => walk.touchMove(forward, right), look: (dx, dy) => walk.touchLook(dx, dy), action: (action, pressed) => walk.touchAction(action, pressed) })
function syncWalk() {
  $('walk').textContent = walk.active ? 'Orbit view' : 'Walk in'
  $('reticle').hidden = !walk.active
  touch.hidden = !walk.active
  $('hint').textContent = walk.active ? `${WALK_TOOLS[walk.toolIndex]!.label} · WASD move · Shift sprint · C crouch · Space jump · 1–4 tools · click use · Tab orbit` : 'Drag to orbit · Scroll to zoom · Click frame to place a charge'
  orbit.enabled = !walk.active
}
$('walk').addEventListener('click', () => walk.setActive(!walk.active))
$('detonate').addEventListener('click', () => session.impact('detonate', [0, 0, 0], [0, 1, 0], 1, 1))
$('reset').addEventListener('click', () => session.reset())
$('dev').addEventListener('click', () => { $('devPanel').hidden = !$('devPanel').hidden })
const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
let down: [number, number] | null = null
const markerGeometry = new THREE.SphereGeometry(0.16, 10, 8)
const markers = new THREE.Group()
scene.add(markers)
gl.domElement.addEventListener('pointerdown', event => { down = [event.clientX, event.clientY] })
gl.domElement.addEventListener('pointerup', event => {
  if (walk.active || !down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5) return
  const rect = gl.domElement.getBoundingClientRect()
  pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1)
  raycaster.setFromCamera(pointer, camera)
  const hit = raycaster.intersectObject(view.group, true)[0]
  if (hit) session.impact('placeExplosive', hit.point.toArray() as [number, number, number], [0, 1, 0], 1.5, 2)
})
window.addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); gl.setSize(innerWidth, innerHeight) })
let lastRevision = -1
function animate() {
  requestAnimationFrame(animate)
  const frame = session.frame
  if (frame) {
    view.update(frame, session.previous, session.interpolationAlpha())
    if (frame.tick !== lastRevision) {
      lastRevision = frame.tick
      markers.clear()
      for (const item of frame.ordnance ?? []) if (item.type === 'explosive') {
        const mesh = new THREE.Mesh(markerGeometry, materials.accent)
        mesh.position.fromArray(item.position)
        markers.add(mesh)
      }
      const runtime = session.getSnapshot()
      $('status').textContent = `${runtime.simulationHz || '—'} Hz physics · ${runtime.snapshotHz || '—'} Hz snapshots`
      $('detail').textContent = `${frame.stats.activeBodies} moving bodies · ${frame.ordnance?.length ?? 0} charges`
    }
    if (walk.active && frame.player) {
      camera.position.fromArray(frame.player.eye)
      camera.rotation.set(walk.pitch, walk.yaw, 0, 'YXZ')
    }
  }
  if (!walk.active) orbit.update()
  gl.render(scene, camera)
  ;(window as Window & { __blacksiteBodies?: (count: number) => void }).__blacksiteBodies?.(frame?.stats.activeBodies ?? 0)
}
animate()
