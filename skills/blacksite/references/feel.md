# Feel

Movement, camera and aim numbers taken from shipped character systems and from the kit's own tuning. Put the ones the game uses in `src/game/model.ts` and give them to the check contract as `model.feel`; `blacksite check --only feel` measures them back.

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

Players expect **coyote time** (0.1 s after leaving a ledge) and a **jump buffer** (0.1 s before landing); the template's motor has both. Add a camera dip on landing; the walker already plays the landing sound. The standalone first-person subject has no gravity, collision or jump, which is why the `fpp` template puts it on the walker.

## Camera

| Number | Value |
|---|---|
| First-person eye height | 1.63 m standing, 1.0 m crouched, smoothed at exp(−20·dt) |
| World FOV, first person | 75° (35–110 allowed), Arena uses 88° on desktop |
| Aim FOV | 58° default; rifle 50°, pistol 60° in the Firing Range |
| FOV blend | exp(−14·dt) |
| Viewmodel FOV | 56°, in its own pass |
| Near plane | 0.05 m world, 0.005 m viewmodel |
| Mouse | 0.0022 rad per pixel × sensitivity (0.25–2) |
| Pitch clamp | ±85° |
| Touch look | 0.0042 rad per pixel |
| Gamepad look | 240°/s yaw, 90°/s pitch, radial dead zone 0.2 |
| Third-person FOV | 90° horizontal, converted to vertical for the aspect |
| Aim blend in the viewmodel | 16/s; sprint blend 10/s; bob 0.006 walking, 0.012 sprinting |
| Recoil | 55% of each kick stays as climb (recovers at 28/s), the rest settles at 11/s |

## Rules, and the failures that taught them

- **One owner for the view.** Subject and the ALS camera each read the same mouse at different sensitivities. At 144 Hz render and 60 Hz physics the yaw sawtoothed by 1.748°. With one control-rotation source the error was under 1e-12°. Pass Subject's yaw and pitch to the character and to `AlsCamera.controlRotationSource`.
- **Frame order.** Control rotation, character, physics, pose, animation, camera, then attachments. Physics was moved before pose and camera, and the arms attach after the final camera; the measured residual was 5.6e-15.
- **Send gait, not speed.** Characters looked like they were in slow or fast motion because the bridge passed `desiredSpeed: 300/600`, values in cm/s, to an API in m/s and left out gait. At a real 3.75 m/s the graph picked Walking and played the walk at 2.5× instead of the run at 1.07×. The clocks were already correct, so no time multiplier was added. Send `desiredGait` (`Walking`, `Running`, `Sprinting`) and let the character pick its authored speed.
- **Prove locomotion by foot slip.** A test actor moved at zero velocity advanced its animation clock for 3.8 s while its stride phase never changed and its foot slid over 10 m. Bound planted-foot slip instead: 3 cm per plant. Measured slip was 0.83 cm walking, 1.03 cm running and 1.78 cm sprinting.
- **Pointer lock is optional.** Phones threw `WrongDocumentError` from an unconditional lock request, and nothing could drive a player without it, which blocked touch and Arena's bot. Skip lock on touch, catch a refused request, and give every controllable character a virtual input path (`setVirtual`, `keySubject`, `lookSubject`).
- **Scale look while aiming.** Multiply look sensitivity by the aim FOV over the hip FOV so the crosshair moves the same distance on screen.

## Touch

The stick is 124 px with a 52 px knob, 22 px from the left and 28 px from the bottom plus the safe area. The look zone is the right 60% of the screen. Buttons are at least 44 px, 52 px by default. A stick pushed past 0.92 sprints. Look on touch is scaled up (×1.7 in Arena) because thumbs travel less than mice. See `input.md`.
