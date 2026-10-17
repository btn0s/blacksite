# Subject: the Character Controller

One controller for every character game, single-player or multiplayer, built on the ALS character. It lives in `@blacksite/subject`. `@blacksite/subject-fpp` folds into it (arms, feel, found rig, bindings) and is deleted, leaving one controller package.

```tsx
const player = createCharacterController({ views: ['arms'], weapons, move, start })

<Physics timeStep={1 / 60} updatePriority={ALS_FRAME_PRIORITY.Physics}>
  <LevelColliders />
  <CharacterController controller={player} queries={queries} events={events} aimTargets={targets} />
</Physics>
<CharacterOverlay controller={player} prompt="Click to fight" />
```

## Views replace perspective, switch flag and FPP mode

The request was a default perspective, a flag that allows switching, and an FPP mode of arms or true. Those are three settings, and some combinations mean nothing (TPP with an FPP mode, a switch flag with one perspective). One ordered list says all of it:

| View | Camera | Body | Arms and feel |
| --- | --- | --- | --- |
| `arms` | Stable eye: ground plus smoothed eye height (1.63, crouched 1.0), control rotation, recoil springs and the camera feel pose | Simulated and animated, mesh hidden, shadow kept | Found-rig arms with all of d369ef1: spring recoil, ADS curve, bob and roll, sprint FOV, landing dip, idle hold, portrait FOV, hip convergence |
| `head` | Native ALS first-person camera on the head socket (`setViewMode('FirstPerson')`) | Visible, head hidden | None |
| `shoulder` | Native ALS third-person camera | Visible | None |

`views[0]` is the default. With more than one view, the `view` action (V, D-pad right) cycles through the list; with one, the view is locked. Breach is `['arms']`, Traverse and Valley `['shoulder', 'head']`, and the arena `['arms', 'shoulder']`.

## What the controller owns

- **Input** through `@blacksite/input`, one hub:
  - keyboard and mouse with pointer lock;
  - gamepad per the gamepad-everywhere spec: bindings, 240/90 °/s look with a 0.2 radial dead zone and curve, ADS slowdown, subtle aim assist, trigger rumble, pause on Start;
  - touch through `CharacterOverlay`;
  - glyph prompts that follow the device; touch UI hides while a pad is active.
- **Movement:** ALS only (its port of character movement over Rapier shape casts). The game's speeds and curves go in as ALS movement settings and gait overrides. There is no second movement model.
- **Look:** sensitivity, pad curve, ADS slowdown, and recoil applied to the control rotation in every view.
- **Weapons:** an Armory runtime stepped at its fixed rate, driven by fire, ADS, reload, swap and inspect. The ALS overlay follows the equipped weapon. With no weapons there is no runtime and the overlay is Default.
- **State and handles:**
  - status (locked, paused, view) for React;
  - per-frame state (eye, aim, velocity, grounded, stance, gait);
  - `respawn`, `teleport`, `face`, `ragdoll`, `setPaused`;
  - a driver for check scripts.

## One aim model for every view

- **The aim ray** comes from the active view's camera: its position and forward after the frame's look and recoil. In `arms` that's the stable eye, in `head` the head-socket camera, and in `shoulder` the third-person camera behind the shoulder.
- **The shot** leaves the muzzle and converges on whatever the aim ray hits. Armory already works this way: `step` takes `aim` and `muzzle`, casts the aim ray, and aims the muzzle cast at that point. It never turns the gun backwards when the camera is nearer cover than the muzzle.
- **The muzzle** is a point the controller tracks:
  - in `arms`, the eye itself, so a hip shot can never start on the far side of a wall the camera is touching;
  - in `head` and `shoulder`, the muzzle socket of the world weapon on the hand, clamped inside the capsule so it can't poke through a thin wall.
- **Recoil** acts on the control rotation, the same yaw and pitch that ALS and the camera read, so it kicks every view the same way. Camera feel (bob, roll, landing dip, sprint FOV) is a pose layered on top in `arms` only; it never moves the aim ray.
- **Implementation:** one fixed-step weapon loop. The only thing a view changes is where the camera transform and the muzzle point come from.

## The weapon in the world

- **Source:** each found GLB already holds the weapon as its own nodes beside the arms (`rifle.glb` is the AKM, `pistol.glb` the Beretta). The world weapon is a clone of those weapon nodes, so the viewmodel and the body draw one asset.
- **Attachment:** a per-weapon `world` grip transform in `found/field.ts` (the same model file as the viewmodel's hip and ADS numbers). The clone attaches through ALS's `renderOverlayObject` to `VB hand_r_to_ik_hand_gun`, and the overlay pose (`Rifle`, `PistolTwoHanded`) follows the equipped weapon.
- **Where it shows:** in `head` and `shoulder` it is visible. In `arms` it is hidden from the camera but still casts a shadow with the body.
- **Remote players:** `AlsRemoteActor` takes the same `renderOverlayObject`, so `Replication` draws remote players' weapons the same way.
- **What it replaces:** ALS's default rifle and pistol props are no longer used. They stay in `vendor/` untouched.

## Pause is a menu, time belongs to the session

- **The controller owns** the pause action (Esc, Start, losing pointer lock) and a `paused` status. Paused means the menu is open: the controller releases pointer lock and stops reading gameplay input. It never touches the clock.
- **The session owns time.** Whoever owns the clock decides whether the world stops under the menu:
  - a local single-player session (`useLocalSession`) stops the frame loop, so physics, animation, the weapon and every game frame stop together and resume with no catch-up step, and it stops its `now()` for anything that runs off the frame loop (a worker simulation, timestamps, interpolation buffers);
  - a networked session keeps the world running under the menu; the character just stops taking input.
- **Games don't shift clocks.** They read the session's `now()` instead of `performance.now()`.
- **Body visibility drives animation cost.** The controller tells ALS whether the camera can see the body (the `BODY_LAYER` test). When it can't, ALS updates the graph at the shadow rate, the same mechanism remote characters use for distance.
- **Menus belong to the game:**
  - the game shell already owns a pause screen with console navigation (`templates/game-shell/src/main.tsx`), so a shell game opens its screen from that status;
  - a standalone game like Breach draws its own menu from `@blacksite/ui/hud`'s `Menu` plus `useConsoleNavigation`.
- **Why the menu isn't bundled:** a bundled menu would have to take every game's items and actions. That turns a character controller into a screen manager, and a shell game would end up with two pause screens.
- **`CharacterOverlay`** is input UI only: touch controls and device prompts.

## What a game supplies

- Level colliders inside its own `<Physics>`.
- Hit `queries` for Armory.
- Weapons: `{ definition, adsFov, adsSeconds, rumble }`.
- Model numbers: movement (gait speeds, acceleration and braking curve, jump), look, pad, aim assist.
- `aimTargets` for aim assist.
- Event handlers:
  - `onWeapon` (shots, impacts, damage, reloads);
  - `onFootstep(surface, volume, landing)` from ALS animation notifies;
  - `onLand(speed)`, `onJump`, `onAction(action, device)`;
  - `onSnapshot` (ALS snapshots at a set rate).
- Extra bindings for game actions (restart, checkpoint). They arrive through `onAction`.

## Networking is a layer, not a controller

`<Replication connection={connection} controller={player} />` mounts the controller and uses only what it already exposes:
- it sends `onSnapshot` to the server as `move` messages;
- it sends `onWeapon` shots as `fire` messages, aimed from the server's shot origin;
- it applies server spawn, death and life through `respawn` and `ragdoll`;
- it draws other players as `AlsRemoteActor` puppets fed from snapshot buffers.

The controller's default weapon queries cast into the Rapier world, so a multiplayer game's local hits are visuals only; the server stays authoritative for hits. Weapon definitions are shared with the server.

## What gets deleted

- **subject-fpp:** the `StandaloneSubject` export and the work-in-progress camera-only body and collision. Feel, arms, input and intent move into `subject`.
- **subject:** `Subject.tsx` (the DOM listeners and the FPP eye override), `keySubject`, `lookSubject`, `driveSubject`, `pressSubject`, `MultiplayerSubject` and `MultiplayerScene`. The scene is replaced by the controller plus `Replication`.
- **Breach:** `player.ts`, its own camera and input wiring, and the `Touch` component.
- **Traverse and Valley:** their own `player.tsx` and `controls.ts` character wiring, and the landing-reaction code in the game.
- **FPP kit:** the game-shell walker. The ALS TPP kit loses its hand-built `createControl`.

## Risks, measured in slice 2

These are the walls I expect. If one stands, I stop and report it with a redesign.

1. **Phone cost.** Breach's phone runs physics at 30 Hz; ALS needs a fixed 1/60 step and runs its animation graph even with the mesh hidden. That means more physics steps for ragdolls, plus the local character's graph and sweeps. Phone p95 is measured before and after against the 16.7 ms budget with no frame over 33 ms. If it misses, the fix belongs in ALS for every game, for example ticking the animation graph less often when nothing shows the body. It does not belong in Breach.
2. **Feel numbers.** Breach's model is already ALS's normal movement curve: walk 1.75, run 3.75, sprint 6.5, acceleration 20 easing to 7.5, braking 15/12.5/5, jump 4.2. The feel check should match without changes; this is verified, not assumed.
3. **Footstep cadence.** Breach's footsteps come from a stride timer today; they will come from animation notifies, the same as every other ALS game.
4. **Steps and ledges.** Breach climbs 0.45 m steps; the ALS step height and mantles replace that, and are checked on Breach's stairs.

## Transition

The old `Subject`, `MultiplayerSubject`, `MultiplayerScene`, `createSubject` and `LoopbackSplitView` are deleted. The arena and every kit except `blank` run on the controller; `blank` keeps the game-shell walker because it is the kit for a custom, ALS-free body.

## Migration order

1. **Controller and Breach.** Build the controller in `subject`, fold in subject-fpp, move Breach to `['arms']`, and delete the old paths. Gates, plus `blacksite check` desktop and phone before and after.
2. **The rest.** Traverse and Valley on `['shoulder', 'head']`, including the landing foot slide fix in the controller's locomotion. The arena and the multiplayer kit on the controller plus `Replication`. The FPP and TPP kits on the controller.
3. **Docs and skill.** "Build every character game on the Character Controller; pick its views."
