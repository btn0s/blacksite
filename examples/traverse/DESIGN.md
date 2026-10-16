# Traverse — design

Tier: **Slice**. One space, a ruined courtyard block, with the full look, sound and feel. The player runs a timed route through its yards, garage roofs, a stairwell and a rooftop, racing a ghost of their best run. Traverse is the bar for character feel and the third-person camera.

The shipped version we build: the third-person traversal of a modern action game. An authored animation graph with foot locking and foot IK, distance-matched mantles over any ledge from knee to above the head, a spring-arm camera with soft lag, a sphere collision probe that pulls in fast and eases out slow, and a smooth shoulder swap, and a time trial with split times and a ghost. We already have the animation graph (ALS Web); this example sets the numbers it must hit and the checks that prove it.

## Model

`src/model.ts` holds every number below. The game reads them from there; the checks measure against them.

### Locomotion (from the ALS Web authored settings, the ALS Refactored data)

| Number | Value | Source |
| --- | --- | --- |
| Walk | 1.75 m/s | ALS `MS_Als_Normal` walk speed. Human preferred walking speed is 1.3–1.4 m/s (Bohannon 1997); a game walk is a brisk walk. |
| Run | 3.75 m/s | ALS run speed: a jog. |
| Sprint | 6.5 m/s | ALS sprint speed. A trained runner's 400 m pace is 7–8 m/s; a game sprint must stay readable through doorways. |
| Crouch walk / run | 1.5 / 2.0 m/s | ALS crouching settings. |
| Capsule | radius 0.30 m, half height 0.90 m (1.80 m tall) | ALS capsule, the UE mannequin proportions. |
| Max step | 0.45 m | UE CharacterMovement default `MaxStepHeight`. Anything at or above 0.5 m is a mantle, not a step. |
| Walkable slope | 44.8° | UE CharacterMovement default walkable floor angle (z ≥ 0.71). |
| Jump | see `model.ts` | ALS jump velocity and gravity. |

### Mantle

| Number | Value | Source |
| --- | --- | --- |
| Grounded ledge range | 0.50–2.25 m | ALS `CS_Als_Default` grounded trace. |
| Low / high split | 1.25 m | ALS `MantlingHighHeightThreshold`. |
| Route ledges | 0.50, 0.75, 1.00, 1.25, 1.50, 1.75, 2.00 m | Every quarter metre of the bar. Each height appears on the route at least once, in rising order before the first fork. |
| Success | 100% of scripted approaches at each height reach the top inside 1.6 s | A mantle that fails once in ten is a bug report. |

### Feet

| Number | Value | Source |
| --- | --- | --- |
| Planted foot speed, flat run | p95 ≤ 0.10 m/s, mean ≤ 0.04 m/s | Foot skate is the classic motion-matching failure metric (Holden et al., Learned Motion Matching, 2020, measures it as planted-foot drift). ALS foot locking pins a planted foot; what remains is blend and IK error. |
| Planted foot speed, stairs and 20° slope | p95 ≤ 0.15 m/s | Foot IK on stairs adds pelvis and foot offsets on top of the locked pose. |
| Foot-to-ground gap while planted | ≤ 0.04 m | Above 4 cm a foot visibly floats at the default camera distance. |
| Stairs | riser 0.17 m, tread 0.28 m | Building-code stairs (IBC: riser ≤ 178 mm, tread ≥ 279 mm). |
| Slopes on the route | 10°, 20°, 30° | Ramp, rubble and a fallen slab, all walkable. |

"Planted" means the foot bone is within 0.06 m of the ground under it and the character is grounded and not in an action. A foot is sliding when its horizontal speed in that phase exceeds the bar.

### Camera

| Number | Value | Source |
| --- | --- | --- |
| Probe | sphere, radius in `model.ts` | ALS camera trace (spring-arm sweep). |
| Pull-in / ease-out | in one frame / eased over about 0.4 s | GDC 2014, John Nesky, "50 Game Camera Mistakes": snap in to avoid a wall, ease out to avoid a pop. |
| Clip budget | 0 frames with geometry inside the near plane | Measured by a sphere query of radius `near × tan(fov/2) × √(1 + aspect²)` at the camera each frame of every scripted run. |
| Shoulder swap | 0.35 s ease, no frame step over 0.12 m | A swap that teleports reads as a cut. |
| Lag | location lag from ALS, no visible stutter at 120 fps | ALS camera settings. |

### Route and ghost

| Number | Value | Source |
| --- | --- | --- |
| Route length | about 260 m | Time-trial courses in action games run 45–90 s. |
| Checkpoints | 7 plus finish | One per space. |
| Par / gold | 75 s / 58 s | Measured on the scripted reference run (see `checks`). |
| Ghost sample rate | 20 Hz | Root position, yaw and bone rotations, quantised; replayed with interpolation. |
| Ghost cost | ≤ 0.15 ms per frame, ≤ 1 MB per minute | A ghost is a recording, not a second character. |

### Frame

| Number | Value |
| --- | --- |
| Desktop | 120 fps, 8.3 ms frame, p95 ≤ 9 ms |
| Phone | 60 fps sustained, 16.7 ms frame |
| First playable | under 5 s |
| Draw calls | ≤ 180 desktop, ≤ 120 phone |
| Shadowed lights | 1 (the sun) |
| Point lights | ≤ 4 practicals lit at once |

## The route

A ruined khrushchyovka block: a five-storey panel block, a row of garages, a boiler house with a chimney, and the yards between them. Overcast, heavy fog, birch and dead poplars.

1. **Gate** — the start, under the arch of the block. Kerb (0.50 m) and a planter (0.75 m) teach the first mantle.
2. **Garage yard** — a low wall (1.00 m), then a dumpster (1.25 m) to the garage roofs (1.50 m from the dumpster lid's side). A 2.00 m garage back wall is the discovery shortcut: mantle it straight from the ground.
3. **Garage roofs** — run the roofs, jump a 1.2 m gap, drop 3 m into the boiler yard. A hard landing rolls.
4. **Boiler yard** — rubble slope (20°), a fallen slab (30°), a broken fence. The ragdoll is here: a loose barrel stack.
5. **Stairwell** — four flights, 17 cm risers, landings with a flickering tube light. Out of a blown wall on the third floor.
6. **Rooftop** — the boiler house roof (drop 1.5 m), a parapet (1.75 m), the plant room (2.00 m), a water tank.
7. **Descent** — a 10° ramp of fallen roof sheet down to the far yard.
8. **Finish** — under the second arch.

## Parts list

| Group | Minimum | Planned |
| --- | --- | --- |
| Set dressing: kit pieces | 12 | panel block, garages ×8, boiler house, chimney, stairwell shell, arches ×2, fences, parapets |
| Set dressing: trims | 6 | kerbs, window frames, roof edges, stair nosings, parapet caps, garage door frames |
| Set dressing: decals | 8 | stains, cracks, soot, graffiti tags, puddles, oil, numbers on garages, route arrows |
| Set dressing: props | 25 | dumpsters, Ladas, barrels, crates, tyres, pipes, benches, laundry poles, tank, antennas, trees, rubble |
| Lighting | key, fill, bounce, 3 practicals | overcast sun (only shadow caster), hemisphere fill, bounce from the sky environment, a stairwell tube light, a sodium lamp, a fire barrel; emissive windows |
| Atmosphere | fog plus 2 particle systems | exponential fog, falling ash/snow, dust puffs, a steam vent |
| Audio | bed, 3 spot emitters, one-shots, 2 reverb zones | wind bed and distant drone; tube buzz, fire crackle, dripping pipe; footsteps, landing, mantle, roll, checkpoint, ghost; stairwell and open-yard reverb |
| Feedback | every action | land: thud, dust, camera dip; mantle: hand slap and cloth; roll: body roll; checkpoint: chime, marker flash, split time; ragdoll: impact |

## Camera bookmarks

Fixed views for critic captures, in world metres. Each bookmark has a position, a target and a vertical FOV, and a matching place to stand the character.

| Name | What it shows |
| --- | --- |
| `gate` | The first view of the game: the arch, the kerb and the yard behind. |
| `garages` | The garage row and the dumpster, with the 2 m back wall. |
| `roofs` | The roof run and the gap from behind the character. |
| `boiler-yard` | The rubble slope, slab and chimney. |
| `stairwell` | Inside, the flights and the tube light. |
| `rooftop` | The parapet and plant room against the sky. |
| `finish` | The far yard and the second arch. |
| `hero` | Over the shoulder, character close, at the dumpster. |

## Checks

Each scripted run drives input the way a player does and measures against the model:

- `mantle-ladder`: approach a ledge of each route height at walk, run and sprint; all reach the top.
- `feet-flat`, `feet-stairs`, `feet-slope`: run across each; planted foot speed and gap within the bar.
- `camera-wall`: walk along walls and into corners while turning the camera; zero clip frames.
- `shoulder`: swap shoulders while running; no frame step over the bar.
- `route`: the reference run of the whole route; it completes, sets the par, and records a ghost.
