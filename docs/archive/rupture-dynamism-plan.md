# Rupture plan: Finals-class destruction in the browser

Status: draft for discussion, 2026-10-06. Not a shipping checklist. Supersedes the per-item perf
brief once agreed.

## The target

The Finals' destruction, including the Dynamism upgrade (October 20, 2026), running in a browser at
120 FPS render. Their system has three layers:

1. **Strain.** Pieces are held rigid until their static load capacity is exceeded.
2. **Dynamic connections (new in Dynamism).** When static capacity breaks, an elastic connection
   engages instead of the piece detaching. Floors tilt, corridors twist, rooms sag; debris forms
   connected chains that slump under their own weight before failing. Collapsing buildings damage
   neighbours; explosions hurl roof sections.
3. **Debris.** Loose pieces under rigid-body physics with short lifetimes for small debris.

Rupture at `f95fe4c` has layers 1 and 3. It has no layer 2: a bond is intact, cracked, yielding or
broken, and a broken bond means separate rigid bodies. There is nothing between "held rigid" and
"loose".

## What the play test showed (2026-10-06, large frame)

- **1 m cells, main thread (port 5190):** individual charges look right. Big chunks first, then
  smaller ones. Knocking out the whole ground floor at once ("Demolish") is correct but far slower
  than real time.
- **2 m cells, worker, 30 Hz (port 5199):** render is smooth at display rate, but the collapse
  plays in slow motion because each physics step costs more wall-clock than the simulated time it
  advances. Demolish pulverises the whole building instead of chunking it. The 2 m cells with
  refine-on-landing changed the feel for the worse.

Conclusion: keep the 1 m authoring and the chunking behaviour of f95fe4c as the reference feel.
Park the 2 m hierarchical cells behind a flag. Keep baking, force-event contacts, SIMD, the worker
path and the 30/60 Hz option.

## Decisions already taken

- Bit-identical replay is not a requirement. Deterministic ordering is still good hygiene, but
  budget-driven, camera-aware and multi-world techniques are allowed.
- Render runs at display rate (120 FPS) and interpolates. Physics rate is a separate knob.
- Test and tune on the large frame only. Feel in the browser is the acceptance bar; the user runs
  the play test. Workers do not do display checks.
- We are iterating on the design. No packaging, docs or test maintenance until asked.

## Architecture: rigid compounds joined by compliant seams

The core idea that makes layer 2 affordable in a browser: a damaged building is a small tree of
rigid compound bodies connected by compliant joints at the places where bonds have yielded. Intact
regions stay merged (one Rapier body, many colliders, which Rupture's islands already are). Only the
seams are joints. Pieces only become loose when a seam breaks. Body count during a slump stays in
the tens or low hundreds, not thousands, and joints are far cheaper than the contacts a pile of
loose pieces generates.

Bond lifecycle becomes:

    intact -> cracked -> yielding -> COMPLIANT (new) -> broken

- **Compliant** is entered when the support-path load exceeds static capacity. The bond's two
  sides are split into separate compound bodies (or the existing island split is reused) and a
  Rapier joint is created across the seam: a spring or generic joint with stiffness and damping
  derived from the bond's section and material, angular limits so slabs can hinge but not spin,
  and a breaking force and torque derived from remaining capacity.
- Each tick the joint's applied impulse is read. Sustained impulse above the breaking threshold
  for a short time (in seconds, rate-independent) breaks the seam: joint removed, bodies loose.
- Neighbouring compliant seams in the same region are grouped so a slab hinges as one seam, not
  as a row of independent springs. This is the single most important detail for cost and for
  look.
- The display displacement from the elastic solver is no longer needed for sag; the sag is real.

Risks: a chain of compliant joints across a large compound can be soft and jittery at low solver
iteration counts. Mitigations: stiff springs with high damping, joint grouping, position-based
joint correction (Rapier's joint ERP), and a cap on compliant seams per body.

## Real-time guarantee

Physics must never run slower than wall-clock. Fidelity gives instead.

- **Step budget.** The worker measures each step. When a step would exceed the fixed dt, the
  engine degrades before the next step, in this order: sleep bodies below a velocity threshold
  immediately; bake the slowest awake loose pieces, oldest first; defer refinement of pieces that
  are not exposed; finally, skip sub-fracture entirely for that step. Selection is by sim state
  only.
- **Sleep fast.** Rapier's sleep thresholds and timers tuned for heavy slow concrete: a settled
  chunk sleeps within a few hundred milliseconds, not seconds.
- **Physics rate.** 30 Hz default, 20 Hz as a tested fallback for the collapse phase. Constants
  are already in seconds.
- **Debris tiers.** Large chunks persist and bake. Small debris (under a volume threshold) has a
  lifetime of a few seconds and a hard live cap; the oldest is removed first.
- **Refine where seen.** Sub-fracture happens on exposed faces and at impact points, not inside
  piles or on the undersides of slabs. A seam that breaks produces chunks at the seam, not a
  storm of 1 m pieces across the whole slab.

## Phases

### Phase 1: never slow motion (small, do first)

Step budget with the degradation ladder above, fast sleeping, debris tiers, 2 m cells parked
behind a flag. Deliverable: Demolish on the large frame runs at wall-clock on the worker page at
30 Hz and reads the same as the 1 m main-thread page does today. The overlay shows ms per step
under 1000 / Hz throughout.

### Phase 2: the Blast model at member level, then dynamic connections

Governed by [the reference architecture](./rupture-reference-architecture.md); the rows below
are implemented as the reference does them, in this order.

1. **Chunk hierarchy and member-level support graph (rows A1 to A5).** Depth 0 authored element,
   depth 1 member segment (column per storey, slab per bay, wall per panel), depth 2 today's
   cells, depth 3+ run-time sub-fracture. Support chunks are depth 1; cells are subsupport.
   World bonds replace the anchored flag. An actor renders and collides as its shallowest intact
   chunks. Chunk health with min/max damage thresholds per material.
2. **Fracture pipeline (row A6).** Explicit fracture command buffers; radial, capsule, shear and
   impact-spread graph shaders plus the subgraph shader; generate, apply, split as three calls.
   The user's tweak: a damaged but supported chunk demotes to its children in place.
3. **Direct structural solve (row B2).** Sparse Cholesky over the depth-1 connection graph,
   factored on create and refactored incrementally; tension/compression, shear and bending terms
   with per-material multipliers; break on impulse above baseline + offset. The support-path
   model stays as the over-budget fallback.
4. **Compliant connections (rows A9 and B3).** A connection past its elastic limit becomes a
   Rapier joint between the two actors; its applied impulse feeds the baseline test; adjacent
   compliant connections on one interface share a joint; un-bake on seam motion.

Deliverable: on the large frame, a single charge removes a member's worth of cells with big
chunks first; knocking out the ground floor makes the building slump, floors tilt and sag, then
fail progressively, with actor count in the low hundreds during the slump because standing and
falling members are single actors, not cell soup. The earlier phase-2 text ("compliant bond
state, seam joints") is item 4 of this list; it is not done before items 1 to 3.

### Phase 3: knock-on and pressure

Landing impulses delivered through the receiving structure's bond graph (partly in already) so a
collapsing building damages its neighbour. Explosion pressure applied as impulse to roof and wall
compounds so roof sections lift and slabs flex before failing. Pieces thrown by blasts.

### Phase 4: presentation

Dust and smoke from the events the engine already emits (heavy impact, blast, seam break), scaled
by mass and impulse. Damaged-edge visuals: smaller, consistent fracture edges on the exposed faces
of chunks so damage location reads clearly. Camera shake from heavy impacts.

### Later

Multiple Rapier worlds across workers for independent buildings. Material-specific failure
(masonry, glass, thin members). Per-joint capacity channels (weak tension, strong compression)
which the compliant seam model makes natural, since stiffness and breaking limits are per seam.

## Decisions from the user (2026-10-06)

1. **Phase order:** real-time guarantee (phase 1) first, then dynamic connections.
2. **Physics rate:** 30 Hz is the floor. The budget degrades fidelity (sleep, bake, defer
   refinement, skip sub-fracture), never rate. No 20 Hz rung.
3. **Debris tiers:** small pieces (under a volume threshold) settle, then after about 8 s sink
   into the ground over about 1 s and are removed. Large chunks persist and bake. A hard live cap
   removes the oldest small pieces first.

## Open for phase 2

- Should slabs be allowed to hang by one seam (dramatic, Finals-like) or should a slab with a
  single remaining seam always break (safer for cost and for gameplay readability)?
- Row B2 is a direct solver in TypeScript. It is sized for hundreds of member-level nodes per
  building; see Part D of the reference architecture for the fallback if a level exceeds that.

## Revision 2026-10-06

Phase 2 rewritten after the user pointed out that the plan had substituted cheaper mechanisms
(2 m cells that refine to 1 m, a step budget ahead of any hierarchy) for the Blast and Finals
methods. The reference architecture document is now the governing spec; this plan only orders it.
