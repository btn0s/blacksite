# Cascade

## Walk mode

`@blacksite/cascade/walk-client` gives a game an on-foot mode inside a destructible structure. Its default bindings: WASD to move, Shift to sprint, C or Ctrl to crouch, Space to jump, R to respawn, and 1–4 or the mouse wheel to select explosive, cannonball, sledge, or cutter. Click to use the selected tool. The sledge lands 300 ms into a 680 ms swing; holding the button chains swings. Hold right mouse to look when pointer lock is unavailable. `Tab` toggles walk mode on and off.

Games can import `CascadeWalkClient`, `walkInput`, `StrikeClock`, and `WALK_TOOLS` from `@blacksite/cascade/walk-client`. Pass an adapter for the `CascadeSession` methods `setPlayerEnabled`, `playerInput`, `playerAction`, and `respawnPlayer`; construct the controller with a canvas and call `dispose()` on teardown. Render each frame's `player.eye` with the controller's `yaw` and `pitch`. The worker owns player collision, movement, target queries, and tool action acceptance; the client owns input and presentation.

CASCADE's structural destruction engine, ported from the destruction physics lab into a source-exported Blacksite package. It includes the original bond graph, force/moment equilibrium and stress solvers, convex Voronoi fracture authoring, detached Rapier islands, bounded secondary fracture, ordnance, Three.js rendering, Koota presentation data, XState lifecycle, Effect worker supervision, snapshot codecs and standalone replay.

Consume Blacksite as one recursive Git submodule. List `vendor/blacksite/packages/cascade` in the game's pnpm workspace and declare `@blacksite/cascade: workspace:*`. Import the source export from `@blacksite/cascade`. Games use stock Rapier; Blacksite's patched Rapier tarballs are retained for Cascade development and tests.

The [historical consolidation backlog](./archive/rupture-consolidation.md) records building-scale solver findings
and authoring port candidates from the CASCADE game.

## Author a structure

```ts
import {
  createDestructibleBoxes,
  DestructionSimulation,
  DestructionRenderer,
} from '@blacksite/cascade';

const { manifest, fragmentSource } = createDestructibleBoxes([
  { id: 'wall', min: [-2, 0, -0.2], max: [2, 3, 0.2], material: 0, anchored: true },
], { id: 'courtyard', cellSize: 0.75, maxFragments: 1024 });

const simulation = await DestructionSimulation.create(manifest);
const renderer = new DestructionRenderer(manifest);
scene.add(renderer.group);

// In the host's fixed-step loop:
const frame = simulation.step();
renderer.update(frame);

// On teardown:
renderer.dispose();
simulation.dispose();
```

`fragmentSource` maps stable primary fragment IDs back to authored box IDs. `anchored` fixes only the bottom seed layer. Unsupported boxes are allowed and fall naturally. Omit `cellSize` to adapt resolution deterministically to `maxFragments`; an explicitly requested resolution that exceeds the budget fails visibly. Materials 0–4 preserve the lab's concrete, terracotta, frame and glass presets; 5 and 6 add timber and steel game presets. Supply your own materials with the `materials` option. These parameters model game behavior, not engineering-certified structural analysis.

`fractureBoxMembers` exposes the original organic authoring API for explicit seeds. `validateManifest` and `assertManifest` validate imported manifests; pass `{ requireSupported: false }` to accept initially unsupported structures. Authored fragments support arbitrary convex meshes; the convenience box author currently accepts axis-aligned boxes.

## Attach to an existing Rapier world

Use one physics authority when the host already owns movement, weapons or ALS:

```ts
import RAPIER from '@dimforge/rapier3d-compat';
import { DestructionSimulation } from '@blacksite/cascade';

// RAPIER and world have already been initialized by the host.
const destruction = DestructionSimulation.attach(manifest, { rapier: RAPIER, world });

// Each fixed tick, around the host's existing single world.step call:
destruction.beforePhysicsStep();
world.step(eventQueue);
eventQueue.drainContactForceEvents(event => {
  destruction.recordContactForce(event);
  // Forward to the host's other contact consumers here too.
});
const frame = destruction.afterPhysicsStep();
```

The current solver uses a fixed 60 Hz tick; `attach` rejects a host world with a different timestep. Attached mode creates no ground, player, worker, timer or second physics world. It never steps or frees the host world. `dispose()` removes only destruction-owned bodies and colliders. Call `recordContactForce` while the event is valid; Rapier's queue is destructive, so drain it once and forward events to all consumers. Use the same installed Rapier module as the host; both 0.19.2 and 0.21 are tested, including their different contact-force accumulator behavior.

Replace the original intact colliders and meshes for authored destructible pieces; otherwise duplicate walls will block the opening. Leave non-destructible geometry in the host world. For a native trace or swept projectile hit:

```ts
destruction.recordImpact({
  colliderHandle: hit.collider.handle,
  position: [hit.point.x, hit.point.y, hit.point.z],
  direction: [direction.x, direction.y, direction.z],
  energy: projectileEnergyJoules,
  impulse: [momentum.x, momentum.y, momentum.z],
  radius: projectileRadius,
});
```

The engine identifies the struck fragment, applies localized structural damage and preserves native momentum. Keep the host's normal collision, ammunition, character damage, recoil and firing rules. `fragmentForCollider(handle)` identifies destruction colliders for host collision filtering. Dynamic rubble remains real physics geometry.

`collisionGeometry()` returns surviving static/supported and settled fragment triangles, cached by its returned `version`. Feed that version into Warden's geometry rebake/invalidation adapter. Airborne rubble does not trigger a navmesh bake every frame. `{ includeDynamic: true }` includes moving geometry for other spatial consumers. `topologyVersion` identifies collider topology changes; `geometryVersion` also includes moving geometry for rendering. Do not continue querying the original intact piece bounds for visibility, acoustics or camera collision.

## Bullet impacts and secondary pieces

Point impacts on brittle masonry-like materials (names matching concrete, reinforced frame, masonry, brick or terracotta, brittleness of at least 0.35 and command strength of at least 0.25) knock real convex chunks out of the struck fragment instead of only damaging the bond graph. Everything below is deterministic for a given manifest and command stream.

**Crater model.** The crater is cut on the face the shot enters, as a flat-floored frustum: four seeded lateral planes that meet at an apex three crater depths along the crater axis, and a floor plane at the crater depth. The opening is centred on the struck point, snapped onto the entered face.

- *Axis.* On an exterior face, and on a fracture face (crater wall, crater floor or inner fracture face) whose inward normal is within about 25° of the shot (cosine at least 0.9), the axis is the face's inward normal. On a steeper fracture face, such as the sloped wall of an earlier crater, the axis is the bisector of the inward normal and the shot direction, so the hit digs along the open bullet path instead of sideways into the wall.
- *Depth.* The depth scales with the angle of incidence: it is multiplied by `max(cos θ, 0.35)`, where θ is the angle between the shot and the face's inward normal, and the opening shrinks with the square root of the same factor. A grazing skim removes much less material than a head-on hit.
- *Repeat hits.* On a fracture face, the opening half-width is clamped to fit inside that face, so repeat hits drill within the previous recess and never undercut overhanging material. The depth is also capped at 1.25 times the clamped opening half-width. Repeat hits on the same spot widen and roughen the recess rather than boring a narrow needle through the wall, and the chips they produce stay compact.
- *Layout.* The struck piece is replaced entirely. The retained (attached) pieces are up to four lateral sectors around the crater plus, when the crater has a floor, one base column under the floor. The floor is a real face of that base column, so the wall keeps a visible recess. The crater material itself is quartered along the two lateral directions into up to four loose chips. One hit therefore costs up to nine live slots and replaces one. If the remaining thickness along the axis is less than 1.25 times the depth, or a floored crater cannot be cut validly, the floor is omitted and the crater runs through the piece.
- *Slivers.* When a lateral sector would be empty, a sliver or otherwise invalid, that side is dropped and the crater region extends to the piece boundary on that side, so its material joins the detached chips. No material is lost. If the crater region would exceed four times the nominal frustum volume, the hit is not cratered.

The minimum piece width is 4 mm and the minimum volume is 1e-7 m³. Mass, volume, centre of mass, inertia and surface labels are partitioned exactly. Every piece passes the same hull checks the snapshot codec enforces, and its encoded definition stays within `MAX_SECONDARY_DEFINITION_BYTES`; a crater that would produce a larger definition is not cut.

**Chips and spall.** Chips leave with a bounded, deterministic spall velocity. The spall energy is 0.005 × (90 × strength)² J shared by mass across the chips, capped at 8 m/s. Each chip gets an outward-and-radial direction plus a seeded spin of at most 12 rad/s. Pieces of a moving or loose parent inherit its point velocity, capped at 12 m/s, and chips add their spall to it. The bullet's share of the impulse is applied only to the retained pieces, never to the chips, so chips are not driven back into the wall. No body receives more than 12 m/s of Δv from a bullet, and a new chip never starts faster than 20 m/s. Impulse is applied once: a command whose impulse was consumed by fracture is not applied again. Bullet impulse on a body whose colliders changed in the same tick uses its recomputed mass.

After every physics step, in both `step()` and `afterPhysicsStep()`, every loose dynamic secondary piece under 0.01 m³ is clamped to at most 20 m/s of linear and 30 rad/s of angular velocity. This covers bullet chips and small explosion debris alike. The clamp is deterministic and does not wake sleeping bodies. Explosion-launched pieces of 0.01 m³ or more are not clamped. Rapier stores velocities in single precision, so a clamped speed can read a few millionths above 20 m/s.

**Hierarchy and release.** Pieces can be fractured again up to `MAX_FRACTURE_GENERATION` (8) generations. A piece is released as loose debris instead of cratered when it reaches the generation cap, is fully consumed, or is too thin to crater, provided its volume is at most 0.004 m³. Larger pieces fall back to structural damage only. A released piece keeps its parent's point velocity, capped at 12 m/s, and adds a spall launch along the shot, again capped at 20 m/s in total. An attached piece that spans from the struck face to within 1 cm of the root's back face along the shot is never released, because releasing it would open a line of sight through the wall. That hit applies only the structural fallback, and the wall stays opaque until its bonds break and the cell detaches.

**Structural coupling.** For eligible materials, every bullet also sends a reduced structural point impact to the primary root, whether or not a crater was cut or the budget was full. Cratering removes cross-section from the root's bonds. Each incident bond's capacity is scaled by the fraction of its interface section still covered by attached pieces, and a bond breaks once that fraction falls to 0.4 or less. The root's structural mass follows the live attached pieces. When less than 10% of the original volume remains attached, the remaining pieces are released and the root is retired. This means concentrated fire chips small pieces first, then lets larger sections around them fall. Other materials keep their original full-strength structural behavior.

**Live budget and detail recycling.** `MAX_SECONDARY_FRAGMENTS` (512) bounds the number of *live* secondary pieces, not the lifetime history. Bullet fractures (`MAX_IMPACT_FRACTURES_PER_TICK`, 4) and explosion splits (`MAX_SECONDARY_SPLITS_PER_TICK`, 2) have separate per-tick limits. When a fracture needs live slots, the engine frees them deterministically in this order:

1. Loose Settled pieces, oldest (lowest id) first.
2. Loose Sleeping pieces, oldest first.
3. Cratered roots, healed least recently hit first (ties by manifest order).
4. Loose Dynamic pieces, oldest first.

Healing recycles crater detail. It removes every live piece of the root, attached pieces and its loose chips alike, because a snapshot may only list pieces whose root is presented as Retired. It then restores the root's authored collider in its current supported structure or rubble island, and removes any loose piece that the restored collider overlaps by more than 5 mm. The root stops being presented as Retired, and its structural mass returns to the manifest mass. Bond section loss and damage are monotonic and stay, so structural weakening is kept and only the visible crater detail is recycled. A root is never healed if it was hit this tick, is part of the current fracture, or has a charge attached to one of its pieces. A late command aimed at an id from a healed root resolves to whichever is closer, the root itself or a surviving descendant. Healed pieces count in `stats.evictedFragments`, and each healed root counts in `stats.healedRoots`.

When new bodies would exceed the dynamic-body limit, only loose pieces are evicted. Attached pieces leave only through healing. Pieces carrying a charge, pieces involved in the current fracture and pieces created in the current tick are never evicted or healed. Evicted pieces wake their contacts. If none of this frees enough room, `stats.capacityEvents` increments and the impact falls back to structural damage. Because recycling always reaches older craters, sustained fire keeps chipping new surfaces for the whole firefight instead of freezing once the budget fills.

**Kill volume.** Every tick, before commands run, loose secondary pieces are removed if their position is non-finite, more than 50 m below the manifest's lowest point, or beyond the horizontal and vertical extent limit on any axis. The extent limit is the larger of 1,000 m and the manifest's own extent plus 50 m, capped at 2,047 m. Removed pieces follow the eviction bookkeeping and drop any charges on them. Detached primary islands whose body leaves the same volume are retired: their bodies and colliders are removed, their attached pieces are evicted, and the primaries become Retired with no live pieces. This matters in attached mode, where Cascade adds no ground: chips and rubble that fall past a ledge would otherwise fall forever and eventually exceed the snapshot position bound (2,048 m).

**Monotonic ids and lineage.** Secondary ids start one above the largest manifest id and only increase; they are never reused. A frame lists live pieces only, in ascending id order. Each definition carries `parentId`, `generation` and `rootId`, which is the manifest id of its primary ancestor. Re-fractured and evicted ids are remembered in a bounded FIFO lineage map (`MAX_SECONDARY_LINEAGE`, 4096 entries). A late or stale command aimed at a piece that no longer exists is redirected to the closest live descendant within the command radius. If the lineage points at a root that is still cratered but no descendant of that id survives, it falls back to the closest live piece of the same root within the radius. If the root has been healed, the root itself is a candidate. If nothing qualifies, or the lineage has expired, the command finds no target and never throws. A charge with no surviving target stays where it was placed in world space. `enqueue` accepts any primary id or any safe integer in `[firstSecondaryId, firstSecondaryId + MAX_SECONDARY_ID_SPAN)`, including ids that do not exist yet in a replay.

**Navigation and debris.** `collisionGeometry()` includes supported and settled unrefined primaries, live attached pieces of cratered supported or settled roots, and settled loose pieces of at least 0.01 m³. A cratered root changes the navigation version only when its transform changes or its live volume crosses an eighth-of-original step. A single crater or a settling chip does not force a navmesh rebake; heavy loss, detachment and large settled pieces do. `fragmentColliders()` marks loose secondary pieces under 0.01 m³ with `debris: true`. Hosts should exclude those from camera, lean, acoustic and character-controller queries. Small settled or sleeping debris also skips the structural contact-load pass.

**Stats.**
- `secondaryFragments` is the live secondary count.
- `evictedFragments` is the cumulative number of secondary pieces removed for room or by the kill volume, including the pieces of healed roots and of retired out-of-bounds islands.
- `healedRoots` is the cumulative number of cratered roots restored by detail recycling.
- `capacityEvents` counts budget and throttle refusals. It increments when a bullet hit exceeds `MAX_IMPACT_FRACTURES_PER_TICK`; when a crater cannot get ids, live slots or dynamic bodies; when a piece that should be released as loose debris cannot get a dynamic body; when a root that should release its remaining pieces cannot reserve bodies (its pieces stay attached); when explosion splits exceed `MAX_SECONDARY_SPLITS_PER_TICK` or eight attempts, or a split cannot get room; when a placed charge beyond `MAX_EXPLOSIVES` displaces the oldest charge; when a cannonball beyond `MAX_CANNONBALLS` displaces the oldest, or cannot spawn at the dynamic-body limit; and when a detached island is created settled because the dynamic-body limit is full. During sustained fire, only the per-tick throttle should keep it growing.
- `supportedFragments` counts unrefined supported primaries plus live attached pieces of supported roots.
- `detachedFragments` counts the remaining live pieces.

**Known limits.** Spread fire near the floor of an existing crater can leave some released chips lodged inside the recess. In a 40-shot AKM host-world check, 29 of 160 chips rested inside it after two seconds of settling per shot. These remain real colliding bodies and are subject to the same live budget and cleanup rules; improving their exit clearance is a follow-up. Healing also removes loose floor debris belonging to the healed root, as described above. An idle saturated scene has measured about 2–2.7 ms per fixed tick on the development host, primarily from structural contact queries on attached pieces; hosts should profile that cost within their frame budget.

## Rendering and workers

`DestructionRenderer` owns generated geometry and default materials. It renders primary fragments in batches, exposes interior fracture surfaces only when needed, hides retired parents and renders secondary pieces. A primary's interior faces are shown when it is fully damaged, is not Supported, or has a bonded neighbour presented as Retired (cratered or removed). The last case shows the intact neighbour's shared interface face behind a crater cut at a cell boundary, so the crater has no see-through hole. `update(frame, previous, blend)` interpolates snapshots. Secondary pieces are updated incrementally by id. A new revision adds geometry only for new ids and deletes it only for removed ids, so per-hit cost scales with the pieces that changed rather than the live count. Batches reserve capacity with headroom, compact freed space in place, and rebuild only when they must grow. Previous and current poses are paired by id, so removing a piece never makes its neighbours snap. Each secondary batch's `userData.fragmentIds[batchId]` maps a raycast hit to its piece id. `PresentationWorld` refreshes each secondary entity's `RenderSlot` to its current frame index on every `accept`. Supply `{ materialFor(fragment, surface) }` to borrow host materials; the renderer does not dispose borrowed materials.

`DestructionSession` owns a standalone module worker, Effect resource scope, lifecycle actor and presentation mirror. It exposes `subscribe`, `getSnapshot`, `frame`, `previous`, `interpolationAlpha`, `impact`, placed collision objects, emitter launches and replay export. Construct it inside a client lifecycle and call `await session.dispose()` on teardown. An optional `workerFactory` supports custom bundlers/transports. Importing the barrel starts no worker. Host-world integration uses `DestructionSimulation.attach`, because a host Rapier world cannot be shared with a separate worker through a JavaScript object reference.

## Contact collapse and crushing

Contact cascades apply damage using the moving rigid body's mass and reduced effective mass.
They add no kinetic impulse: Rapier has already exchanged the contact momentum. A large body
can generate up to six cascades per tick (one plus one per forty primary members), with twelve
cascades per simulation tick overall. Player, placed-charge and native projectile impulses keep
their existing behavior.

A multi-member body's contact-induced velocity change above 1.5 m/s produces a landing shock.
Damage reaches only internal bonds near external solver contact points, falling linearly to zero
at `min(3.5, 1 + excessSpeed × 0.4)` metres. Severity is `excessSpeed × 0.25`, scaled by joint
strength, area and material brittleness. Gravity is subtracted using the host world's gravity.
Each bond uses its nearest contact once, so duplicate contact points do not multiply damage.
At most 128 contact points per island are retained; excess points increment `capacityEvents`.
This bounds the damage query but does not impose a fixed-time budget on graph solving or contact
enumeration. A small slump can survive, while a hard landing breaks near the strike instead of
damaging the entire body uniformly.

Supported, non-anchored primary fragments can crush after one overloaded contact tick. Lone
primary rubble takes half the contact load and needs three consecutive overloaded ticks.
Generic contact load never crushes a fragment inside a multi-member falling body, so a body is
not peeled apart by whatever it strikes; cannonball contacts use their impact path. Compression
capacity is `compressionStrength × liveVolume^(2/3) × 0.1`, with the existing material-strength
fallback. Detonated placed charges also pulverise non-anchored fragment centres inside
`radius × 0.5 × sqrt(strength / 2)`, whether the fragment is still supported or already part of
a detached body. Generic explosion commands do not pulverise material. Anchored footings remain
fixed and chippable.

### Support overload

A detached multi-member body that rests on fixed footings or ground puts its whole weight
through the few fragments in contact with them. Each tick, from the same per-contact reaction
the crush path already accumulates, the engine sums the normal reaction on every fragment of a
multi-member, non-fixed body that touches a fixed collider (anchored footings, standing
fragments, ground or placed collision objects). It compares that reaction with:

- the fragment's own crush capacity (`compressionStrength × liveVolume^(2/3) × 0.1`, scaled by
  remaining mass as for generic crushing), and
- the summed shear capacity of its intact incident bonds
  (`graph.incidentBondCapacity(index)`: shear strength × area × remaining section ×
  `(1 − 0.6 × damage)`; shear is the weakest mode, so this bounds a reaction from any direction).

If either is exceeded for three consecutive ticks (`CRUSH_SUSTAIN_TICKS`), the fragment crushes
(preferred when its own capacity is exceeded) or all its intact bonds fail
(`graph.failIncidentBonds`) when only the joint is overloaded. The check is solver-free and runs
on cached contacts too, so a sleeping body whose reaction has not changed still counts ticks and
is woken when a support goes. Candidates are ordered by overload ratio and then fragment id; at
most sixteen act per tick (shared with `MAX_CRUSHED_PER_TICK`), and the excess increments
`capacityEvents`. A crush removes one fragment from the body: its collider is dropped, the body
is woken, and the graph's next component report keeps the body when it stayed connected or
splits it into new islands. A slump onto supports that carry their load, such as a ten-centimetre
drop, still survives.

The mechanism removes one support fragment per overloaded cycle. After a crush the body falls
only to the next fragment, so the cadence is a free fall plus three ticks, and the body stops
dropping once its weight spreads over enough contacts for none to be overloaded. It therefore
brings a building down only as far as its supports fail; it does not pancake storeys that
rest on intact columns.

Crushing removes the primary's structural contribution, collider and attached descendants,
without creating secondary pieces. Already-loose descendants keep their retired root lineage.
Collision geometry, navigation and presentation then reflect the surviving pieces. Dust mass
is counted in `stats.crushedMass`, and retired primaries in `stats.crushedFragments`. Contact and
charge crushing share a sixteen-retirement budget per tick; remaining targets are deferred and
rechecked for eligibility, with budget pressure reported through `capacityEvents`. These rules
apply to primary rubble and refined primary roots; independent secondary chips retain their
existing descendant-fracture and eviction lifecycle.

Islands with at most four primary members and secondary rubble use angular damping 2.5. Chips
below 0.01 cubic metres retain damping 3. Larger primary islands retain damping 0.4.

## Structural work and scale

Equilibrium is reused while stiffness and accepted loads are unchanged. Capacity loss within
one bond state updates utilization without rebuilding stiffness. Cracked, yielding and broken
state transitions, changed live mass, topology and changed contact loads invalidate the relevant
result. Stable contact loads no longer force a fresh solve every fifteen ticks. Sleeping debris
keeps its last measured stress; waking contact loads are sampled again. Owned-world idle contact
and geometry work is cached; shared worlds still inspect host contacts each step. Batch crushing
rebuilds connectivity once, and component invalidation visits each affected component once per
phase. Charge batches use a spatial bond lookup with canonical bond ordering. Authoring uses
spatial cell buckets, retaining a bounded fallback for oversized cells; all three scale manifests
keep their previous hashes and bond counts.

`STRUCTURAL_WORK_POLICY` exposes the fixed policy. Work weight is `bonds + 2 × fragments`.
Jobs at or below 4,000 weight retain up to 64 PCG iterations per tick. Larger jobs resume on
one of every four graph steps with `max(1, floor(60,000 / weight))` iterations. Unfinished Krylov
state is retained; changing stiffness or loads restarts the affected component. At the manifest
limits, one iteration can exceed 60,000 weighted visits, so this is an operation policy, not a
wall-time deadline. Commands, topology loss and localized landing shocks still apply each tick.
Stress-based fatigue waits for a strictly converged, current component; expensive structures can
therefore take longer to fail. `stats.structuralDeferred`, `structuralWorkUnits`, `solverIterations`
and `solverResidual` expose that degradation. Runtime scheduling never depends on elapsed time.

Simulation creation performs an initial gravity solve of at most 2,048 iterations for larger
jobs. This is startup work, outside interactive steps, and can remain unconverged, in which
case bounded runtime work continues. The measured medium and large fixtures still had deferred
strict stress work at the end. Rest medians below 2 ms do **not** mean every rest tick is below
2 ms; pending solve steps can still exceed that budget. Stronger preconditioning and a
finer-grained work quantum remain follow-ups.

The headless scale benchmark reproduces Monolith's exact column/slab/core geometry, 180 rest
steps and 1,500 collapse steps. Charges fire core first in waves of `MAX_EXPLOSIVES` (32), with
one placement and one detonation step per wave. Every queued command is checked, and every
wave verifies the actual placed charge IDs and that detonation clears them. Collapse is
measured by displacement, not by detachment: the mass-weighted centroid drop as a fraction of
the initial centroid height, and the fraction of mass whose centre ends below one storey
(3.5 m). Live primaries and secondary pieces use their final pose; crushed primaries (dust) count
as collapsed and are reported separately as `crushedMassFraction`. The gate is at least 90% of
mass below one storey. Detached mass (`detachedMassFraction`) is informational only: a body can
detach from its footings and still rest almost where it stood. Placement and detonation timings are recorded separately
from the subsequent 1,500 steps; their maximum also counts toward the optional timing gate.

Measured by displacement at revision `4cce701` (Rapier 0.19.2 checkout) all three frames fail the
gate, although detached mass reads 98–99%: the detached building drops a few decimetres and rests
on its anchored footings as one sleeping body. Before and after support overload
(simulation `rigid-bond-budgeted-4`, same host and Rapier 0.19.2):

| Frame | Centroid drop before → after | Mass below 3.5 m before → after | Crushed mass after | Collapse p50 / p95 / max after | Largest wave step after | Active bodies after |
| --- | --- | --- | --- | --- | --- | --- |
| Small | 2.4% → 62.9% | 24.8% → 58.2% | 26% | 8.2 / 13.5 / 40.5 ms | 91.7 ms | 213 |
| Medium | 1.4% → 41.8% | 16.6% → 35.3% | 15% | 24.6 / 34.3 / 82.7 ms | 109.0 ms | 17 |
| Large | 3.1% → 34.6% | 13.0% → 26.6% | 8% | 49.9 / 68.9 / 164.2 ms | 269.6 ms | 8 |

Support overload turns a standing detached body into a progressive collapse at its supports,
but **none of the three frames reaches the 90% gate**, and medium and large fail every timing
gate. The "crushed mass" column counts as collapsed in the below-storey fraction (dust), so it
flatters the result. Large drops its centroid from 15.2 m to 10.0 m over 25 s and is still
grinding: the body stays one 7,400-piece rigid body that is awake for the whole run, which is
what costs 40–50 ms per step. Rest p50 is unchanged (0.5 / 0.8 / 1.3 ms). The reason is
physical rather than a tuning gap: once a building has sunk onto enough ground contacts, the
reaction per contact is under capacity and nothing crushes further, while the floors above rest
on intact columns that no support-level check reaches. Pancaking those storeys needs either a
stress path that converges for resting detached bodies (a 8.5k-node group gets one PCG
iteration every four ticks under `STRUCTURAL_WORK_POLICY`) or a dynamic-impact model for
crushing through slabs; neither is included.

The earlier timing table below used detached mass as its collapse criterion and therefore
describes charge handling of buildings that were still standing.

The original single-wave benchmark exceeded charge capacity on medium and large. Those runs
measured only 2% and 1% detached mass, so their collapse timings are not comparable to the
corrected full-collapse scenario.

Corrected measurements at engine revision `14a8a54439592eda6bba11dbce118cf594058451`, Node
24.21.0 / Apple Silicon, in a retained source consumer using Rapier 0.21.0:

| Frame | Charges verified | Rest p50 | Collapse p50 / p95 / max | Largest wave step | Final 300 p50 | Detached mass |
| --- | --- | --- | --- | --- | --- | --- |
| Small, 1,752 fragments | 28/28 | 0.4 ms | 0.3 / 3.8 / 35.1 ms | 84.9 ms | 0.2 ms | 98% |
| Medium, 4,584 fragments | 36/36 | 0.6 ms | 0.7 / 7.4 / 17.5 ms | 86.5 ms | 0.7 ms | 99% |
| Large, 8,720 fragments | 44/44 | 1.1 ms | 6.1 / 17.7 / 42.9 ms | 183.6 ms | 1.2 ms | 99% |

All three finish with zero active bodies. Large's post-charge maximum is predominantly physics
(37.8 ms physics, 4.9 ms structural). All timing gates still fail because detonation steps exceed
50 ms; large also exceeds the 16 ms post-charge p95 target. Creation takes 0.42 / 1.51 / 3.82
seconds and authoring 0.30 / 0.65 / 1.20 seconds. Startup amortization, detonation-step budgeting
and large-collapse physics remain follow-ups.

The checkout uses Rapier 0.19.2 and has different collapse behavior and timing: medium/large
post-charge p95 is 22.4 / 50.3 ms; the small frame retains two active bodies after 25 seconds.
Do not compare different Rapier versions as equivalent replay or performance measurements.
A brief typecheck
overlapped part of the 0.19.2 large run; those timings are diagnostic, rather than an idle-host
baseline.

Run:

```sh
corepack pnpm benchmark:cascade:scale -- medium large --assert
corepack pnpm benchmark:cascade:scale -- small
corepack pnpm benchmark:cascade:scale -- medium --rest-only --assert
CASCADE_SCALE_REPORT=/tmp/cascade-scale.json corepack pnpm benchmark:cascade:scale -- medium large
```

`CASCADE_SCALE_REPORT` writes the raw wave steps, physics/structural breakdowns and counts above
the frame budget as JSON. Reports stay local; none are committed.

`--assert` checks rest and final-window medians below 2 ms, post-charge p95 below 16 ms and
all collapse/placement/detonation steps below 50 ms. It collects failures across all selected
frames and retains JSON results even when timing assertions fail. Run on an otherwise idle
host; unit regressions separately guard cache invalidation, deterministic work limits, continued
stress and replay behavior. The engine's strict unconverged stress is deferred: current contact,
command and topology damage still applies, but stress-based fatigue waits for convergence.

## Replay and limits

Standalone `recordReplay()` includes accepted commands and physical operations; replay is tested in the same runtime/version. Attached mode intentionally rejects standalone replay export: external contacts, controller inputs and host snapshots belong to the host's authoritative replay. Shared mode keeps bounded recent command diagnostics. Pin source, map and Rapier versions for reproducibility.

Budgeted structural and contact-collapse behavior uses simulation version `rigid-bond-budgeted-4`
(and its `-physics-operations-1` variant). Revision 4 adds support overload, removal of single
fragments from multi-member bodies and pulverising of detached fragments. Revision 3 and earlier
impact-hierarchy recordings, including revision 2, are rejected rather than
silently replayed with different collapse behavior. Snapshot layout remains protocol v4.

The original engine bounds manifest fragments, dynamic bodies and secondary fracture.

Snapshot protocol v4 (`PROTOCOL_VERSION` 4) consists of:
- a 32-byte header;
- 24 bytes per primary fragment (quantized position, quaternion, damage and a state from 0 to 4);
- one byte per bond;
- 56 bytes per ordnance item;
- a secondary section, made of a 12-byte header (revision, live count, definition byte length), the JSON definitions, and 24 bytes per live piece.

Simulation frames include the secondary section whenever a primary is retired or the secondary
revision is non-zero, and it may hold zero pieces (`[]`). The encoder, decoder and verifier also
accept childless retired primaries with no secondary section, representing crushed material.

Definitions must satisfy these rules:
- Ids are strictly ascending safe integers in `[firstId, firstId + MAX_SECONDARY_ID_SPAN)`, where `firstId` is the largest manifest id plus one.
- `generation` is an integer from 1 to `MAX_FRACTURE_GENERATION`.
- Generation 1 requires `parentId === rootId`.
- Generation 2 and above require `firstId <= parentId < id`, with the parent absent from the frame, because it was re-fractured.
- `rootId` must be a manifest fragment presented as Retired, with the same material and region as the piece.
- Secondary states are 0 to 3; there are no Retired secondary entries.

A Supported secondary piece makes its root count as supported in the topology checksum. A Retired primary does not need any live pieces. Decoders also accept v1 to v3 packets; v3 secondary definitions must be generation 1 without `rootId`, and the decoder sets `rootId = parentId`.

`LIMITS.secondaryFragments` equals `MAX_SECONDARY_FRAGMENTS`. Each definition's UTF-8 JSON encoding is bounded by `MAX_SECONDARY_DEFINITION_BYTES` (3,800 bytes). The fracture code refuses to create a larger piece, and the encoder and decoder reject one. The largest definition observed under concentrated fire is 2,607 bytes, at generation 7, so the bound leaves about 46% headroom. `LIMITS.secondaryDefinitionBytes` is derived as `MAX_SECONDARY_FRAGMENTS × (MAX_SECONDARY_DEFINITION_BYTES + 1) + 1` (1,946,113 bytes), so a full live budget of maximum-size definitions, with separators and brackets, always fits. `LIMITS.packetBytes` (2,700,000) covers the worst-case primary payload (20,000 fragments, 100,000 bonds, all ordnance) plus that full secondary section (2,541,581 bytes), with about 6% margin. Encoding a frame within these bounds cannot fail for size. The example server's slow-receiver limit is twice the packet limit. Every snapshot still carries every live definition. Sending definitions only when they change, keyed by id, would cut this to about 28 bytes per piece; that transport is a planned follow-up. The box author adds an explicit fragment budget. High-detail scenes still require profiling against the host's fixed-step budget. The browser package includes portable codecs; the repository's optional Node WebSocket example is not pulled into browser applications.

Source identity and SHA-256 hashes of the captured source files are recorded in [provenance.json](../packages/cascade/provenance.json). The port adds shared-world ownership, native hit adaptation, reusable rendering and authoring, strict consumer types and source exports while retaining the original structural solver.

## Verification

```sh
corepack pnpm typecheck
corepack pnpm check:boundaries
corepack pnpm test:cascade
corepack pnpm benchmark:cascade:scale -- medium large --assert
```
