# Viewmodel asset provenance

Checked 17 October 2026. The default viewmodel is the found field set, CC BY 4.0, credited in [found/CREDITS.md](found/CREDITS.md). The Blacksite rig below (`rig="blacksite"`) is CC0. Runtime TypeScript remains under the repository's code licence. The optional legacy ALS viewmodel retains its existing MIT attribution and is a separate presentation.

## Blacksite arms

`blacksite-arms.glb` is derived from the bundled MakeHuman base mesh, macro targets, weights and `game_engine` skeleton through [MPFB](https://github.com/makehumancommunity/mpfb2), by the MakeHuman team. These assets are [CC0 1.0](licenses/CC0-1.0.txt). MPFB's [licence statement](licenses/MPFB-LICENSE.md) explicitly includes graphical output created by scripts; its application code licence does not apply to the exported mesh.

Blacksite crops the body to the hands, dresses the hand surface as gloves, authors sleeves, trims the skeleton to the arms and fingers, normalizes weights, adds UVs and baked ambient occlusion, and exports glTF. The original Blacksite mesh additions are also dedicated to CC0 1.0. No downloaded clothing pack, purchased character, external animation or AI model contributes to this mesh.

The retained generator, `packages/subject-fpp/scripts/build-arms.py`, calls `HumanService.create_human` and `HumanService.add_builtin_rig`, using only the bundled base and targets. It takes an MPFB source directory and output GLB path. The game does not ship MPFB application code.

Generation used MPFB 2.0.18, commit [`3af0cd5a2ffba072e93a34e5f6f494fdc4813ddf`](https://github.com/makehumancommunity/mpfb2/tree/3af0cd5a2ffba072e93a34e5f6f494fdc4813ddf), recovered from the downloaded GitHub ZIP's archive comment. Blender was 5.1.2, build `ec6e62d40fa9`, started with `--factory-startup`. The generator uses `detailed_helpers=True` when creating the human so that the game skeleton fits the generated mesh.

Reproduction commands, after obtaining the linked source assets:

```sh
blender --background --factory-startup --python packages/subject-fpp/scripts/build-arms.py -- /path/mpfb2/src /tmp/blacksite-arms.glb
blender --background --factory-startup --python packages/subject-fpp/scripts/build-weapons.py -- rifle /path/akm54.blend /tmp/rifle.glb
blender --background --factory-startup --python packages/subject-fpp/scripts/build-weapons.py -- pistol '/path/FPS Pack/Blends/Pistol.blend' /tmp/pistol.glb
```

## Original animation and grip data

Blacksite dedicates its original animation and grip data to [CC0 1.0](licenses/CC0-1.0.txt): the authored timing, movement curves and event data in `VIEWMODEL_CLIPS` (`packages/subject-fpp/src/viewmodel/clips.ts`), finger-pose values in `GRIPS`, and weapon socket and pose transforms in `VIEWMODEL_WEAPONS` (`packages/subject-fpp/src/viewmodel/model.ts`). These data were authored for this viewmodel and do not derive from the found field set or legacy ALS clips.

The CC0 dedication applies to the animation and grip data. The TypeScript sampler, runtime and other implementation code retain the repository's code licence.

## Blacksite rig weapons

`../weapons/rifle.glb` derives from **AKM**, by **LonesomeDucky**, [CC0 1.0](licenses/CC0-1.0.txt): [author's release](https://opengameart.org/content/akm), [source Blender file](https://opengameart.org/sites/default/files/akm54.blend). The source includes weathered base-colour, normal, metalness, roughness and ambient-occlusion maps. Blacksite adds a weapon rig with magazine, charging-handle and muzzle bones, reorients the model, and reduces the embedded maps from 4096 to 1024 pixels with JPEG quality 88.

`../weapons/pistol.glb` derives from **Animated Guns Pack**, by **Quaternius**, [CC0 1.0](licenses/CC0-1.0.txt).

- [Author's pack page](https://quaternius.com/packs/animatedguns.html).
- [Author's OpenGameArt release and download](https://opengameart.org/content/low-poly-animated-guns).
- [Source archive](https://opengameart.org/sites/default/files/FPS%20Pack_0.zip), using `Blends/Pistol.blend`.

Blacksite adapts the pistol's scale, orientation, bone names and materials, makes the slide, trigger and magazine vertex weights rigid, adds a muzzle marker, and applies ambientCG surfaces at runtime. The source pistol has `Control`, `Slide`, `Trigger` and `Magazine` bones. The retained conversion script is `packages/subject-fpp/scripts/build-weapons.py`. Blacksite's authored movement curves and grip poses are independent of the source pack's fire/reload clips; no original weapon action is exported in the default GLBs.

## Surface materials

Sleeve, glove and weapon maps come from **ambientCG / Lennart Demes**, [CC0 1.0](https://docs.ambientcg.com/license/). Maps are reduced to 512 pixels and encoded as WebP; the painted-metal colour is recoloured olive. The full legal text is [included](licenses/CC0-1.0.txt).

| Maps in `../materials` | Source |
| --- | --- |
| `sleeve_*` | [Fabric030](https://ambientcg.com/view?id=Fabric030) |
| `glove_*` | [Leather032](https://ambientcg.com/view?id=Leather032) |
| `gunmetal_*` | [Metal046B](https://ambientcg.com/view?id=Metal046B) |
| `paint_*` | [PaintedMetal005](https://ambientcg.com/view?id=PaintedMetal005) |
| `polymer_*` | [Plastic012B](https://ambientcg.com/view?id=Plastic012B) |

## Found field set

The default `found` rig ships `rifle.glb` and `pistol.glb` from `packages/subject-fpp/assets/found/`. Both are CC BY 4.0 works by user77, DJMaesen and Armored Wave; full attribution, changes, the warranty disclaimer and the licence text are in [found/CREDITS.md](found/CREDITS.md), and the authors' licence declarations at the time of checking are in [found/Sketchfab-provenance.json](found/Sketchfab-provenance.json).
