# Found viewmodel credits

Checked 17 October 2026 against the Sketchfab API (`GET /v3/models/{uid}`); every work below reports licence slug `by`, [CC BY 4.0](CC-BY-4.0.txt), and is downloadable. These files are supplied without warranty under the [full CC BY 4.0 licence](CC-BY-4.0.txt). No endorsement by any author is implied. The licence fields returned for each work are recorded in [Sketchfab-provenance.json](Sketchfab-provenance.json).

## Rifle: `rifle.glb`

Based on **[AKM Assault Rifle - Animated](https://sketchfab.com/3d-models/akm-assault-rifle-animated-6348dc53e3e249c6b297cb8f3f1e3e9b)** by **[user77](https://sketchfab.com/user77)**, CC BY 4.0. It combines:

- arms and animations from **[fps AK animated](https://sketchfab.com/3d-models/fps-ak-animated-b0b1bae40337449189483f6187cf7af7)** by **[DJMaesen](https://sketchfab.com/bumstrum)** (account `bumstrum`), CC BY 4.0;
- the weapon model **[AKM](https://sketchfab.com/3d-models/akm-fe8b79ae8a8142fb9ba706912c6b9df8)** by **[Armored Wave](https://sketchfab.com/armoredwave)**, CC BY 4.0.

## Pistol: `pistol.glb`

Based on **[animated pistol](https://sketchfab.com/3d-models/animated-pistol-bd896167e7ca44f19597d3afe6a8d83f)** by **[DJMaesen](https://sketchfab.com/bumstrum)** (account `bumstrum`), CC BY 4.0, which includes its own arms, pistol and animations.

## Changes

Blacksite baked both downloads in Blender 5.1.2 with `packages/subject/scripts/bake-found-set.py`. That script keeps only the deforming arm joints and the animated weapon parts, resamples the single authored action, and reduces textures to 1024-pixel JPEGs. `packages/subject/scripts/dress-viewmodel.py` then removes emissive maps and retones the sleeve region of each arms texture to olive drab. Gloves, weapons and all keyframes are unchanged.

The runtime plays sub-ranges of the authored timelines as separate clips. Sway, bob, recoil, landing, sprint, aiming and the rifle inspect are procedural layers that Blacksite adds on top.

## Not used

DJMaesen's separate "FP Arms" upload is CC BY-NC (14,852 triangles); it is a different mesh from the 13,700-triangle arms in the two works above, which the same author released under CC BY. A CC BY assembly by another user that includes those NC arms, Epic's mannequin, or ripped game content would not be eligible here, and none of these is used.
