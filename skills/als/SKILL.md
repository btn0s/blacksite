---
name: als
description: ALS consumer contract for local characters, camera, overlays, actions, remote actors, FPP arms, loading, or performance in a Blacksite game. Use whenever wiring or changing ALS integration.
---

# ALS consumer contract

Read the matching recipe from `vendor/als-web/docs/guide/recipes/` in Blacksite or `vendor/blacksite/vendor/als-web/docs/guide/recipes/` in a generated game. Open `overview.md`, `gotchas.md`, and `api.md` in the same guide for context and public imports. Each recipe points to an executable example or test. Finish with the game's gate.

## Shared model

Character owns desired state and actions. CharacterMovement owns capsule, floor, velocity and authored speeds. AnimInstance owns pose, curves, slots and Control Rig. Camera owns view and reads the final pose. The game owns authority, combat and transport. Frame order: ControlRotation → Character → Physics → MeshBase → Animation → PosePublication → Replication → AnimNotifyDispatch → Camera; use `ALS_FRAME_PRIORITY.Physics` for Rapier, then evaluate held-object attachment from published bones after Camera.

ALS authored data uses UE centimetres, cm/s, degrees and axes +X forward/+Y right/+Z up. Rapier and snapshots use three.js metres, m/s and axes +X/+Y up/+Z. Snapshot angles remain ALS degrees. The movement bridge converts movement units; animation multiplies raw m/s by 100 internally. `src/engine/unrealCoordinateSpace.ts` has axis/yaw helpers. Relay forwards m/s. Snapshot `pos` is capsule anchor; feet are anchor minus 0.9 m, including crouch.

`Character.inputSource` returns `AlsCharacterCodeInput` every physics sample. Send `active` (false clears pending jump edges), `jumpSequence` (increment once per press), `movementDirection` (world `{x,z}`, ≤1), `desiredGait` (`Walking|Running|Sprinting`), `desiredStance` (`Standing|Crouching`), `desiredRotationMode` (`VelocityDirection|ViewDirection|Aiming`), `viewYawAngle`/`viewPitchAngle` (ALS degrees), `aiming` (boolean), and `overlayMode` (built-in or registered). Defaults are active, no external jump, and current controls: Running, Standing, ViewDirection, Default; aiming resets false on omitted sample. `desiredSpeed` is an optional **m/s speed override**, not a gait; ALS selects authored speed from semantic gait. Set `inputEnabled={false}` when code/Subject owns input.

## Symptom rules

- Fast legs or Walking animation while running: send semantic gait with ALS speeds; inspect `desiredSpeed` units.
- Camera sawtooth or jittery arms: one look owner; pass Subject's yaw/pitch to Character and `AlsCamera.controlRotationSource`.
- One-frame camera/attachment lag: Physics priority, pose, camera, then attachment transforms.
- Remote glide or wrong animation: forward recorded gait, stance, body/view angles and animation intent in metre/m/s snapshots; retain anchor conversion.
- Missing spawn after loading: subscribe after React commit and clean up on unmount; Suspense may abandon a render.

## Recipe routing

| Task | Open under `docs/guide/recipes/` |
| --- | --- |
| Spawn/input, walk, crouch, aim | `local.md` |
| FPP/TPP, shoulder, look ownership | `camera.md` |
| Weapon attachment, rifle/pistol/custom overlay | `weapon.md` |
| Fire/reload/equip upper-body slot, interrupt | `montage.md` |
| Mantle, roll, ragdoll, get-up | `actions.md` |
| Replication, snapshots, remote, recorder/ghost | `remote.md` |
| FPP arms from ALS mesh and owned pack | `fpp-arms.md` |
| Foot IK and ground | `foot-ik.md` |
| Suspense, subscription and actor lifetime | `lifecycle.md` |
| Remote cost and update knobs | `performance.md` |
