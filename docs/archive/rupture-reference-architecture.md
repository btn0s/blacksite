# Rupture reference architecture: NVIDIA Blast and The Finals, row by row

Status: the governing spec for Rupture, 2026-10-06. Rupture is a browser recreation of NVIDIA
Blast's destruction model and Embark's destruction system in The Finals, with our own deliberate
tweaks. Every worker brief names rows of this document and implements them the way the reference
does. If a reference technique does not fit the browser, the row says so and the user decides;
nobody substitutes a cheaper approach silently.

Sources, which workers read themselves before implementing a row:

- Blast low-level users guide: https://nvidia-omniverse.github.io/PhysX/blast/docs/api/api_ll_users_guide.html
- Blast toolkit (Tk) users guide: https://nvidia-omniverse.github.io/PhysX/blast/docs/api/api_hl_users_guide.html
- Blast types (chunk, bond, fracture buffers, shaders): https://github.com/NVIDIA-Omniverse/PhysX/blob/main/blast/include/lowlevel/NvBlastTypes.h
- Blast damage shaders: https://github.com/NVIDIA-Omniverse/PhysX/blob/main/blast/include/extensions/shaders/NvBlastExtDamageShaders.h
- Blast stress solver: https://github.com/NVIDIA-Omniverse/PhysX/blob/main/blast/include/extensions/stress/NvBlastExtStressSolver.h
  and https://nvidia-omniverse.github.io/PhysX/blast/docs/api/extensions/ext_stress.html
- Blast UE4 destructible settings (archived GameWorks docs): damage = impulse / hardness, damage
  radius and falloff, min/max damage thresholds, debris depth, max size, max separation, bounds,
  lifetime min/max.
- Embark, GDC 2024, "Engineering Mayhem: technical deep-dive into environmental destruction in
  THE FINALS" (Måns Isaksson). Slides: https://gdcvault.com/play/1034280/Engineering-Mayhem-Technical-Deep-Dive
- Embark, Season 8 "Smooth Destruction" / dynamism announcements (September 2025 onward).

Rupture code referenced below is on the branch
`btn0s/rupture-phase-1-never-slow-motion-budget-sleep-d-thr_dc8cef5i5c` at `dbcaddd`.

## How the two references fit together

Blast is the data model and pipeline: a chunk hierarchy, a support graph of bonds, health on
bonds and chunks, damage programs that emit fracture commands, apply, split into actors, a stress
solver that turns gravity and impulses into bond fracture commands. The Finals is Blast's model
taken to building scale in a shipped game: Houdini-authored chunking per building element, a
connection graph with a sparse direct structural solver, breaking on a baseline-plus-offset
impulse test, server-authoritative replication, and a presentation layer. Rupture is the Blast
pipeline with the Finals' structural solver and feel, in TypeScript on Rapier and Three.js.

## Part A: the Blast data model

### A1. Asset and chunk hierarchy

Reference. An asset is a tree of chunks. "Index of this chunk's parent. If this is a root chunk,
then this value must be UINT32_MAX." Each chunk has a centroid, a volume, flags and user data.
Authoring is multi-level: the root is the whole object, each level fractures the level above
("multi level fracture (5 levels) 341 chunks" in NVIDIA's examples). The rule is show the biggest
chunk possible: an actor renders the visible chunks at the shallowest depth that is still intact.

Rupture today. `FragmentDef` has no parent. `createDestructibleBoxes` cuts every authored box into a
flat grid of cells (`cellSize`, default 0.75 m, 1 m on the large frame) and every cell is a leaf
and a root at once. Secondary fracture (`SecondaryFragmentDef.parentId`, `rootId`, `generation`)
builds a hierarchy downward at run time, but only below cells, never above them.

Gap. The hierarchy above the cell is missing. There is no chunk for "this column", "this slab",
"this wall panel" that the cells are children of. This is why one hard event shatters the whole
frame into 1 m soup: there is no coarser chunk to stay intact.

Decision. Implement A1 as Blast does. Depth 0 = authored element (column, beam, slab, wall panel,
the box the author placed). Depth 1 = member segments (a column cut every storey, a slab cut into
bays, a wall into panels; The Finals' Houdini tool cuts per element type: foundation, floors,
roofs, exterior walls, windows, trims). Depth 2 = today's cells. Depth 3+ = run-time secondary
fracture as today. The manifest gains `parent` on every fragment and a `depth` on the asset.

### A2. Support chunks and the support graph

Reference. "If this flag is set then the chunk will become a support chunk, unless an ancestor
chunk is also marked as support." Support chunks are the nodes of the support graph; they must
exactly cover the asset (every leaf has exactly one support ancestor or is itself support). Bonds
exist only between support chunks. Chunks below support depth are subsupport: they do not carry
structure and only matter once their support ancestor is a free actor.

Rupture today. Every cell is a support chunk and every face between adjacent cells is a bond.
`StructuralGraph` builds the graph from `manifest.bonds` and owns `states`, `damage`,
`utilization`, islands.

Gap. Support depth is fixed at the cell. In Blast and in The Finals the support level is the
member segment, not the cell: the structural solver runs on hundreds of nodes per building, not
tens of thousands.

Decision. Support chunks live at depth 1 (member segments). Cells and smaller are subsupport. The
structural solver (A7 and B2) runs on the depth-1 graph. The user's tweak: a support chunk may be
demoted to its children at run time when it is damaged but not detached (A6), which Blast does not
do and which is what makes "big chunks first, then smaller" happen inside a standing building.

### A3. Bonds

Reference. A bond has `normal` ("interface average normal"), `area` ("area of interface"),
`centroid` ("central position on the interface between chunks") and `userData` ("e.g. whether or
not to create a joint"). World bonds connect a support chunk to the world by using the invalid
chunk index as the second endpoint; a chunk with a world bond is anchored while the bond lives.

Rupture today. `BondDef` has `a`, `b`, `normal`, `area`, `strength` and an optional `section`
(tangents, section moduli, inertias, torsion modulus, point). Anchoring is a per-fragment
`anchored` flag rather than a world bond.

Gap. No world bonds; no per-bond user data (joint-or-not). Section data is richer than Blast's and
is kept.

Decision. Keep `BondDef` and its section. Add world bonds as bonds whose `b` is `-1`, replacing the
`anchored` flag for ground contact, so an anchored column can be cut free at its base exactly like
any other bond and the stress solver sees ground reaction as a bond load. Add `joint: boolean`
user data for Part B's compliant seams.

### A4. Families and actors

Reference. "Actors live within a family created from asset data." An actor "references a list of
visible chunk indices". Initially one actor represents the root; splitting produces child actors,
each owning a connected set of support-graph nodes. One actor equals one rigid body in the game.
Tk creates the family automatically and raises split events listing destroyed and created actors.

Rupture today. Islands (`StructuralGraph.islands`) are connected components of the cell graph; the
physics layer makes one Rapier body with many colliders per detached island and keeps the
supported component fixed. Secondary bodies are separate.

Gap. The mapping is already actor-like. What is missing is the visible-chunk list: an island
renders and collides as its cells, never as the depth-0 or depth-1 chunk it still fully contains.

Decision. An actor's visible chunks are the shallowest intact chunks (A1 rule). A detached column
segment that has not been damaged below depth 1 is one collider and one draw, not nine cells.
This is the main body-count win and it comes straight from the model, not from a step budget.

### A5. Health on bonds and chunks

Reference. `initialBondHealth` and `initialChunkHealth` are set on the actor. Fracture commands
carry `health` ("health value (damage or remains)"). A bond at zero health is broken. A support
chunk at zero health is dead: "Chunks fractured hard enough will also fracture their children,
creating Fracture Events for each." Materials (`NvBlastExtMaterial`) have `health`,
`minDamageThreshold` and `maxDamageThreshold`, and damage arrives normalised to [0, 1].

Rupture today. Bonds have `damage` in [0, 1] with state thresholds (cracked 0.2, yielding 0.65,
broken 1). Fragments have no health.

Gap. Chunk health is missing, so a charge cannot kill a chunk and cascade to its children; it can
only break bonds, which is why a point charge "rips cells out" rather than fracturing a member.

Decision. Add chunk health. A dead support chunk is replaced by its children (they become support
nodes, with bonds inherited from the parent's bonds by interface area), and the damage that killed
it continues into them. Min and max damage thresholds per material as in Blast.

### A6. Damage programs, fracture commands, apply, split

Reference. A damage program is "composed of a NvBlastGraphShaderFunction and a
NvBlastSubgraphShaderFunction operating on support graphs and disconnected subsupport chunks
respectively". The graph shader sees the actor's node indices, adjacency, `familyBondHealths`,
`supportChunkHealths`, chunk centroids. It "creates a list of NvBlastFractureCommand". The
pipeline is three separate calls: GenerateFracture ("does not modify the NvBlastActor"),
ApplyFracture ("does modify the state"), Split ("may be split into all its smallest pieces").
Shipped shaders: radial (min/max radius falloff), capsule radial (distance to segment),
shear (directional), triangle intersection (bond = segment between centroids), impact spread
("Breadth-first support graph traversal ... distance is measured along the edges").

Rupture today. `StructuralGraph.applyCommands` handles `pointImpact`, `explosion`, `cut` in one
pass: radius test, `falloff = (1 - d / r)^k`, a type multiplier, brittleness and resistance, added
straight to bond damage. Island recomputation follows. There is no separate command list, no
subgraph shader, no impact spread, no chunk damage.

Gap. The structure of the pipeline is missing: commands are not materialised, so nothing can
inspect, cap, replicate or replay them, and damage never reaches chunks or subsupport actors.

Decision. Implement the three-step pipeline with explicit `FractureCommand` buffers (bond
commands and chunk commands, each with health delta), the radial, capsule, shear and impact-spread
shaders over the depth-1 graph, and a subgraph shader for free single-chunk actors. Secondary
fracture (today's `fractureFragmentAtImpact`, crater and chip logic) becomes the subgraph shader's
geometric output and is otherwise unchanged. The user's tweak, as in A2: a chunk that is damaged
hard but still supported is demoted to its children in place rather than detached, so the building
loses a member's worth of cells, not a member.

### A7. The stress solver

Reference. NvBlastExtStress runs on the support graph. Inputs: `addGravity`, `addForce` (external
impulse at a position on an actor), `addCentrifugalAcceleration`. Settings:
`maxSolverIterationsPerFrame` ("computation time is linearly proportional"),
`graphReductionLevel` (solve on a graph reduced by 2^N), and per-channel limits
`compressionElasticLimit`/`compressionFatalLimit`, `tensionElasticLimit`/`tensionFatalLimit`,
`shearElasticLimit`/`shearFatalLimit` ("below this ... no damage is done to bonds", "above this
... the bond is immediately broken"). Each frame: `update()`, then if
`getOverstressedBondCount() > 0` call `generateFractureCommands()` and apply them through A6.
Between the elastic and fatal limits a bond accumulates damage in proportion to its excess.
"It fully utilizes the fact that it knows the initial support graph structure and does a maximum
of processing in the create() call", and actor splits are synchronised internally.

Rupture today. `SupportPathModel` (support-path routing: potential from nearest support, loads
handed downhill by conductance, axial and shear checks, `damagePerSecond = 60`,
`capacityMargin = 2`). Earlier `EquilibriumSolver` (budgeted elastic PCG) still exists and is
used for display displacement. Landing impulses enter as contact wrenches amplified by
`IMPACT_PEAK_FACTOR = 8`. Overload is converted to damage per second, broken bonds split islands.

Gap. The shape matches Blast (gravity + impulses in, over-stressed bonds out, damage between
elastic and fatal). What differs: Rupture has no explicit elastic/fatal pair per channel (it has
one capacity and a margin), no graph reduction, and the solver runs on cells rather than members.
Bending is deliberately not estimated by the path model; The Finals does estimate it (B2).

Decision. Keep the support-path model as the cheap always-converged estimate, moved to the depth-1
graph. Expose Blast's six limits per material, derived from `tensionStrength`,
`compressionStrength`, `shearStrength` (elastic = strength / capacityMargin, fatal = strength ×
fatalFactor). Graph reduction is unnecessary once the graph is at member level; record that as the
reason, not as a skipped feature. The Finals' direct solver is row B2.

### A8. Debris and lifetime (Blast UE4 destructible settings)

Reference. `DebrisDepth` (chunks at or below this depth are debris), `DebrisMaxSize`,
`DebrisMaxSeparation`, `DebrisLifetimeMin`/`Max`, `ValidBounds`. Debris chunks have a lifetime and
are removed; everything shallower persists.

Rupture today. `DEBRIS_TIER` (volume under 0.05 m³ sinks after 8 s over 1 s, live cap 600),
`KILL_DEPTH`, `KILL_EXTENT`, baking resting rubble to fixed bodies.

Gap. Debris is defined by volume rather than depth. With A1 in place the natural definition is
depth: depth ≥ 3 (run-time sub-fracture) is debris, depth 2 cells persist and bake.

Decision. Debris = chunks at or below `debrisDepth` (3) or below `debrisMaxVolume`. Keep the
user's chosen lifetime and sink. Keep baking for persistent rubble; Blast has no equivalent, it is
the Finals-style "bake to static" from B5.

### A9. Joints (Blast Tk)

Reference. A bond flagged `BondJointed` creates an "internal joint" inside the actor; when a split
puts the two chunks in different actors the user gets `TkJointUpdateEvent::External` and is
expected to create a physics joint between the new bodies. External joints can also attach an
actor to the Newtonian reference frame. Joints are released when the user decides (on break).

Rupture today. None. A broken bond is a free body.

Gap. This is the Blast half of the Dynamism layer. See B3.

## Part B: The Finals (Embark, GDC 2024 and Dynamism)

### B1. Authoring: per-element chunking, connection generation, level tools

Reference. A Houdini "Building Creator" fractures a building per element type (foundation, floors,
roofs, exterior walls, windows, exterior trims) with wall thickness and floor height parameters.
Connections are generated between adjacent parts (a Voronoi-like graph across a wall face), and
parts standing on supportive ground are marked as supported. Level tools attach props (a balcony)
to a house and visualise all connections across a level.

Rupture today. `createDestructibleBoxes` takes axis-aligned boxes with a material and `anchored`,
cells them, and bonds adjacent cells. No element types, no connection visualisation beyond the
demo's bond overlay.

Decision. A1 gives the per-element hierarchy. Authoring boxes get an `element` kind (column, beam,
slab, wall, roof, trim, glass) which selects the depth-1 cut pattern and material defaults. A
"show connections" overlay in the demo is a presentation item, phase 4.

### B2. Structural analysis: sparse direct solver on the connection graph

Reference. "Embark rigid body solver: sparse direct solver using Cholesky decomposition" over the
connection graph. Forces on a connection between A and B are split into components:

    Tension/Compression = Normal(A,B) * Dot(F_l, Normal(A,B))
    Shearing            = F_l - Normal(A,B) * Dot(F_l, Normal(A,B))
    Bending             = F_a * C

and scored as

    size(TensionCompression * (IsTension(F_l) ? Material.TensionMult : Material.CompressionMult))
    + size(Shearing * Material.ShearingMult)
    + size(Bending * Material.BendingMult)

Break test ("the baseline"): `Impulse = CombineImpulse(ConstraintImpulse); if (Impulse > Baseline
+ BreakOffset) Break();` where the baseline is the static impulse the connection carries under
gravity alone. Sequential impulse solvers were rejected because they fail to converge on a lintel
(the slide shows the sequential solver leaving the middle connections unloaded); the direct solver
loads them correctly. Incremental Cholesky keeps the per-frame cost near 0.001 ms up to ~2,000
constraints. "Cutting corners": structure is only analysed for elements that matter (red/cyan
regions in the slide); the rest is simple.

Rupture today. Support-path routing (A7) plus `CutBondEquilibrium` (exact loads on bridge bonds)
and the older PCG elastic solve. Checks are axial and shear with friction. No bending term, no
baseline-plus-offset test, and the graph is cells, not members.

Gap. Bending and the baseline test. Both are cheap at member scale and both are the difference
between "the lintel holds then cracks in the middle" and "the lintel's cells peel off".

Decision. On the depth-1 graph (hundreds of nodes per building) implement the direct solve:
assemble the sparse stiffness system over connections, Cholesky-factor it on create (as Blast's
stress solver does its heavy work in `create`), refactor incrementally on bond removal, and score
each connection with the three-term formula above. Record each connection's static baseline after
the first solve; a connection breaks when its combined impulse exceeds baseline + offset, where
offset comes from the material's fatal limit. This replaces `SupportPathModel` as the failure
driver once it exists; the path model stays as the fallback rung if the direct solve is over
budget. Bending is included; the earlier Rupture decision to skip bending was a substitute and is
withdrawn.

### B3. Dynamism: dynamic connections

Reference (Embark's dynamism announcements, Season 8 onward). "With this new update, we're
dialing up the cascading damage that can occur when buildings or objects fall into others." Knock-on
effects and chain reactions. Structures bend, sag and hinge before they fail; roofs and floors tilt;
debris forms connected chains that slump under their own weight; collapsing buildings damage
neighbours; blasts throw roof sections. Smaller, consistent damaged-edge visuals; smoke and gas
blocked by intact walls.

Rupture today. Bond states intact → cracked → yielding → broken; broken is a free body. Landing
impulses are amplified and routed through the receiver's bonds (part of knock-on).

Gap. Nothing between rigid and free. This is Blast's A9 joint at Finals scale.

Decision. Add a `compliant` bond state entered when a depth-1 connection passes its elastic limit
but not its fatal limit. The two sides become separate actors (A4) and a Rapier joint is created
on the connection (A9's `BondJointed`): generic joint with linear and angular stiffness and damping
from the section and material, angular limits from the section's two moduli, break force and
torque from the remaining capacity. The joint's applied impulse feeds back into B2 as the
connection's measured impulse, so the baseline test still governs breaking. Adjacent compliant
connections on one interface are grouped into one joint. Un-bake on seam motion. This is phase 2
of the plan.

### B4. Replication

Reference. Server-authoritative; "Replicating transforms: large destruction event, avg ~400
kbits/s, eventually saturates the connection". Fix: quantise positions against the level bounds
(17 + 16 bits for an 800 × 400 range), delta-compress against the last acknowledged snapshot,
Glenn Fiedler's snapshot compression. "Peaks at ~175 kbits/s for destruction."

Rupture today. `packages/destruction-network` snapshot codecs, `destruction-server`. Commands are
replayable; transforms are sent as Float32.

Decision. Out of scope for phases 1 to 4. Noted so that A6's explicit fracture commands are
designed as the replicated unit (Blast and Embark both replicate commands and splits, not cell
transforms).

### B5. Performance: physics state of simulated debris

Reference. "Large stacks of simulated rigid bodies"; "platform crumbles into simulated debris".
Debris lifetimes; settled debris is made static; only elements that matter are analysed; the
constraint solver is incremental; a GPU transform pool renders "many, many parts" from one buffer
with per-mesh ranges and tombstoned slots.

Rupture today. Baking resting rubble to fixed bodies, debris tier with lifetime and cap, force
events, SIMD Rapier, 30/60 Hz worker, step budget ladder (sleep, bake, defer refinement, skip
sub-fracture), refine-where-seen.

Gap. The render side: Three.js instanced meshes exist but are rebuilt per island; Embark's pool
is one persistent transform buffer with ranges per mesh.

Decision. Keep everything in place. Treat the step budget as the safety net under A4 (fewer
bodies by construction), not as the primary mechanism. GPU transform pool is phase 4.

### B6. Presentation: lighting, edge meshes, VFX, movement

Reference. Damaged-edge meshes along fracture boundaries; dust and smoke from events; movement
through collapsing geometry.

Rupture today. `destruction-effects` emits events (heavy impact, blast, seam break candidates);
the renderer draws fracture surfaces with a distinct material.

Decision. Phase 4, unchanged from the plan.

## Part C: what Rupture keeps as its own tweaks

These are deliberate departures from the references, chosen by the user, not shortcuts:

1. **In-place demotion.** A damaged but still supported support chunk is replaced by its children
   in the standing structure (A2, A6). Blast only splits free actors. This produces "big chunks
   first, then smaller ones" inside a building.
2. **Debris sinks.** Small debris settles, waits ~8 s, sinks over ~1 s (A8). Blast and Embark
   remove on lifetime.
3. **Baking.** Persistent rubble bakes to fixed bodies and un-bakes on disturbance (B5).
4. **Real-time guarantee.** 30 Hz floor; a step budget ladder degrades fidelity, never rate.
5. **Rapier joints for Dynamism.** Embark's dynamic connections run inside their own solver; ours
   are Rapier joints fed back into the structural solve (B3).

## Part D: things that may not fit the browser, for the user to decide

- **Rapier joint impulse binding (A9/B3), resolved.** Upstream JavaScript/WASM 0.19.2
  exposes per-axis generic motors and limits but omits solved joint impulses. The local
  scalar and SIMD compatibility tarballs in `vendor/rapier` extend Rapier.js revision
  `f072e6efa75f4f61a290bd0b58b61c443685ec01` (v0.19.2), backed by Rapier Rust 0.30.1.
  The local fork commit is `1fa92269c0dc14e4dbe1d804f3854e20715de1fb`, preserved in
  `vendor/rapier/rupture-bindings.bundle`; its readable diff is `applied-impulses.patch`.
  `ImpulseJoint.appliedImpulses()` returns actual signed solver writeback for uncoupled
  linear X/Y/Z and angular X/Y/Z axes in the joint frame: locked-axis, enabled motor and
  enabled limit impulses. Separate `impulses()`, `motorImpulses()` and `limitImpulses()`
  accessors retain the native channels; no displacement-based estimate is substituted.
  `setFrameX1/2()` preserves distinct actor-local frames after splitting or rotation.
  `angularJacobian()` exposes Rapier's exact quaternion differential for locked and limit
  angular channels at the current world poses; motor angular channels use the first
  world joint frame. The reported impulse channels are the last internal substep's
  writeback. The physics adapter scales them by `stepDt / sampleDt` and passes the
  resulting whole-step impulse and `stepDt` to the graph's baseline test.
  Rebuild with `node vendor/rapier/build.mjs`, Rust 1.98.0 with the
  `wasm32-unknown-unknown` target, wasm-pack 0.15.0 and Node/npm. The patch and Cargo lock
  are committed beside the tarballs; npm build dependencies use the pinned upstream
  lock. Then run `corepack pnpm install --lockfile-only` to refresh tarball integrity hashes,
  followed by `npm ci` to replace installed bindings even when the upstream package version is unchanged.
  Shared-world `attach` hosts must supply this patched Rapier module for compliant seams.
  Hosts using per-body additional solver iterations supply the optional
  `jointImpulseSampleDt(joint)` callback with the final native substep interval;
  owned worlds use `timestep / numSolverIterations` with zero additional iterations.
- **Sparse direct Cholesky in TypeScript (B2).** Fine at hundreds of nodes per building. If a
  level has many buildings, each building is its own system and factors independently. If a
  building exceeds a few thousand connections, Blast's `graphReductionLevel` is the documented
  fallback. Decision needed only if a level breaks this assumption.
- **Houdini authoring (B1).** Not available; the per-element cut patterns are generated in
  `destruction-authoring` from the box's element kind. Same output shape (chunk tree + connections).
- **Server authority (B4).** Rupture has a server package but the demo runs the authority in a
  worker. Unchanged for now.

- **Support graph reduction (A7).** The large frame now starts with 432 depth-1 support nodes. Each rigid connected component is factored independently; no graph-reduction pass is needed at this member-level size. The support-path model remains the explicit over-budget fallback.
- **Full-collapse real-time budget (B5/C4), unresolved.** Runtime member demotion can expand
  the large frame into thousands of active cells. The phase-3 large-frame knee run on patched
  SIMD at 30 Hz measured fall p50 65.8 ms, p95 185.9 ms and maximum 214.6 ms after replacing
  repeated whole-asset section searches with indexed lookups. Sparse factor work is budgeted,
  and debris lifetime, baking and refinement deferral remain active, but the combined actor,
  contact and topology work still exceeds 33.3 ms during this collapse. The fixed timestep
  stays at 1/30 second; sustained wall-clock 30 Hz is not achieved by this run. No cheaper
  structural model has replaced the requested direct solve or native compliant connections.
- **A6 damage/demotion follow-up.** The initial correction required the support chunk centroid inside
  `minRadius`, with material thresholds (concrete 0.25); charge damage uses radius / 3.
  That correction passed only excess health damage to children and left exhausted leaves bonded.
  The patched SIMD large-frame knee run at 30 Hz kept 1,608 initial / 1,608 final bonds,
  with 0 final active bodies and fall p50 / p95 / max of 2.18 / 2.63 / 8.37 ms, but
  centroid drop was 0%: the collapse target remains unmet. These are standing-frame
  timings, not evidence of a real-time collapse. The knee charge is about 0.60 m from
  the 3.2 m column member's centroid, outside the 0.50 m inner radius; its outer-falloff
  bond damage does not sever the footing. The follow-up preserves the requested scope:
  no replacement distance metric, charge retuning, or rigid baseline/solver change.
- **A6 chunk bounds distance, user-directed follow-up.** Chunk health now samples distance
  to its local AABB in its current pose: inverse-transform the blast origin and clamp
  to the bounds, giving zero distance inside. Irregular cells use their local vertex
  bounds; excess damage to descendants uses the source chunk's current rotation.
  Capsule chunk damage measures segment-to-box distance. Bond centroid sampling,
  radius / 3, material thresholds, excess-only propagation and B2 remain unchanged.
  Patched SIMD large-frame knee at 30 Hz: 1,608 initial / 2,113 final bonds, 0 final
  active bodies, fall p50 / p95 / max 2.51 / 2.97 / 11.90 ms, centroid drop -0.16%.
  Local demotion now occurs, but the 40% collapse target remains unmet; these timings
  do not establish the performance of a successful collapse.
- **A6 same-event replay and dead leaves, user-directed follow-up.** Each demotion replays
  accepted damage programs over newly exposed graph topology before marking the event seen.
  Child health retains per-program excess-only accounting; inherited interfaces credit the
  same event's existing dose, while new internal bonds receive the shader's local damage.
  Scratch child poses keep replay in world space, and the complete demotion list reaches
  physics. Exhausted leaves again break their incident bonds once their adjacency exists.
  Patched SIMD large-frame knee at 30 Hz: 1,608 initial / 12,350 final bonds, 24 final
  active bodies, fall p50 / p95 / max 26.08 / 68.23 / 103.29 ms, centroid drop 85.29%.
  The p50 and collapse targets are met; bond growth still exceeds the requested few thousand,
  and 306 of 750 fall steps exceeded 33 ms. Material health, thresholds, radius / 3,
  the direct solver and rigid baseline test are unchanged.
- **Collapse tail follow-up (A4/B2/B5/phase 3).** Benchmark-local exclusive timers now
  separate structural solve, fracture/demotion, Rapier, contacts, baking and frame work.
  Landing contact impulses already reach `addForce`; removing their duplicate damage
  programs stops collapse-time member demotion. Free-actor demotion retains a complete
  visible parent and its existing body/collider until an actual split. Component solutions
  now reuse unchanged balanced loads, while symbolic and numeric Cholesky work resumes
  across the existing budget ladder (6/6/6/4/2 ms factor deadlines). Material thresholds,
  rigid baseline tests and the structural model are unchanged.
  Two plain patched-SIMD large-frame knee runs at 30 Hz finish with 1,608 -> 2,113 bonds
  and 15 active bodies. Fall p50/p95/max: 3.54/12.34/46.78 ms and 3.73/12.86/46.09 ms.
  Both reach 75.37% final centroid drop: the frame falls to 1.58 m, then rebounds late
  after further bond splits and debris wake-up. A diagnostic trace run reaches 88.15%
  drop at 4.57/15.99/57.71 ms with 5 active bodies. The p95 target is met; consistent
  80% final drop remains unresolved. No stale factor or retained-collider overlap was
  found in source review. Step 5's conditional demotion cap is not engaged because
  fall p95 is already below 33 ms. Detonation remains a separate spike (142 ms maximum).
- **Physics energy audit (A4/A9/B3/B5), user-directed follow-up.** The benchmark now
  records dynamic linear/angular KE, gravity conversion, contact penetration and pairs,
  native joint impulses, pressure input, inherited motion, mass and CCD per step. The
  original final detonation jumped from 4.6 kJ to 1.387 GJ inside Rapier with zero joints;
  coincident sibling collision proxies produced a reported 2.567 m penetration. Inward
  convex faces and inherited parent collision envelopes reduced that step to 0.261 MJ
  and 0.013 m penetration. Collision geometry keeps authored mass, COM and inertia.
  Pressure launches now share the existing 12 m/s impulse-delta, 20 m/s linear and
  30 rad/s spin limits. Collider edits refresh mass before impulses and preserve the
  rigid velocity field as COM moves; the benchmark has found no >5% mass mismatch.
  Compliant ForceBased motors now use each native axis's inverse effective mass
  `J M^-1 J^T`, including anchor lever arms and locked axes. Clamp
  `k <= m_eff * (2*pi/(5*solverDt))^2`; clamped axes use critical damping
  `c = 2*sqrt(k*m_eff)`. At 30 Hz and six native substeps this is a 36 Hz ceiling;
  the measured authored maximum was 767.11 Hz. Reconfigure after all bake/wake
  transitions each step. The authored B2 stiffness, baseline and impulse allocation
  remain unchanged. Positive KE residuals are audit flags: gravity, topology transport,
  stored spring energy and numerical/contact correction must be distinguished.
- **A6 maximum-charge audit.** Placement now preserves an explicit `minRadius`; a
  radius-9/core-4 charge previously reached the graph with a 3 m core. Same-event
  replay credits damage spent on each child itself, rather than suppressing all
  descendants of a damaged parent. Excess-only continuation and material thresholds
  stay unchanged. At a ground-storey column face on the large frame, strength 10
  kills all 3 core members and all 23 newly exposed core cells; all 36 core bonds
  break. All 34 exterior cells and their 70 mutual bonds survive. Full IDs and
  descriptors are retained in the benchmark's `chargeAudit` output.
  Fast rubble above 8 m/s now keeps full CCD at every budget rung; the knee audit
  finds no unprotected fast bodies or dynamic mass errors above 5%. With collider
  energy injection removed, the frame mostly stands: the latest knee is
  1,608 -> 2,113 bonds, 17 final active bodies, fall 4.28/15.31/29.18 ms,
  and 5.47% centroid drop. The former collapse target is not met by this result.
- **Compliant contact audit (A9/B3).** Rapier's `contactsEnabled=false` suppresses
  every collider pair between the joint's actors. Compliant seams now keep contacts
  enabled so unrelated compound geometry cannot pass through while connected and
  reveal overlap when the joint breaks. With inset proxies, fracture faces retain
  clearance. The patched-SIMD knee reaches 4.740 MJ peak KE and ends at 432 J;
  brief contact-recovery gains remain observable, rather than being hidden by a
  global energy clamp. Its 2.94% centroid drop still misses the collapse target.
- **Baking support geometry audit (A8/B5).** A bounding sphere previously counted
  wide first-storey slabs as grounded while their lower faces were metres above the
  floor, and broad AABB candidates could establish support dependencies. Grounding
  and dependencies now require a native bearing contact within both contact skins
  plus Rapier's existing allowed linear error. Wake dependencies, settlement times
  and budget rungs are unchanged. The knee is 1,608 -> 2,113 bonds, 26 active bodies,
  fall 5.30/18.48/32.60 ms, 4.72% centroid drop; peak KE is 6.617 MJ and final KE
  356 J. Correcting the geometry predicate alone does not meet the 80% drop target.
- **Landing load retention (A7/B2/phase 3).** A budget-deferred factorization previously
  cleared its `addForce` queue, and an unfinished component suppressed fracture commands
  from other completed components. Contact capture also ran after settlement. Capture now
  precedes baking; positive native predictive-contact impulses are retained. Each deferred
  30 Hz sample keeps its original impulse, application point, ambient RHS and timestep;
  completed components fracture independently. Samples are never added across steps, and
  free actors use the balanced direct RHS. Historical scores do not overwrite current
  reactions. The benchmark separately records first touch, the complete landing episode,
  per-sample solves and actual breaks in normalized trace tables.
  In the patched-SIMD knee, the 4,638 t free actor first touches at tick 95: 1,322.15 N s
  reaches `addForce` unchanged. Its principal deceleration at tick 98 carries 6.388 MN s
  of native normal impulse. The first completed 1,612-bond solve at tick 108 evaluates
  that step's later landing pulse at 1,240.88x utilization and breaks 1,544 bonds;
  the tiny first-touch sample has no surviving connected graph to evaluate afterward.
  The knee finishes with 1,608 -> 2,113 bonds, 1 active body, fall p50/p95/max
  3.81/8.33/37.97 ms, 45.76% centroid drop, 34.54% live mass below one storey,
  and 65.845 MJ peak KE after the final detonation. The centroid gate is not reached.
  Materials, existing baselines, offsets, charge sizes and the knee protocol are unchanged.
- **Bearing reanchoring WIP (A3/A7/B2/B5), priority handoff.** Runtime bearing patches
  can now create unloaded world bonds, retain current actor poses, solve self-weight,
  transfer ambient reactions to the real supporting chunks, and unbake failed supports.
  Native landing samples retain separate timesteps, including standalone-piece families.
  Existing authored baselines and material values remain unchanged. This work is gated by
  `experimentalBearingReanchor: true`; the default retains the previous baking path.
  The enabled large-frame knee exhausted Node's 4 GB heap before producing a final table;
  it is not validated and must remain disabled. The priority changed to the user's delayed
  failure replay, so the pancake analysis is deferred. The default-off integration passes
  typecheck. Support contact enumeration also skips native pairs whose collider was removed
  earlier in the same step, preventing the observed null-`isEnabled` crash.
- **Visual-only debris retirement (A8/B5), `feel-good-1`.** The supplied replay exposed
  retirement targets descending from upper storeys to below world zero over one second.
  A disabled collider was insufficient isolation: in the pinned Rapier core, moved
  colliders can enter the broad phase, and position-based kinematic velocities are
  derived from the next target, including a growing target gap after CCD clamping.
  Retirement now immediately removes the actual native body, every attached collider
  and joint, and all live ownership mappings. Stored visual poses shrink in place at
  elevation; only a near-terrain visual can descend, bounded by its own height. The
  eight-second settled lifetime, one-second visual interval and live-cap ordering stay
  unchanged. Scale interpolates at display rate. Removed contact endpoints are ignored.
  The full instrumented user replay through tick 1,618 removes 361 bodies and 361
  colliders, with zero later contact events from them, zero mass errors and no crash.
  This fixes retirement, but does not yet pass the entire energy acceptance: that run
  still reaches 55.11 m/s from later contacts; the supplied lighter runner reaches
  101.2 m/s. Wall-clock budget decisions still change physical outcomes between runs.
  Counted-work determinism and the remaining contact-energy source are subsequent
  fixes. The user reviewed this retirement state as having good crumble behavior;
  preserve its local `feel-good-1` reference and explicitly disclose later feel changes.
- **Contact warmstart after baking (A8/B5), delayed-failure follow-up.** The retirement
  fix exposed a second source: a 536.7 kg fixed fragment woke at zero velocity, then
  gained 1.285 MJ against an 85.3 t neighbour moving at 0.009 m/s, without a joint or
  blast input. Rapier 0.30.1 preserves contact warmstart values across body-type changes
  and applies them with the new inverse mass. The old support reaction therefore
  remains cached when an effectively infinite-mass support becomes light dynamic rubble.
  All three bake/wake transitions now queue a reset, flushed outside native manifold
  callbacks before stepping. Ordinary sleep/wake, geometry, material limits and solver
  coefficients are unchanged. This intentionally changes the crumble by removing
  wake-up launches and the impact loads they would have generated; `feel-good-1` remains
  the user-reviewed comparison point.
  The `.3` scalar/SIMD tarballs add `NarrowPhase.resetContactWarmstart(collider)`.
  Fork `1aa7b55e4dff84582335d20c8939b3c1db83c756`, bundle and readable binding patch
  are pinned in `vendor/rapier`. A pristine Rapier 0.30.1 core archive (SHA-256
  `5bd27b8eb36d0833fa0f2aea40164fabfad0fc34b9932286ae9e84f3452f5364`) plus
  `contact-warmstart.patch` supplies safe mutable contact access without modifying the
  Cargo registry. `node vendor/rapier/build.mjs` extracts, verifies and patches that
  local core and builds both flavours with the committed lock. Only cached normal,
  tangent and twist impulses are reset; completed-step impulse totals, geometry and
  contact-newness/restitution state are preserved. Shared-world hosts need the same build.
  The full SIMD user replay reaches tick 1,618 without a crash: maximum post-396
  speed 14.68 m/s, peak KE 1.750 MJ, no retired contacts or mass errors. Its largest
  positive KE-minus-gravity residual is 1.15 kJ; every residual is below the reported
  full-step gravity-integration scale, not an assertion of exact monotone energy.
  Phase-labeled contact samples now distinguish previous-step writeback from current
  native events. The near-face one-second speed increase is downward gravitational
  acceleration; the large fracture wave is a completed deferred B2 impact evaluation
  (sample 2, 15.22 kN s, 1,478 bonds, 123.75x maximum utilization, 1,203 breaks).
  It emits bond commands only. Wall-clock scheduling still changes its completion tick;
  deterministic work admission is the next separate change.
- **Deterministic work admission (B2/B5), replay follow-up.** Sparse preparation,
  numeric refactoring, triangular solves and connection scoring now consume counted
  integer work; unfinished factors and individual landing samples retain their exact
  continuation state. The step ladder uses executed work and native body/collider,
  joint-row and contact-row counts. Measured milliseconds remain telemetry only,
  including host-reported step cost. The default-off bearing solver shares the
  remaining quota instead of a clock deadline. Unserved work is queue telemetry,
  not spent work: charging it to the ladder would repeatedly lower the quota and
  starve the same retained landing samples.
  A separate timed patched-SIMD near-face run measured 36,923 symbolic operations,
  192,212 numeric operations and 25,235 native rows per millisecond. Fixed rounded-down
  conversions are 36,000 / 190,000 / 25,000; runtime never learns them from timing.
  The existing 6/6/6/4/2 nominal-ms structural rungs and ladder hysteresis remain.
  Creation remains unbudgeted, unchanged components reuse exact factors/RHS results,
  and an admitted triangular solve plus its first retained impact completes atomically.
  This intentionally changes crumble timing and collapse extent versus `feel-good-1`:
  landing samples receive prompt, repeatable service instead of host-dependent delays.
  Geometry, material limits, baselines, offsets, charges and timestep are unchanged.
  Two complete instrumented user replays through tick 1,618 have byte-identical
  per-step physical fingerprints. Two runs of the supplied `/tmp/replay-run.mts` also
  match after removing only printed step timings. Post-396 maximum speed is 15.353 m/s, peak KE
  after the blast is 4.695 MJ, and 87 retired bodies/colliders produce zero later
  contact events; there are no mass errors or crashes. There are 670 raw KE-gain
  steps and 393 positive gravity-adjusted residual flags, with a maximum residual
  of 2.910 kJ. All are inside Rapier; 382 include joint-connected bodies among
  the top three gains. The largest occurs at tick 1,084 on bodies moving only
  0.14-0.48 m/s, without a blast or body-type transition. The reported full-step
  gravity-integration scale is not an error bound; spring storage and contact
  correction are unaccounted terms. Strict monotone-KE acceptance remains unproven,
  although retirement contacts and the high-speed runaway are gone.
  The 30 Hz SIMD knee finishes at 1,608 -> 2,113 bonds, one active body, fall
  3.90/19.43/111.05 ms, 81.44% centroid drop, centroid below one storey at 4.2 s,
  64.71% live mass below one storey and 176.845 MJ peak KE after the last detonation.
  There are 370 raw KE-gain steps and 238 positive gravity-adjusted residual flags
  in that knee. Bearing reanchoring remains opt-in WIP; no material retuning was used.
- **Bearing reanchoring completion (A3/A7/B2/B5).** Reanchoring now runs by default;
  the existing `experimentalBearingReanchor: false` option retains legacy baking for
  comparison. A bake captures native bearing polygons, creates world bonds with
  unloaded birth baselines, and waits for a completed, surviving direct solve before
  making the actor fixed. Static reactions load the real supporting pieces; failed
  world bonds unbake their owners and dependents. Authored baselines and materials
  are unchanged. This changes crumble behavior versus `feel-good-1`: settled rubble
  remains structurally solvable instead of becoming a permanent rigid support.
  Released runtime contact slots are reused only after their fracture notifications
  drain. Fresh generation IDs prevent stale owners from releasing replacement
  contacts; only factors owning the replaced connection are invalidated. Deferred
  impulse samples remain intact. Failure latches follow body lifetimes. The landing
  audit shares immutable inputs and references deferred visits instead of copying
  the entire backlog. Reports stream through a 64 KiB buffer rather than building
  a report-sized string.
  The enabled knee exposed a valid contact patch on piece 9814 with area
  1.43835e-9 m² and weak section inertia 6.46829e-27 m⁴. Its weak bending stiffness
  was 2.12938e-16 against translational stiffness 47.3508; COM-frame assembly lost
  that mode and produced a negative Cholesky pivot. Singleton, one-world-bond
  factors now use the exact interface-coordinate congruence of the same six-channel
  stiffness matrix. The diagonal stiffness still uses Cholesky; reciprocal basis
  transforms preserve the supplied tangents and actions are recovered in interface
  coordinates. Current, ambient, historical and cached solves retain separate
  actions. No artificial stiffness, contact-area cutoff or capacity retuning is used.
  The successful default-on SIMD/30 Hz knee finishes at 1,608 -> 2,232 bonds,
  410 active bodies, fall 28.75/43.37/101.56 ms, 84.84% centroid drop, centroid
  below one storey at 3.9 s, 77.88% live mass below one storey and 167.754 MJ
  peak KE after the last detonation. There are 348 raw energy-gain steps, 225
  positive gravity-adjusted flags and zero mass mismatches. The 33 ms p95 target
  is missed; structural graph bookkeeping contributes 42.1% of the slowest steps.
  Of 4,753 captured supports, 3,227 bake admissions complete; 2,478 subsequent
  failures occur on previously baked supports. Fixed rubble therefore re-enters
  the solve and can unbake. Memory samples stay below 1.31 GB through the full knee,
  and the complete 548 MB diagnostic report writes successfully without a giant string.
- **Pancake observation (monolith item 3, no physics change).** In the completed
  reanchored knee, the 4,637,928 kg free actor first touches at tick 95; its peak
  initial contact impulse is 3.190374 MN s at tick 104. Tick 105's sample 11 solves
  1,612 bonds at 33.7575x maximum utilization and breaks 1,134, distributed across
  original storeys 0-7 as 124/148/146/149/148/143/140/136. The initial landing thus
  fragments all eight levels before the later layered descent; this is not a clean
  one-storey-at-a-time fracture sequence. Subsequent contact-height bands 1/2/3/5/6/7
  include samples at ticks 108/109/112/114/115/116 with 210.732/28.813/603.874/34.092/
  3.855/11.664 kN s, maximum utilization 1.5968/5.1366/13.4485/1.9338/4.5034/5.2286,
  and 5/7/8/6/6/6 bond breaks. These are measured contact heights, not complete
  source-storey-to-receiver-storey lineage.
  At +2 s the original-storey centroids are 0.77/1.79/4.16/7.50/11.29/15.02/18.73/
  22.58 m; at +4 s, 0.62/1.20/1.71/2.55/3.50/4.48/5.54/7.18 m; at +25 s,
  0.62/1.11/1.55/2.09/2.68/3.08/3.48/3.78 m. The global centroid gate passes,
  although the top-storey centroid remains above 3.5 m. Previously baked failures
  affect 161 distinct bodies. For example, the 706.33 kg support 3 bakes at 106,
  fails at 108 at 1.36284x, breaks its world bond and is dynamic that tick; support 4
  (797.25 kg) bakes at 107 and fails at 120 at 21.9984x. Repeated rebaking remains
  substantial. This trace justifies no material, baseline, offset or charge retuning.
- **Bearing handle retirement guards (A3/A7/B5).** Native contact and broadphase
  callbacks can deliver a removed collider as null; collider parent wrappers can
  remain after their native body is removed. Validate both before pose, skin, body
  type or handle reads, including grounding/supporter sorts, capture, deferred
  admission, reaction transfer and wake callbacks. Missing references log once per
  wrapper/context and invalidate or release the affected support through its existing
  lifecycle. Legitimate parentless terrain stays eligible for bearing. Secondary
  family lookups also tolerate retirement. No blanket exception handler is added.
  The supplied user replay reaches tick 1,618 without throwing and actually exercises
  a null wake-contact callback. Maximum post-396 speed is 15.081 m/s, peak KE after
  detonation is 4.695 MJ, and 60 retired bodies/colliders have zero later contacts.
  There are zero mass mismatches, 639 raw KE-gain steps and 508 positive
  gravity-adjusted flags (maximum 12.064 kJ); strict monotone KE is not established.
  No intended change to crumble on valid handles. The play-specific freeze was later
  attributed to the demo's stale `rupture.2` vendor copy, which lacked
  `resetContactWarmstart`; updating the demo to `rupture.3` closed it. Any future
  vendor-tarball update must be named in the commit subject so the demo can resync.
  The guarded SIMD/30 Hz knee completes at 1,608 -> 2,232 bonds, 410 active bodies,
  fall 26.54/34.46/69.96 ms, 84.84% centroid drop, centroid below one storey at
  3.9 s and 77.88% live mass below one storey. Peak KE is 167.754 MJ after the last
  charge; 347 later steps gain raw KE and 225 have positive gravity-adjusted flags.
  These physical results match the pre-guard knee; p95 remains over 33 ms.
- **World-rooted tree conditioning (B2).** The pressure-candidate knee exposed the
  same cancellation on two connected pieces: internal stiffness 9.34296e9, bearing
  area 1.15840e-9 m² and weak bending stiffness 2.23860e-15. The COM matrix produced
  a -2.84989e-15 scaled pivot. Extend the exact interface-coordinate congruence from
  singleton supports to connected trees with one world edge. Reverse traversal
  transforms complete subtree wrenches, including moments; forward traversal
  reconstructs motion. Cholesky still factors every original channel stiffness,
  and reactions come directly from its solved channel action. Cycles and multiple
  world supports retain the general sparse factor. No regularization, contact-area
  cutoff, material or capacity change. Deterministic work counts include these
  transforms. This can change crumble timing versus `feel-good-1` through preserved
  weak modes and changed counted work; it is not a retuning of the structural model.
  The SIMD/30 Hz knee retains 1,608 -> 2,232 bonds, 410 active bodies, 84.84%
  centroid drop, the 3.9 s storey gate and 77.88% live mass below one storey.
  Fall timing is 26.50/36.18/66.72 ms. Peak post-charge KE remains 167.754 MJ,
  with 347 later raw gain steps, 225 positive gravity-adjusted flags and no mass errors.
- **Pressure launch falloff and mass cap (B6).** Full pressure remains inside the
  descriptor's core. Outside it, use the normalized inverse-square profile
  `((minRadius/r)^2 - (minRadius/radius)^2) / (1 - (minRadius/radius)^2)` so pressure
  reaches zero continuously at the outer radius. Exposure, incidence, occlusion and
  the 1,000 N s pressure constant are unchanged. Pressure-added velocity is capped
  at `20 * min(1, 300/m)` m/s. Capture the destroyed member's pre-demotion mass;
  use the larger of that and the receiving actor's mass so smaller descendants
  cannot buy a faster launch. Preserve this limit through same-event secondary
  fracture, including angular velocity at child COMs and COM changes after mass
  recomputation. Existing motion keeps its own limits. This intentionally changes
  crumble appearance versus `feel-good-1`: heavy members and slabs launch less
  forcefully. Damage shaders, thresholds, materials, baselines and charge sizes
  are unchanged. Simulation and physics-operations version 32.
  Final-source SIMD strikes use the supplied repro's 60 Hz/480-post-hit-step
  protocol. Centre (0.5,11.5,0.5), direction (0.6,-0.7,0.35): zero bodies over
  8 m/s on launch; fastest 2.249 m/s at 536.446 kg; launch-step peak KE 22.249 kJ.
  Near face (0.5,9.5,-8.9), direction (0.3,-0.9,0.3): zero over 8 m/s; fastest
  2.349 m/s at 144.328 kg; launch-step peak KE 6.000 kJ. Over the full runs,
  post-blast KE peaks are 4.080/4.550 MJ, with 254/248 raw gain steps and 112/134
  positive gravity-adjusted flags. Neither run crashes or has mass errors or
  post-calm speeds over 20 m/s; strict monotone KE remains unproven.
  The final SIMD/30 Hz knee completes at 1,608 -> 2,224 bonds, 441 active bodies,
  fall 28.53/39.81/243.30 ms, 84.83% centroid drop, the storey gate at 3.7 s and
  74.81% live mass below one storey. Peak post-charge KE is 158.128 MJ, with 342
  later raw gain steps, 213 positive gravity-adjusted flags and zero mass errors.
  P95 still misses 33 ms; native contact motion later reaches 29.53 m/s in the knee.
- **Reanchoring topology cost (B2/B5).** The instrumented `f4345e1` knee attributes
  8.77 ms median and 12.81 ms p95 to bearing topology updates: each insertion batch
  constructed a new entire graph, rebuilt every section and hierarchy buffer, and
  rebuilt connectivity twice. It also records 3,056 real fixed-to-dynamic transitions,
  3,375 bakes and 4,026 bearing failures. Main/secondary reanchored solution-cache
  hits are 83.29%/80.52%; this is not a failure to reuse an unchanged factor.
  Contact insertion now updates only changed slots, grows bond buffers only when
  appending, preserves chunk state and component factors, and rebuilds ordered CSR
  and connectivity once. A freshly built external-load snapshot is marked current
  instead of being rebuilt again at solve entry. No intended crumble change, no
  material or bearing-policy change, and no new vendor tarball.
  The SIMD/30 Hz knee improves from 29.09/38.27/67.23 to 19.75/26.13/57.96 ms
  p50/p95/max. Bearing topology falls from 8.77 to 1.06 ms median. Physical outputs
  match: 1,608 -> 2,224 bonds, 441 active, 84.83% centroid drop, gate 3.7 s,
  74.81% live mass below one storey and 158.128 MJ peak post-charge KE. Active
  counts at 5/10/15/20/25 s remain 527/528/441/457/441; cache and lifecycle counts
  are unchanged. The p95 gate passes, but median and resting-body goals remain.
- **Behavior lock and FPS-only work.** User direction freezes simulation behavior at
  local tag `behaviour-lock-1` (`f4345e1`). The later passive-ground and fixed-velocity
  changes are removed, and the queued retry/budget-policy changes are cancelled.
  Only the in-place bearing-storage optimization from `5eb1685` remains. Every later
  optimization must match broken-bond counts and all centroid fields at every tick
  of both the large knee and user replay 2 through tick 1,618; timers/version labels
  are excluded. The replay retains the recorded/default 60 Hz protocol; the knee is
  patched SIMD at 30 Hz. Comparison uses `timings.steps` and `landings.steps` in the
  knee artifact, and a checkout-selectable replay trace with explicit completion.
  Restored source matches the lock exactly on all 844 knee ticks and 1,618 replay
  ticks, including supplementary total-bond and active/sleeping/settled counts.
  Knee fall p50/p95/max is 16.37/23.36/72.30 ms, with unchanged 1,608 -> 2,224
  bonds, 441 active, 84.83% drop, 3.7 s storey gate and 74.81% live below storey.
  The replay ends with 2,969 broken bonds and centroid 14.75577810511212 m.
  The median target remains unmet; subsequent work removes repeated computation
  without changing solves, scheduling, work counts, motion, fractures or lifetimes.
- **Exact component topology reuse (B2, behavior locked).** Cache the direct
  solver's component descriptions only while all state/active bytes, fallback
  anchor flags and connection definitions match. Return a fresh outer list before
  impulse-priority sorting; factors retain independent mutable state. Numerical
  arithmetic, charged work, scheduling and all simulation decisions are unchanged.
  Both lock comparisons pass with zero differences: knee 844 ticks, replay 2
  through tick 1,618, including supplementary body/bond counts. Knee fall timing
  is 19.24/27.42/61.65 ms; B2 median is 2.68 ms. This run is slower than the
  preceding 16.37 ms median run and slightly below the earlier 19.75 ms in-place
  graph run; a substantial timing gain is not established by this small cache.
  The p50 goal remains unmet. Physical results retain the locked 84.83% drop,
  3.7 s gate, 74.81% live below storey and 441 final active bodies.
- **GPU transform storage (B5).** WebGL2 carries the shared transform pool in one persistent
  RGBA32F matrix texture. Primary chunks, runtime pieces and fracture-edge batches address
  its per-actor ranges through GPU draw indirection; released slots are tombstoned and reused.
  Geometry batches can grow independently without replacing the shared transform storage.

## Order of work

1. A1, A2, A3, A4, A5: the chunk hierarchy, member-level support graph, world bonds, actors with
   visible-chunk lists, chunk health. The demo must show the large frame with columns, beams and
   slabs as depth-1 chunks, cells as depth-2.
2. A6: explicit fracture commands, the shader set, apply, split, in-place demotion.
3. B2: direct structural solve with bending and the baseline test on the depth-1 graph.
4. A9 + B3: compliant connections (Dynamism).
5. A8, B5: debris by depth, keep the budget and baking as the safety net.
6. B1 overlay, B6, GPU transform pool: presentation.

The existing plan's phases map onto this as: phase 1 (done) = C4; phase 2 = steps 1 to 4; phase 3 =
knock-on and pressure, which falls out of B2 + B3 with impulses from landings and blasts fed into
`addForce`; phase 4 = step 6.
