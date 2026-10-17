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
| Max step | 0.45 m | UE CharacterMovement default `MaxStepHeight`. Anything at or above 0.5 m is a mantle, not a step. ALS Web had no step-up; Traverse adds it in `vendor/als-web`. |
| Walkable slope | 44.8° | UE CharacterMovement default walkable floor angle (z ≥ 0.71). |
| Acceleration | 20 m/s², 90% of run speed in 0.20 s | ALS ground acceleration. The continuous ramp takes 0.17 s; the 60 Hz step needs 11 steps and input is read on the next step, so the model predicts 12 steps (0.20 s), inside feel.md's 0.25 s. |
| Jump | 4.2 m/s, discrete-step apex 0.865 m | ALS `JumpZVelocity`, 9.8 m/s² gravity and a 60 Hz semi-implicit physics step. The continuous trajectory reaches 0.90 m. |
| Jump buffer | 0.1 s | feel.md: a press up to 0.1 s before landing still jumps. |
| Coyote time | 0.1 s | feel.md: a press up to 0.1 s after running off a ledge still jumps. |
| Landing | camera dip 0.12 m at full strength, critically damped at ω 9 | feel.md asks for a dip and a sound on landing; strength scales from 2 m/s to 8 m/s of fall speed. |

### Mantle

| Number | Value | Source |
| --- | --- | --- |
| Grounded ledge range | 0.50–2.25 m | ALS `CS_Als_Default` grounded trace. |
| Low / high split | 1.25 m | ALS `MantlingHighHeightThreshold`. |
| Route ledges | 0.50, 0.75, 1.00, 1.25, 1.50, 1.75, 2.00 m | Every quarter metre of the bar. Each height appears on the route at least once, in rising order before the first fork. |
| Success | 100% of scripted approaches at each height reach the top inside 1.8 s | A mantle that fails once in ten is a bug report. The authored high mantle takes 1.55–1.73 s at 1.75–2.0 m. |
| Ledge depth | ≥ 0.6 m | The capsule must fit on top; every wall on the route is 0.7–0.8 m deep. |

### Feet

| Number | Value | Source |
| --- | --- | --- |
| Planted-foot travel per contact | p95 ≤ 3 cm | feel.md: bound planted-foot slip at 3 cm per plant. The contact probe includes start, stop and gait changes. |
| Planted-foot drift, flat / uneven | p95 ≤ 0.10 / 0.15 m/s | Foot skate is the classic motion-matching failure metric (Holden et al., Learned Motion Matching, 2020). Foot IK on stairs and slopes adds pelvis and foot offsets on top of the locked pose. |
| Gait changes | same planted-contact bar | Start, stop and gait transitions are included in the contact checks. |
| Foot-to-ground gap while planted | ≤ 0.04 m | Above 4 cm a foot visibly floats at the default camera distance. |
| Stairs | riser 0.17 m, tread 0.28 m | Building-code stairs (IBC: riser ≤ 178 mm, tread ≥ 279 mm). |
| Slopes on the route | 10°, 20°, 30° | Ramp, rubble and a fallen slab, all walkable. |

The contact probe measures the final rendered foot against an independent physics raycast. Grounded moving stance is selected by the authored signed `FootPlanted` curve at 0.75; it is measured even if the foot floats. An idle `FootLock` request at 0.99 acquires contact only after the ankle reaches within 2.5 cm of its calibrated floor height, then remains measured until the lock or grounded state ends. This prevents the stopping clip's early lock request from counting a foot that is still descending, without hiding a foot that later floats. Each contact discards one boundary frame at either end and requires three remaining samples. Drift is total horizontal travel divided by duration; excursion is maximum displacement from the first sample. Both idle feet must separately settle within 4 cm of the floor.

### Camera

| Number | Value | Source |
| --- | --- | --- |
| Probe | sphere, 0.15 m | ALS camera trace (spring-arm sweep). |
| Pull-in / ease-out | in one frame / eased over about 0.4 s | GDC 2014, John Nesky, "50 Game Camera Mistakes": snap in to avoid a wall, ease out to avoid a pop. |
| Clip budget | 0 frames with geometry inside the near plane | Measured by a sphere query of radius `near × tan(fov/2) × √(1 + aspect²)` at the camera each frame of every scripted run. |
| Shoulder | 0.5 m offset, 0.5 s swap, no frame step over 0.12 m | ALS `CF_Als_CameraBlend_Quick` is 0.5 s. A swap that teleports reads as a cut. |
| Lag | location lag from ALS, no visible stutter at 120 fps | ALS camera settings. |

### Input

| Number | Value | Source |
| --- | --- | --- |
| Mouse | 0.0022 rad per pixel (0.126°) | feel.md. |
| Touch look | 0.0042 rad per pixel × 1.7 | feel.md: thumbs travel less than mice. |
| Gamepad look | 240°/s yaw, 90°/s pitch, dead zone 0.2 | feel.md. |
| Touch sprint | stick past 0.92 | feel.md. |
| Roll | tap Shift under 0.25 s | Hold Shift sprints. |

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
| Desktop | 120 fps, main-thread p95 ≤ 8.3 ms |
| Phone | 60 fps sustained, main-thread p95 ≤ 16.7 ms, half the ash, low look tier, pixel ratio ≤ 1.25, 1024 shadow map |
| Hitch | no frame over 33 ms after first playable |
| First playable | under 5 s |
| Sound | ≤ 32 voices desktop, 16 phone; one-shots have at least 4 variants, ±5% pitch, ±1.5 dB, no back-to-back repeat. Musical chimes preserve their melody with zero pitch jitter and four tuned voicings: plain, upper octave, lower octave and fifth. The graph, impulse responses and recordings are prepared during loading; an early gesture resumes a silent mixer until the recorded outdoor bed is registered. |
| JavaScript | every chunk under 4 MB (rapier, three, ALS and vendor split) |
| Draw calls | ≤ 180 desktop, ≤ 120 phone |
| Shadowed lights | 1 (the sun) |
| Point lights | ≤ 4 practicals lit at once |

## The route

A ruined khrushchyovka block: a five-storey panel block, a row of garages, a boiler house with a chimney, and the yards between them. Overcast, heavy fog, birch and dead poplars.

1. **Gate** — the start, under the arch of the block. Kerb (0.50 m) and a planter (0.75 m) teach the first mantle.
2. **Garage yard** — a low wall (1.00 m), then a dumpster (1.25 m) to the garage roofs (1.50 m from the dumpster lid's side). The 2.00 m boiler-house ledge later on the route is the discovery shortcut, approached from a raised service platform.
3. **Garage roofs** — run the roofs, jump a 1.2 m gap, drop 3 m into the boiler yard. A hard landing rolls.
4. **Boiler yard** — rubble slope (20°), a fallen slab (30°), a broken fence. The ragdoll is here: a loose barrel stack.
5. **Stairwell** — three flights, 17 cm risers, landings with a flickering tube light. Out of a blown wall on the third floor.
6. **Rooftop** — the boiler house roof (drop 1.5 m), a parapet (1.75 m), the plant room (2.00 m), a water tank.
7. **Descent** — a 30° fallen roof slab down to the far yard, followed by the 10° loading ramp and dock.
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
| Audio | Soundscape: bed, spot emitters, one-shots, 3 zones, occlusion | wind bed that rises with height, room tone indoors; tube buzz, fire crackle, dripping pipe, tarp loops with ray occlusion; surface footsteps and landings (concrete, metal garage roofs, dirt rubble, water puddles), body landing, mantle, roll, ragdoll, checkpoint chimes; outdoor, arch (corridor) and stairwell (hall) reverb |
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
- `start`: run from rest; time to 90% of run speed and jump apex match the model.
- `feet-flat`, `stairs`, `slope`: run across each; planted foot speed and gap within the bar.
- `ramp-foot`: run and sprint into the foot of each rising ramp from 12 sub-step start offsets; none stalls.
- `actions`: roll, ragdoll and get up, drop and land, and cross a low wall without stopping.
- `camera-wall`: walk along walls and into corners while turning the camera; zero clip frames.
- `shoulder`: swap shoulders while running; no frame step over the bar.
- `ghost`: a recorded take stays under the storage and pose-cost budgets at the player's scale.
- `route`: the reference run of the whole route finishes under par with zero clip frames and draw calls under budget.


## Delivered parts inventory

The route contains eight garage bays, seven apartment blocks, a boiler house and chimney, the stairwell, two arches and two sheds. The six trim families and eight decal families listed above are present. Props include 15 crates, 24 pallets, 23 stacked tyres, four cars, a transport hull, water tank, three benches, three radiators and six roof vents, in addition to the original barrels, trees and rubble. These are merged by material through the public world kit.

Eight practical sources (three sodium lamps, three fluorescent tubes, two fires) share a maximum of four nearby point lights. The sun is the sole shadow caster. Nine located audio spots, including the steam outlet, use outdoor, corridor and hall acoustic zones. Recorded concrete, metal, gravel and water footsteps each have five variants; the source and processing record is in `CREDITS.md` and `assets.credits.json`.

Checkpoint respawn poses are authored on safe floor surfaces independently of trigger bounds. The phone stick sprints at full travel; the six action buttons provide jump/mantle, roll, crouch, shoulder, ragdoll/get-up and checkpoint retry. After finishing, Retry starts the next race against the saved ghost.
