# First-person arms

`ArmsViewmodel` from `@blacksite/subject-fpp/arms` draws a separately lit, camera-relative viewmodel after the world. The default is a finger-rigged MakeHuman/MPFB mesh with textured sleeves and gloves. Weapon parts drive short action curves; two-bone IK places the hands on the grip, magazine and charging handle. The existing ALS-derived arms remain available for games that want local arms matching the remote character.

## Use

```tsx
import { ArmsViewmodel, createArmsState } from '@blacksite/subject-fpp/arms'

const arms = createArmsState()

<ArmsViewmodel state={arms} render="external" onPresentation={setPresentation} />
<Look overlay={presentation} />
```

Keep one `ArmsState` per player. Update `weapon`, `aiming`, `speed` in metres per second, and `sprinting` from gameplay. Increment `fireSequence`, `reloadSequence` and `equipSequence` only for accepted Armory events. Set `weapon` when a switch starts: the viewmodel holsters the old weapon before equipping the new one. Increment `inspectSequence` for inspect, and `landSequence` with `landSpeed` in metres per second for a landing dip. Set `empty` from the displayed weapon's magazine so the pistol slide can lock open.

Aim, firing and sprint cancel inspect smoothly. Reload and weapon switching suppress ADS until the action permits it. Animation does not authorize shots or refill magazines; Armory owns those decisions.

`StandaloneSubject` accepts `touch` (`createStandaloneTouch()`), `recoil` (`createStandaloneRecoil()`) and `sensitivity`. Scale look sensitivity by aim FOV / hip FOV. It owns camera input; the arms derive sway from that finished camera pose without another mouse listener.

## Motion model and parts list

The authoritative model is `packages/subject-fpp/src/viewmodel/model.ts`; the short action curves are in `clips.ts`. Their public exports are `VIEWMODEL`, `VIEWMODEL_WEAPONS`, `VIEWMODEL_CLIPS` and `switchSeconds(to, from)`. These are Blacksite tuning values, not measurements claimed from a commercial title.

Armory's older `ALS_WEAPONS` equip timings are shorter than the new holster-plus-equip animation. When adopting this default, derive the weapon definitions from the same curves; the FPP template and Firing Range demonstrate this migration. For definitions that have one equip duration per destination, use the longer of the two source weapons:

```ts
const definitions = ALS_WEAPONS.map(weapon =>
  weapon.id === 'rifle' || weapon.id === 'pistol'
    ? {
        ...weapon,
        reloadSeconds: VIEWMODEL_CLIPS[weapon.id].reload.duration,
        equipSeconds: Math.max(
          switchSeconds(weapon.id, 'rifle'),
          switchSeconds(weapon.id, 'pistol'),
        ),
      }
    : weapon,
)
```

Apply these definitions on the authoritative simulation as well as the client. A multiplayer game retaining the older timings can keep `rig="als"` until both sides migrate together.

| Layer | What moves |
| --- | --- |
| Idle | Low-amplitude breathing, textured sleeves and articulated hands |
| Sway | Bounded springs driven by camera angular velocity |
| Bob | Stride phase derived from speed and stride length, reduced in ADS |
| Fire | Translation and rotation springs, trigger pose, slide/bolt cycle and muzzle flash |
| ADS | Timed blend toward the calibrated physical sight line, with per-weapon framing |
| Reload | Magazine removal and insertion, bolt/slide travel, support-hand IK and finger grip changes |
| Equip / holster | Two distinct curves with weapon replacement below the screen |
| Sprint | Lowered, canted weapon with a speed-driven stride |
| Inspect | Two inspection angles, reversible interruption and support-hand release |
| Land | A capped spring impulse proportional to impact speed |

The minimum visual parts are two skinned forearms with sleeves, two gloves, ten independently articulated fingers, two weapons, two detachable magazines, and a moving charging handle or slide on each weapon. Rifle and pistol have their own sight, wrist targets, elbow poles, grip poses and action curves. The Firing Range is the playable reference for all these states.

The rifle calibration centres the front blade and pitches the model to retain a visible sight picture; the pistol uses its rear-sight target. Sight distances in the model are measured to those chosen points.

The default viewmodel FOV is 56°, with a 0.005 m near plane. Below a 4:3 aspect it widens the vertical FOV to preserve horizontal coverage and shifts hip framing inward. ADS fades the shift to zero. `portraitFov(fov, aspect, minimum)` exposes the widening for a game's world camera.

## Composition

With `render="external"`, `onPresentation` supplies `{ scene, camera }` to `<Look overlay={presentation} />` or `look.addOverlay(scene, camera)`. The viewmodel receives bloom and grading after world AO, and its independent depth buffer prevents walls from clipping the hands. The default `composite` mode renders after the world without requiring Look. Show exactly one local set of arms; remote characters continue using their full body.

## ALS compatibility

Use `<ArmsViewmodel rig="als" … />` or set `"rig": "als"` in `public/assets/arms.json`. This keeps the existing SK_Als skeleton, graph and action slots. The public component, state factory, composition callback and sequence counters retain their names. Games that construct `ArmsState` literals should switch to `createArmsState()` so the added inspect, landing, empty-magazine and diagnostic fields receive their defaults.

A version-1 manifest remains the asset customization entry point. Relative URLs resolve from `manifestUrl`, which defaults to `/assets/arms.json`.

For the procedural rig, `armsUrl` replaces the arm mesh while retaining the MakeHuman game skeleton and its fitted bind pose. It is a compatible-mesh slot, not an automatic retargeter. Weapon geometry and its moving-part names must match the calibrated sockets in `VIEWMODEL_WEAPONS`; an arbitrary gun needs its own socket and sight calibration. The older animation and attachment slots below belong to ALS mode.

```json
{
  "version": 1,
  "rig": "als",
  "fov": 56,
  "weapons": {
    "rifle": {
      "meshUrl": "/assets/owned/rifle.glb",
      "animationUrl": "/assets/owned/character.glb",
      "clips": {
        "fire": "Rifle_Fire",
        "reload": "Rifle_Reload",
        "equip": "Rifle_Equip"
      },
      "attachment": {
        "bone": "hand_r",
        "position": [0, 0, 0],
        "rotation": [0, 0, 0],
        "scale": 1
      }
    }
  }
}
```

Existing manifests with character or weapon overrides select ALS automatically unless `rig` is explicitly set. Legacy character and animation replacements require SK_Als bone names, hierarchy, reference transforms and animation targets. Clip slots also include `poses`, `aim`, `aimCrouch`, `aimReference`, `idle`, `idleReference`, `runArms`, `sprintArms` and `sprintImpulseArms`. Attachment positions are metres, Euler rotations are radians, and scale is uniform.

In ALS mode, `presentation.position` frames the pose, `presentation.sight` identifies the rear sight in the weapon asset's scene-local coordinates, and `presentation.aimOffset` trims the centered sight. Its Z coordinate controls stock clearance. Matching a skeleton does not prove weapon socket alignment: measure the sight for every replacement.

Owned-pack installation belongs in the user's game, through `blacksite assets search`, `formats` and `add`. Generated ignore rules exclude purchased asset directories. Commit a manifest when appropriate; keep purchased bytes local and ignored. Blacksite's default requires no purchased content.

## Verification

Run the Firing Range capture harness and the standard `blacksite check` desktop and phone profiles. The capture harness pauses the animation clock and advances exact frame steps to expose the complete reload and equip, including handoffs. Its report includes model timings and contact residuals. Compare screenshots as well: zero wrist-target error cannot prove that a finger bends correctly or that a magazine is inside the hand.

Read the 1× view for framing and the 4× view for wrist deformation, finger placement, clipping, magazine contact and state transitions. Runtime tests cover the numerical model and the rig; a playtest still decides whether recoil, action weight and touch aiming feel right.

## Distribution

Asset provenance and licence texts live beside the arms in `packages/subject-fpp/assets/arms/`. `cli/serve-assets.mjs` serves and copies the provenance to `assets/viewmodel/CREDITS.md` and the full texts to `assets/viewmodel/licenses/` in both the site and generated games. The pre-existing ALS option and original ALS action tracks retain their MIT notices. See `docs/viewmodel-research.md` for the Find shortlist and exclusions.
