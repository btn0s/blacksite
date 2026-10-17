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

Players expect **coyote time** (0.1 s after leaving a ledge) and a **jump buffer** (0.1 s before landing); the template's motor has both, the ALS character and Subject don't. Add a camera dip on landing (below); the walker already plays the landing sound. The standalone first-person subject has no gravity, collision or jump, which is why the `fpp` template puts it on the walker.

## Camera

| Number | Value |
|---|---|
| First-person eye height | 1.63 m standing, 1.0 m crouched, smoothed at exp(−20·dt) |
| World FOV, first person | 75° (35–110 allowed), Arena uses 88° on desktop |
| Aim FOV | 58° default; rifle 50°, pistol 60° in `VIEWMODEL_WEAPONS` |
| FOV | Hip to aim on the ADS curve, plus sprint and punch springs; summed in horizontal degrees at 16:9, then converted to vertical |
| Viewmodel FOV | 56°, in its own pass |
| Near plane | 0.05 m world, 0.005 m viewmodel (see `craft.md` for the depth-buffer case for 0.1 m) |
| Mouse | 0.0022 rad per pixel × sensitivity (0.25–2, default 1) |
| Pitch clamp | ±85° |
| Touch look | 0.0042 rad per pixel |
| Gamepad look | 240°/s yaw, 90°/s pitch, radial dead zone 0.2 |
| Third-person FOV | 90° horizontal, converted to vertical for the aspect |
| Third-person orbit camera | 1° per pixel with no sensitivity prop; Checkpoint scales pointer events by 0.55 |
| ADS time | 0.3 s × (1 + 0.35 × (heft − 1)): rifle 0.3 s, pistol 0.26 s, on a quintic ease. Out takes 0.8× as long. Measured to 90%: about 0.24 s in, 0.19 s out |
| Sprint pose | A cubic Hermite over 0.26 s, raised again before the weapon can fire |
| Recoil | Every kick returns (below) |

A third-person camera has a shoulder offset, a collision-traced spring arm, lag on position but not on aim, and a narrower FOV when aiming.

## Landing and camera motion (proposed)

From Breach and Traverse (`examples/*/src/model.ts`).

- **Landing dip scales with fall speed.** First person: see the springs below; the camera moves about 2 mm and the arms carry the weight. Third person: up to 0.12 m, critically damped at ω 9, scaling from 2 to 8 m/s of fall speed. The arms add their own dip: 0.0075 m per m/s, at most 0.04 m, on a spring (stiffness 95, damping 11).
- **Crouch takes 0.2 s**, not one frame.
- **The spring arm snaps in and eases out.** Pull the camera in within one frame to avoid a wall, and ease it back out over about 0.4 s to avoid a pop, with a 0.15 m sphere probe. No frame ever has geometry inside the near plane.
- **A shoulder swap is a move, not a cut.** A 0.5 m shoulder offset swapped over 0.5 s, with no step over 0.12 m in one 1/60 s frame.
- **Hits and landings roll the view**, on the same flinch spring (`combat.md`).

## Camera and weapon motion

Every number below is in `@blacksite/subject-fpp/feel` (`CAMERA_FEEL`, `GUN_FEEL`, `RECOIL_TUNING`). Breach and the `fpp` template both use it: `createCameraFeel` for the eye, `createAimRecoil` for the view's recoil, and the arms runtimes for the viewmodel. Springs are exact (closed form, frame-rate independent), written as frequency in Hz and damping ratio.

| Motion | Value |
|---|---|
| Walk bob | Phase advances by distance: stride 1.15 m + 0.35 m × min(1, speed ÷ 5.9). Amplitude min(1.5, speed ÷ 4.3) × 1.25, ×1.35 sprinting, gone in ADS. Vertical 11 mm per unit on cos 2φ, lateral 12 mm on sin φ, roll 0.005 rad. Measured: 24 mm vertical at 3.75 m/s, 0.62° of roll |
| Strafe roll | −0.006 rad per m/s of lateral speed, on a 2.6 Hz, ζ 0.8 spring; about 1.5° at a run |
| Landing dip | A 3.2 Hz, ζ 0.5 spring kicked by 0.42 × fall speed (capped at 8 m/s), × 5 cm. Jumping lifts it, crouching drops it |
| Flinch | Roll on a 3.5 Hz, ζ 0.45 spring × 0.02 rad: landings alternate sides, a hit rolls away from its source by 1.2 + 0.03 × damage |
| FOV | Sprint +2° (2.2 Hz, critically damped). A punch spring (6 Hz, ζ 0.6): +0.2° a shot (halved in ADS), +2° on a jump, −0.5° × landing speed; ADS keeps 40% of it |
| Look in ADS | Sensitivity × tan(FOV ÷ 2) ÷ tan(hip FOV ÷ 2), from the live FOV |
| View recoil | Each kick adds to a climb and pushes a hands spring at 4.2 × √(recover ÷ 7) Hz, ζ 0.78 (light) to 0.87 (heavy). The climb settles at 0.9/s while firing; 0.22 s after the last shot it settles at the weapon's rate. The first shot of a spray kicks harder |
| Recoil tuning | Rifle: recover 6, settle 2.92/s, first shot ×1.7. Pistol: recover 10.5, settle 7/s, first shot ×1.2. Measured on a 10-round rifle burst: 40% of the peak remains 0.5 s after release, 10% at 1 s |
| Viewmodel recoil | Back 2.6, rise 0.8 and roll 0.7 per unit of punch; back on a 9.5 Hz, ζ 0.82 spring, rise and roll on the hands spring. ×0.72 in ADS, ×0.82 crouched, and ADS cuts the visible kick by a further 30%. The camera follows the rise by 0.3 and the roll by 0.12 on a 1.8 Hz spring. The rear sight moves about 7 mm a shot |
| Sway | Look rate × 0.0355, soft-clamped to 0.1 rad (pitch 0.75 of that), on a 2.1 Hz, ζ 0.7 spring; the hands also reach toward the turn. ADS keeps 10%; firing tightens the grip |
| Gun bob | A figure-eight at hip with the stride, a slower lope while sprinting, a small dip on each step in ADS; heavier weapons swing more and lag more |
| ADS move | The gun arcs 3 cm in and settles with a small bump when it arrives |
| Idle | Breath over 4.8 s: 1.5 mm of rise (0.6 mm in ADS) and 0.0012 rad of pitch (half at hip) about the shoulder; no roll |
| Landing, viewmodel | Drops by 0.25 × fall speed (at most 1.6) on a 3 Hz, ζ 0.75 spring |

## First person

- **One set of arms.** The arms viewmodel with the local body hidden, or the full body from the head socket with the head and eyes masked (`colorWrite` and `depthWrite` off). Never both: a viewmodel was once mounted while the full body stayed visible.
- **The viewmodel draws last**, through the look's overlay, with its own 56° FOV. The rifle sits lower right at about 30% of a 16:9 width. Sprint lowers and cants the weapon with bob and roll rather than swinging full-body sprint poses across the screen.
- **Narrow screens widen the vertical FOV** to hold horizontal coverage: the world below 0.8 aspect for portrait phones (`portraitFov`), and the viewmodel across the shorter side (`framePresentation`), so its 56° spans the width of a portrait phone just as it spans the height in landscape.
- **Portrait frames the gun like landscape.** An inward lens shift and a portrait-only camera offset kept the arms in frame, but moved the viewmodel's vanishing point off the reticle. On an iPhone the hip rifle read as a diagonal from the bottom left, with its barrel 41 px off the crosshair. Holding the viewmodel FOV across the shorter side, with no shift, keeps both hands in view and the vanishing point on the reticle.
- **The hip gun points at the reticle.** Each frame, the hip pose is turned about the rear sight so the sight line meets the crosshair at 12 m (`FOUND_CONVERGE`, or `converge` per weapon). The authored pistol hold pointed 9° up and 3° left, up to 178 px off on desktop; it now misses by under a pixel on every profile.
- **Idle is a breath, not a seesaw.** The found idle clips were linear ping-pongs between two poses: the rifle rolled ±2° every 0.8 s, and the pistol pitched ±3° and pushed ±12 mm every 0.97 s. Read on a phone, the arms tilted around the muzzle. The runtime holds each idle clip at its mean pose (`holdPose`), and the feel layer breathes: a ±1.5 mm rise and under 0.1° of pitch over 4.8 s, about the shoulder.
- **Cropped meshes end off screen.** Cropping a body at the elbow left rounded capsule ends in pistol aim and on phones. A sleeve on each forearm now runs past the edge of the screen in every pose and aspect.

## Rules, and the failures that taught them

- **One owner for the view.** Subject and the ALS camera each read the same mouse at different sensitivities. At 144 Hz render and 60 Hz physics the yaw sawtoothed by 1.748°. With one control-rotation source the error was under 1e-12°. Pass Subject's yaw and pitch to the character and to `AlsCamera.controlRotationSource`. When joining prototypes, two that both read the mouse or both own the player's position will fight.
- **Frame order.** Control rotation, character, physics, pose, animation, camera, then attachments. Done the other way, held objects lag one frame behind. Physics was moved before pose and camera, and the arms attach after the final camera; the measured residual was 5.6e-15.
- **Send gait, not speed.** Characters looked like they were in slow or fast motion because the bridge passed `desiredSpeed: 300/600`, values in cm/s, to an API in m/s and left out gait. At a real 3.75 m/s the graph picked Walking and played the walk at 2.5× instead of the run at 1.07×. The clocks were already correct, so no time multiplier was added. Send `desiredGait` (`Walking`, `Running`, `Sprinting`) and let the character pick its authored speed.
- **Prove locomotion by foot slip.** A test actor moved at zero velocity advanced its animation clock for 3.8 s while its stride phase never changed and its foot slid over 10 m. Bound planted-foot slip instead: 3 cm per plant. Measured slip was 0.83 cm walking, 1.03 cm running and 1.78 cm sprinting.
- **Scale look while aiming.** Multiply look sensitivity by tan(aim FOV ÷ 2) ÷ tan(hip FOV ÷ 2) so the crosshair moves the same distance on screen.
- **Recoil comes back.** Breach kept 39% of a burst's climb a second after release, because a fixed fraction of every kick was never recovered. With every kick returning, it keeps about 10% at 1 s, and the player pulls down only during the burst.
- **The camera barely moves; the arms do.** Breach's first-person landing dropped the eye 37 mm, which read as a stumble. The eye now moves about 2 mm and the viewmodel drops instead. The same goes for firing: the old springs threw the rear sight 36 mm toward the eye on every shot, and now it moves 7 mm.
- **Measure the sight, not the holder.** A found rig's holder transform includes compensation for its authored fire clip, so it reported motion the player never saw. The capture records the rear sight in camera space.
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
