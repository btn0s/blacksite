# ALS consumer contract

How a Blacksite game drives an ALS character: local bodies, camera, overlays, actions, remote actors, first-person arms, loading and cost. Open the matching recipe in `vendor/als-web/docs/guide/recipes/` (in a generated game, `vendor/blacksite/vendor/als-web/docs/guide/recipes/`), with `overview.md`, `gotchas.md` and `api.md` beside it for context and imports. Each recipe points to an example or test. Finish with the game's gate.

## Who owns what

The Character owns desired state and actions. Character movement owns the capsule, the floor, velocity and the authored speeds. The animation instance owns the pose, curves, slots and the control rig. The camera owns the view and reads the final pose. The game owns authority, combat and transport.

Frame order: ControlRotation → Character → Physics → MeshBase → Animation → PosePublication → Replication → AnimNotifyDispatch → Camera. Step Rapier at `ALS_FRAME_PRIORITY.Physics`, and attach held objects from the published bones after the camera. A pose override for the check contract goes at `ALS_FRAME_PRIORITY.Camera + 0.05`, before the look renders at priority 1.

## Units

ALS's authored data is in centimetres, cm/s and degrees, with +X forward, +Y right and +Z up. Rapier and snapshots use three.js metres and m/s, with +Y up. Snapshot angles stay in ALS degrees. The movement bridge converts movement units, and the animation graph multiplies m/s by 100 itself. The guide's `overview.md` names the axis and yaw helpers. Relay forwards m/s. A snapshot's `pos` is the capsule anchor; the feet are 0.9 m below it, crouched too.

## Code input

`Character.inputSource` returns an `AlsCharacterCodeInput` every physics sample:

| Field | Meaning |
|---|---|
| `active` | `false` clears pending jump edges |
| `jumpSequence` | Increment once per press |
| `movementDirection` | World `{x, z}`, length ≤ 1 |
| `desiredGait` | `Walking`, `Running` or `Sprinting` |
| `desiredStance` | `Standing` or `Crouching` |
| `desiredRotationMode` | `VelocityDirection`, `ViewDirection` or `Aiming` |
| `viewYawAngle`, `viewPitchAngle` | ALS degrees |
| `aiming` | Resets to false when omitted |
| `overlayMode` | Built in or registered |
| `desiredSpeed` | An optional speed override in m/s, not a gait |

Defaults: active, no jump, Running, Standing, ViewDirection, the default overlay. Set `inputEnabled={false}` when code or Subject owns input.

## Symptoms

| Symptom | Cause and fix |
|---|---|
| Fast legs, or the walk playing while running | Send the semantic gait with ALS speeds; check `desiredSpeed` units. |
| The camera sawtooths or the arms jitter | Two look owners. Pass Subject's yaw and pitch to the Character and `AlsCamera.controlRotationSource`. |
| A one-frame lag on the camera or an attachment | Physics priority, then pose, then camera, then attachments. |
| Remotes glide or play the wrong animation | Forward the recorded gait, stance, body and view angles and the animation intent in metre snapshots; keep the anchor conversion. |
| Remotes cost too much | Pass camera significance to `AlsRemoteActor.animationLod`; focused actors and actions run at full rate. |
| No spawn after loading | Subscribe after React commits and clean up on unmount; Suspense may throw a render away. |
| `rawshape_ball` from Rapier | Two Rapier instances. Pre-bundle it once in Vite's `optimizeDeps`. |

## Recipes

| Task | Recipe |
|---|---|
| Spawn and input, walk, crouch, aim | `local.md` |
| First or third person, shoulder, look ownership | `camera.md` |
| Weapon attachment, rifle, pistol or a custom overlay | `weapon.md` |
| Fire, reload and equip on the upper body; interrupts | `montage.md` |
| Mantle, roll, ragdoll, get-up | `actions.md` |
| Replication, snapshots, remotes, recording a ghost | `remote.md` |
| First-person arms from the ALS mesh and an owned pack | `fpp-arms.md` |
| Foot IK and the ground | `foot-ik.md` |
| Suspense, subscriptions and actor lifetime | `lifecycle.md` |
| Remote cost and update knobs | `performance.md` |
