# Feel

Movement, camera, aim and controls: the numbers shipped character systems use, and the failures that taught each rule. Put the ones the game uses in `src/game/model.ts` and give them to the check contract as `model.feel`; `blacksite check --only feel` measures them back. Wiring for the character and input blocks is in [building-blocks.md](building-blocks.md).

## Movement

| Number | Value | Source |
|---|---|---|
| Walk / run / sprint, standing | 1.75 / 3.75 / 6.5 m/s | ALS movement settings |
| Walk / run, crouched | 1.5 / 2.0 m/s | ALS |
| Walk while aiming | 1.65 m/s | ALS |
| Acceleration, normal | 20 m/s² from rest, falling to 7.5 at sprint | ALS |
| Braking | 15, then 12.5, then 5 m/s² at sprint | ALS |
| Acceleration, responsive | 25 → 5 m/s², braking 20 → 8 | ALS, for twitchier games |
| Time to 90% of run speed | About 0.25 s (Checkpoint measures 0.23 s) | Check |
| Jump | 4.2 m/s at 9.8 m/s² gravity, about a 0.9 m apex | ALS |
| Walkable slope | About 45° | ALS |
| Capsule | Radius 0.3 m, height 1.8 m standing, 1.12 m crouched | ALS |
| Mantle | Ledges 0.5–2.25 m from the ground, 0.5–1.5 m in the air | ALS |
| Physics step | Fixed 1/60 s | Every template |
| Template walker | 1.75 m/s walk, 3.75 run, 6.5 sprint, 0.25 s to top speed, 0.9 m apex | `src/game/model.ts` |
| Firing range | 3.1 m/s walk, 5.2 sprint, 1.8 aiming | Firing Range |

Players expect **coyote time** (0.1 s after leaving a ledge) and a **jump buffer** (0.1 s before landing); the template's motor has both, the ALS character and Subject don't. Add a camera dip on landing; the walker already plays the landing sound. The standalone first-person subject has no gravity, collision or jump, which is why the `fpp` template puts it on the walker.

## Camera

| Number | Value |
|---|---|
| First-person eye height | 1.63 m standing, 1.0 m crouched, smoothed at exp(−20·dt) |
| World FOV, first person | 75° (35–110 allowed), Arena uses 88° on desktop |
| Aim FOV | 58° default; rifle 50°, pistol 60° in the Firing Range |
| FOV blend | exp(−14·dt) |
| Viewmodel FOV | 56°, in its own pass |
| Near plane | 0.05 m world, 0.005 m viewmodel (see `craft.md` for the depth-buffer case for 0.1 m) |
| Mouse | 0.0022 rad per pixel × sensitivity (0.25–2, default 1) |
| Pitch clamp | ±85° |
| Touch look | 0.0042 rad per pixel |
| Gamepad look | 240°/s yaw, 90°/s pitch, radial dead zone 0.2 |
| Third-person FOV | 90° horizontal, converted to vertical for the aspect |
| Third-person orbit camera | 1° per pixel with no sensitivity prop; Checkpoint scales pointer events by 0.55 |
| Aim blend in the viewmodel | 16/s; sprint blend 10/s; bob 0.006 walking, 0.012 sprinting |
| Recoil | 55% of each kick stays as climb (recovers at 28/s), the rest settles at 11/s |

A third-person camera has a shoulder offset, a collision-traced spring arm, lag on position but not on aim, and a narrower FOV when aiming.

## Landing and camera motion (proposed)

From Breach and Traverse (`examples/*/src/model.ts`).

- **Landing dip scales with fall speed.** First person: 6 cm × min(1, landing speed ÷ 6 m/s). Third person: up to 0.12 m, critically damped at ω 9, scaling from 2 to 8 m/s of fall speed. The arms add their own dip: 0.0075 m per m/s, at most 0.04 m, on a spring (stiffness 95, damping 11).
- **Crouch takes 0.2 s**, not one frame.
- **The spring arm snaps in and eases out.** Pull the camera in within one frame to avoid a wall, and ease it back out over about 0.4 s to avoid a pop, with a 0.15 m sphere probe. No frame ever has geometry inside the near plane.
- **A shoulder swap is a move, not a cut.** A 0.5 m shoulder offset swapped over 0.5 s, with no step over 0.12 m in one 1/60 s frame.
- **Shake is one trauma value** shared by hits, shots and landings (`combat.md`).

## First person

- **One set of arms.** The arms viewmodel with the local body hidden, or the full body from the head socket with the head and eyes masked (`colorWrite` and `depthWrite` off). Never both: a viewmodel was once mounted while the full body stayed visible.
- **The viewmodel draws last**, through the look's overlay, with its own 56° FOV. The rifle sits lower right at about 30% of a 16:9 width. Sprint lowers and cants the weapon with bob and roll rather than swinging full-body sprint poses across the screen.
- **Narrow screens widen the vertical FOV** to hold horizontal coverage, for the world and the viewmodel: below 4:3 for split views, below 0.8 aspect for portrait phones (`portraitFov`). The hip framing slides inward on portrait, with a lens offset that fades to zero in ADS so the sights stay centred.
- **Portrait is a different shot.** On a tall phone screen the upper arms filled the view. Pulling the weapon away was not enough; a portrait-only camera offset that fades out in ADS kept both hands and the weapon in frame.
- **Cropped meshes end off screen.** Cropping a body at the elbow left rounded capsule ends in pistol aim and on phones. A sleeve on each forearm now runs past the edge of the screen in every pose and aspect.

## Rules, and the failures that taught them

- **One owner for the view.** Subject and the ALS camera each read the same mouse at different sensitivities. At 144 Hz render and 60 Hz physics the yaw sawtoothed by 1.748°. With one control-rotation source the error was under 1e-12°. Pass Subject's yaw and pitch to the character and to `AlsCamera.controlRotationSource`. When joining prototypes, two that both read the mouse or both own the player's position will fight.
- **Frame order.** Control rotation, character, physics, pose, animation, camera, then attachments. Done the other way, held objects lag one frame behind. Physics was moved before pose and camera, and the arms attach after the final camera; the measured residual was 5.6e-15.
- **Send gait, not speed.** Characters looked like they were in slow or fast motion because the bridge passed `desiredSpeed: 300/600`, values in cm/s, to an API in m/s and left out gait. At a real 3.75 m/s the graph picked Walking and played the walk at 2.5× instead of the run at 1.07×. The clocks were already correct, so no time multiplier was added. Send `desiredGait` (`Walking`, `Running`, `Sprinting`) and let the character pick its authored speed.
- **Prove locomotion by foot slip.** A test actor moved at zero velocity advanced its animation clock for 3.8 s while its stride phase never changed and its foot slid over 10 m. Bound planted-foot slip instead: 3 cm per plant. Measured slip was 0.83 cm walking, 1.03 cm running and 1.78 cm sprinting.
- **Scale look while aiming.** Multiply look sensitivity by the aim FOV over the hip FOV so the crosshair moves the same distance on screen.
- **Pointer lock is optional.** Phones threw `WrongDocumentError` from an unconditional lock request, and nothing could drive a player without it, which blocked touch and Arena's bot. Skip lock on touch, catch a refused request, and give every controllable character a virtual input path (`setVirtual`, `keySubject`, `lookSubject`).
- **Clear held input on blur.** A key held while the tab loses focus must release, or the player walks forever. Clear on disconnect and possession change too.
- **Show the right glyphs.** Swap prompts to the last device used.

## Controls

| Number | Value |
|---|---|
| Gamepad activity threshold | 0.25 |
| Menu stick as a button | 0.55; repeat after 0.35 s, then every 0.16 s |
| Aim assist | Slowdown 0.55 in a 1.75° cone, magnetism 0.3 in 2.5°, snap 2.5° over 0.16 s in 4°; half on hip fire |
| Touch stick | 124 px with a 52 px knob, 22 px from the left and 28 px from the bottom plus the safe area; dead zone 0.1–0.15 |
| Touch look zone | The right 60% of the screen |
| Touch buttons | 52 px by default, at least 44 px |
| Touch sprint | Stick pushed past 0.92 |
| Touch look scale | Scaled up (×1.7 in Arena), because thumbs travel less than mice |

Everything is playable by touch at 390 px wide, with the HUD clear of the focal point.
