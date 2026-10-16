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
- Draw the arms with `<ArmsViewmodel render="external" onPresentation={…} />` and pass the presentation to `<Look overlay>`.

## Presets

| Weapon | Mode | Rate | Magazine / reserve | Reload | Damage | Range | Spread |
|---|---|---|---|---|---|---|---|
| Rifle | Auto | 600 RPM | 30 / 180 | 2.1 s | 24 | 250 m | 0.0035 rad |
| Pistol | Semi | 300 RPM | 12 / 72 | 1.35 s | 38 | 150 m | 0.002 rad |
| Bow | Semi | 66 RPM | 1 / 30 | 0.7 s | 80 | 180 m | Projectile at 55 m/s with gravity |

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
