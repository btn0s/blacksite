# Destruction

Cascade (`@blacksite/cascade`) breaks buildings by structure: a bond graph with a stress solver decides what fails, Rapier moves the pieces, and a batched renderer draws primaries, secondary fractures and exposed edges. It runs in a module worker and stays real time by trading fidelity, never rate.

## Guides

- `docs/cascade.md`: walk mode, authoring, attaching to a host world, bullet craters and secondary pieces, workers and rendering, crushing, structural work, scale benchmarks, replay, the protocol and verification. Some of its numbers are older than the code; the code wins.
- `packages/cascade/AGENTS.md`.
- `site/src/showcases/air-strike/`: the complete reference, with a five-storey block, missiles, dust, smoke, fire and the perf probe.

## Standard use

- **Author:** `createDestructibleBoxes(boxes, { id, cellSize, maxFragments, materials, storeyHeight, panelWidth })`. Air Strike uses 1.6 m cells and up to 4,200 fragments; the defaults are 0.75 m and 2,048, with a hard limit of 10,000.
- **Simulate:** `new DestructionSession(manifest, { frame, ready }, { timestep: FIXED_DT_30HZ, rest: { forceAfterSeconds: 2.5, forceSpeed: 0.5, forceSpin: 0.9 } })`. Dispose it on teardown.
- **Draw:** `new DestructionRenderer(manifest, { materialFor, secondaryAddsPerUpdate: 12, edgeFacesPerUpdate: 64 })`, then `view.update(session.frame, session.previous, session.interpolationAlpha())` each frame. Leave the per-update throttles at those values, not their unlimited defaults.
- **Interact:** `session.impact('explosion', position, direction, radius, strength, undefined, minRadius)`; Air Strike's strike is radius 9, minimum 4.5, strength 10.
- **Shared world:** when the game owns Rapier, `DestructionSimulation.attach(manifest, { rapier, world })` and call `beforePhysicsStep()` and `afterPhysicsStep()` around the step. Leave debris colliders out of camera and character queries.
- **Feed effects** from `frame.events` and report `frame.stats.activeBodies` to the perf probe.

Compliant joints need the pinned Cascade Rapier build in `vendor/rapier`; stock Rapier throws in that mode.

## What isn't there yet

- No prototype template: `--with cascade` adds the package and an empty mode. Start from Air Strike.
- The medium and large scale frames miss the timing gates; detonation steps run 85–270 ms against a 50 ms target. Keep buildings small enough for the step budget.
- Snapshots carry every live secondary definition every frame; a delta transport is planned.

## Rules, and the failures that taught them

- **Physics never runs slower than the wall clock.** At 2 m cells on a 30 Hz worker the collapse played in slow motion. A step budget now drops fidelity in four rungs when cost passes 0.85 of the step, with 30 Hz as the floor.
- **Bake settled rubble.** A 1,600-body pile never slept, because one awake body keeps its neighbours awake. Bodies below 0.35 m/s for 0.4 s become fixed and remember their supports.
- **Contact damage adds no momentum.** Contacts that also applied an impulse sprayed 460 pieces at 12–30 m/s, up to 64 m out. Damage only: spread fell to 2–3 m at p90.
- **Localize landing shock.** Damaging a whole falling island made outcomes all or nothing. Damage bonds within 1–3.5 m of the contact.
- **Inset sibling colliders.** Coincident proxies penetrated 2.6 m and kinetic energy jumped from 4.6 kJ to 1.4 GJ in one tick. Audit energy per step after every fracture.
- **Clear warm-start impulses on a type change.** A 537 kg fragment switched from fixed to dynamic was launched at 61 m/s by cached contact impulses. The patched Rapier adds `resetContactWarmstart`.
- **Keep CCD on fast bodies.** 73 steps had bodies above 8 m/s without CCD. It stays on above 8 m/s at every budget rung.
- **Remove physics before the visual fades.** A sinking kinematic body with its collider disabled still fell 14 m through live floors.
- **Read loads from force events.** Walking every contact pair cost 33.7 ms at the collapse peak; force events above 500 N cost 3.0 ms.
- **Measure collapse by where the mass went.** A "99% collapse" counted detached mass; the building had dropped 0.4 m in one piece. Gate on mass below one storey and the centroid drop.
- **Rewrite stale tests as invariants.** After a solver change 94 of 336 tests pinned old trajectories. Invariants (exposure before effect, conservation, caps, determinism, locality) passed and exposed two real bugs.
- **Sort ids by code unit.** `localeCompare` hashed manifests differently under English and Swedish collation.
