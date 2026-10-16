# Warden integration

Consume Blacksite as one recursive Git submodule. List `vendor/blacksite/packages/warden` and `vendor/blacksite/packages/warden-react` in the game's pnpm workspace, declare both as `workspace:*` dependencies, and import their source exports. Warden uses React 19, React Three Fiber 9, Koota, XState and Effect.

## Existing React Three Fiber scene

```tsx
"use client";

import { Canvas } from "@react-three/fiber";
import {
  WardenScene,
  useWarden,
} from "@blacksite/warden-react";

export function TacticalPreview() {
  const ai = useWarden({ config: { seed: 2048, scenarioId: "casualty" } });
  return (
    <section>
      <button onClick={() => ai.play()}>Play</button>
      <button onClick={() => ai.pause()}>Pause</button>
      <button onClick={() => ai.step()}>One tick</button>
      <button onClick={() => ai.reset()}>Reset</button>
      {ai.error && <p role="alert">{ai.error}</p>}
      <div style={{ height: 480 }}>
        <Canvas orthographic camera={{ position: [0, 60, 0], rotation: [-Math.PI / 2, 0, 0], zoom: 10 }}>
          <ambientLight intensity={1.4} />
          <directionalLight position={[-15, 35, 10]} intensity={2} />
          {ai.map && ai.snapshot && (
            <WardenScene map={ai.map} snapshot={ai.snapshot} showPaths />
          )}
        </Canvas>
      </div>
    </section>
  );
}
```

The scene owns only its scene objects. It does not create a Canvas, camera controller, lights, DOM root or global styles. Use your own characters/rendering by reading snapshots instead. `WardenDemo` is an optional self-contained preview that owns its own Canvas and controls.

The hook creates its session in an effect, handles configuration changes, and disposes its worker on unmount. It starts paused. Commands, resets and export requests run through the worker protocol; simulation ticks remain independent of React's render cadence.

## Headless reference runtime

```ts
import {
  DEFAULT_CONFIG,
  TacticalRuntime,
  verifyReplay,
} from "@blacksite/warden";

const runtime = new TacticalRuntime({
  ...DEFAULT_CONFIG,
  seed: 2048,
  scenarioId: "casualty",
});
try {
  for (let tick = 0; tick < 300; tick++) runtime.step();
  const state = runtime.snapshot();
  const replay = runtime.exportReplay();
  console.log(state.tick, verifyReplay(replay));
} finally {
  runtime.dispose();
}
```

`runtime.step(commands)` accepts normalized controller commands through the same authoritative movement/weapon interface used by AI. Omitting commands runs the bots. Importing the core does not start a world, timer or worker. Dispose every runtime or managed Effect session when finished.

## Your map

Pass a serializable `RuntimeWorld` as the second runtime argument, or the hook's `world` option:

```ts
import { DEFAULT_CONFIG, TacticalRuntime, type RuntimeWorld } from "@blacksite/warden";

const world: RuntimeWorld = {
  map: authoredTacticalMap,
  initialAmmo: 24,
  initialHealth: { "alpha-1": 100 },
};
const runtime = new TacticalRuntime(DEFAULT_CONFIG, world);
// Or: useWarden({ world, config: { agentsPerTeam: 5 } })
```

Author a `TacticalMap` with bounds, obstacle rectangles, region topology, tactical nodes, objectives and exactly `agentsPerTeam` spawn points for each team. Positions use metres and Y-up coordinates; movement occurs on the X/Z plane. `bakeTacticalNodes` is available for generating tactical annotations. Maps and references are validated before authority starts. Custom worlds are embedded in exported replays so verification uses the same authored content. Give changed maps a new version. `bakeTacticalNodes(map, anchors, { spacing })` derives its grid from the map's bounds, so it works for any map size. A world may set `rules: { damage, spread, suppressedSpread }` to tune lethality and accuracy under suppression; those rules travel with the world into replays.

The default authority runs the included planar reference simulation. To integrate an existing game, supply a `TacticalAuthority` adapter to `TacticalRuntime`: it exposes self status, generates legal observations, and applies normalized `AgentCommand`s through the same controller interface as players. Warden runs the hierarchy, beliefs, planning, execution and motors. For elevated levels, use the included navigation builder and tactical baker below and pass their `spatial` queries to the runtime. Your existing ECS, controller, physics and weapons remain authoritative; hidden enemy state never enters planning snapshots.

## A human player against the squad

A single-player shooter runs `TacticalRuntime` on the main thread with its own `TacticalAuthority`, steps it with a fixed 30 Hz accumulator, and lists the player in `controlledAgentIds`. The authority owns movement, weapons, health and the win condition; `ObservationGenerator` gives the bots legal senses, and `recordShot` and `recordDamage` let them hear the player's gunfire and feel hits. `neutralCommand`, `normalizeCommand`, `hashValue`, `lineClear` and `insideObstacle` are exported for authorities.

Two runtime options make a squad read as smart rather than lethal:

```ts
const runtime = new TacticalRuntime(config, world, {
  authority,
  controlledAgentIds: ["alpha-1"],
  attackTokens: { count: 2, holdTicks: 90, cooldownTicks: 36 },
  intents: { leadTicks: 24 },
});
```

- `attackTokens` lets at most `count` AI agents per team hold the fire button at once. A holder hands its token on after `holdTicks`, or after `idleTicks` (default 15) without trying to fire, and waits `cooldownTicks` before taking another. The rest keep aiming with `fireGate: 'attack-token'`. `runtime.attackTokenHolders(team)` lists the holders.
- `intents` emits a `SimEvent` of type `intent` whenever an AI agent's activity changes (`advance`, `flank`, `cover`, `engage`, `suppress`, `reload`, `fallback`, `search`, `hold`; `intentOf` derives it). A new `advance` or `flank` waits in place for `leadTicks`, so a game can play the callout before the move starts.

## Worker and bundler integration

The default worker factory uses the bundler-recognized form:

```ts
new Worker(new URL("../ai-worker/worker.ts", import.meta.url), { type: "module" });
```

Vite production builds are tested, including relocated nonstandard `lib` aliases. Other bundlers can provide a `workerFactory` to the hook or session API. Do not import the worker entry from a main-thread barrel: it intentionally installs worker message handlers and starts a scheduling timer.

For Next.js or other SSR frameworks, use the React entry from a client component. The core can execute headlessly on a compatible server runtime. The optional demo is for local inspection, not a secure competitive multiplayer client.

`createWardenSession` is also available without React. Subscribe to its state, issue controls, export a replay, and dispose it when done. For game presentation, pass `detail: 'render'` to `createWardenSession` or `useWarden`. Snapshots then drop the full decision trace, keep a short belief provenance and the top tactical candidates, and send the map once instead of on every tick. See the installed TypeScript types for method signatures and the injectable worker interface.

## Effect and model boundary

The core exports `createAuthority`, `AuthorityService` and `offlineDeterministicLayer` for Effect-managed lifetime and typed failures. Koota owns the reference simulation; XState runs skill lifecycles. No online training occurs. The policy gate and signed model registry are extension points; no trained model artifacts are shipped. Browser signature verification requires WebCrypto support when you invoke it.

## Installation and updates

Pin the Blacksite submodule commit and update it deliberately with `git submodule update --init --recursive` and `pnpm install`.

## 3D navigation included

The Warden package includes navmesh generation, path queries, tactical annotation and crowd avoidance. It installs `navcat` as a dependency. Games supply indexed level triangles and authored team spawn zones; they do not need a separate navigation engine or tactical-map baker.

```ts
import {
  buildNavigationMesh,
  bakeNavigationTactics,
  TacticalRuntime,
  DEFAULT_CONFIG,
} from "@blacksite/warden";

const navigation = buildNavigationMesh({ positions, indices }, {
  radius: 0.35,
  height: 1.8,
  climb: 0.3,
  slope: 45,
});
const { map, spatial } = bakeNavigationTactics(navigation, {
  id: "my-level",
  name: "My level",
  width: 64,
  depth: 64,
  spawns: {
    alpha: [{ x: -20, y: 0, z: 0 }],
    bravo: [{ x: 20, y: 0, z: 0 }],
  },
});
const runtime = new TacticalRuntime(DEFAULT_CONFIG, { map }, {
  authority: myGameAuthority,
  spatial,
  controlledAgentIds: ["alpha-1"],
});
```

`positions` and `indices` are array-like buffers containing triangles in world metres. The builder retains elevation and disconnected navigation islands, supports decks and ramps, and provides `project`, `path`, `canTraverse`, `isWalkable`, `randomPoint`, `samplePoints` and geometry-based `hasLineOfSight`. Its navmesh settings control agent clearance, climb and slope limits. Mesh generation is a load/bake operation; run it in a worker for large levels.

`bakeNavigationTactics` samples the generated mesh, identifies connected regions and tactical positions, scores static cover and exposure, and returns the map and spatial queries used throughout Warden's planning and motor control. Spawn zones are authored public map information: never derive them or tactical annotations from live hidden opponents. Its optional visibility callback can reflect dynamic physics geometry; the default queries the supplied triangles.

`createNavigationCrowd(navigation)` owns local avoidance. On each fixed tick, supply agents with stable `id`, `position`, `velocity`, `preferredVelocity` and `maxSpeed`; set `controlled: true` for human agents so avoidance predicts their physical presence without changing their commands. `update(agents, deltaSeconds)` returns avoided velocities by ID. Apply those velocities through your existing controller's legal input interface. The crowd automatically releases removed agents and never writes to transforms.

When geometry changes, call `navigation.rebuild(updatedGeometry)`, rebake tactical annotations and replace the tactical runtime at a safe fixed-tick boundary. `navigation.revision` identifies the current mesh. Dispose the tactical runtime and any crowds before disposing navigation. Your game continues to own movement, physics, weapon rules and observation generation through `TacticalAuthority`; Warden owns every AI and navigation decision.
