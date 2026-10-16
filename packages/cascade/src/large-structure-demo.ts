/**
 * Large concrete frame play-test: charges, demolition sequence and airstrikes on the large scale
 * frame. Physics runs in the destruction Worker at 60 Hz (`?hz=30` to compare); the main thread
 * only renders, interpolating between the last two snapshots, so frame rate is the renderer's.
 */
import * as THREE from 'three';
import { RenderProfile } from './render-profile';
import { CascadeWalkClient, WALK_TOOLS } from './walk-client';
import { attachTouchWalkControls } from '@blacksite/input/touch-walk';
const renderProfile = new RenderProfile();
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createDestructibleBoxes } from '../../destruction-authoring/src/boxes';
import { DestructionRenderer } from '../../destruction-render/src/renderer';
import { FragmentState, MAX_EXPLOSIVES, FIXED_DT, FIXED_DT_30HZ } from '../../destruction-domain/src/index';
import type { BondDef, DestructibleManifest, DestructionCommand, PlayerInput, PlayerTool, ReplayLog, SecondaryFragmentDef, SimulationFrame, Vec3, WorkerRequest, WorkerResponse } from '../../destruction-domain/src/index';
import { SCALE_FRAMES, scaleFrameBoxes } from '../../destruction-testkit/src/scale-frame';
const scene = new THREE.Scene();
scene.background = new THREE.Color("#171e23");
scene.fog = new THREE.Fog("#171e23", 105, 260);
const camera = new THREE.PerspectiveCamera(43, innerWidth / innerHeight, 0.1, 500);
camera.position.set(57, 38, 62);
scene.add(camera);
const toolMaterial = new THREE.MeshBasicMaterial({ color: '#8d9694', depthTest: false });
const gripMaterial = new THREE.MeshBasicMaterial({ color: '#303b3c', depthTest: false });
const accentMaterial = new THREE.MeshBasicMaterial({ color: '#dda665', depthTest: false });
const toolGeometries: THREE.BufferGeometry[] = [];
const toolModels = WALK_TOOLS.map((tool) => {
  const group = new THREE.Group();
  group.position.set(0.72, -0.18, -0.95);
  const part = (geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0) => {
    toolGeometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.renderOrder = 100;
    group.add(mesh);
    return mesh;
  };
  if (tool.id === 'explosive') {
    part(new THREE.BoxGeometry(0.17, 0.25, 0.11), gripMaterial);
    part(new THREE.BoxGeometry(0.19, 0.045, 0.12), accentMaterial, 0, 0.05);
    part(new THREE.BoxGeometry(0.08, 0.045, 0.02), toolMaterial, 0, 0.135, 0.055);
  } else if (tool.id === 'cannonball') {
    part(new THREE.SphereGeometry(0.17, 16, 12), toolMaterial);
    part(new THREE.BoxGeometry(0.09, 0.18, 0.11), gripMaterial, 0, -0.2);
  } else if (tool.id === 'hammer') {
    part(new THREE.CylinderGeometry(0.027, 0.032, 0.56, 8), gripMaterial);
    part(new THREE.BoxGeometry(0.32, 0.11, 0.13), toolMaterial, 0, 0.25);
  } else {
    part(new THREE.BoxGeometry(0.22, 0.14, 0.13), gripMaterial);
    part(new THREE.BoxGeometry(0.26, 0.025, 0.05), toolMaterial, 0, 0.12, -0.02);
    part(new THREE.BoxGeometry(0.05, 0.04, 0.135), accentMaterial, 0, 0.05);
  }
  group.visible = false;
  camera.add(group);
  return group;
});
const gl = new THREE.WebGLRenderer({ antialias: true });
(window as Window & { __blacksitePerf?: (renderer: THREE.WebGLRenderer) => void }).__blacksitePerf?.(gl);
gl.setSize(innerWidth, innerHeight);
gl.setPixelRatio(Math.min(devicePixelRatio, 1.5));
gl.shadowMap.enabled = true;
gl.shadowMap.type = THREE.PCFShadowMap;
gl.shadowMap.autoUpdate = false;
gl.shadowMap.needsUpdate = true;
gl.toneMapping = THREE.ACESFilmicToneMapping;
gl.toneMappingExposure = 1.25;
document.body.prepend(gl.domElement);
const controls = new OrbitControls(camera, gl.domElement);
controls.target.set(0, 11, 0);
controls.enableDamping = true;
controls.minDistance = 3;
controls.maxDistance = 180;
controls.maxPolarAngle = Math.PI / 2 - 0.01;
controls.update();
scene.add(new THREE.HemisphereLight("#c8dcf0", "#4b4540", 2.5));
const sun = new THREE.DirectionalLight("#fff0d5", 4.2);
sun.position.set(-36, 58, 27);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.autoUpdate = false;
sun.shadow.needsUpdate = true;
Object.assign(sun.shadow.camera, { left: -53, right: 53, top: 53, bottom: -53, near: 1, far: 155 });
sun.shadow.bias = -25e-5;
sun.shadow.normalBias = 0.1;
scene.add(sun, sun.target);
function fitSunShadow(manifest: DestructibleManifest) {
  const bounds = new THREE.Box3(), point = new THREE.Vector3(), size = new THREE.Vector3();
  for (const fragment of manifest.fragments) {
    size.fromArray(fragment.size);
    point.fromArray(fragment.position).addScaledVector(size, -0.5);
    bounds.expandByPoint(point);
    point.fromArray(fragment.position).addScaledVector(size, 0.5);
    bounds.expandByPoint(point);
  }
  // Cover the authored frame plus the surrounding rubble/airstrike landing area.
  bounds.min.x -= 12; bounds.max.x += 12;
  bounds.min.z -= 12; bounds.max.z += 12;
  bounds.min.y = -1; bounds.max.y += 8;
  const shadowCamera = sun.shadow.camera;
  shadowCamera.position.copy(sun.position);
  shadowCamera.lookAt(sun.target.position);
  shadowCamera.updateMatrixWorld(true);
  const lightBounds = new THREE.Box3();
  for (let corner = 0; corner < 8; corner++) {
    point.set(corner & 1 ? bounds.max.x : bounds.min.x, corner & 2 ? bounds.max.y : bounds.min.y, corner & 4 ? bounds.max.z : bounds.min.z);
    lightBounds.expandByPoint(point.applyMatrix4(shadowCamera.matrixWorldInverse));
  }
  shadowCamera.left = lightBounds.min.x - 2; shadowCamera.right = lightBounds.max.x + 2;
  shadowCamera.bottom = lightBounds.min.y - 2; shadowCamera.top = lightBounds.max.y + 2;
  shadowCamera.near = Math.max(0.1, -lightBounds.max.z - 4);
  shadowCamera.far = Math.max(shadowCamera.near + 1, -lightBounds.min.z + 4);
  shadowCamera.updateProjectionMatrix();
  sun.shadow.needsUpdate = gl.shadowMap.needsUpdate = true;
}
let shadowView: DestructionRenderer | undefined, lastShadowRevision = -1;
const shadowLightPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
const shadowTargetPosition = new THREE.Vector3(Infinity, Infinity, Infinity);
function updateShadows() {
  const revision = view?.shadowRevision ?? -1;
  if (view !== shadowView || revision !== lastShadowRevision ||
    !sun.position.equals(shadowLightPosition) || !sun.target.position.equals(shadowTargetPosition)) {
    sun.shadow.needsUpdate = gl.shadowMap.needsUpdate = true;
    shadowView = view;
    lastShadowRevision = revision;
    shadowLightPosition.copy(sun.position);
    shadowTargetPosition.copy(sun.target.position);
  }
}
const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: "#54595a", roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.015;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(160, 32, "#7a8482", "#636c6a");
grid.position.y = -9e-3;
scene.add(grid);
const exterior = new THREE.MeshStandardMaterial({ color: "#aaa99f", roughness: 0.94 });
const interior = new THREE.MeshStandardMaterial({ color: "#bcb8aa", roughness: 1 });
const markerGeometry = new THREE.SphereGeometry(0.16, 8, 6);
const markerMaterial = new THREE.MeshStandardMaterial({ color: "#e8773d", emissive: "#922c07", emissiveIntensity: 0.7 });
const markers = new THREE.Group();
scene.add(markers);
const $ = (id: string) => document.getElementById(id)!;
const button = (id: string) => $(id) as HTMLButtonElement;
const loading = $("loading");
// Physics runs in a Worker at PHYSICS_HZ (default 60; ?hz=30 or the Physics button, which resets the scene) and posts snapshots.
// The main thread only renders, interpolating between the last two snapshots, so the frame rate
// is the renderer's, not the step cost's.
let PHYSICS_HZ: 30 | 60 = new URLSearchParams(location.search).get('hz') === '30' ? 30 : 60;
class PhysicsClient {
  frame: SimulationFrame | undefined;
  previous: SimulationFrame | undefined;
  frameAt = 0;
  snapshotPeriod = 1000 / 30;
  simulationHz = 0;
  snapshotHz = 0;
  onFrame: ((frame: SimulationFrame) => void) | undefined;
  onError: ((message: string) => void) | undefined;
  onAction: ((accepted: boolean, message?: string) => void) | undefined;
  private worker: Worker;
  private readonly pieces = new Map<number, SecondaryFragmentDef>();
  private readonly livePieceIds = new Set<number>();
  private pieceDefinitions: SecondaryFragmentDef[] | undefined;
  private bonds: BondDef[] | undefined;
  private exports = new Map<number, (log: ReplayLog) => void>();
  private requestId = 1;
  private rate = { at: 0, frames: 0, tick: 0 };
  private constructor(readonly manifest: DestructibleManifest, worker: Worker) { this.worker = worker; }
  static create(manifest: DestructibleManifest, hz: number): Promise<PhysicsClient> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('../../destruction-physics/src/destruction.worker.ts', import.meta.url), { type: 'module' });
      const client = new PhysicsClient(manifest, worker);
      let settled = false;
      worker.onerror = event => {
        // A module worker whose script (or an import) fails to fetch fires a plain Event with no message.
        const detail = event.message ?? `script or import failed to load (${event.filename || 'no file'}:${event.lineno || 0}); if the dev server just re-optimized dependencies, reload the page`;
        if (!settled) { settled = true; reject(new Error(`physics worker failed to load: ${detail}`)); } else client.onError?.(`worker error: ${detail}`);
      };
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        if (message.type === 'error') {
          if (!settled) { settled = true; reject(new Error(message.message)); }
          else client.onError?.(message.message);
          return;
        }
        if (message.type === 'replayExport') { const done = client.exports.get(message.requestId); client.exports.delete(message.requestId); done?.(message.log); return; }
        if (message.type === 'commandAccepted') { client.onAction?.(true); return; }
        if (message.type === 'actionResult') { client.onAction?.(false, message.message); return; }
        if (message.type !== 'frame') return;
        const messageStart = performance.now();
        // Each received snapshot contributes once, independent of render FPS.
        for (const name of ['workerMs', 'workerStepMs', 'physicsMs', 'nativeStepMs', 'structuralMs', 'structuralDirectMs', 'snapshotMs'] as const) {
          const value = message.stats[name];
          if (value !== undefined) renderProfile.record(`worker.${name}`, value);
        }
        client.accept(message);
        if (!settled) { settled = true; resolve(client); }
        else client.onFrame?.(message);
        renderProfile.record('workerMessageMs', performance.now() - messageStart);
      };
      client.post({ type: 'init', manifest, timestep: hz === 60 ? FIXED_DT : FIXED_DT_30HZ });
    });
  }
  private post(message: WorkerRequest) { this.worker.postMessage(message); }
  private accept(message: SimulationFrame) {
    const arrivedAt = performance.now();
    const rewound = !!this.frame && message.tick < this.frame.tick;
    if (rewound) {
      this.pieces.clear();
      this.pieceDefinitions = undefined;
    }
    if (this.frame && message.tick > this.frame.tick) {
      const observed = Math.max(16, Math.min(100, arrivedAt - this.frameAt));
      this.snapshotPeriod = this.snapshotPeriod * .7 + observed * .3;
    }
    if (message.bonds) this.bonds = message.bonds;
    else if (this.frame && message.tick < this.frame.tick) this.bonds = undefined;
    message.bonds = this.bonds;
    const secondary = message.secondary;
    if (secondary?.ids) {
      const ids = secondary.ids;
      const definitions = secondary.fragments;
      let unchanged = definitions.length === 0 && this.pieceDefinitions?.length === ids.length;
      if (unchanged) {
        for (let i = 0; i < ids.length; i++) {
          if (this.pieceDefinitions![i]!.id !== ids[i]) { unchanged = false; break; }
        }
      }
      if (!unchanged) {
        // Definitions are immutable. Reconstruct only when membership changes, keeping
        // the previous snapshot's ordered array intact for interpolation.
        for (const piece of definitions) this.pieces.set(piece.id, piece);
        const ordered = new Array<SecondaryFragmentDef>(ids.length);
        this.livePieceIds.clear();
        for (let i = 0; i < ids.length; i++) {
          const id = ids[i]!;
          ordered[i] = this.pieces.get(id)!;
          this.livePieceIds.add(id);
        }
        for (const id of this.pieces.keys()) if (!this.livePieceIds.has(id)) this.pieces.delete(id);
        this.pieceDefinitions = ordered;
      }
      secondary.fragments = this.pieceDefinitions!;
      secondary.ids = undefined;
      // transforms/states already arrive as transferred typed arrays from the frozen worker.
    } else {
      this.pieces.clear();
      this.livePieceIds.clear();
      this.pieceDefinitions = undefined;
    }
    this.previous = rewound ? undefined : this.frame;
    renderProfile.record('snapshotIntervalMs', this.frameAt ? arrivedAt - this.frameAt : 0);
    this.frame = message;
    this.frameAt = arrivedAt;
    const r = this.rate;
    if (!r.at || message.tick < r.tick) this.rate = { at: arrivedAt, frames: 0, tick: message.tick };
    else {
      r.frames++;
      const elapsed = arrivedAt - r.at;
      if (elapsed >= 750) {
        this.simulationHz = Math.round((message.tick - r.tick) * 1000 / elapsed);
        this.snapshotHz = Math.round(r.frames * 1000 / elapsed);
        this.rate = { at: arrivedAt, frames: 0, tick: message.tick };
      }
    }
  }
  alpha(): number {
    if (!this.frame || !this.previous || this.frame.paused) return 1;
    return Math.max(0, Math.min(1, (performance.now() - this.frameAt) / this.snapshotPeriod));
  }
  enqueue(command: DestructionCommand) { renderProfile.event(performance.now(), 'command', { command }); this.post({ type: 'command', command }); }
  setPaused(paused: boolean) { this.post({ type: 'pause', paused }); }
  setPlayerEnabled(enabled: boolean) { this.post({ type: 'player', enabled }); }
  playerInput(input: PlayerInput) { this.post({ type: 'playerInput', input }); }
  playerAction(action: PlayerTool, direction: Vec3, radius: number, strength: number) {
    this.post({ type: 'playerAction', action, direction, radius: action === 'cannonball' ? 0.32 : radius, strength, id: commandId++ });
  }
  respawnPlayer() { this.post({ type: 'playerRespawn' }); }
  exportReplay(): Promise<ReplayLog> {
    const requestId = this.requestId++;
    return new Promise(resolve => { this.exports.set(requestId, resolve); this.post({ type: 'exportReplay', requestId }); });
  }
  dispose() { this.worker.onmessage = null; try { this.post({ type: 'dispose' }); } catch {} this.worker.terminate(); }
}
let sim: PhysicsClient | undefined;
let view: DestructionRenderer | undefined;
let frame: SimulationFrame | undefined;
let paused = false;
let ready = false;
const walk = new CascadeWalkClient(gl.domElement, {
  setPlayerEnabled: enabled => sim?.setPlayerEnabled(enabled),
  playerInput: input => { if (ready && !paused) sim?.playerInput(input); },
  playerAction: (tool, direction, radius, strength) => { if (ready && !paused) sim?.playerAction(tool, direction, radius, strength); },
  respawnPlayer: () => sim?.respawnPlayer(),
}, () => {
  if (walk.active) {
    setMissileMode(false);
    reticle.visible = beam.visible = false;
  }
  controls.enabled = !walk.active;
  camera.fov = walk.active ? 74 : 43;
  camera.updateProjectionMatrix();
  button('walk').textContent = walk.active ? 'Orbit view (Tab)' : 'Walk mode (Tab)';
  document.body.classList.toggle('walk-active', walk.active);
  button('walk').textContent = walk.active ? 'Exit walk' : 'Walk mode';
  $('walkHud').hidden = !walk.active;
  $('walkTool').textContent = `${walk.toolIndex + 1} / ${walk.tool.label}`;
  const coarse = matchMedia('(pointer: coarse)').matches;
  $('hint').textContent = walk.active
    ? coarse ? 'Left stick move · Right drag look · Use tool · Next tool · Jump · Crouch · Sprint · Exit walk' : 'WASD move · Shift sprint · C crouch · Space jump · 1–4 or wheel tools · Click use · R respawn · Tab orbit · Right drag to look if mouse lock fails'
    : coarse ? 'One finger orbit · Pinch zoom · Tap concrete to place a charge · Walk mode for touch controls' : 'Drag to orbit · Scroll to zoom · Click concrete to place a charge · M toggles airstrike mode · Tab to walk';
  $('touchHint').textContent = coarse ? $('hint').textContent : '';
});
if (innerWidth <= 900 || innerHeight <= 500) (document.getElementById('hudDetails') as HTMLDetailsElement).open = false;
const detachTouch = attachTouchWalkControls($('touchWalk'), {
  move: (forward, right) => walk.touchMove(forward, right),
  look: (dx, dy) => walk.touchLook(dx, dy),
  action: (action, pressed) => {
    walk.touchAction(action, pressed);
    if (action === 'sprint' && pressed) document.querySelector('[data-touch="sprint"]')?.classList.toggle('on');
  },
});
if (matchMedia('(pointer: coarse)').matches) {
  $('hint').textContent = 'One finger orbit · Pinch zoom · Tap concrete to place a charge · Walk mode for touch controls';
  $('touchHint').textContent = $('hint').textContent;
}
button('walk').onclick = () => walk.setActive(!walk.active);
let cameraKick = 0;
let commandId = 1;
let wave = 0;
let sequence = false;
let placeNext = true;
let mass = 1;
let lastHud = 0;
const charges: Vec3[] = [];
for (let ix = 0; ix <= 6; ix++) {
  for (let iz = 0; iz <= 3; iz++) {
    charges.push([-18 + ix * 6, 1, -9 + iz * 6]);
  }
}
for (let t = 0.75; t < 6; t += 1.5) {
  for (const p of [[-18 + t, -9], [-18 + t, -3], [-18, -9 + t], [-12, -9 + t]]) {
    charges.push([p[0], 1, p[1]]);
  }
}
charges.reverse();
function enqueue(type: DestructionCommand['type'], position: Vec3 = [0, 0, 0], fragmentId?: number) {
  if (!sim || !frame) return;
  sim.enqueue({ type, id: commandId++, tick: frame.tick + 1, source: 1, position, direction: [0, 0, 1], radius: CHARGE.radius, strength: CHARGE.strength, ...fragmentId === void 0 ? {} : { fragmentId } });
}
const ray = new THREE.Raycaster();
// Airstrike yield. The default is the engine's maximum charge (9 m radius); `?strike=5` scales the
// blast radius and the full-strength core together, so a smaller strike makes a hole rather than
// taking out the middle third of the plan.
const STRIKE_RADIUS = Math.min(9, Math.max(2, Number(new URLSearchParams(location.search).get('strike')) || 9));
const MISSILE = { speed: 900, range: 420, diveMin: 32, diveMax: 68, altitude: 420, radius: STRIKE_RADIUS, minRadius: STRIKE_RADIUS * 4 / 9, strength: 10 };
// Placed charges: the knee benchmark's 1.5 m / strength 2 by default.
const CHARGE = { radius: 1.5, strength: 2 };
// Sliders in the tools bar. Each drives one of the constants above and shows its value.
function slider(id: string, format: (v: number) => string, apply: (v: number) => void, initial?: number) {
  const input = $(id) as HTMLInputElement, label = $(id + 'Value');
  if (initial !== undefined) input.value = String(initial);
  const sync = () => { const v = Number(input.value); apply(v); label.textContent = format(v); };
  input.addEventListener('input', sync); sync();
}
slider('strike', v => `${v.toFixed(1)} m`, v => { MISSILE.radius = v; MISSILE.minRadius = v * 4 / 9; }, STRIKE_RADIUS);
slider('chargeRadius', v => `${v.toFixed(1)} m`, v => { CHARGE.radius = v; });
slider('chargeStrength', v => `${v.toFixed(1)}`, v => { CHARGE.strength = v; });
let missileMode = false;
interface Strike { line: THREE.Line; from: THREE.Vector3; to: THREE.Vector3; burst: THREE.Vector3; t: number; length: number; positions: Float32Array; }
const missiles: Strike[] = [];
const flashes: Array<{ mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>; ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>; light: THREE.PointLight; age: number }> = [];
let shake = 0;
const streakMaterial = new THREE.LineBasicMaterial({ color: "#fff1c8", transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, linewidth: 2 });
const flashGeometry = new THREE.SphereGeometry(1, 16, 12);
const flashMaterial = new THREE.MeshBasicMaterial({ color: "#ffd28a", transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
const ringGeometry = new THREE.RingGeometry(0.86, 1, 48);
const ringMaterial = new THREE.MeshBasicMaterial({ color: "#ffc27a", transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
function setMissileMode(on: boolean) {
  missileMode = on;
  if (!on) {
    reticle.visible = beam.visible = false;
    if (designation && !designation.fired) {
      designation = void 0;
      designatorLabel.style.display = "none";
    }
    reticleMaterial.uniforms.uLock.value = 0;
  }
  button("missile").textContent = on ? "Airstrike: ON (click target)" : "Airstrike: off";
  button("missile").classList.toggle("primary", on);
  $("hint").textContent = on ? "Airstrike mode · Click the building to call it in · M to switch back to charges" : "Drag to orbit · Scroll to zoom · Click concrete to place a charge · M toggles airstrike mode";
}
interface Approach { from: THREE.Vector3; clear: boolean; firstHit?: THREE.Vector3 }
function approachCandidates(target: THREE.Vector3): Approach[] {
  const list = [];
  const bearings = 16, dives = 4;
  const offset = Math.random() * Math.PI * 2;
  for (let d = 0; d < dives; d++) {
    const dive = THREE.MathUtils.degToRad(MISSILE.diveMin + (d + 0.5) / dives * (MISSILE.diveMax - MISSILE.diveMin));
    const horizontal = MISSILE.altitude / Math.tan(dive);
    for (let b = 0; b < bearings; b++) {
      const bearing = offset + b / bearings * Math.PI * 2;
      list.push({ from: new THREE.Vector3(target.x + Math.cos(bearing) * horizontal, target.y + MISSILE.altitude, target.z + Math.sin(bearing) * horizontal), clear: false });
    }
  }
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
const approachRay = new THREE.Raycaster();
function testApproach(candidate: Approach, target: THREE.Vector3): boolean {
  if (!view) return true;
  const dir = new THREE.Vector3().subVectors(target, candidate.from);
  const length = dir.length();
  dir.normalize();
  approachRay.set(candidate.from, dir);
  approachRay.near = 0;
  approachRay.far = length - 0.35;
  const hit = approachRay.intersectObject(view.group, true)[0];
  if (hit) {
    candidate.firstHit = hit.point.clone();
    candidate.clear = false;
  } else candidate.clear = true;
  return candidate.clear;
}
function launchMissile(target: THREE.Vector3, approach: Approach) {
  const stop = approach.clear || !approach.firstHit ? target.clone() : approach.firstHit.clone();
  if (stop.y < 0) stop.y = 0;
  const positions = new Float32Array(2 * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const line = new THREE.Line(geometry, streakMaterial);
  line.frustumCulled = false;
  scene.add(line);
  missiles.push({ line, from: approach.from.clone(), to: stop, burst: target.clone(), t: 0, length: approach.from.distanceTo(stop), positions });
}
function detonateMissile(m: Strike) {
  if (sim && frame) {
    const d = new THREE.Vector3().subVectors(m.to, m.from).normalize();
    sim.enqueue({
      type: "explosion",
      id: commandId++,
      tick: frame.tick + 1,
      source: 1,
      position: m.burst.toArray(),
      direction: d.toArray(),
      radius: MISSILE.radius,
      strength: MISSILE.strength,
      minRadius: MISSILE.minRadius
    });
  }
  const mesh = new THREE.Mesh(flashGeometry, flashMaterial.clone());
  mesh.position.copy(m.burst);
  scene.add(mesh);
  const ring = new THREE.Mesh(ringGeometry, ringMaterial.clone());
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(m.burst.x, 0.05, m.burst.z);
  scene.add(ring);
  const light = new THREE.PointLight("#ffb866", 6e3, 90, 1.6);
  light.position.copy(m.burst).add(new THREE.Vector3(0, 2, 0));
  scene.add(light);
  flashes.push({ mesh, ring, light, age: 0 });
  shake = Math.min(1.5, shake + 60 / Math.max(20, camera.position.distanceTo(m.burst)));
  scene.remove(m.line);
  m.line.geometry.dispose();
}
function updateMissiles(dt: number) {
  for (let i = missiles.length - 1; i >= 0; i--) {
    const m = missiles[i];
    m.t = Math.min(1, m.t + MISSILE.speed * dt / m.length);
    const head = new THREE.Vector3().lerpVectors(m.from, m.to, m.t);
    const tail = new THREE.Vector3().lerpVectors(m.from, m.to, Math.max(0, m.t - 70 / m.length));
    m.positions.set([tail.x, tail.y, tail.z, head.x, head.y, head.z]);
    m.line.geometry.attributes.position.needsUpdate = true;
    if (m.t >= 1) {
      detonateMissile(m);
      missiles.splice(i, 1);
    }
  }
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    f.age += dt;
    const k = f.age / 0.6;
    f.mesh.scale.setScalar(1 + k * 16);
    f.mesh.material.opacity = Math.max(0, 0.9 * (1 - k));
    f.ring.scale.setScalar(1 + k * 40);
    f.ring.material.opacity = Math.max(0, 0.7 * (1 - k));
    f.light.intensity = Math.max(0, 6e3 * (1 - k));
    if (k >= 1) {
      scene.remove(f.mesh);
      scene.remove(f.ring);
      scene.remove(f.light);
      f.mesh.material.dispose();
      f.ring.material.dispose();
      flashes.splice(i, 1);
    }
  }
  if (shake > 0) {
    const a = shake * 0.35;
    camera.position.x += (Math.random() - 0.5) * a;
    camera.position.y += (Math.random() - 0.5) * a;
    camera.position.z += (Math.random() - 0.5) * a;
    shake = Math.max(0, shake - dt * 2.5);
  }
}
const reticleMaterial = new THREE.ShaderMaterial({
  transparent: true,
  depthTest: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color("#ff2a1a") }, uLock: { value: 0 }, uConfirm: { value: -1 }, uRelease: { value: -1 }, uFlight: { value: 0.5 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform float uTime; uniform vec3 uColor; uniform float uLock; uniform float uConfirm; uniform float uRelease; uniform float uFlight; varying vec2 vUv;
    float ring(float r, float radius, float width){ return smoothstep(width, 0.0, abs(r - radius)); }
    void main(){
      float r = length(vUv);
      float a = atan(vUv.y, vUv.x);
      float lock = clamp(uLock, 0.0, 1.0);
      float pulse = 0.5 + 0.5 * sin(uTime * (6.0 + 18.0 * lock));
      // Outer ring breathes while searching, then snaps inward as the lock completes.
      float outerR = mix(0.78 - 0.06 * pulse, 0.42, lock);
      float outer = ring(r, outerR, 0.012 + 0.01 * lock);
      float inner = ring(r, mix(0.30, 0.18, lock), 0.010);
      // Tick marks spin faster as the lock builds.
      float spin = a + uTime * (1.2 + 9.0 * lock);
      float ticks = step(0.92, abs(cos(spin * 2.0))) * smoothstep(0.02, 0.0, abs(r - outerR) - 0.05) * step(outerR - 0.2, r);
      float cross = (smoothstep(0.012, 0.0, abs(vUv.x)) + smoothstep(0.012, 0.0, abs(vUv.y))) * step(0.08, r) * step(r, mix(0.62, 0.36, lock));
      float sweep = smoothstep(0.0, 1.0, 1.0 - fract((a - uTime * 1.5) / 6.2831853)) * 0.08 * step(r, 0.76) * step(0.32, r) * (1.0 - lock);
      // Countdown: a strobing full ring at the edge once locked.
      float strobe = step(0.5, fract(uTime * (3.0 + 6.0 * lock))) * ring(r, 0.92, 0.02) * lock;
      float dot = smoothstep(0.05 + 0.03 * lock, 0.0, r);
      // Confirmation: one bright ring expands outward from the centre at the moment of lock.
      float since = uTime - uConfirm;
      float confirm = (uConfirm >= 0.0 && since < 0.5) ? ring(r, since * 2.0, 0.05) * (1.0 - since * 2.0) * 2.0 : 0.0;
      // Release pulse: two rings expand out of the reticle over the strike's flight time, so the
      // pulse reaches the edge as the trace hits.
      float flight = uTime - uRelease;
      float k = (uRelease >= 0.0 && flight < uFlight) ? flight / uFlight : -1.0;
      float release = k >= 0.0 ? (ring(r, k * 1.35, 0.06) * 2.5 + ring(r, max(0.0, k - 0.18) * 1.35, 0.03) * 1.5) * (1.0 - k * 0.6) : 0.0;
      float alpha = outer + inner + ticks + cross + sweep + dot + strobe + confirm + release;
      vec3 color = mix(uColor, vec3(1.0, 0.95, 0.8), lock * 0.6);
      gl_FragColor = vec4(color * (1.2 + 0.4 * pulse + 0.8 * lock), clamp(alpha, 0.0, 1.0));
    }`
});
const reticle = new THREE.Mesh(new THREE.PlaneGeometry(6, 6), reticleMaterial);
reticle.renderOrder = 2;
reticle.visible = false;
scene.add(reticle);
const beamMaterial = new THREE.LineBasicMaterial({ color: "#ff3a2a", transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false });
const beamGeometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, MISSILE.altitude, 0)]);
const beam = new THREE.Line(beamGeometry, beamMaterial);
beam.visible = false;
beam.frustumCulled = false;
scene.add(beam);
const reticleNormal = new THREE.Vector3(), reticleUp = new THREE.Vector3(0, 1, 0);
const LOCK_SECONDS = 0.9, HOLD_SECONDS = 0.9;
interface Designation { point: THREE.Vector3; age: number; fired: boolean; confirmed: boolean; candidates: Approach[]; cursor: number; chosen?: Approach }
let designation: Designation | undefined;
const designatorLabel = $("designator");
const labelPosition = new THREE.Vector3();
function showLabel(_text: string, _confirmed: boolean) {
  designatorLabel.style.display = "none";
}
function placeLabel(_point: THREE.Vector3) {
  void labelPosition;
}
function designate(point: THREE.Vector3) {
  if (designation) return;
  designation = { point: point.clone(), age: 0, fired: false, confirmed: false, candidates: approachCandidates(point), cursor: 0 };
  showLabel("DESIGNATING", false);
  $("hint").textContent = "Designating target…";
}
function updateDesignation(dt: number) {
  if (!designation) return;
  designation.age += dt;
  const lock = Math.min(1, designation.age / LOCK_SECONDS);
  reticleMaterial.uniforms.uLock.value = lock;
  placeLabel(designation.point);
  if (!designation.confirmed && lock >= 1) {
    designation.confirmed = true;
    reticleMaterial.uniforms.uConfirm.value = performance.now() / 1e3;
    showLabel("TARGET CONFIRMED", true);
  }
  if (designation.fired) {
    const eta = missiles[0] ? Math.max(0, (1 - missiles[0].t) * missiles[0].length / MISSILE.speed) : 0;
    showLabel(`STRIKE INBOUND ${eta.toFixed(1)}s`, true);
  } else if (designation.confirmed) {
    const remaining = Math.max(0, LOCK_SECONDS + HOLD_SECONDS - designation.age);
    showLabel(Math.floor(designation.age * 6) % 2 === 0 ? "TARGET CONFIRMED" : `RELEASE IN ${remaining.toFixed(1)}s`, true);
  }
  beam.visible = true;
  beam.position.copy(designation.point);
  beamMaterial.opacity = lock < 1 ? 0.35 : Math.sin(designation.age * 40) > 0 ? 0.8 : 0.25;
  for (let n = 0; n < 6 && !designation.chosen && designation.cursor < designation.candidates.length; n++) {
    const candidate = designation.candidates[designation.cursor++];
    if (testApproach(candidate, designation.point)) designation.chosen = candidate;
  }
  if (!designation.fired && designation.age >= LOCK_SECONDS + HOLD_SECONDS) {
    designation.fired = true;
    const d = designation;
    const approach = d.chosen ?? d.candidates.slice(0, d.cursor).reduce((best: Approach, c: Approach) => (c.firstHit?.distanceTo(d.point) ?? Infinity) < (best.firstHit?.distanceTo(d.point) ?? Infinity) ? c : best, d.candidates[0]!);
    launchMissile(designation.point, approach);
    const strike = missiles[missiles.length - 1];
    reticleMaterial.uniforms.uRelease.value = performance.now() / 1e3;
    reticleMaterial.uniforms.uFlight.value = strike.length / MISSILE.speed;
    $("hint").textContent = "Strike inbound";
  }
  if (designation.fired && missiles.length === 0) {
    designation = void 0;
    reticleMaterial.uniforms.uLock.value = 0;
    reticleMaterial.uniforms.uRelease.value = -1;
    beamMaterial.opacity = 0.35;
    designatorLabel.style.display = "none";
    if (missileMode) $("hint").textContent = "Airstrike mode · Click the building to call it in · M to switch back to charges";
  }
}
function aimReticle(clientX: number, clientY: number) {
  if (designation) return;
  if (!missileMode || !ready || !view) {
    reticle.visible = beam.visible = false;
    return;
  }
  ray.setFromCamera(new THREE.Vector2(clientX / innerWidth * 2 - 1, 1 - clientY / innerHeight * 2), camera);
  const hit = ray.intersectObject(view.group, true)[0] ?? ray.intersectObject(ground)[0];
  if (!hit) {
    reticle.visible = beam.visible = false;
    return;
  }
  reticleNormal.copy(hit.face?.normal ?? reticleUp).transformDirection(hit.object.matrixWorld);
  if (hit.object === ground) reticleNormal.copy(reticleUp);
  reticle.position.copy(hit.point).addScaledVector(reticleNormal, 0.08);
  reticle.lookAt(reticle.position.clone().add(reticleNormal));
  reticle.visible = true;
  beam.position.copy(hit.point);
  beam.visible = true;
}
gl.domElement.addEventListener("pointermove", (event) => { if (!walk.active) aimReticle(event.clientX, event.clientY); });
gl.domElement.addEventListener("pointerleave", () => {
  reticle.visible = beam.visible = false;
});
button("missile").onclick = () => setMissileMode(!missileMode);
window.addEventListener("keydown", (e) => {
  if (!walk.active && (e.key === "m" || e.key === "M")) setMissileMode(!missileMode);
});
function fail(error: unknown) {
  ready = false;
  loading.hidden = false;
  loading.textContent = `Demo error
${String(error)}`;
}
async function reset() {
  ready = false;
  loading.hidden = false;
  loading.textContent = "Preparing the concrete frame…\n8,720 fragments · 24,720 bonds";
  for (const id of ["collapse", "detonate", "pause", "reset", "missile", "rate", "export"]) button(id).disabled = true;
  await new Promise((resolve) => setTimeout(resolve, 80));
  sim?.dispose();
  if (view) {
    scene.remove(view.group);
    view.dispose();
  }
  markers.clear();
  const { manifest } = createDestructibleBoxes(scaleFrameBoxes(SCALE_FRAMES.find(f => f.name === 'large')!), { id: 'large', cellSize: 1, maxFragments: 10_000 });
  manifest.level = { boxes: [], camera: { position: [57, 38, 62], target: [0, 11, 0] }, spawn: { position: [0, 0.05, 16], yaw: 0 } };
  fitSunShadow(manifest);
  mass = manifest.fragments.reduce((sum, f) => sum + f.mass, 0);
  renderProfile.reset(performance.now());
  sim = await PhysicsClient.create(manifest, PHYSICS_HZ);
  sim.setPlayerEnabled(walk.active);
  frame = sim.frame;
  sim.onFrame = (next) => {
    frame = next;
    onPhysicsFrame();
  };
  sim.onError = (message) => reportStepCrash(new Error(message));
  sim.onAction = (accepted, message) => {
    if (accepted && walk.active) cameraKick = Math.min(0.05, cameraKick + 0.027);
    if (message && walk.active) $('walkNotice').textContent = message;
    if (accepted) $('walkNotice').textContent = '';
  };
  crashed = false;
  view = new DestructionRenderer(manifest, { profile: true, materialFor: (_fragment, surface) => surface === "exterior" ? exterior : interior });
  scene.add(view.group);
  view.update(frame);
  wave = 0;
  sequence = false;
  placeNext = true;
  commandId = 1;
  paused = false;
  button("pause").textContent = "Pause";
  for (const id of ["collapse", "detonate", "pause", "reset", "missile", "rate", "export", "walk"]) button(id).disabled = false;
  loading.hidden = true;
  frameTimes.clear(); syncTimes.clear(); cpuTimes.clear(); gpuTimes.clear();
  // Drain any prior scene's GPU queries without attributing them to this capture.
  gpuDiscard = true;
  last = fpsAt = performance.now(); fpsFrames = 0; renderMs = 0;
  renderProfile.event(last, 'ready', { physicsHz: PHYSICS_HZ });
  ready = true;
  (window as any).__cascadeDemo = { sim, manifest, frame: () => frame, physicsHz: PHYSICS_HZ, profile: exportRenderProfile };
}
function syncRateButton() {
  button("rate").textContent = `Physics: ${PHYSICS_HZ} Hz`;
}
button("rate").onclick = () => {
  if (!ready) return;
  PHYSICS_HZ = PHYSICS_HZ === 60 ? 30 : 60;
  const url = new URL(location.href);
  url.searchParams.set('hz', String(PHYSICS_HZ));
  history.replaceState(null, '', url);
  syncRateButton();
  void reset();
};
syncRateButton();
button("collapse").onclick = () => {
  if (!sim || !frame || sequence) return;
  if ((frame.ordnance ?? []).length) enqueue("detonate");
  sequence = true;
  wave = 0;
  placeNext = true;
  paused = false;
  sim.setPaused(false);
  button("pause").textContent = "Pause";
  button("collapse").disabled = true;
};
button("detonate").onclick = () => enqueue("detonate");
button("pause").onclick = () => {
  paused = !paused;
  sim?.setPaused(paused);
  button("pause").textContent = paused ? "Resume" : "Pause";
  renderProfile.event(performance.now(), 'pause', { paused });
};
button("reset").onclick = () => reset().catch(fail);
let down = [0, 0];
const orbitPointers = new Set<number>();
let pinched = false;
gl.domElement.addEventListener("pointerdown", (event) => {
  if (walk.active) return;
  orbitPointers.add(event.pointerId);
  if (orbitPointers.size > 1) pinched = true;
  down = [event.clientX, event.clientY];
});
gl.domElement.addEventListener("pointerup", (event) => {
  if (walk.active) return;
  orbitPointers.delete(event.pointerId);
  if (pinched) { if (!orbitPointers.size) pinched = false; return; }
  if (!ready || !frame || !view || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5 || event.button !== 0) return;
  if (missileMode) {
    ray.setFromCamera(new THREE.Vector2(event.clientX / innerWidth * 2 - 1, 1 - event.clientY / innerHeight * 2), camera);
    const target = ray.intersectObject(view.group, true)[0]?.point ?? ray.intersectObject(ground)[0]?.point;
    if (target) designate(target);
    return;
  }
  if (sequence) return;
  if ((frame.ordnance ?? []).filter((item) => item.type === "explosive").length >= MAX_EXPLOSIVES) {
    $("hint").textContent = "32 charges placed. Detonate before placing more.";
    return;
  }
  ray.setFromCamera(new THREE.Vector2(event.clientX / innerWidth * 2 - 1, 1 - event.clientY / innerHeight * 2), camera);
  const hit = ray.intersectObject(view.group, true)[0];
  if (!hit) return;
  const batchId = hit.batchId;
  const fragmentId = batchId === void 0 ? void 0 : hit.object.userData.fragmentIds?.[batchId];
  enqueue("placeExplosive", hit.point.toArray(), fragmentId);
});
gl.domElement.addEventListener('pointercancel', (event) => { orbitPointers.delete(event.pointerId); if (!orbitPointers.size) pinched = false; });
window.addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  gl.setSize(innerWidth, innerHeight);
});
function onPhysicsFrame() {
  if (!ready || paused || !sequence) return;
  if (placeNext) {
    for (const position of charges.slice(wave * MAX_EXPLOSIVES, (wave + 1) * MAX_EXPLOSIVES)) enqueue("placeExplosive", position);
    placeNext = false;
  } else {
    enqueue("detonate");
    wave++;
    placeNext = true;
    if (wave * MAX_EXPLOSIVES >= charges.length) sequence = false;
  }
}
// Two-second windows. Recording uses fixed storage; sorting happens only at HUD rate.
class FrameTimes {
  private readonly values = new Float32Array(480);
  private readonly times = new Float64Array(480);
  private readonly sorted = new Float32Array(480);
  private cursor = 0;
  private count = 0;
  add(ms: number, at: number) {
    this.values[this.cursor] = ms;
    this.times[this.cursor] = at;
    this.cursor = (this.cursor + 1) % this.values.length;
    this.count = Math.min(this.count + 1, this.values.length);
  }
  clear() { this.cursor = this.count = 0; }
  p95(now: number): string {
    let count = 0;
    for (let i = 0; i < this.count; i++) {
      if (now - this.times[i]! <= 2000) this.sorted[count++] = this.values[i]!;
    }
    if (!count) return '—';
    this.sorted.subarray(0, count).sort();
    return this.sorted[Math.ceil(count * 0.95) - 1]!.toFixed(2);
  }
}
const frameTimes = new FrameTimes(), syncTimes = new FrameTimes(), cpuTimes = new FrameTimes(), gpuTimes = new FrameTimes();
const gpuContext = gl.getContext() as WebGL2RenderingContext;
const gpuTimer = gpuContext.getExtension('EXT_disjoint_timer_query_webgl2') as {
  TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number;
} | null;
const gpuQueries = gpuTimer ? Array.from({ length: 4 }, () => ({ query: gpuContext.createQuery()!, at: 0 })) : [];
let gpuRead = 0, gpuWrite = 0, gpuPending = 0, gpuDiscard = false, gpuSampleFrame = 0;
function beginGpuSample(now: number): boolean {
  if (!gpuTimer) return false;
  const disjoint = !!gpuContext.getParameter(gpuTimer.GPU_DISJOINT_EXT);
  if (disjoint) { if (!gpuDiscard) renderProfile.event(now, 'gpu-disjoint'); gpuDiscard = true; gpuTimes.clear(); }
  while (gpuPending) {
    const sample = gpuQueries[gpuRead]!;
    if (!gpuContext.getQueryParameter(sample.query, gpuContext.QUERY_RESULT_AVAILABLE)) break;
    if (!gpuDiscard) {
      const ms = gpuContext.getQueryParameter(sample.query, gpuContext.QUERY_RESULT) / 1e6;
      gpuTimes.add(ms, sample.at);
      renderProfile.record('gpuMs', ms);
      renderProfile.record('gpuSampleAgeMs', now - sample.at);
    }
    gpuRead = (gpuRead + 1) % gpuQueries.length;
    gpuPending--;
  }
  if (gpuDiscard) {
    if (gpuPending || disjoint) return false;
    gpuDiscard = false;
  }
  // Sample one draw in eight; never block waiting for a result or allocate queries in rAF.
  if (++gpuSampleFrame % 8 || gpuPending === gpuQueries.length) return false;
  const sample = gpuQueries[gpuWrite]!;
  sample.at = now;
  gpuContext.beginQuery(gpuTimer.TIME_ELAPSED_EXT, sample.query);
  return true;
}
function endGpuSample() {
  gpuContext.endQuery(gpuTimer!.TIME_ELAPSED_EXT);
  gpuWrite = (gpuWrite + 1) % gpuQueries.length;
  gpuPending++;
}
const longTaskSupported = typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask');
const longTasks = longTaskSupported ? new PerformanceObserver(list => {
  for (const entry of list.getEntries()) {
    if (!ready) continue;
    renderProfile.record('longTaskMs', entry.duration);
    renderProfile.event(entry.startTime, 'long-task', { durationMs: entry.duration, name: entry.name });
  }
}) : undefined;
longTasks?.observe({ type: 'longtask' });
document.addEventListener('visibilitychange', () => renderProfile.event(performance.now(), 'visibility', { state: document.visibilityState }));
const gpuDebug = gpuContext.getExtension('WEBGL_debug_renderer_info');
function exportRenderProfile() {
  return renderProfile.export(performance.now(), {
    captureTick: frame?.tick, physicsTargetHz: PHYSICS_HZ,
    userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency,
    threeRevision: THREE.REVISION, devicePixelRatio, renderPixelRatio: gl.getPixelRatio(),
    viewport: { width: innerWidth, height: innerHeight },
    gpuRenderer: gpuDebug ? gpuContext.getParameter(gpuDebug.UNMASKED_RENDERER_WEBGL) : gpuContext.getParameter(gpuContext.RENDERER),
    gpuVendor: gpuDebug ? gpuContext.getParameter(gpuDebug.UNMASKED_VENDOR_WEBGL) : gpuContext.getParameter(gpuContext.VENDOR),
    gpuTimerSupported: !!gpuTimer, gpuPendingSamples: gpuPending, gpuDisjoint: gpuDiscard,
    longTaskSupported, shadowsEnabled: gl.shadowMap.enabled, shadowMapSize: sun.shadow.mapSize.toArray(),
    antialias: gpuContext.getContextAttributes()?.antialias,
  });
}
const stats = $('stats');
stats.style.whiteSpace = 'pre-line';
stats.title = 'Rolling p95 over two seconds. Frame measures rAF cadence; CPU measures this render callback; sync measures interpolation/updates. GPU is sampled asynchronously when supported. 120 Hz budget: 8.33 ms.';
let last = performance.now();
let fpsAt = performance.now(), fpsFrames = 0, fps = 0, renderMs = 0;
let disposed = false;
function animate(now: number) {
  if (disposed) return;
  requestAnimationFrame(animate);
  const cpuStart = performance.now();
  const frameMs = now - last;
  if (ready && frameMs > 0) frameTimes.add(frameMs, now);
  const dt = Math.min(frameMs / 1e3, 0.05);
  last = now;
  fpsFrames++;
  if (now - fpsAt >= 500) {
    fps = fpsFrames * 1e3 / (now - fpsAt);
    fpsAt = now;
    fpsFrames = 0;
  }
  let syncMs = 0;
  const phases: Record<string, number> = {};
  if (ready && sim && frame && view) {
    const start = performance.now();
    view.update(frame, sim.previous, sim.alpha());
    syncMs = performance.now() - start;
    for (const [name, ms] of Object.entries(view.timings)) phases[`renderer.${name}Ms`] = ms;
    for (const [name, ms] of Object.entries(view.secondaryTimings)) phases[`renderer.secondary.${name}`] = ms;
    for (const [name, ms] of Object.entries(view.edgeTimings)) phases[`renderer.edges.${name}`] = ms;
    syncTimes.add(syncMs, now);
    renderMs = renderMs * 0.9 + syncMs * 0.1;
  }
  const gameStart = performance.now();
  if (ready && !paused) updateMissiles(dt);
  reticleMaterial.uniforms.uTime.value = now / 1e3;
  if (ready && !paused) updateDesignation(dt);
  const gameMs = performance.now() - gameStart;
  const hudStart = performance.now();
  if (frame && now - lastHud >= 250 && sim) {
    lastHud = now;
    const fraction = sim.manifest.fragments.reduce((sum, f, i) => sum + (frame!.states[i] === FragmentState.Supported ? 0 : f.mass), 0) / mass;
    stats.textContent = `${fps.toFixed(0)} fps render · ${renderMs.toFixed(1)} ms sync
frame p95 ${frameTimes.p95(now)} ms · sync p95 ${syncTimes.p95(now)} ms
CPU p95 ${cpuTimes.p95(now)} ms · GPU p95 ${gpuTimer ? gpuTimes.p95(now) + ' ms' : 'unavailable'}
${sim.simulationHz} Hz physics (target ${PHYSICS_HZ}) · ${sim.snapshotHz} Hz snapshots
${(frame.stats.physicsMs ?? 0).toFixed(1)} ms step · rung ${frame.stats.budgetRung ?? 0} · ${frame.stats.droppedFrames} dropped
${(fraction * 100).toFixed(1)}% detached mass
${frame.stats.activeBodies} moving bodies
${(frame.ordnance ?? []).length} placed charges${walk.active ? `
Player ${frame.player?.grounded ? 'grounded' : 'airborne'} · ${frame.player ? Math.hypot(frame.player.velocity[0], frame.player.velocity[2]).toFixed(1) : '0.0'} m/s · ${walk.tool.label}` : ''}`;
    markers.clear();
    for (const item of frame.ordnance ?? []) {
      if (item.type !== "explosive") continue;
      const mesh = new THREE.Mesh(markerGeometry, markerMaterial);
      mesh.position.fromArray(item.position);
      markers.add(mesh);
    }
  }
  const hudMs = performance.now() - hudStart;
  const controlsStart = performance.now();
  if (walk.active && frame?.player) {
    camera.position.fromArray(frame.player.eye);
    camera.rotation.set(walk.pitch, walk.yaw, 0, 'YXZ');
    camera.translateZ(cameraKick);
    cameraKick *= Math.exp(-dt * 24);
  } else controls.update();
  for (let i = 0; i < toolModels.length; i++) toolModels[i]!.visible = walk.active && i === walk.toolIndex;
  updateShadows();
  const controlsMs = performance.now() - controlsStart;
  const shadowsUpdated = gl.shadowMap.needsUpdate;
  const gpuSample = ready && beginGpuSample(now);
  const submitStart = performance.now();
  gl.render(scene, camera);
  (window as Window & { __blacksiteBodies?: (count: number) => void }).__blacksiteBodies?.(frame?.stats.activeBodies ?? 0);
  const submitMs = performance.now() - submitStart;
  if (gpuSample) endGpuSample();
  if (ready) {
    const callbackMs = performance.now() - cpuStart;
    cpuTimes.add(callbackMs, now);
    const telemetryStart = performance.now();
    renderProfile.frame(now, { frameIntervalMs: frameMs, callbackMs, syncMs, gameMs, hudMs, controlsMs, submitMs, ...phases }, {
      tick: frame?.tick, paused, visibility: document.visibilityState,
      snapshotAgeMs: sim ? performance.now() - sim.frameAt : null,
      physicsHz: sim?.simulationHz, snapshotHz: sim?.snapshotHz, physicsTargetHz: PHYSICS_HZ,
      physicsStepMs: frame?.stats.physicsMs, activeBodies: frame?.stats.activeBodies,
      droppedPhysicsFrames: frame?.stats.droppedFrames, budgetRung: frame?.stats.budgetRung,
      secondaryPieces: frame?.secondary?.fragments.length ?? 0, actors: frame?.actors?.length ?? 0,
      bonds: frame?.bonds?.length ?? sim?.manifest.bonds.length ?? 0,
      hierarchyRevision: frame?.hierarchyRevision, bondRevision: frame?.bondRevision,
      secondaryRevision: frame?.secondary?.revision, shadowsUpdated,
      ...view?.edgeStats, ...view?.secondaryStats,
      physicsStats: frame?.stats,
      drawCalls: gl.info.render.calls, triangles: gl.info.render.triangles,
      lines: gl.info.render.lines, points: gl.info.render.points,
      geometries: gl.info.memory.geometries, textures: gl.info.memory.textures,
      programs: gl.info.programs?.length ?? 0,
      width: gl.domElement.width, height: gl.domElement.height,
      cameraPosition: camera.position.toArray(), cameraTarget: controls.target.toArray(),
      playerGrounded: frame?.player?.grounded, playerSpeed: frame?.player ? Math.hypot(frame.player.velocity[0], frame.player.velocity[2]) : 0, playerTool: walk.tool.id,
    });
    renderProfile.record('telemetryMs', performance.now() - telemetryStart);
  }
}
requestAnimationFrame(animate);
reset().catch(fail);
window.addEventListener("beforeunload", () => {
  disposed = true;
  longTasks?.disconnect();
  sim?.dispose();
  walk.dispose();
  detachTouch();
  view?.dispose();
  controls.dispose();
  for (const geometry of toolGeometries) geometry.dispose();
  toolMaterial.dispose(); gripMaterial.dispose(); accentMaterial.dispose();
  for (const sample of gpuQueries) gpuContext.deleteQuery(sample.query);
  gl.dispose();
  exterior.dispose();
  interior.dispose();
  markerGeometry.dispose();
  markerMaterial.dispose();
});
let exporting = false;
async function downloadReplayProfile() {
  if (!sim || exporting) return;
  exporting = true;
  button('export').disabled = true;
  button('export').textContent = 'Exporting…';
  const client = sim;
  const profile = exportRenderProfile();
  try {
    const log = await client.exportReplay();
    const blob = new Blob([JSON.stringify({ ...log, renderProfile: profile })], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cascade-replay-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch (error) {
    console.error('replay export failed', error);
    $('hint').textContent = 'Export failed. Please try again.';
  } finally {
    exporting = false;
    button('export').disabled = !ready;
    button('export').textContent = 'Export profile (E)';
  }
}
button('export').onclick = () => { void downloadReplayProfile(); };
window.addEventListener('keydown', e => {
  if ((e.key === 'e' || e.key === 'E') && !e.repeat) void downloadReplayProfile();
});
let crashed = false;
function reportStepCrash(error: unknown) {
  if (crashed) return;
  crashed = true;
  console.error("simulation step crashed", error);
  const message = error instanceof Error ? `${error.message}
${(error.stack ?? "").split("\n").slice(1, 4).join("\n")}` : String(error);
  sim?.exportReplay().then((log) => {
    const blob = new Blob([JSON.stringify({ ...log, crash: message, renderProfile: exportRenderProfile() })], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `cascade-crash-${Date.now()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1e3);
  }).catch((exportError) => console.error("crash replay export failed", exportError));
  paused = true;
  loading.hidden = false;
  loading.textContent = `Simulation step crashed at tick ${frame?.tick ?? "?"} (replay downloaded)
${message}`;
}
