/**
 * Minimal Cascade demo: the large scale frame simulated in a Web Worker at a fixed 30 Hz (or 60 Hz),
 * rendered at display rate by interpolating between the last two snapshots every frame. Physics
 * rate and render rate are independent; the overlay shows both and the main-thread cost per frame.
 */
import {
  AmbientLight,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import {
  FIXED_DT,
  FIXED_DT_30HZ,
  MAX_EXPLOSIVES,
  type Vec3,
} from '../../destruction-domain/src/index';
import { createDestructibleBoxes } from '../../destruction-authoring/src/boxes';
import { DestructionRenderer } from '../../destruction-render/src/renderer';
import {
  SCALE_BAY,
  SCALE_CELL,
  SCALE_FRAMES,
  scaleFrameBoxes,
} from '../../destruction-testkit/src/scale-frame';
import { DestructionSession } from './session';

/**
 * Structural cell size. 1 m is the reference feel; `?cell=2` opts into the parked 2 m hierarchical
 * cells, which refine to 1 m pieces where they land hard or are blasted.
 */
const DEMO_CELL = Number(new URLSearchParams(location.search).get('cell')) || SCALE_CELL;
const frame = SCALE_FRAMES.find((f) => f.name === 'large')!;
const { manifest } = createDestructibleBoxes(scaleFrameBoxes(frame), {
  cellSize: DEMO_CELL,
  id: frame.name,
  maxFragments: 10_000,
});

const scene = new Scene();
scene.background = new Color('#10161a');
scene.add(new AmbientLight('#9db4c0', 1.2));
const sun = new DirectionalLight('#ffffff', 2.2);
sun.position.set(30, 50, 20);
scene.add(sun);
const ground = new Mesh(
  new PlaneGeometry(400, 400),
  new MeshStandardMaterial({ color: '#2a3238' }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.01;
scene.add(ground);
const cascade = new DestructionRenderer(manifest);
scene.add(cascade.group);

const renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
(window as Window & { __blacksitePerf?: (renderer: WebGLRenderer) => void }).__blacksitePerf?.(renderer);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);
const camera = new PerspectiveCamera(50, 1, 0.1, 1000);
const resize = () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
};
addEventListener('resize', resize);
resize();
camera.position.set(42, 26, 46);
camera.lookAt(0, 8, 0);
cascade.setCamera(camera);

const demolish = document.getElementById('demolish') as HTMLButtonElement;
const reset = document.getElementById('reset') as HTMLButtonElement;
const hz30 = document.getElementById('hz30') as HTMLButtonElement;
const hz60 = document.getElementById('hz60') as HTMLButtonElement;
const stats = document.getElementById('stats')!;
const connections = document.getElementById('connections') as HTMLButtonElement;
connections.onclick = () => {
  cascade.setShowConnections(!cascade.showConnections);
  connections.classList.toggle('on', cascade.showConnections);
  connections.setAttribute('aria-pressed', String(cascade.showConnections));
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let session: DestructionSession;
let demolishing = false;

function start(timestep: number) {
  void session?.dispose();
  demolishing = false;
  session = new DestructionSession(manifest, {}, { timestep });
  session.subscribe(() => {
    const ready = session.getSnapshot().status === 'running';
    demolish.disabled = !ready || demolishing;
    reset.disabled = !ready;
  });
  hz30.classList.toggle('on', timestep === FIXED_DT_30HZ);
  hz60.classList.toggle('on', timestep === FIXED_DT);
}

async function runDemolition() {
  if (demolishing) return;
  demolishing = true;
  demolish.disabled = true;
  const active = session;
  // Same knee charges as the benchmark: every ground-floor column, then the stair core.
  const x0 = (-frame.baysX * SCALE_BAY) / 2,
    z0 = (-frame.baysZ * SCALE_BAY) / 2;
  const charges: Vec3[] = [];
  for (let ix = 0; ix <= frame.baysX; ix++)
    for (let iz = 0; iz <= frame.baysZ; iz++)
      charges.push([x0 + ix * SCALE_BAY, 1, z0 + iz * SCALE_BAY]);
  for (let t = 0.75; t < SCALE_BAY; t += 1.5)
    charges.push(
      [x0 + t, 1, z0],
      [x0 + t, 1, z0 + SCALE_BAY],
      [x0, 1, z0 + t],
      [x0 + SCALE_BAY, 1, z0 + t],
    );
  charges.reverse();
  for (let i = 0; i < charges.length && active === session; i += MAX_EXPLOSIVES) {
    for (const p of charges.slice(i, i + MAX_EXPLOSIVES))
      active.impact('placeExplosive', p, [0, 0, 1], 1.5, 2);
    await sleep(250);
    active.impact('detonate', [0, 0, 0], [0, 0, 1], 1, 1);
    await sleep(250);
  }
  demolishing = false;
}
demolish.onclick = () => void runDemolition();
reset.onclick = () => session.reset();
hz30.onclick = () => start(FIXED_DT_30HZ);
hz60.onclick = () => start(FIXED_DT);
start(FIXED_DT_30HZ);

// Overlay: rolling one-second window of render FPS and main-thread milliseconds per frame.
let windowStart = performance.now();
let frames = 0;
let busy = 0;
let worst = 0;
let shown = { fps: 0, ms: 0, worst: 0 };
renderer.setAnimationLoop(() => {
  const began = performance.now();
  // Interpolate between the last two physics snapshots; display rate, not physics rate.
  cascade.update(
    session.frame,
    session.previous,
    session.previous ? session.interpolationAlpha() : 1,
  );
  renderer.render(scene, camera);
  (window as Window & { __blacksiteBodies?: (count: number) => void }).__blacksiteBodies?.(session.frame?.stats.activeBodies ?? 0);
  // Main-thread cost per frame: renderer update + draw, plus snapshot apply since the last frame.
  const cost = performance.now() - began + session.takeApplyMs();
  frames++;
  busy += cost;
  worst = Math.max(worst, cost);
  const now = performance.now();
  if (now - windowStart >= 1000) {
    shown = { fps: (frames * 1000) / (now - windowStart), ms: busy / frames, worst };
    frames = 0;
    busy = 0;
    worst = 0;
    windowStart = now;
    const view = session.getSnapshot();
    const step = session.frame?.stats;
    const pieces = session.frame?.secondary?.fragments.length ?? 0;
    stats.textContent = [
      `render  ${shown.fps.toFixed(0)} FPS   main ${shown.ms.toFixed(1)} ms/frame (worst ${shown.worst.toFixed(1)})`,
      `physics ${view.simulationHz} Hz   ${step ? step.physicsMs.toFixed(1) : '–'} ms/step   snapshots ${view.snapshotHz} Hz`,
      `${view.status} · ${session.frame?.visibleChunks?.length ?? manifest.fragments.length} visible chunks · ${pieces} pieces · ${step?.activeBodies ?? 0} active${view.error ? ` · ${view.error}` : ''}`,
      step?.budgetRung === undefined
        ? ''
        : `budget rung ${step.budgetRung}/4 · step ${(step.budgetStepMs ?? 0).toFixed(0)}/${(step.budgetLimitMs ?? 0).toFixed(0)} ms · baked ${step.budgetBakedTotal ?? 0} (+${step.budgetBaked ?? 0}) · deferred ${step.budgetDeferred ?? 0} · debris ${step.debrisLive ?? 0}/${step.debrisCap ?? 0}`,
    ]
      .filter(Boolean)
      .join('\n');
  }
});
