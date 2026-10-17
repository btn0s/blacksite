# Subject: the Character Controller

One controller for every character game, single-player or multiplayer, built on the ALS character. It lives in `@blacksite/subject`. `@blacksite/subject-fpp` folds into it (arms, feel, found rig, bindings) and is deleted, leaving one controller package.

```tsx
const player = createCharacterController({ views: ['arms'], weapons, move, start })

<Physics timeStep={1 / 60} updatePriority={ALS_FRAME_PRIORITY.Physics}>
  <LevelColliders />
  <CharacterController controller={player} queries={queries} events={events} aimTargets={targets} />
</Physics>
<CharacterOverlay controller={player} prompt="Click to fight" pauseItems={[restart]} />
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
  - `respawn`, `teleport`, `face`, `ragdoll`, `pause`;
  - a driver for check scripts.

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

`<Replication controller={player} replica={replica} />` sits beside the controller and uses only what the controller already exposes:
- it sends `onSnapshot` to the server as `move` messages;
- it sends `onWeapon` shots as `fire` messages, aimed from the server's shot origin;
- it applies server spawn, death and life through `respawn` and `ragdoll`;
- it draws other players as `AlsRemoteActor` puppets fed from snapshot buffers.

A multiplayer game mounts the same controller with `queries` set to the Rapier world (client-side visuals only); the server stays authoritative for hits. Weapon definitions are shared with the server.

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

## Migration order

1. **Controller and Breach.** Build the controller in `subject`, fold in subject-fpp, move Breach to `['arms']`, and delete the old paths. Gates, plus `blacksite check` desktop and phone before and after.
2. **The rest.** Traverse and Valley on `['shoulder', 'head']`, including the landing foot slide fix in the controller's locomotion. The arena and the multiplayer kit on the controller plus `Replication`. The FPP and TPP kits on the controller.
3. **Docs and skill.** "Build every character game on the Character Controller; pick its views."
