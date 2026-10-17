# Combat and feedback

Weapons, hits, explosions and destruction as the player feels them: what every action answers with, the numbers shipped weapons use, and the failures behind each rule. Wiring for Armory, the arms viewmodel and Cascade is in [building-blocks.md](building-blocks.md).

## Every action has three responses

Something you see, something you hear, and something the camera or controller does. An action with one of the three missing reads as broken, even when its logic is right.

| Action | See | Hear | Feel |
|---|---|---|---|
| Fire | Muzzle flash light for one frame, tracer on one round in three, casing | Shot plus a room-matched tail | Recoil kick that returns, viewmodel kick, a 0.2° FOV punch |
| Hit an enemy | Hit marker, blood or sparks by material, the enemy flinching | Impact by material, a hit tick | Short controller pulse |
| Take damage | Direction indicator, red vignette | Impact, a grunt | A roll away from the hit, scaled by damage |
| Land | Dust | Land sound by surface and speed | Camera dip |
| Explosion | Flash light for 0.1 s, fireball, smoke that hangs 5–10 s, debris with contact shadows, a scorch decal | Delayed by distance at 343 m/s, with a low-pass tail | Shake falling off with distance |
| Low health | A red vignette that pulses with the heartbeat | Muffled audio, regeneration you can hear start | |

## Weapons

| Weapon | Mode | Rate | Magazine / reserve | Reload | Damage | Range | Spread |
|---|---|---|---|---|---|---|---|
| Rifle | Auto | 600 RPM | 30 / 180 | 2.1 s | 24 | 250 m | 0.0035 rad |
| Pistol | Semi | 300 RPM | 12 / 72 | 1.35 s | 38 | 150 m | 0.002 rad |
| Bow | Semi | 66 RPM | 1 / 30 | 0.7 s | 80 | 180 m | Projectile at 55 m/s with gravity |

These are Armory's presets. Step the weapon on a fixed 1/60 s clock, so the fire rate doesn't depend on the frame rate. Recoil is a per-shot kick the view fully recovers from: the climb holds while firing and settles once the trigger is released, on a hands spring (`feel.md`). The Firing Range scales kick by 0.7 and narrows the FOV while aiming.

Shipped shooters also have a learnable recoil pattern, spread that grows with sustained fire and movement, headshots at 2× or more, and damage falloff past an effective range. Armory's definitions take an authored `pattern` and a `spread` block (hip, aim, move and crouch cones, bloom per shot that recovers); damage is still flat on any hit, with no hit zones, armour, penetration or falloff, and there's no melee, grenades or throwables. Build those in the game.

## Weapon handling (proposed)

Breach's tuned rifle and pistol, in `examples/breach/src/model.ts`. A starting point for a single-player shooter, not yet proven in a second game.

| Number | Rifle | Pistol |
|---|---|---|
| Time to aim | 0.3 s | 0.26 s (lighter weapons aim faster) |
| Aim FOV | 55° | 62° |
| Spread, hip / aimed | 1.1° / 0.12° | 0.9° / 0.15° |
| Spread added moving / sprinting | +1.6° / +4° | +1.2° / +3° |
| Spread crouched | ×0.75 | ×0.8 |
| Bloom | +0.18° a shot up to 2.2°, recovering over 0.43 s after 0.1 s | +0.35° a shot up to 1.8°, recovering over 0.3 s after 0.2 s |
| Recoil pattern | 30 authored kicks: about 6.5° of climb, then pulls left and right, ±0.04° jitter | 8 kicks of 1.3–1.5°, alternating sideways |
| Recoil recovery | All of it; settles at 2.92/s from 0.22 s after the last shot, first shot ×1.7 | All of it; settles at 7/s, first shot ×1.2 |

- **Aiming steadies the gun.** Kick is scaled by 0.75 while aiming.
- **Sprinting costs a beat.** A 0.22 s delay before a sprinting player can fire.
- **Headshots pay.** Hit zones multiply damage: head 4×, chest 1×, limbs 0.75×.
- **Pools, not allocation.** Tracers travel at 520 m/s; 256 pooled decals and 48 pooled casings.

## Hit confirmation and camera response (proposed)

From Breach (`examples/breach/src/model.ts`, `game.tsx`).

- **The player knows they hit.** A hit marker for 0.12 s, a kill marker for 0.32 s, larger (×1.35) and in a different colour, and a third colour for a headshot. The muzzle flash lasts 0.05 s.
- **The target answers the hit.** Every hit on a soldier gets a marker, a flesh sound, a blood puff, a flinch, and a bark from a squadmate on a kill. The flinch lasts 0.35 s: the soldier can't fire and moves at 0.35× speed.
- **Springs, not noise.** Breach's random shot shake added noise on top of its authored recoil pattern. The camera answers on springs instead (`feel.md`): a shot punches the FOV 0.2° and the view follows the gun's rise and roll; a hit rolls the view away from its source by 1.2 + 0.03 × damage on a loose spring; a landing dips and rolls by fall speed. A pose override (the checks) turns all of it off.

## The HUD (proposed)

From Breach (`examples/breach/src/hud.tsx`, `breach.css`) and the template's phone review.

- **The crosshair shows the spread.** Four 7 × 1.5 px ticks with an 8 px gap that opens with spread, written to a CSS variable outside React so firing doesn't re-render the HUD. It hides while aiming down sights.
- **Damage reads from the edge.** A red vignette at min(0.85, missing health × 1.1) opacity, and a directional arc on a 220 px ring that fades over 0.9 s.
- **Small, sharp, out of the middle.** Labels at 12 px, subtitles at 15 px on a dark backing, big numbers at 38 px, every corner element inset by the safe area. On phones, labels drawn straight over the sky lost contrast; give them a backing or a shadow. Touch targets are at least 44 × 44 px.

## Rules, and the failures that taught them

- **One tracer in three.** With a tracer on every round, Squad's bursts read as bars of light. Every shot still flashes and kicks dust.
- **Don't hide the payoff.** In Air Strike, smoke hid the building's collapse until it was darkened and thinned. And the missiles came in from behind the block, so the charges landed outside the facade and the collapse began 10 s late; moving the approach put them inside the ground storey and the block drops 3 s after impact. Check that a scripted moment happens where the camera is looking.
- **One action clock.** A reload sound timed independently of the magazine animation can click before the magazine seats. Use the clip event times for foley and the same duration for the weapon's reload.
- **Step on elapsed time.** The server's weapon simulation advanced two ticks per received shot and drifted from the clients'. Step it from elapsed fixed-step time.
- **Shots go where the crosshair is.** Third-person shots missed the crosshair until the fire direction came from the camera's aim point. Arena's hits went through cover until the server's rays tested obstacles.
- **Round-trip authored values.** A requested 4 m charge core was stored as radius ÷ 3. Assert that authored values reach the moment they act unchanged.
- **Physics never runs slower than the wall clock.** At 2 m cells on a 30 Hz worker a building's collapse played in slow motion. When a step costs more than the time it simulates, drop fidelity (sleep, bake, defer, cap debris), never rate.
- **Debris lands near where it broke.** Contacts that applied an impulse as well as damage sprayed 460 pieces at 12–30 m/s, up to 64 m out. With damage only, spread fell to 2–3 m at p90.
- **Rubble settles.** A 1,600-body pile never slept, because one awake body keeps its neighbours awake. Bodies below 0.35 m/s for 0.4 s become fixed and remember their supports.
- **A collapse is measured by where the mass went.** A "99% collapse" counted detached mass; the building had dropped 0.4 m in one piece. Judge mass below one storey and the centroid drop.

## The arms on screen

The viewmodel is the most-looked-at object in a first-person game. Keep its physical dimensions, FOV, ADS time, recoil springs, sway bounds and stride length in the pure viewmodel model; motion reads it and the checks measure it back.

- **Hand-keyed beats procedural.** Prefer an authored set when one passes the licence bar and reads better: hand-keyed reloads beat IK on finger contact and weight. For a procedural rig, author reload, equip, holster and inspect as short curves for weapon and weapon-part transforms, put hand sockets on the parts, solve shoulder–elbow–wrist IK, and blend finger poses for trigger, support, magazine and charging-handle grips. A magazine moves the hand that holds it. Recoil, sway, breathing, speed-driven bob, ADS and landing dip are procedural layers around those clips.
- **Frame the hip pose** in the lower-right third with both forearms entering from the bottom edges.
- **Aim from the mesh, not the picture.** A found pistol's ADS sat off centre because its sight landmarks were guessed. Measure the rear and front sight from the weapon's vertices in bone space, then solve the eye position from them every frame.
- **A correct wrist is not a correct hand.** The first MakeHuman viewmodel held its wrist target within hundredths of a millimetre while its fingers still formed stretched tubes. Verify skinned vertices and finger flexion, then read close-ups of every grip.
- **A moving bone is not a moving part.** A pistol magazine kept half its weight on the weapon root, so its geometry moved half as far as the hand following its bone. Give rigid weapon parts full weights and measure hand contact against the animated mesh, including the replacement-magazine handoff.
- **Wear reads at its viewing distance.** An olive paint-wear pattern on the first-person rifle read as camouflage at viewmodel distance and had to be flattened.
- **Read every frame.** Capture rifle and pistol at desktop and 390 px through idle, movement, fire, ADS, reload, holster, equip, sprint, inspect and land. Read every reload and equip contact-sheet frame at 1× and 4×: wrist shape, fingers on the grip, hand-to-magazine contact, slide and bolt motion, state transitions. A passing attachment residual proves a target position, not anatomical deformation.
- **Check every credited part's licence.** Compare candidate arms in the Firing Range before choosing a default. Record original authors and component licences; an uploader's permissive label doesn't override a credited source's restrictions, and a permissive assembly that reuses non-commercial arms or ripped game meshes is ineligible. Ship source links, attribution, modifications and full licence text with the assets.
