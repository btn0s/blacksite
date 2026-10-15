# Rupture consolidation backlog

Blacksite's Rupture is intended to become the shared engine for its consumers, including the
RUPTURE game. This records engine relays 1–4 from `thr_nkwphruqwg`, delivered through
`thr_qd44mj8zbq` on 2026-10-05. The source checkout is
`a separate Rupture checkout`, branch `proto/art-reset`. Its changes were uncommitted at the
time of the relay; treat it as read-only and capture a source revision before porting anything.

The measurements below are reported by the RUPTURE author, not independent Blacksite benchmark
results. They came from a four-storey masonry walk-up with roughly 800 fragments and 2,600 bonds.
The source authoring guide is `rupture/maps/README.md`.

## Port status (2026-10-06)

Relays 2–4 are implemented in Blacksite from frozen `engine-snapshot-5`. Source checksums and
adaptations are recorded in `packages/rupture/provenance.json`. The port includes damage-only
body-mass cascades, contact-localized landing shock, placed-charge pulverisation, supported and
lone-primary rubble crushing, small-rubble damping and childless-retirement codecs. It preserves
v4 root lineage and attached descendant cleanup. Independent secondary chips keep their existing
re-fracture/eviction lifecycle. Tiny chips retain Blacksite's damping 3; other secondary rubble
and primary islands of up to four members use 2.5. Crushing is bounded to sixteen retirements
per tick, and landing damage retains at most 128 contact samples per island. Standalone replay
behavior is versioned as `rigid-bond-impact-hierarchy-2`.

Game render material names, sledge reach and superseded whole-island shock are excluded. Relay 1's
solver, material-capacity and authoring-tool work remains backlog. The sections below preserve
the reported source history; source-game demolition and timing numbers are not Blacksite
acceptance measurements. See [Rupture's contact-collapse documentation](./rupture.md#contact-collapse-and-crushing)
for the installed behavior.

## Monolith structural performance (2026-10-06)

The unchanged-load/fatigue invalidation and repeated component traversal issues are addressed
in simulation revision `rigid-bond-budgeted-3`. PCG work resumes under a deterministic operation
policy; idle contact/geometry work is cached, crushing is batched, and commands/authoring use
spatial broadphases. The exact Monolith scale fixture is now `benchmark:rupture:scale`.
[Measurements and remaining limits](./rupture.md#structural-work-and-scale) distinguish runtime
medians from pending-solve bursts, startup costs and physics spikes. The benchmark now fires
core-first waves of 32 and verifies placed charges; the earlier incomplete medium/large
demolition was a charge-capacity error in the test. Its "at least 95% detached mass" gate is
superseded by the displacement measure in [Relay 5](#relay-5-support-overload-for-resting-detached-bodies).
This does not port masonry capacity changes, TrenchBroom tooling or improve solver conditioning.

### Remaining Monolith priorities

1. Amortize or warm-start the initial gravity solve; repeated generated structures currently
   pay seconds of creation time at medium and large sizes.
2. Budget detonation work and body creation/activation or reduce detached-body overhead.
   The corrected benchmark records wave steps separately: large detonation exceeds 180 ms
   on Rapier 0.21.0 even though subsequent collapse steps peak below 50 ms. Full large collapses
   are physics-bound; preserve contact-localized breakup and deterministic scheduling.
3. Strict stress convergence remains deferred at rest. Do not claim converged overload/fatigue
   detection until measured; existing load/mass/topology invalidation tests guard resumption.
4. Charge capacity already increments `stats.capacityEvents` when the oldest placed charge is
   displaced. `enqueue()` acknowledges queue admission, returns null for duplicate IDs and
   does not promise that an ordnance instance survives until detonation. Consumers should
   check `frame.ordnance` or fire capacity-sized waves. A more specific admission/result API
   remains a follow-up.

## Relationship to the bullet-fracture release

Blacksite revision `a1357755d3130b2c558fdbd87f73ca19773b8be9` adds localized concrete chips,
descendant fracture, live fragment mass and bond section loss. Mass changes invalidate structural
loads and equilibrium caches. It retains the existing PCG solver, its 64-iteration limit, additive
stress utilisation and `authoredScale` capacity model. It does not resolve the stable cracked
equilibrium or masonry joint issues reported below.

The 512-live-piece budget bounds secondary fracture pieces. It does not bound authored primary
fragments, bonds or the cost of solving a large building. Root healing also removes loose chips
with that root's lineage. Preserve structural damage when consolidating lifecycle policies.

The separate 300-round Blacksite/Space playtest reached generation 8 within that piece budget,
but developed multi-second frame stalls. Profiling remains tracked in
[Space issue #769](https://github.com/btn0s/space/issues/769); the responsible subsystem has not
been isolated. Building-scale solver measurements and this sustained-fire failure need separate
reproductions before selecting a fix.

## Structural solver and runtime work

| Backlog | Reported behaviour | Candidate work and acceptance evidence |
| --- | --- | --- |
| Stable cracked equilibrium | A structure that cracks at rest re-solves every tick. An unconverged rest state cost 11–21 ms per tick; authoring changes brought it to about 1.0–1.4 ms. | Reuse converged equilibrium or solver work while loads, topology, mass and stiffness are unchanged. Diagnose rest-state cracks and non-convergence at load time. Demonstrate that idle cracked structures stop doing redundant solves and resume correctly after a changed load. |
| Masonry capacity interaction | Utilisation adds tension, compression, bending and `hypot(shear, torsion)`. Capacity is the minimum material capacity multiplied by `bond.strength / min(material.strength)`. Slabs attached to wall sides, butted L-corners and weakened bed joints crack at rest. | Evaluate compression-dependent joint shear capacity, such as Mohr–Coulomb, against deterministic fixtures. Treat this as a proposed game model, not a validated engineering calculation. Preserve existing material behaviour through an explicit compatibility choice. |
| Per-joint capacity channels | `bond.strength` scales every capacity channel together. The game needs weak tension with full compression, and orientation-dependent joints. | Add an authoring/runtime seam for per-member or per-joint capacity channels. The current game post-pass weakens vertical faces between different members by `max(jointA, jointB)` and leaves bed joints untouched. Validate codec, source-export and replay behaviour for any new fields. |
| Solver conditioning | Thin, stiff glass panes and sills caused non-convergence and rest-state cracks; removing them from the structural graph fixed the authored building. | Add conditioning diagnostics and evaluate explicit structural exclusion or thickness/stiffness rules. Avoid silently dropping structural members. Reproduce the thin-member failure and compare convergence and idle cost. |
| Dynamic island breakup | Relay 1 reported storey-height islands landing intact. Relays 2–3 introduced landing shock, body-mass cascades and crushing. Relay 4's contact-localized replacement is now ported to Blacksite. | Building-scale profiling remains open; small fixtures verify hard-drop breakup, survival of small slumps, intact remote bonds, replay and collider cleanup. |
| Collapse spikes | About 1,050 bonds broke and 720 fragments detached over roughly eight seconds. The worst headless step was about 50 ms; an earlier denser version reached about 330 ms. | Profile graph solving, connectivity changes, collider construction and island transitions independently. Define explicit work budgets and degradation for authored structures as well as secondary pieces. Preserve replay results or version any intentional change. |
| Runtime material presets | Production authoring imports `MATERIALS` from `destruction-testkit`; game mocks of that package break production paths. Blacksite has the same dependency. | Move reusable material presets into a runtime package and keep testkit consumers on that shared definition. Verify the source-installable payload has no testkit dependency. |
| Repeated static context | `LevelBox` is capped at 4,096 boxes; the simplified walk-up street already uses 2,335. | Explore reusable/instanced context with clear rendering and collision budgets instead of merely raising the cap. |

## Relay 2: landing shock and crushing

The second relay reports a fix for dynamic island breakup in the same uncommitted, read-only
RUPTURE checkout, across destruction-physics, destruction-graph and destruction-network. Its
benchmark uses a 787-fragment, four-storey walk-up. This section records the original source
implementation; see port status above for the retained features and adaptations.

### Reported causes

- Free-body equilibrium clamps one member as a gauge. A 650-node island did not strictly
  converge even with 512 PCG iterations. Fatigue requires loads to remain within 5% between
  samples, preventing accumulation on the moving body. An experiment leaving rigid modes free
  converged from a warm start in 20–45 iterations; that experiment was not adopted in RUPTURE.
- Cascade impacts used the touching fragment's mass instead of the island body's mass: a
  roughly 490-tonne storey produced an impact scaled like a one-tonne brick.
- Charges broke bonds without removing material. Detached pier cells remained stacked under
  friction and continued carrying the building.
- RUPTURE's contact crushing initially peeled members from multi-member falling islands.
  Rebuilding after each peel made blocks grind down slowly instead of falling.

### Source implementation history and port candidates

- **Whole-island landing shock (superseded by relay 4):** `landingShocks()` runs after the physics
  step, comparing contact-induced
  velocity change with pre-step velocity after removing gravity's contribution. Above
  1.5 m/s, `graph.shockIsland(members, severity, transforms)` adds damage to each intact bond:
  `severity × (0.25 + 0.75 × mass-above share) × (0.65 + 0.5 × brittleness) / resistance`,
  with `severity = (deltaVelocity - 1.5) × 0.35` in relay 2 (revised to 0.25 in relay 3 below).
  Resistance follows `applyCommands`; weak joints
  fail first, with more damage near the base. Validate ordering and transforms in both standalone
  and shared-world operation.
- **Cascade mass and budgets:** `massOf` uses island rigid-body mass, treats standing pieces as
  immovable, and computes reduced effective mass. A large body can receive one impact per
  roughly 40 members, capped at six per body and twelve per tick overall. Before the port, Blacksite used
  live individual fragment mass in this path; reconcile live mass loss with body mass and avoid
  counting internal contacts or duplicate contact energy.
- **Placed-charge pulverisation:** `pulverise()` applies only to detonated placed charges,
  not generic `explosion` commands. It removes standing, non-anchored fragments whose centres
  lie within `radius × 0.5 × sqrt(strength / 2)`. Keep the distinction explicit in reusable
  commands and replay.
- **Contact crushing:** `queueCrushing` / `crushFragments` applies to supported, non-anchored
  fragments and lone rubble, excluding members of multi-member bodies. Capacity is
  `compressionStrength × volume^(2/3) × 0.1`. Standing pieces crush after one overloaded tick;
  lone rubble receives half the contact load and requires three consecutive overloaded ticks.
  `graph.crushFragment(i)` sets every incident bond's pending damage to one. The fragment is
  retired as dust with no children and its collider removed. A Blacksite port must also reconcile
  retained children, live mass, structural connectivity, navigation, renderer entries and stale
  collider handles; dust mass must be accounted for explicitly rather than treated as conserved
  physical debris.
- **Rubble damping:** RUPTURE applies angular damping 2.5 to islands with at most four members
  and secondary children, replacing 0.4. This addressed Voronoi cells rolling more than 20 m.
  Before the port, Blacksite used damping 3 for secondary fragments below 0.01 cubic metres and 0.4 for
  larger ones. Reconcile the size and member-count policies instead of overwriting bullet-chip
  tuning indiscriminately.
- **Childless retirement protocol:** RUPTURE now permits retired fragments with no secondary
  children, while still requiring children to reference retired parents. Before the port, Blacksite's v4 encode,
  decode and verification rejected a retired primary when the secondary section is absent; with
  a secondary section present, verification checks each live child's retired `rootId`, not that
  every retired primary has a child. Do not copy older immediate-parent validation over v4's
  bounded live lineage. Define childless retirement consistently across all codec paths, replay,
  checksum and presentation before enabling crushing, including snapshots with no secondary
  section and retirement of a refined root.

The relay 2 route sledges two columns and charges six piers. All six jittered charge layouts
collapse, scoring 0.95–0.99 demolition, with 5–13% of mass converted to dust. The worst step is
about 47 ms, so collapse budgeting remains open. Remaining rubble is mostly loose one-metre
cells, with occasional slabs containing 20–300 pieces. These results describe the earlier
whole-island shock implementation, not validation of relay 4's localized replacement.

The accompanying authoring lessons are that anchored pieces neither move nor crush: walls
should stand on a thin anchored footing brush to avoid an immovable pier stump. A storey needs
its supports removed to produce a substantial landing shock; gently settling onto intact walls
can leave it whole. Relay 2 recommended spawn and retreat points behind neighbouring buildings
based on observed debris travel. Relay 3 subsequently identified excess contact-cascade impulses
as a cause of that spread; use the corrected measurements below when evaluating this behaviour.

## Relay 3: contact cascades must not add momentum twice

RUPTURE reports that `applyImpulses` applied kinetic impulses for contact-generated `pointImpact`
cascades with `ORDNANCE_SOURCE`, excluding the existing cannonball path. Each island within the
impact radius received `min(mass, 900) × strength × 1.8 × falloff`, adding up to roughly 5 m/s
per impact on a one-tonne cell. Relay 2's body-mass correction raised cascade strength enough
to expose this: landing bodies queue up to twelve impacts per tick, and a storey splitting into
cells sprayed about 460 pieces at 12–30 m/s. Reported spread beyond the footprint was p90 31 m
and maximum 64 m.

The source fix makes contact cascades damage-only because Rapier has already exchanged contact
momentum, following the existing cannonball treatment. Player and charge impulses are unchanged.
Reported corrected spread is p90 2–3 m and maximum 7–9 m, with collapse settling into a heap.
Port cascade mass and this momentum fix together. Verify command provenance distinguishes
contact damage from player/charge impulses, preserve native momentum, and check both standalone
and shared-world replay; damage cascades must not reapply the physics contact impulse.

`LANDING_SHOCK_PER_MPS` is now 0.25, superseding relay 2's 0.35. At 0.35, every landing body
broke into individual cells. At 0.25, the reported walk-up achieves 0.95–0.99 demolition with a
70–190-piece slab plus rubble, 9–15% crushed mass and a worst step of about 47–49 ms. At 0.2,
worst steps rise to 60–87 ms. These are source-game tuning results, not universal defaults or
independently reproduced Blacksite benchmarks; collapse work budgeting remains open. Relay 4
subsequently invalidates the whole-island damage approach underlying these tuning results.

## Relay 4: localize landing shock to external contacts

RUPTURE reports that damaging every bond in a falling island produced all-or-nothing outcomes:
a roughly 10 cm slump near the 1.5 m/s threshold could shatter the entire 700-piece upper
building, and charges alone could flatten it. The whole-island approach from relays 2–3 is
superseded, rather than a port candidate to retain alongside the replacement.

The latest API is `graph.shockIsland(members, contacts, severity, reach, positions)`. Contacts
are solver contact points against geometry outside the body. Only bonds within `reach` of
those external contacts receive damage, with linear distance falloff. Reach is
`min(3.5, 1 + 0.4 × max(0, deltaVelocity - 1.5))` metres; severity remains
`max(0, deltaVelocity - 1.5) × 0.25`, applied above the free 1.5 m/s threshold. The reported
behaviour is that a block breaks where it strikes and collapses progressively.

A Blacksite port should preserve contact locality when mapping primary bonds and refined roots,
exclude internal contacts, and deterministically order or aggregate multiple contact points
without applying the same shock repeatedly. Validate low-drop survival, localized bond failure,
intact remote geometry, repeat landing breakup and bounded contact-processing cost. Retain
relay 3's damage-only cascades so Rapier contact momentum is not added again. No revised
demolition, dust or timing measurements were included in relay 4.

The source game's sledge reach increased from 0.48 m to 1 m: the shorter reach hit only one
joint in a column divided into 0.85 m cells, cracking it while leaving the piece wedged under
load. This is equipment tuning owned by the consumer, not an engine default. Record reach and
cell size together when reproducing the collapse route so equipment effectiveness does not
depend on excessive global landing damage.

## Relay 5: support overload for resting detached bodies

The earlier note that medium and large "reach 99% collapse" measured detached mass. It was wrong
as an acceptance measure: a charge detaches the building from its footings and it drops about
0.4 m onto three or four anchored footing fragments, still one sleeping 8,500-piece body with
only about 315 of 24,720 bonds broken. Every mechanism that turns weight into breakage was
disabled for that state: generic contact crushing gives multi-member bodies no load, crushing
and pulverising only handled lone or still-supported fragments, a slow slump never exceeds the
1.5 m/s landing-shock threshold, and the budgeted stress solve never converges for an 8.5k-node
group, so fatigue never applies. Localized landing shock (relay 4) and the work budget
(`rigid-bond-budgeted-3`) stay as they are.

Simulation `rigid-bond-budgeted-4` adds, for that case only:

- **Support overload.** Sustained reaction on a multi-member body's fragment against a fixed
  collider is checked each tick against that fragment's crush capacity and the shear capacity
  of its intact bonds. Three overloaded ticks crush it, or fail its bonds if only the joint is
  overloaded. Solver-free, id-ordered, bounded by the crush budget, overflow in `capacityEvents`.
- **Single-fragment removal from a multi-member body**, so crushing and pulverising work on
  detached islands. The graph's component report decides whether the body stays whole or splits.
- **Pulverising of detached fragments** inside a charge's brisance core, regardless of state.
- **A displacement-based benchmark gate** (mass below one storey), replacing detached mass.

Measured result: the mechanism collapses the supports of each frame and no more. Small drops
its centroid 63% (58% of mass below one storey, 26% of it dust), medium 42% (35%) and large 35%
(27%); none meets the 90% gate and the awake giant body costs 25–50 ms per step on medium and
large. Sustained overload removes one support fragment per free-fall cycle, then stops once the
weight is shared by enough contacts; storeys resting on intact columns do not pancake.
The earlier idea of spending idle structural budget on resting detached groups was **not
implemented**: the solver has no per-group iteration budget and sleep state lives in the
physics package, so it does not fit as a local change, and a statically stable resting body
would not reach the stress needed to fail columns anyway. Open options are a converging stress
path for resting detached bodies, a dynamic-impact crush for slab-on-slab landings, or taller
or storey-level charges. The detached-stress replay test now also counts assemblies that have
moved under 2 cm in a 20-tick interval as at rest, because the large body can creep on a rubble
bed for thousands of ticks without sleeping (the old physics passed only because it happened
to settle near tick 4,500).

## Authoring knowledge to preserve

These are the RUPTURE author's working rules under the current solver, rather than guarantees
for every future material model:

- Establish idle stability with zero rest-state cracks before tuning a collapse route.
  `scripts/maps/check-map.ts` reports convergence and the location of cracked bonds.
- Bear floors on ledges: step walls about 12.5 cm thinner per storey and place slabs inside the
  walls, supported from below, instead of attaching them to a wall's side.
- Weaken vertical joints only, using the maximum of the two member joint factors; keep horizontal
  bed joints at full strength.
- Author L-corners as single piers instead of two butted wall members.
- Provide a soft storey: cased-concrete columns and beams with wide ground-floor openings gave
  a readable route of sledging columns, then charging a pier.
- Keep glass and thin sills outside the structural graph, in static or non-colliding geometry.
- Use cells around one metre at building scale. Smaller cells increase bond and solver cost
  without a clear improvement at gameplay viewing distances.
- Undermine one side to induce a topple; a symmetric drop can park a rigid island on its rubble.

## Port candidates and ownership boundaries

1. **Static material names.** RUPTURE adds `brick` and `slate` to `LevelBox.material` and the
   destruction-authoring validator. Port the shared schema and validation together. The game's
   sourced texture sets and their asset provenance remain consumer responsibilities.
2. **Quake 220 parser.** New `packages/destruction-authoring/src/quakeMap.ts` parses convex
   brushes, recovers oriented boxes from six-face brushes, chooses materials by majority of
   faces, and exposes entity origin/angle helpers. It is a candidate for Blacksite's authoring
   package. Its outward plane normal is `(p2 - p0) × (p1 - p0)`. Default units are 64 per metre,
   overridable with `units_per_meter`; editor Z-up becomes engine Y-up through
   `(x, y, z) → (x, z, -y) / units_per_meter`. This proper rotation preserves winding. Verify
   these conventions with fixtures before integrating it.
3. **Generic map compilation.** The current game implementation is
   `apps/client/src/game/maps/jobMap.ts`. Move reusable brushes-to-manifest, region validation
   and joint handling into Blacksite authoring. Axis-aligned `func_destructible` brushes become
   `fractureBoxMembers` members with a seed grid sized by `cell`; `worldspawn` and `func_detail`
   become collidable static boxes; `func_illusionary` becomes non-collidable boxes; `clip`
   becomes invisible collision. Van, pickups, signs and game-specific prop colliders stay in
   the game. Oriented static brush support does not imply oriented destructible box authoring.
4. **TrenchBroom tooling.** `maps/trenchbroom/` contains GameConfig v9, an FGD for the brush
   entities and markers, editor textures and a setup script. Consolidate reusable editor
   definitions alongside authoring documentation while retaining game-specific markers and
   verifying texture redistribution provenance.
5. **Browser map loading.** The source `vite.config.ts` uses `jobMaps()` to expose map content
   through a virtual `.js` module. The reported Vite failure is that URLs ending in `.map` are
   treated as sourcemaps: `.map?raw` worked in Vitest but failed in the browser. Preserve a real
   browser-loading check when porting; a parser unit test alone does not cover this seam.

Port these as reviewable changes after capturing the source state, with a fresh submodule consumer
installation checks for shared payload changes. Keep consumer-specific gameplay outside the
engine and retain a single Rapier world in hosts that already own physics.
