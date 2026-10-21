# Building blocks

How to wire each block: which package, which guide, the standard calls, and what it doesn't do yet. The instincts each block serves are in the area references (`feel.md`, `combat.md`, `enemies.md`, `sound.md`, `craft.md`, `worlds.md`, `multiplayer.md`). Paths like `docs/cascade.md` are relative to the Blacksite repository; inside a generated game they're under `vendor/blacksite/`. Run `blacksite catalog --json` for the live list of packages ([catalog.md](catalog.md) is its release snapshot), and read [architecture.md](architecture.md) for who owns which state.

Sections: [The scaffold](#the-scaffold) · [Characters](#characters-subject-and-als) · [Weapons](#weapons-armory) · [Enemies](#enemies-warden) · [Destruction](#destruction-cascade) · [Multiplayer](#multiplayer-relay) · [Input](#input) · [The look](#the-look-and-the-world-kit) · [Open worlds](#open-worlds-landscape) · [Materials](#materials) · [Sound](#sound-soundscape)

## The scaffold

Every profile boots straight into play and fills the viewport, including portrait phones, with a "Click to play" prompt that takes pointer lock. Escape or the pad's Start opens Pause; Main menu, Settings and the developer list of prototypes hang off Pause and support controller navigation. `src/game/mode.tsx` is the profile's game: a walker in the starter yard (`blank`), or the Character Controller with arms and a rifle (`fpp`), the shoulder view (`tpp`), or both views under Relay with the offline loopback (`mp`). The same kit is also listed as `src/prototypes/controller-<profile>`.

| File | What it is | Change it when |
|---|---|---|
| `src/game/model.ts` | `FEEL`, `BUDGET`, `FIXED_STEP` and the motor rule (acceleration, coyote time, jump buffer, jump velocity from apex). The controller's gaits, the `blank` walker and the check read it. ALS acceleration is measured by the check; the walker's time to top speed is also asserted. | You tune anything. Never hard-code a number in a component. |
| `src/game/input.ts` | The `play` context for `@blacksite/input`: keyboard, mouse, gamepad and touch bound to `move`, `look`, `jump`, `sprint`, `crouch`, `walk`, `fire`, `aim`, `reload`, `view`, `rifle`, `pistol` and `pause`. `value()`, `held()` and `take()` read it. | You add a verb. Bind every device to it in the same place. |
| `src/game/stage.tsx` | The canvas, `<Look atmosphere="zone">` with `autoQuality()`, sun and fill, fixed-step physics, the sound listener on the camera and the yard. | You change the level, the atmosphere or the lights. |
| `src/game/yard.ts` | A starter yard from `@blacksite/look/world`, `surfaceAt()` for footsteps, and the check bookmarks. | You build the real level. Keep a bookmark on every area that matters. |
| `src/game/walker.tsx` | `blank` only: a kinematic capsule driven by the motor, with footsteps and landings. | The design needs a body that isn't the ALS character. |
| `src/game/check.tsx` | `CheckProbe`: `window.__blacksite` with bookmarks, camera override, `player()`, `audio()`, input, model and `ready()` once the world has loaded. | The ready condition or player changes. |
| `src/game/sound.ts` | The `@blacksite/soundscape` mixer for the device tier, in the `outdoor` zone. The shell prepares it during loading and starts it on the first gesture. | Rooms need their own zone, or the game needs its own cues. |
| `src/game/footsteps.ts` | Routes ALS foot plants and the camera listener into the mixer. | Surfaces change. |
| `src/game/hud.tsx` | Hints, the prompt and the touch pad (stick, look zone and buttons, all feeding the same actions). | Touch needs another button. |
| `src/architecture.ts` | The one Koota world, the life and phase machines and the Effect event service. | You add game state. Extend it; don't add another store. |

The shell's Settings audio toggle drives the master bus. Bundled world and Subject arm WebP textures are listed by filename in `legacyAssetPaths` in `budget.config.json` until they are converted to KTX2; any texture you add must be KTX2.

## Characters (Subject and ALS)

An animated player body that walks, runs, sprints, crouches, mantles, rolls, ragdolls and aims, in first or third person. It is ALS Web, an MIT-licensed port of the ALS Refactored animation system to three.js and Rapier ([github.com/btn0s/als-web](https://github.com/btn0s/als-web)), with the Character Controller in Subject on top. Build every character game on the Character Controller and pick its views.

| Need | Use |
|---|---|
| A player character, any view | `@blacksite/subject`: `createCharacterController({ views })` and `<CharacterController>` inside `<Physics>`. `views` is an ordered list of `arms`, `head` and `shoulder`; one entry locks the view. A local session (`useLocalSession`) owns the clock and stops the world under the pause menu. Examples: `examples/breach/` (`['arms']`), `examples/traverse/` and `examples/valley/` (`['shoulder', 'head']`). |
| A body the game drives (bots, scripted runs) | `controller.drive({ forward, right, sprint, jump, fire, aim })`; `drive(null)` hands control back. Write `controller.control.yaw` and `pitch` to aim. |
| A multiplayer player | `<Replication connection controller>` from `@blacksite/subject` in place of `<CharacterController>`. |
| Remote players, or AI puppets | One `AlsSnapshotBuffer` per actor, drawn with `AlsRemoteActor`. Squad does this. |

ALS ships its own agent guide; read it instead of guessing. It's at `vendor/als-web/docs/guide/` in Blacksite, or `vendor/blacksite/vendor/als-web/docs/guide/` in a generated game. Start with `overview.md` (who owns what, frame order, units, the input contract), then the recipe for the task in `recipes/` (local, camera, weapon, montage, actions, remote, fpp-arms, foot-ik, lifecycle, performance), with `api.md` for imports and `gotchas.md` for symptoms.

Other guides: `docs/arms.md` (the first-person arms viewmodel and its `public/assets/arms.json` manifest), `docs/player-templates.md` (what each scaffold profile mounts), `packages/subject/AGENTS.md`, `packages/subject/DESIGN.md`. Working examples: `site/src/showcases/characters/` (Checkpoint, third person with the check contract), `multiplayer/` (the controller under Replication with a bot, both views), `squad/soldiers.tsx` (remote actors), and `examples/breach/` (first person).

- Wrap the scene in `<Physics gravity={[0, -9.8, 0]} timeStep={1/60} updatePriority={ALS_FRAME_PRIORITY.Physics}>`.
- Preload the character with `preloadAlsCharacterGltf` behind the loading screen.
- Pass `weapons` and the controller runs Armory, recoil and the arms itself; `onWeapon` events carry shots and impacts for presentation. `controller.respawn(seed, position, yaw)` and `controller.teleport(position, yaw)` move the player.
- Touch and pad come from `@blacksite/input`; `CharacterOverlay` draws the touch controls and hides them while a pad is in use.
- Pass `character={controller.check}` to the check contract so the stress run can respawn and drive the player.
- For the check contract, apply a camera pose override at `ALS_FRAME_PRIORITY.Camera + 0.05`, before the look renders at priority 1 ([verify.md](verify.md)).

What isn't there yet:

- No swimming, ladders, climbing, slide, prone, lean, wall-run, coyote time or jump buffer. Build them in the game.
- `AlsCamera` has no sensitivity prop (1° per pixel). Scale the pointer events instead, as Checkpoint does (×0.55).
- The arms viewmodel animates the rifle and the pistol only.
- The body is the ALS mannequin, coloured per game. Bringing another skinned character isn't supported.

## Weapons (Armory)

Armory (`@blacksite/armory`) is a deterministic weapon simulation: fire modes, cadence, magazines, reloads, equips, spread, recoil and hitscan or ballistic projectiles. It renders nothing and sends nothing; the game feeds it aim and collision queries and turns its events into presentation. Guides: `packages/armory/AGENTS.md` (the contract), `docs/arms.md` (the arms viewmodel), `examples/breach/` (the complete reference, with recoil, arms, impacts and synthesized audio), `templates/prototype-kits/fpp/mode.tsx` (the smallest integration), `packages/relay/src/index.ts` (Armory on the server for multiplayer hits).

- One runtime per owner: `createWeaponRuntime({ ownerId, seed, definitions: ALS_WEAPONS })`.
- Step it from a fixed-step accumulator, clamped to 0.1 s: `weapon.step({ tick, trigger, reload, selectWeaponId, aim, muzzle }, queries)` while the accumulator holds a full `fixedDeltaSeconds` (1/60).
- Supply `WeaponQueries { castRay, sweepSphere }` against the game's colliders. A hit with a `targetId` produces a `damage` event.
- Map events to presentation: `shot` to recoil, flash, tracer, sound and `arms.fireSequence++`; `reload-started` to `arms.reloadSequence++`; `switch-started` to `arms.weapon` and `arms.equipSequence++`; `trigger-blocked` (empty) to a dry fire; `impact` to decals and dust.
- Draw the arms with `<ArmsViewmodel state={arms} render="external" onPresentation={…} />` and pass the presentation to `<Look overlay>`. The default `found` rig plays an authored, CC BY rifle and pistol set with procedural sway, bob, recoil, ADS and sprint on top; credit it in the game. `rig="blacksite"` is the CC0 procedural rig; `rig="als"` matches local arms to the remote body.
- Set Armory durations from the animation: `{ ...weapon, ...foundTimings(FIELD_SET, weapon.id) }` gives `reloadSeconds`, `emptyReloadSeconds` and `equipSeconds`. Drive reload foley from the set's clip events. Set `arms.empty` from the magazine, increment `inspectSequence` for inspect, and send landing speed with `landSequence`.
- Authoritative servers call `foundTimings({ weapons: FIELD_WEAPONS }, id)` from `@blacksite/subject/arms/model`; this entry point has no renderer, asset-loader or GLB imports.
- A definition may add an authored recoil `pattern` and a `spread` block with bloom; pass the shooter's `stance` and read `spread` and `patternIndex` from the snapshot for a crosshair (`packages/armory/AGENTS.md`). The `ALS_WEAPONS` presets use neither.
- For a new viewmodel, read `docs/arms.md` before replacing a mesh or authoring an action. Declare an authored set's frame ranges, eye basis and bone-local sight landmarks; ADS is solved from the landmarks.

What isn't there yet:

- No damage falloff, hit zones, headshots, armour or penetration: damage is flat on any hit.
- No melee, grenades or throwables.
- Aiming changes nothing in Armory unless the definition's `spread` says so; scale the kick and narrow the FOV in game code.
- The arms animate the rifle and pistol only. The bow's projectile path is untested in a shipped scene.
- The `fpp` template answers Armory's queries with Rapier rays (a sphere sweep is approximated by its centre ray), excluding the player's capsule. Give targets their own colliders and map `colliderId` to them.
- No lag compensation on the server (`multiplayer.md`).

## Enemies (Warden)

Warden (`@blacksite/warden`) is squad AI that perceives, remembers, plans and moves as a team: vision cones and hearing, beliefs that decay, squad orders (bound, flank, crossfire, breach), cover reservation and a motor layer with reaction time and aim acquisition. It runs in a worker at 30 Hz and renders nothing. `@blacksite/warden-react` adds a session, a hook and a debug view. Guides: `docs/warden.md` (integration, the headless runtime, custom maps and rules, the `TacticalAuthority` adapter for an existing game, navmesh build, tactics bake and crowd avoidance), `packages/warden/AGENTS.md` (knowledge comes only from observation, replays are deterministic, and Warden doesn't own the pawn), `site/src/showcases/squad/` (a 5v5 courtyard with ALS puppets, ragdolls, tracers, synthesized gunfire and pose LOD), `examples/breach/` (Warden behind a game's own authority).

- `createWardenSession({ detail: 'render' })`, then `session.connect(config, world)` with `{ seed, agentsPerTeam, maxTicks, scenarioId }`. `detail: 'render'` keeps snapshots render-sized.
- Author a `TacticalMap` (bounds, obstacle rectangles, regions, objectives, spawns per team) and bake `map.nodes = bakeTacticalNodes(map, anchors)`. For real geometry, build a navmesh with `buildNavigationMesh` and `bakeNavigationTactics`.
- Subscribe to `RenderSnapshot`s and interpolate each agent through an `AlsSnapshotBuffer` at a 125 ms delay, drawn with `AlsRemoteActor`.
- For an existing game's physics, weapons or ECS, write a `TacticalAuthority` adapter (`docs/warden.md`).

What isn't there yet:

- Agents aren't driven through ALS characters; the showcase replays snapshots into puppets.
- The reference simulation is planar and has its own weapon model, not Armory. Elevation and Armory need a custom `TacticalAuthority`.
- Two teams only. No civilians, creatures or single-NPC behaviour API.
- Grenades, smoke and lean are declared but not simulated.
- No trained models ship; the policy is symbolic.

## Destruction (Cascade)

Cascade (`@blacksite/cascade`) breaks buildings by structure: a bond graph with a stress solver decides what fails, Rapier moves the pieces, and a batched renderer draws primaries, secondary fractures and exposed edges. It runs in a module worker and stays real time by trading fidelity, never rate. Guides: `docs/cascade.md` (walk mode, authoring, attaching to a host world, bullet craters and secondary pieces, workers and rendering, crushing, structural work, scale benchmarks, replay, the protocol and verification; some of its numbers are older than the code, and the code wins), `packages/cascade/AGENTS.md` (including the solver's own failure stories), `site/src/showcases/air-strike/` (a six-storey block, single strikes from a missile or a penetrating bomb, dust, smoke, fire and the perf probe).

- **Author:** `createDestructibleBoxes(boxes, { id, cellSize, maxFragments, materials, storeyHeight, panelWidth })`. Air Strike uses 1.6 m cells and up to 4,200 fragments; the defaults are 0.75 m and 2,048, with a hard limit of 10,000.
- **Simulate:** `new DestructionSession(manifest, { frame, ready }, { timestep: FIXED_DT_30HZ, rest: { forceAfterSeconds: 2.5, forceSpeed: 0.5, forceSpin: 0.9 } })`. Dispose it on teardown.
- **Draw:** `new DestructionRenderer(manifest, { materialFor, buildMs })`, then `view.update(session.frame, session.previous, session.interpolationAlpha())` each frame. `buildMs` is the time each update may spend building debris and damaged-edge geometry, measured with the clock, so a slower device builds fewer pieces per frame and finishes over more frames. Derive it from the phone frame budget: 16.7 ms minus what the rest of a collapse frame costs on the phone profile (Air Strike measures 13.3 ms at p95, so 3.4 ms). Leave it unset only for scenes with no runtime fracture.
- **Interact:** `session.impact({ type: 'explosion', position, direction, charge })`, one call per munition. `charge` is the warhead's mass in kilograms of TNT equivalent, from 0.01 to 1000; everything else follows from it. Peak pressure and impulse come from the Kinney–Graham free-air curves at the scaled distance (distance over the cube root of the charge), reflected off each face. Concrete within the distance where the reflected pressure exceeds its compressive strength is crushed to dust. A bond is damaged by the ratio of reflected pressure to its tensile strength, and the damage adds up over hits. The blast skips fragments beyond the distance where even the weakest material in the manifest takes no damage. Use a real warhead mass: Air Strike's cruise missile carries 200 kg at the facade, and its penetrating bomb 250 kg with a fuse depth of 3 m. On the real concrete strengths, one missile at a ground-floor corner brings down 6% of the block and the second drops the corner (20%). One bomb through the roof brings down the top storeys (30%). Let the player place hits; don't scale up a charge or weaken the materials.
- **Shared world:** when the game owns Rapier, `DestructionSimulation.attach(manifest, { rapier, world })` and call `beforePhysicsStep()` and `afterPhysicsStep()` around the step. Leave debris colliders out of camera and character queries.
- **Feed effects** from `frame.events` (debris and collapse cues too) and report `frame.stats.activeBodies` to the perf probe.
- Compliant joints need the pinned Cascade Rapier build in `vendor/rapier`; stock Rapier throws in that mode.

What isn't there yet:

- No prototype template: `--with cascade` adds the package and an empty mode. Start from Air Strike.
- The medium and large scale frames miss the timing gates; detonation steps run 85–270 ms against a 50 ms target. Keep buildings small enough for the step budget.
- Snapshots carry every live secondary definition every frame; a delta transport is planned.

## Multiplayer (Relay)

Relay (`@blacksite/relay`) is the replication seam: a transport-agnostic match authority, client prediction and reconciliation, interpolation, and two transports, Colyseus and an in-memory loopback. `Replication` from `@blacksite/subject` mounts the Character Controller on it, with ALS remote bodies and Armory hits checked on the server. Guides: `packages/relay/AGENTS.md` (the v0 contract and what it doesn't do), `docs/player-templates.md` (the `mp` profile, `/relay` and the offline loopback), `templates/multiplayer-server/README.md` (the scaffolded server), `vendor/als-web/docs/guide/recipes/remote.md` (remote ALS bodies), `site/src/showcases/multiplayer/` (Arena: loopback plus a bot, with snapshots, interpolation and server hits), [architecture.md](architecture.md) (the Controller → Pawn → Intent model and transport choice).

- Scaffold with `--profile mp`. `pnpm dev` runs the Colyseus match server on port 2567 and Vite together; Vite proxies `/relay` with WebSocket upgrades.
- Client: `createColyseusTransport(import.meta.env.VITE_RELAY_URL || \`${location.origin}/relay\`)`, or `createLoopbackRoom()` offline, then `connect()`.
- Mount `<Replication connection={connection} controller={player} />` inside `<Physics>`; `onStatus` reports players, health and hits.
- Server: `startMatchServer(port)` from `@blacksite/relay/server`; `createMatch({ spawns, obstacles, respawnMs })` for the level. Relay's `shot` and `hit` messages drive remote combat cues.

What isn't there yet:

- No lag compensation, interest management, delta encoding, reconnection, clock sync, lobbies, teams, scoring or authentication.
- Movement is owner-authored and bounds-checked; only hits are authoritative.
- `PawnState.t` is the server's clock compared against the client's. It works in loopback and drifts over a real network.
- The online `MatchRoom` has no level geometry, so its rays ignore cover. Pass obstacles.
- The deploy templates are incomplete ([process.md](process.md#ship)).

## Input

`@blacksite/input` is an input runtime: contexts with priorities, bindings with triggers (`down`, `pressed`, `pulse`), gamepad classification and glyphs, console-style menu navigation, settings and aim assist. `@blacksite/ui/hud` has the touch stick (`TouchPad`) and `useTouch` the showcases use. Guides: `packages/input/README.md` (the runtime, contexts, triggers, the action hub, aim assist, settings, touch controls, console navigation and glyphs), `packages/input/AGENTS.md` (clear held input on blur, disconnect and possession change), `packages/ui/README.md`, "Game HUD" (`TouchPad` and `useTouch`).

- One `makeInputDevices()` per client, provided with `<InputProvider runtime={…}>`, or `inputDevicesLayer` from `@blacksite/input/effect` in an Effect 3 app.
- Move and look through `actions.value(action)`: sticks, mouse delta (only under pointer lock), touch joystick (`setTouchStick`) and touch drag (`addTouchLook`) are summed with their modifiers. Scale mouse and touch look per pixel; scale the right stick with `scaleByDeltaTime`.
- Gameplay bindings with `createGameplayContext([...GAMEPLAY.bindings, …])`, switched with `useInputContext(play, inGame)` and `useInputContext(MENU, !inGame)`.
- `useActionEvents` for edges and `useActionHeld` for held state; `useInputSource()` for glyphs.
- Touch: `TouchPad` from `@blacksite/ui/hud` for a stick and look zone, `TouchControls` for buttons. `TouchPad` has no dead zone; put 0.1–0.15 on the binding with a `deadZone` modifier.

What isn't there yet:

- No rebinding UI or saved bindings; settings aren't consumed.
- Aim assist needs a target-candidate builder that doesn't exist.

## The look and the world kit

Use `@blacksite/look` on every game: `<Look atmosphere="zone" quality={tier} environment sun={sun} fill={fill} />` in React Three Fiber, or `createLook(renderer, scene, camera, …)` and `look.render(dt)` in plain three. It brings HDR, half-resolution AO, bloom, a grade with a shoulder tonemap and a LUT, vignette, aberration and grain. Pass your own sun and hemisphere lights so the atmosphere drives their colour. Guides: `packages/look/README.md` and `packages/look/AGENTS.md` (the `Atmosphere` data, the presets, the sky, the quality tiers and the overlay).

- **Exposure:** change it with an atmosphere of your own, `{ ...ZONE, exposure: 1.22 }`. Never set `renderer.toneMapping` or `toneMappingExposure`.
- **Viewmodels go through the overlay.** `look.addOverlay(scene, camera)` or `<Look overlay>` replaced Arena's post-composer arms pass and hand-inserted composer passes. `ArmsViewmodel render="external"` hands its presentation to the look, and `<CharacterController onPresentation>` passes it out. The overlay runs after AO and before bloom with depth cleared, so the arms get the world's grade and never clip.
- **Antialiasing comes from the composer's MSAA**, not the canvas. Create the canvas with `antialias: false`.
- **Quality:** `autoQuality()` picks the tier (`performance.md`); `internalPixelRatio()` from `@blacksite/look/world` applies the pixel-ratio cap. `depthDefaults(tier)` gives the near plane per tier; `logarithmic: true` for a far plane past 1 km.
- **Shadows:** the world kit's `createAtmosphere` makes the one texel-snapped shadow frustum that follows the player.
- **Surfaces:** `surface(name)` and `meterSurface(name)` from `@blacksite/look/world` give the ruins set: cast concrete, panels, slabs, stained and painted walls, brick, rust, metal, corrugated sheet, asphalt, dirt, grass and gravel. `worldBoxGeometry` and its siblings tile UVs in metres. `groundMaterial()` blends ground by world-space noise; `puddleMaterial()` makes puddles.
- **Building levels:** `LevelBuilder` merges geometry by material (one draw per material, not per prop), adds contact shadows (`contactShadow`), and finds same-direction faces within 1 cm that overlap, pushes the smaller one 2 cm clear and warns with both names (`coplanar: 'throw'` makes it an error). Overlays that sit flat on a surface use `decalBias(material)`.
- **Props:** `apartmentBlock`, `lada`, `shed`, `waterTower`, `apc`, `deadTree` are a starting set; see [process.md](process.md#assets) for owned packs.
- **Outdoor atmosphere:** `<Look atmosphere="nature" quality={tier} sky fog environment sun={sun} fill={fill} />` (or `NATURE`). Its `physical` block switches on the scattering sky and the aerial perspective pass; `zone` and `haze` have none, so their pipeline is unchanged. Copy it and change numbers: `{ ...NATURE, physical: { ...NATURE.physical, mieScattering: 0.03 } }`. `rayleigh` deepens the blue, `mieScattering` and `mieAbsorption` (km⁻¹) whiten and dim the horizon, `aerial` scales the distance the air acts over, `physical.heightFog` is a medium: `extinction` (m⁻¹), `base`, `scaleHeight`, `start`, `albedo`, `phase` and a separate `emissive`, `physical.clouds` draws one self-shadowed layer that drifts with `clouds.wind`. `environment` PMREM-bakes the sky into `scene.environment`. The quality tier sizes the sky view table, its ray-march steps, the cloud octaves and shadow taps; phones run low. Keep the atmosphere in `src/game/atmosphere.ts` or the model, one per tier if the tiers differ. Example: `examples/valley/src/atmosphere.ts` and `src/Game.tsx`.

What isn't there yet: one cloud layer, no high cirrus and no volumetric clouds; no cloud shadows on the ground; no temporal antialiasing (foliage stays stable through MSAA with alpha-to-coverage, measured with `blacksite check --only shimmer`); no time of day (move the sun yourself and rebake the environment).

## Open worlds (Landscape)

`@blacksite/landscape` provides `createTerrain`, procedural `createCover`, authored `createAuthoredCover`, `createForest`, same-model impostors and `createWind`. Read `packages/landscape/AGENTS.md` for the ownership, frame order and mask vocabulary, and `packages/landscape/README.md` for the current API. `examples/valley/src/Landscape.tsx` wires these to the native WebGPU look; its model owns tier settings and its audio reads the shared wind.

```ts
const wind = createWind(BREEZE)
const uniforms = terrainUniforms(sources)
const cover = createAuthoredCover({ renderer, wind, families, heightAt, bounds, distance })
const terrain = createTerrain({ sources, uniforms, cover, layers, layerSpecs, detailDistance: 260 })
const forest = createForest({ renderer, wind, species, density, choose, heightAt, bounds, spacing: 5.2, count, near, far, shadowDistance, frameSize })
scene.add(terrain.object, cover.object, forest.object)
look.onBeforeShadow((renderer, camera) => {
  forest.prepareShadow(renderer, camera)
  cover.prepareShadow(renderer, camera)
})

function frame(dt: number) {
  wind.update(dt)
  terrain.update(camera)
  cover.update(camera)
  forest.update(camera)
}
```

- **Terrain:** near and far heightfields blend through `TerrainSources.band`; `terrainHeightAt` is the CPU truth for placement and physics. CDLOD vertices morph on fixed world nodes. Native TSL splats four material layers with variance-preserving anti-tiling. The forest mask selects ground materials; terrain never substitutes a raised crown surface for trees.
- **Authored foliage:** `loadFoliageModel` retains geometry, UVs, material maps and alpha cutouts. `createForest` selects deterministic candidates using `density` and `choose`. The shared GPU foliage core selects representations, culls and builds indirect draws; authored cover recycles bounded world tiles around the player.
- **Impostors:** `bakeImpostor(renderer, model, { frames, frameSize })` and `createImpostorMaterial` use the original model's albedo and normals. Complementary `landscapeDither` masks crossfade each representation. The final range covers the visible forest population and fades with the atmosphere.
- **Procedural cover:** `createCover` accepts TSL `CoverSample` functions with `surface`, `slope`, `root`, `ground` and `distance`. `landscapeNoise` matches CPU placement noise. Its `ground` node can share cover colour with terrain through the fade.
- **Wind:** `createWindNodes(wind)` exposes native `sample`, `gust`, direction, parameters and time. The CPU `wind.sample` and `wind.gust` follow the same equations. One update serves foliage, particles and sound; `wind.set` retunes the field.

The heightfields and forest population remain resident, and impostors bake at load time. World streaming, player displacement of blades and wind on character clothing remain separate work. Authored assets stay externally served; the package contains no asset packs.

## Materials

`@blacksite/materials` authors materials as node graphs, compares them under the shared look, and bakes them; games load textures, and graph evaluation belongs to authoring. `packages/materials/AGENTS.md` is the API source for node vocabulary, recipes, packing and symptom-based fixes; read it before writing a graph or changing the evaluator. Its `library/` has eleven procedural graphs and eleven image-input variants: poured concrete, precast panels, peeling plaster/paint, brick, corrugated rust, painted metal, wet tiles, asphalt, gravel/soil, bark and wood planks.

| Need | Starting point |
| --- | --- |
| Repeatable joints, boards, rivets or controlled damage | A procedural graph in `packages/materials/library/` |
| Irregular photographic colour where a reference is unavailable | An image-input graph, refined with structure nodes |
| Proven surface detail today | The existing surface or a redistributable reference with recorded provenance |

- **Image sources:** use the local image-generation skill for a new image, and record the model, complete prompt, date, provider and intended metres per image beside it. A photograph needs its author, source URL and redistribution licence. Generated output is labelled generated, not a CC0 scan. `delight` removes broad gradients; it can't measure albedo.
- **Nodes:** periodic noises, tiles/bricks/planks/panels, rivets, scatter shapes, image input, seamless blending, warp, blur, slope blur, levels, curvature, height normals, height AO, masked blends and colour ramps. Weather nodes cover age, dirt, moisture, puddles, rust, edge wear, chips, bullet craters and scorch. The four packed textures hold base colour, normal plus height, AO/roughness/metalness, and wear/dirt/wet/damage masks.
- **Compare:** open `/frames/materials.html` in the repository's site: procedural, image-derived and CC0 reference sources on the same sphere, cube and wall corner. A reference's recorded dimensions may be estimates; a shared metre scale doesn't make an estimate a measurement. Inspect repeated borders, grazing light, the wall corner, roughness changes and distant readability.
- **Bake** from the repository root: `corepack pnpm --filter @blacksite/materials bake library/poured-concrete.json --out baked --sizes 512,1024 --formats ktx2,webp`. This writes into `packages/materials/baked/`; for another game, pass absolute graph and output paths and bake from its build-time script. The WebP fallback needs `cwebp` on PATH (`brew install webp`); its data maps use exact lossless RGBA so a zero damage mask doesn't erase the dirt and wetness channels. KTX2-only bakes don't need it.
- **Load** once during warmup and reuse the source:

  ```ts
  import concrete from './materials/poured-concrete/1024'
  import { loadBakedSurface } from '@blacksite/materials/three'
  import { surface } from '@blacksite/look/world'

  const source = await loadBakedSurface(concrete, { renderer, resolution: 1024 })
  const wall = surface(source)
  ```

  Replace `surface('cast')` with `surface(source)`; named surfaces keep their defaults. Use the world-kit geometry helpers with `wall.userData.tile`, or `meterSurface(source)` for metre UVs. Import `/three` at runtime so the evaluator and Node encoders stay out of the game. Single-resolution descriptors keep unused sizes out of the build; the all-resolution descriptor lets the loader pick a size but makes both available to the bundler. WebP has separate descriptors for an explicit fallback.
- **Budget:** run `blacksite budget` on the game build; the bake's `--budget` option checks individual texture sizes only. Judge the compressed bake again under the shared look before handing over the scene.

## Sound (Soundscape)

Create one Soundscape mixer for the game (`packages/soundscape/AGENTS.md` has the mental model, API, recipes and symptom fixes). Call `prepare()` while the scene loads, then `start()` from the first click, key or touch. Update the listener pose from the game camera each frame; set the zone as the listener crosses a boundary; play cues by name from animation and game events, with a world position for spatial sounds and none for interface cues. Expose `soundscape.sample()` as the check contract's `audio()` and set `model.budget.voices` to the voice cap. A scaffolded game does all of this in `src/game/sound.ts`, `src/game/footsteps.ts` and the shell.

The package starts with synthetic variants for rifle and pistol shots, impacts and footsteps by surface, casing foley, and wind, so a new scene is audible without downloading recordings. Add content by registering cue data (`registerCue`) rather than building a new audio graph beside the mixer; a cue may layer transients, body and tail, while one play chooses one variant. Pass occlusion as a ray test. Hooks: Armory's `shot`, `reload-started`, `switch-started`, `trigger-blocked` and `impact` events; Cascade's destruction events for debris and collapse; Relay's `shot` and `hit` messages for remote combat.
