# Default viewmodel weapons

Both exported models are CC0 1.0 Universal. The [full legal text](licenses/CC0-1.0.txt) is included. Original Blacksite rig additions are also dedicated to CC0. The application runtime is separately licensed as code.

## Rifle

`rifle.glb` derives from **AKM** by **LonesomeDucky**, published under CC0 at [OpenGameArt](https://opengameart.org/content/akm). [Original `akm54.blend`](https://opengameart.org/sites/default/files/akm54.blend).

The source includes the weathered PBR textures. Blacksite reorients the model, assigns magazine and charging-handle vertices to a new part rig, adds a muzzle marker, and resizes the embedded texture maps from 4096 to 1024 pixels, encoded as JPEG quality 88. Original exported geometry, material data and images remain derived from this single CC0 source. No original action clips are included.

## Pistol

`pistol.glb` derives from `Blends/Pistol.blend` in **Animated Guns Pack** by **Quaternius**, CC0. [Author's pack page](https://quaternius.com/packs/animatedguns.html), [author's OpenGameArt release](https://opengameart.org/content/low-poly-animated-guns), [downloaded archive](https://opengameart.org/sites/default/files/FPS%20Pack_0.zip).

Blacksite resets the pose, changes scale and orientation, renames part bones, adds a muzzle marker and replaces the flat source materials at runtime with ambientCG maps. Those maps are **Metal046B** and **Plastic012B**, by **ambientCG / Lennart Demes**, [CC0](https://docs.ambientcg.com/license/); [Metal046B](https://ambientcg.com/view?id=Metal046B), [Plastic012B](https://ambientcg.com/view?id=Plastic012B). No original action clips are included.

## Reproduction

The retained converter is `packages/subject-fpp/scripts/build-weapons.py`. Run headless Blender with this script, then `-- rifle <akm54.blend> <output.glb>` or `-- pistol <Pistol.blend> <output.glb>`. Source downloads are external to the repository; only the redistributable converted assets and this provenance are committed.
