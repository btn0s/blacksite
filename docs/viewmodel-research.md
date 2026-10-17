# Viewmodel asset research

Checked 16–17 October 2026. The brief permits CC0, public domain and CC BY art, including raw files distributed with an open repository. This review traces component credits instead of trusting a combined model's licence badge. The complete CC0 and CC BY legal texts are retained in [the arms package](../packages/subject-fpp/assets/arms/licenses/) and [the found set](../packages/subject-fpp/assets/found/CC-BY-4.0.txt).

**Recommendation and default: the found field set.** user77's animated AKM (DJMaesen's arms and animation on Armored Wave's AKM) and DJMaesen's animated Beretta, both CC BY 4.0, beat the Build rig on hand contact, reload weight and finger placement at 1× and 4×. They share one arm mesh, so the two weapons match. The CC0 Build rig stays available as `rig="blacksite"`; legacy ALS is kept for body matching. [Credits](../packages/subject-fpp/assets/found/CREDITS.md), [licence snapshot](../packages/subject-fpp/assets/found/Sketchfab-provenance.json).

## KingMuffinGF fps-anims collection

The collection holds 69 models: 60 report CC BY, 6 CC BY-NC, 1 CC BY-SA and 2 no licence. Licences came from `GET /v3/models/{uid}`; downloads used an authenticated token and were inspected in Blender for mesh names, texture names, triangle counts, clips and hand placement.

| Set | Licence | Decision |
| --- | --- | --- |
| **user77, AKM Assault Rifle - Animated** | CC BY; credits DJMaesen's `fps AK animated` (CC BY) and Armored Wave's `AKM` (CC BY) | **Rifle default.** Hand-keyed fire, tactical and empty reloads, holster and draw on one timeline; wood-furniture AKM suits the zone. |
| **DJMaesen (bumstrum), animated pistol** (Beretta) | CC BY, single author | **Pistol default.** The only collection pistol held two-handed at idle (wrists 8.5 cm apart), so it supports the V pose. Includes fire, last shot, both reloads, holster, draw and inspect. |
| DJMaesen, fps AK animated | CC BY | Same arms and motion as the user77 assembly; the assembly's weapon texture is better. |
| DJMaesen, fps pistol Animated and the second animated pistol | CC BY | One-handed idle; the support wrist sits about 24 cm from the grip. Rejected for the V-pose rule. |
| 1Matzh, 9mm Pistol (10 clips) and Scorpion remake | CC BY; Urpo pistol and Blue Spirit arms CC BY | Eligible. The 9mm is one-handed through idle, walk and aim; the Scorpion is an SMG, not the rifle slot. Previously the range comparison; no longer shipped. |
| dan741vlasov, Pistol 43 Tactical | CC BY badge | Mesh materials reference `BF3_Tex_*` textures, which indicates ripped game content. Ineligible. |
| TheParaziT, AR-15, MP7A1, Xiri X4, RPG-7 | CC BY badge | Built on Epic's mannequin arms. Ineligible. |
| ccransh, AK-74m, sniper, Makarov, FN 502, Remington, Saiga, SMG | CC BY badge | Credit DJMaesen's `FP Arms`, which is CC BY-NC. Ineligible. `P9 Manny` uses Epic's mannequin. Ineligible. |
| user77, G17, M16 A2, Remington 870, Rheeno, Dual Mac10 | CC BY; chain through DJMaesen's CC BY sets | Eligible, same arms. The AKM is the stronger rifle and the Beretta the only two-handed pistol. |
| DJMaesen's other weapons (carbine, SMGs, shotguns, sniper, LMG, revolver, launchers, melee) | CC BY | Eligible future slots; not rifle or pistol. |
| DJMaesen, battle rifle animated | CC BY-SA | Flagged, not used. |
| DJMaesen, FP Arms; teenjust500, Animated pistol and Animated Assault Rifle; user77, L96A1 and M32 | CC BY-NC | Ineligible. |
| teenjust500, AnimatedPistol (CC BY); Brendan_489, female character rig | CC BY | Screened from metadata and preview only: the pistol does not improve on the Beretta, and the rig is not first-person arms. |

DJMaesen's arms in the CC BY sets have 13,700 triangles; the CC BY-NC `FP Arms` upload has 14,852. They are different meshes, so the CC BY sets do not inherit the NC restriction.

## Earlier shortlist

These are local inspection renders of downloaded files, recovered from the stopped thread and read again during takeover. The portable thumbnails are reduced to 640 × 360 JPEGs; the original PNGs remain with the report captures. Each row supplies the depicted asset's author, source and licence. They show asset construction, not proof of correct in-game framing. Runtime contact sheets belong in the final report.

| Candidate | Licence and source | Included animation | Assessment |
| --- | --- | --- | --- |
| **9mm Pistol — 1Matzh** | [CC BY 4.0](https://sketchfab.com/3d-models/9mm-pistol-first-person-animations-c26d7f5aa72f4b01a6da4578caa8f07f). Urpo's pistol and Blue Spirit's arms source independently verified CC BY. | Downloaded file has `Idle`, `Walk`, `Run`, `Fire`, `Reload`, `Reload_Empty`. | Detailed fabric/gloves and coordinated magazine work. Pistol only, one-handed at idle and aim, about 928 joints. Superseded by the field set. |
| **PSX First Person Arms — Drillimpact** | [CC0, author's release](https://drillimpact.itch.io/psx-first-person-arms-free). | Relax, pushes, jabs, guard, grabs, finger-gun and knife actions; 18 exported actions including rest. | Clean retro shape, hand-painted bare/glove alternatives at 512 pixels. Good low-cost mesh base, but no physical rifle/pistol reload animation. |
| **fps arms (rigged only) — para** | [CC0, author's OpenGameArt release](https://opengameart.org/content/fps-arms-rigged-only). Credits MakeHuman mesh/texture. | T-pose and a crude sample action; arm IK and finger curl controls. | More anatomical than the very low-poly candidates, about 8,000 triangles. Unclothed and unfinished as a weapon system; adapting it would duplicate the Build track. |
| **WRAD ARMS — wriks** | [CC0, author's repository and full licence](https://github.com/wwwriks/wrad-arms). | No exported animation clips; IK rig in the source. | About 1,200 triangles and two 512-pixel skin textures. Clear original-author release; visual inspiration is not a copied game model. Low-poly silhouette and bare forearms need substantial adaptation for the target look. |

### 1Matzh pistol

![Downloaded pistol rig inspection](viewmodel-research/1matzh-9mm-pistol.jpg)

The inspection camera exposes the sleeves and two magazines during reload; it also makes the open sleeve ends obvious. Those ends must stay outside the gameplay camera. The found file should be judged in its authored first-person view before comparing it with the Build rig.

### Drillimpact

![Downloaded Drillimpact arm inspection](viewmodel-research/drillimpact-psx-arms.jpg)

The angular elbow and very broad forearm planes suit a more severe retro style. Individual fingers are present, but no firearm contact is demonstrated by the supplied animation set.

### para

![Downloaded para arm inspection](viewmodel-research/oga-para-fps-arms.jpg)

The hands have useful anatomy and skin detail. Bare skin, exposed upper-arm cuts and sample-only motion mean this is a mesh source, not a ready FPS presentation.

### WRAD

![Downloaded WRAD arm inspection](viewmodel-research/wrad-arms.jpg)

The pronounced facets are a deliberate low-polygon choice. For this project's fabric and glove direction, dressing and re-posing it would still require our own animation system.

## Retired 1Matzh comparison

The earlier range comparison, `site/public/viewmodel/found-pistol.glb` from 1Matzh's 9mm Pistol (Urpo's pistol, Blue Spirit's arms, all CC BY 4.0), was removed when the field set became the default. Its research render above keeps its credits.

## Search coverage and exclusions

| Source | Finding and decision |
| --- | --- |
| Sketchfab | Checked downloaded CC0/CC BY arm and animation results, plus component pages. **Barcode Games' [M4 animation pack](https://sketchfab.com/3d-models/m4-fps-weapon-animations-pack-v1-662fc74dda2646cfb48fc610705768ef)** is a promising CC BY rifle alternative with draw, fire, reload, empty reload and holster. Its preview shows a bare placeholder arm, so it was not pursued. |
| Sketchfab, Cransh | The downloaded [AK-74m](https://sketchfab.com/3d-models/fps-ak-74m-animations-94be8385c402474cacd39bc096c6ca14) and [rifle pack](https://sketchfab.com/3d-models/animated-fps-hands-rifle-animation-pack-5f2d0ed780a94724b36ab505f7564057) have useful draw/fire/reload/run/inspect motion, but credit DJMaesen's **[FP Arms](https://sketchfab.com/3d-models/fp-arms-8416c380544949bb9b224278819cbe6b)**, currently CC BY-NC. The assembly's CC BY badge cannot remove that restriction. Rejected; no component or motion is copied into the repository. |
| OpenGameArt | para's CC0 mesh is a viable base. [Robin Lamb's rifle and hands](https://opengameart.org/content/low-poly-fps-rifle-and-hands) is CC0 but only supplies a shooting action. The search also produced useful separate weapon geometry rather than complete FPS arms. |
| Open-source templates | [GDQuest's FPS-arm demo licence](https://github.com/gdquest-demos/godot-4-FPS-arms/blob/main/LICENSE) separates MIT code from CC BY-NC-SA art: rejected. [bukkbeek's template](https://github.com/bukkbeek/GodotFPS-Template) adds an asset resale prohibition, so it does not meet the permitted art-licence list. [WRAD](https://github.com/wwwriks/wrad-arms) has an explicit CC0 asset licence and is eligible. No game-code licence is treated as an asset licence. |
| Quaternius | [Animated Guns Pack](https://quaternius.com/packs/animatedguns.html) is CC0 with movable weapon parts, but no arms. The downloaded pistol has slide/trigger/magazine bones and fire/reload clips. Its file named `Rifle` is a wood-stock rifle, not an assault rifle despite the broad source tags; it is not used to stand in for a 600-RPM assault rifle. [Universal Animation Library](https://quaternius.com/packs/universalanimationlibrary.html) is CC0 full-body motion, not an authored first-person hand-to-magazine solution. |
| Kenney | [Blaster Kit](https://kenney.nl/assets/blaster-kit) is CC0 and animated. Its stylized science-fiction weapons do not solve anatomical arms or this project's grounded industrial look. |
| Poly Haven | [CC0 policy](https://polyhaven.com/license) explicitly permits raw redistribution. [Service Pistol](https://polyhaven.com/a/service_pistol), by Mateusz Sadek, has worn PBR surfaces and detachable magazines, about 28,000 triangles. A strong weapon upgrade candidate, but no FPS arms or authored reload set. No complete FPS-arm set was located. |
| Fab | Searched first-person arms and animation listings for explicit CC BY terms. [First Person Arms](https://www.fab.com/listings/8d54275e-f018-4cad-bbb2-14e12e5a3f6e) and [First Person Arms And Weapons Pack](https://www.fab.com/listings/7fa65ae4-ca62-4dd2-b5fd-6ddc3f5f5536) did not expose an eligible CC BY grant in the accessible listing. No Fab Standard assets were downloaded or shipped. This is a search limitation, not a claim that no eligible listing exists. |

## Build provenance and weapon choices

The [official MPFB licence](https://github.com/makehumancommunity/mpfb2/blob/master/LICENSE.md) separates its program code from its CC0 base meshes, targets, rigs, poses and textures. It explicitly includes graphical data generated through scripts. The recovered `build_arms.py` calls the bundled human generator and built-in game skeleton; it does not load any purchased or community clothing. Our sleeve mesh and grip/weapon curves are original work. [Package provenance](../packages/subject-fpp/assets/arms/CREDITS.md) records the exact sources.

The Build rig's rifle uses **[AKM by LonesomeDucky](https://opengameart.org/content/akm)**, CC0, weathered and PBR textured. The downloaded source is a 0.972-metre weapon with 5,322 polygons and embedded base-colour, normal, metalness, roughness and AO maps. Blacksite adds magazine/charging-handle part weights and reduces textures to 1024 pixels. The Build rig's pistol uses Quaternius's source with ambientCG surfaces. A secondary CC0 option, **[Soviet Assault Rifle by GGBotNet](https://opengameart.org/content/soviet-assault-rifle-3d)**, is only 2,277 triangles but has no texture and was not selected. Sources came from the authors' direct OpenGameArt releases, not from owned asset stores. [Weapon conversion provenance](../packages/subject-fpp/assets/weapons/CREDITS.md).

The Build route controls weapon sockets, two-bone hand targets, finger poses and timings across both weapons and stays CC0. Side by side with the field set, its procedural reloads read as lighter and less certain than the hand-keyed clips, so it is the opt-in rig.
