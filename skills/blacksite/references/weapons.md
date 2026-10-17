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
- Draw the arms with `<ArmsViewmodel state={arms} render="external" onPresentation={…} />` and pass the presentation to `<Look overlay>`. The default has finger-rigged arms, procedural motion and weapon-part-driven clips. Select `rig="als"` when local arms should match the remote body.
- For the default viewmodel, import `VIEWMODEL_CLIPS`, `VIEWMODEL_WEAPONS` and `switchSeconds` from `@blacksite/subject-fpp/arms`. Set Armory reload/equip durations from those same timings; drive reload foley from clip events. Set `arms.empty` from the magazine, increment `inspectSequence` for inspect, and send landing speed with `landSequence`.
- Authoritative servers import the same model from `@blacksite/subject-fpp/arms/model`; this entry point has no renderer or asset-loader imports.

## Presets

| Weapon | Mode | Rate | Magazine / reserve | Reload | Damage | Range | Spread |
|---|---|---|---|---|---|---|---|
| Rifle | Auto | 600 RPM | 30 / 180 | 2.1 s | 24 | 250 m | 0.0035 rad |
| Pistol | Semi | 300 RPM | 12 / 72 | 1.35 s | 38 | 150 m | 0.002 rad |
| Bow | Semi | 66 RPM | 1 / 30 | 0.7 s | 80 | 180 m | Projectile at 55 m/s with gravity |

## Viewmodel authoring

Read `docs/arms.md` before replacing a mesh or authoring an action. Keep the physical dimensions, FOV, ADS time, recoil springs, sway bounds and stride length in the pure viewmodel model. Motion reads this model; checks measure it back.

Author reload, equip, holster and inspect as short curves for weapon and weapon-part transforms. Put hand sockets on the parts, solve shoulder–elbow–wrist IK, and blend finger poses for trigger, support, magazine and charging-handle grips. A magazine moves the hand that holds it. Recoil, sway, breathing, speed-driven bob, ADS and landing dip are procedural layers around those clips.

Compare candidate assets in the Firing Range before selecting a default. Record original authors and component licences; an uploader's permissive label does not override a credited source's restrictions. Ship source links, attribution, modifications and full licence text with the assets.

Capture rifle and pistol at desktop and 390 px through idle, movement, fire, ADS, reload, holster, equip, sprint, inspect and land. Read every reload/equip contact-sheet frame at 1× and 4×. Check wrist shape, fingers on the grip, hand-to-magazine contact, slide/bolt motion and state transitions. A passing attachment residual proves a target position, not anatomical deformation.

## What isn't there yet

- No damage falloff, hit zones, headshots, armour or penetration: damage is flat on any hit.
- No melee, grenades or throwables.
- No recoil pattern or bloom: spread is a fixed cone and recoil is random per shot. Aiming changes nothing in Armory; the Firing Range scales kick by 0.7 and narrows the FOV in game code.
- The arms animate the rifle and pistol only. The bow's projectile path is untested in a shipped scene.
- The `fpp` template stubs collision queries, so a new game hits nothing until it adds them.
- No lag compensation on the server (`multiplayer.md`).

Build the missing ones the way shipped shooters did: a learnable recoil pattern, spread that grows with sustained fire and movement, headshots at 2× or more, and falloff past an effective range.

## Rules, and the failures that taught them

- **One tracer in three.** A tracer on every round read as bars of light.
- **Step on elapsed time.** The server's weapon simulation advanced two ticks per received shot and drifted from the clients'. Step it from elapsed fixed-step time.
- **Server rays see cover and the crosshair.** Arena's hits went through cover until server rays tested obstacles. Third-person shots missed the crosshair until the fire direction came from the camera's aim point.
- **Round-trip authored values.** A requested 4 m charge core was stored as radius ÷ 3. Assert that authored values reach the moment they act unchanged.

- **A correct wrist is not a correct hand.** The first MakeHuman viewmodel held its wrist target within hundredths of a millimetre while its fingers still formed stretched tubes. Verify skinned vertices and finger flexion, then read close-ups of every grip.
- **A moving bone is not a moving part.** A pistol magazine retained half its weight on the weapon root, so its geometry moved half as far as the hand following its bone. Give rigid weapon parts full weights and measure hand contact against the animated mesh, including the replacement-magazine handoff.
- **One action clock.** A reload sound timed independently of the magazine animation can click before the magazine seats. Use the clip event times for foley and the same duration for Armory.
