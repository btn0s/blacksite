# First-person arms

The `fpp` and `mp` profiles use `ArmsViewmodel` from `@blacksite/subject-fpp/arms`. The viewmodel keeps the SK_Als skeleton and skinning, masks the mesh to arms, and evaluates the ALS rifle/pistol upper-body graph. It draws with its own camera and depth pass after the world camera is final, so the arms have an independent FOV and do not disappear inside walls. Remote players continue to render the full ALS character.

The default mannequin, weapon meshes and locomotion/pose animation data come from the pinned MIT ALS submodule. Original Blacksite fire, reload and equip clips are also MIT, with their authored tracks in `packages/subject-fpp/assets/arms-actions.json`. Generated development servers and builds distribute both `assets/LICENSE-ALS-Refactored.md` and `assets/LICENSE-Blacksite-Arms.md`. No purchased content is required or redistributed by Blacksite.

The solo `fpp` profile needs ALS's animation graph and asset data to use this same viewmodel. It does not mount ALS Character, locomotion physics, full-body presentation, or a multiplayer transport. Keeping the graph as a tree-shaken dependency is the smallest shared implementation; a future animation-only ALS package could reduce the source workspace without duplicating the graph.

## Manifest

Each generated game has `public/assets/arms.json`, initially `{ "version": 1 }`. Edit this manifest to replace assets without changing game code. Relative URLs resolve from the manifest URL. Omitted fields retain the MIT defaults. The viewmodel also accepts `manifestUrl` for games with another asset layout.

```json
{
  "version": 1,
  "fov": 70,
  "weapons": {
    "rifle": {
      "meshUrl": "/assets/owned/infima/rifle.glb",
      "animationUrl": "/assets/owned/infima/character.glb",
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
    },
    "pistol": {
      "meshUrl": "/assets/owned/infima/pistol.glb",
      "animationUrl": "/assets/owned/infima/character.glb",
      "clips": {
        "fire": "Pistol_Fire",
        "reload": "Pistol_Reload",
        "equip": "Pistol_Equip"
      }
    }
  }
}
```

Names above illustrate the slot mapping; use the exact animation names in the converted GLB. Both weapon entries support `poses`, `aim`, `aimCrouch`, `aimReference`, `idle`, `idleReference`, `runArms`, `sprintArms`, `sprintImpulseArms`, `fire`, `reload`, and `equip` clip slots. `characterUrl` replaces the skinned character mesh. Bone names, hierarchy, reference pose, animation targets and ALS metadata must match SK_Als. Attachment positions are metres, rotations are Euler radians, and scale is uniform.

Each weapon may set `presentation.position` to frame its clips in camera-local metres. Set `presentation.sight` to the rear sight's center in the weapon asset's scene-local coordinates, before its attachment transform. At aim, the viewmodel evaluates the current skinned pose, transforms that physical sight point and centers it on the reticle in the same frame. `presentation.aimOffset` is an additional camera-local trim after that centering; its Z coordinate controls stock clearance. These values are three-element metre coordinates. Owned meshes need their own measured sight point even when their animation skeleton matches SK_Als.

The default ALS rifle calibration is:

```json
{
  "position": [0.05, -1.47, -0.05],
  "sight": [0, 0.15937, 0.03789],
  "aimOffset": [0, 0, -0.08]
}
```

The viewmodel keeps all 68 physical bones while rendering only forearms and hands. Its default pose bank uses the native raised aiming posture for first-person visibility; aiming blends that posture and aligns the physical sights. The native third-person relaxed pose remains available to full-body characters.

## Owned-pack upgrade

Discover the user's licensed pack through indexed metadata:

```sh
blacksite assets search "Low Poly Animated Modern Guns" --json
blacksite assets formats <owned-id> --json
```

An owner may install a converted weapon into their game with `blacksite assets add <owned-id> --project /absolute/game`. Its `assets.lock.json` entry supplies the manifest's `meshUrl`. The generated ignore rules cover `public/assets/fab_*/`, `public/assets/itch_*/`, and `public/assets/owned/`; game manifests may be committed, purchased bytes may not. The game `public` directory takes precedence over ALS defaults during development and build.

Infima's character clips have been independently checked against all 68 SK_Als bones, including names, parents and reference transforms. This permits direct slot mapping after conversion; it does not prove weapon socket alignment. Preserve the converted character clips, curves and montage metadata, then set their exact clip names in this manifest. A generic model import does not replace a character-animation export or skeleton validation. Keep these exports local and ignored. Blacksite does not install or bundle the pack itself.

Validate a pack in its owning game with rifle and pistol idle, movement, aim, fire, reload and equip. Check attachment alignment separately from skeleton compatibility. Fire, reload and equip sequences should come from accepted Armory events, keeping their visual actions aligned with the weapon simulation.
