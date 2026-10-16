# Characters

An animated player body that walks, runs, sprints, crouches, mantles, rolls, ragdolls and aims, in first or third person. It is ALS running on three.js and Rapier, with Subject on top for games that own their input.

## Which piece

| Need | Use |
|---|---|
| Solo first person, arms only | `@blacksite/subject-fpp`: `StandaloneSubject` and `ArmsViewmodel` from `/arms`. The game owns movement and returns the camera position. |
| Solo third person | The ALS `Character` and `AlsCamera`; the character reads keyboard, mouse and gamepad itself. Template: `templates/prototype-kits/als-tpp/mode.tsx`. |
| Switchable view, or a body the game drives | `@blacksite/subject`: `createSubject()` plus `Character inputEnabled={false} inputSource={createSubjectInputSource(subject)}`. |
| Remote players, or AI puppets | One `AlsSnapshotBuffer` per actor, drawn with `AlsRemoteActor`. Squad does this. |

Read `als.md` before wiring any ALS body, camera, overlay, action or remote.

## Guides

- `vendor/als-web/docs/guide/overview.md`: the model, frame order, units and the input contract.
- `vendor/als-web/docs/guide/recipes/`: tested recipes for local, camera, weapon, montage, actions, remote, fpp-arms, foot-ik, lifecycle and performance (table in `als.md`).
- `docs/arms.md`: the first-person arms viewmodel and its `public/assets/arms.json` manifest.
- `docs/player-templates.md`: what each scaffold profile mounts.
- `packages/subject/AGENTS.md`, `packages/subject-fpp/AGENTS.md`.
- Working examples: `site/src/showcases/characters/` (Checkpoint, third person with the check contract), `firing-range/` (first person), `multiplayer/` (Subject, both views), `squad/soldiers.tsx` (remote actors).

## Standard use

- Wrap the scene in `<Physics gravity={[0, -9.8, 0]} timeStep={1/60} updatePriority={ALS_FRAME_PRIORITY.Physics}>`.
- Preload the character with `preloadAlsCharacterGltf` behind the loading screen.
- With Subject: read `subject.frame` (eye, aim origin and direction, muzzle) after `ALS_FRAME_PRIORITY.Camera + 0.02` to drive Armory; `subject.addRecoil(pitch, yaw)` for recoil; `subject.respawn(position, yaw)`.
- Touch: `subject.setVirtual(true)`, then `keySubject` and `lookSubject`.

Numbers are in `feel.md`.

## What isn't there yet

- No swimming, ladders, climbing, slide, prone, lean, wall-run, coyote time or jump buffer. Build them in the game.
- No explicit roll or mantle request through Subject: only `jumpSequence`. Roll exists on ALS's own double-tap path.
- The standalone first-person subject has no physics, so a first-person game needs its own character controller.
- Subject has no gamepad and doesn't read `@blacksite/input`; its keys are fixed.
- `AlsCamera` has no sensitivity prop (1° per pixel). Scale the pointer events instead, as Checkpoint does (×0.55).
- The arms viewmodel animates the rifle and the pistol only.
- The body is the ALS mannequin, coloured per game. Bringing another skinned character isn't supported.

## Rules, and the failures that taught them

- **One set of arms, one view owner, gait not speed, foot slip as proof.** See `feel.md` and `craft.md`.
- **Replicate the recorded state.** The first remote pawn guessed running below 4 m/s, forced standing and grounded, and set the body's yaw to the view's. It failed 6 of 12 cases. Send gait, stance, grounded, rotation mode, body and view yaw, and actions.
- **Subscribe after commit.** A subscription made during a Suspense render lost the spawn message when React threw that render away. The player spawned at the origin inside another, and neither could move.
