# Cascade

Purpose: destruction simulation, graph, authoring, physics, presentation, effects, and network primitives. Import the facade from `@blacksite/cascade`; `/session`, `/render-profile`, `/showcase-frame`, and `/walk-client` are focused exports. Add its transitive `destruction-*` workspace closure, construct authored structures and a session, and adapt emitted state to game presentation and authority. Keep structure IDs and simulation time stable across replication; the game owns interaction and rendering integration. Blacksite's patched Rapier tarballs support Cascade development, while games use stock Rapier. See `docs/cascade.md` and `src/session.ts`.

## Rules, and the failures that taught them

The player-facing rules (real-time stepping, debris spread, settled rubble, collapse by mass, force events) are in `skills/blacksite/references/combat.md` and `performance.md`. These are the solver's own:

- **Localize landing shock.** Damaging a whole falling island made outcomes all or nothing. Damage bonds within 1–3.5 m of the contact.
- **Inset sibling colliders.** Coincident proxies penetrated 2.6 m and kinetic energy jumped from 4.6 kJ to 1.4 GJ in one tick. Audit energy per step after every fracture.
- **Clear warm-start impulses on a type change.** A 537 kg fragment switched from fixed to dynamic was launched at 61 m/s by cached contact impulses. The patched Rapier adds `resetContactWarmstart`.
- **Keep CCD on fast bodies.** 73 steps had bodies above 8 m/s without CCD. It stays on above 8 m/s at every budget rung.
- **Remove physics before the visual fades.** A sinking kinematic body with its collider disabled still fell 14 m through live floors.
- **Rewrite stale tests as invariants.** After a solver change 94 of 336 tests pinned old trajectories. Invariants (exposure before effect, conservation, caps, determinism, locality) passed and exposed two real bugs.
- **Sort ids by code unit.** `localeCompare` hashed manifests differently under English and Swedish collation.
