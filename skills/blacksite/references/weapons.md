# Weapons

Armory (`@blacksite/armory`) is a deterministic weapon simulation: fire modes, cadence, magazines, reloads, equips, spread, recoil and hitscan or ballistic projectiles. It renders nothing and sends nothing; the game feeds it aim and collision queries and turns its events into presentation.

## Guides

- `packages/armory/AGENTS.md`: the contract.
- `docs/arms.md`: the first-person arms viewmodel.
- `site/src/showcases/firing-range/`: the complete reference, with recoil, arms, impacts, steel targets and synthesized audio.
- `templates/prototype-kits/fpp/mode.tsx`: the smallest integration.
- `packages/relay/src/index.ts`: Armory run on the server for multiplayer hits.

## Standard use

- One runtime per owner: `createWeaponRuntime({ ownerId, seed, definitions: ALS_WEAPONS })`.
- Step it from a fixed-step accumulator, clamped to 0.1 s: `weapon.step({ tick, trigger, reload, selectWeaponId, aim, muzzle }, queries)` while the accumulator holds a full `fixedDeltaSeconds` (1/60).
- Supply `WeaponQueries { castRay, sweepSphere }` against the game's colliders. A hit with a `targetId` produces a `damage` event.
- Map events to presentation: `shot` to recoil, flash, tracer, sound and `arms.fireSequence++`; `reload-started` to `arms.reloadSequence++`; `switch-started` to `arms.weapon` and `arms.equipSequence++`; `trigger-blocked` (empty) to a dry fire; `impact` to decals and dust.
- Draw the arms with `<ArmsViewmodel state={arms} render="external" onPresentation={…} />` and pass the presentation to `<Look overlay>`. The default `found` rig plays an authored, CC BY rifle and pistol set with procedural sway, bob, recoil, ADS and sprint on top; credit it in the game. `rig="blacksite"` is the CC0 procedural rig; `rig="als"` matches local arms to the remote body.
- Set Armory durations from the animation: `{ ...weapon, ...foundTimings(FIELD_SET, weapon.id) }` gives `reloadSeconds`, `emptyReloadSeconds` and `equipSeconds`. Drive reload foley from the set's clip events. Set `arms.empty` from the magazine, increment `inspectSequence` for inspect, and send landing speed with `landSequence`.
- Authoritative servers call `foundTimings({ weapons: FIELD_WEAPONS }, id)` from `@blacksite/subject-fpp/arms/model`; this entry point has no renderer, asset-loader or GLB imports.

## Presets

| Weapon | Mode | Rate | Magazine / reserve | Reload | Damage | Range | Spread |
|---|---|---|---|---|---|---|---|
| Rifle | Auto | 600 RPM | 30 / 180 | 2.1 s | 24 | 250 m | 0.0035 rad |
| Pistol | Semi | 300 RPM | 12 / 72 | 1.35 s | 38 | 150 m | 0.002 rad |
| Bow | Semi | 66 RPM | 1 / 30 | 0.7 s | 80 | 180 m | Projectile at 55 m/s with gravity |

## Viewmodel authoring

Read `docs/arms.md` before replacing a mesh or authoring an action. Keep the physical dimensions, FOV, ADS time, recoil springs, sway bounds and stride length in the pure viewmodel model. Motion reads this model; checks measure it back.

Prefer an authored set when one passes the licence bar and reads better than procedural motion: hand-keyed reloads beat IK on finger contact and weight. Declare its frame ranges, eye basis and bone-local sight landmarks; ADS is solved from the landmarks, so measure them from the weapon mesh. Frame the hip pose in the lower-right third with both forearms entering from the bottom edges, and fade any portrait camera offset to zero in ADS.

For a procedural rig, author reload, equip, holster and inspect as short curves for weapon and weapon-part transforms. Put hand sockets on the parts, solve shoulder–elbow–wrist IK, and blend finger poses for trigger, support, magazine and charging-handle grips. A magazine moves the hand that holds it. Recoil, sway, breathing, speed-driven bob, ADS and landing dip are procedural layers around those clips.

Compare candidate assets in the Firing Range before selecting a default. Record original authors and component licences; an uploader's permissive label does not override a credited source's restrictions. Check each credited component's licence separately: a permissive assembly that reuses non-commercial arms or ripped game meshes is ineligible. Ship source links, attribution, modifications and full licence text with the assets.

Capture rifle and pistol at desktop and 390 px through idle, movement, fire, ADS, reload, holster, equip, sprint, inspect and land. Read every reload/equip contact-sheet frame at 1× and 4×. Check wrist shape, fingers on the grip, hand-to-magazine contact, slide/bolt motion and state transitions. A passing attachment residual proves a target position, not anatomical deformation.

## What isn't there yet

- No damage falloff, hit zones, headshots, armour or penetration: damage is flat on any hit.
- No melee, grenades or throwables.
- No recoil pattern or bloom: spread is a fixed cone and recoil is random per shot. Aiming changes nothing in Armory; the Firing Range scales kick by 0.7 and narrows the FOV in game code.
- The arms animate the rifle and pistol only. The bow's projectile path is untested in a shipped scene.
- The `fpp` template answers Armory's queries with Rapier rays (a sphere sweep is approximated by its centre ray), excluding the player's capsule. Give targets their own colliders and map `colliderId` to them.
- No lag compensation on the server (`multiplayer.md`).

Build the missing ones the way shipped shooters did: a learnable recoil pattern, spread that grows with sustained fire and movement, headshots at 2× or more, and falloff past an effective range.

## Rules, and the failures that taught them

- **One tracer in three.** A tracer on every round read as bars of light.
- **Step on elapsed time.** The server's weapon simulation advanced two ticks per received shot and drifted from the clients'. Step it from elapsed fixed-step time.
- **Server rays see cover and the crosshair.** Arena's hits went through cover until server rays tested obstacles. Third-person shots missed the crosshair until the fire direction came from the camera's aim point.
- **Round-trip authored values.** A requested 4 m charge core was stored as radius ÷ 3. Assert that authored values reach the moment they act unchanged.

- **A correct wrist is not a correct hand.** The first MakeHuman viewmodel held its wrist target within hundredths of a millimetre while its fingers still formed stretched tubes. Verify skinned vertices and finger flexion, then read close-ups of every grip.
- **A moving bone is not a moving part.** A pistol magazine retained half its weight on the weapon root, so its geometry moved half as far as the hand following its bone. Give rigid weapon parts full weights and measure hand contact against the animated mesh, including the replacement-magazine handoff.
- **Aim from the mesh, not the picture.** A found pistol's ADS sat off centre because its sight landmarks were guessed. Measure the rear and front sight from the weapon's vertices in bone space, then solve the eye position from them every frame.
- **Portrait is a different shot.** On a tall phone screen the upper arms filled the view. Pulling the weapon away was not enough; a portrait-only camera offset that fades out in ADS kept both hands and the weapon in frame.
- **One action clock.** A reload sound timed independently of the magazine animation can click before the magazine seats. Use the clip event times for foley and the same duration for Armory.
