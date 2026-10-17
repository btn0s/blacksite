# Site credits

World textures and the sky below are CC0. The material viewer also includes generated images, identified separately with their provider and provenance. World files are resized to 512 px (sky 1024 × 512) and compressed to WebP; material references retain their recorded tile aspect ratio. The default found first-person arms use CC BY 4.0 art credited below.

## Materials (ambientCG, CC0)

| File | Source |
| --- | --- |
| `world/cast_*` | [Concrete044D](https://ambientcg.com/view?id=Concrete044D) |
| `world/panel_*` | [Concrete042A](https://ambientcg.com/view?id=Concrete042A) |
| `world/slab_*` | [Concrete031](https://ambientcg.com/view?id=Concrete031) |
| `world/stained_*` | [Concrete046](https://ambientcg.com/view?id=Concrete046) |
| `world/paint_*` | [PaintedPlaster015](https://ambientcg.com/view?id=PaintedPlaster015) |
| `world/brick_*` | [Bricks059](https://ambientcg.com/view?id=Bricks059) |
| `world/rust_*` | [Rust009](https://ambientcg.com/view?id=Rust009) |
| `world/metal_*` | [Metal041B](https://ambientcg.com/view?id=Metal041B) |
| `world/corrugated_*` | [CorrugatedSteel005](https://ambientcg.com/view?id=CorrugatedSteel005) |
| `world/asphalt_*` | [Asphalt031](https://ambientcg.com/view?id=Asphalt031) |
| `world/dirt_*` | [Ground103](https://ambientcg.com/view?id=Ground103) |
| `world/grass_*` | [Ground037](https://ambientcg.com/view?id=Ground037) |
| `firing-range/osb_*` | [Chipboard005](https://ambientcg.com/view?id=Chipboard005) |
| `firing-range/canvas_*` | [Fabric045](https://ambientcg.com/view?id=Fabric045) |
| `firing-range/planks_*` | [Planks037A](https://ambientcg.com/view?id=Planks037A) |
| `firing-range/plate_*` | [PaintedMetal005](https://ambientcg.com/view?id=PaintedMetal005) |
| `arms/sleeve_*` | [Fabric030](https://ambientcg.com/view?id=Fabric030) |
| `arms/glove_*` | [Leather032](https://ambientcg.com/view?id=Leather032) |
| `arms/gunmetal_*` | [Metal046B](https://ambientcg.com/view?id=Metal046B) |
| `arms/paint_*` | [PaintedMetal005](https://ambientcg.com/view?id=PaintedMetal005) |
| `arms/polymer_*` | [Plastic012B](https://ambientcg.com/view?id=Plastic012B) |
| `world/gravel_*` | [Gravel043](https://ambientcg.com/view?id=Gravel043) |

## Material references (ambientCG, CC0)

Author: ambientCG (Lennart Demes). Licence: [CC0 1.0 Universal](https://docs.ambientcg.com/license/), including redistribution and commercial use. Files live in `packages/materials/scans/` and are bundled into the material viewer. Complete source tiles are converted to WebP with a longest edge of 1024 px; rectangular tiles preserve their aspect ratio.

| Directory | Source | Source creation method |
| --- | --- | --- |
| `packages/materials/scans/poured-concrete/` | [Concrete004](https://ambientcg.com/view?id=Concrete004) | Photographic image with approximated PBR channels (`PBRApproximated`) |
| `packages/materials/scans/precast-panel/` | [Concrete013](https://ambientcg.com/view?id=Concrete013) | Photogrammetry |
| `packages/materials/scans/plaster-paint/` | [PaintedPlaster018](https://ambientcg.com/view?id=PaintedPlaster018) | Photogrammetry |
| `packages/materials/scans/brick/` | [Bricks097](https://ambientcg.com/view?id=Bricks097) | Photogrammetry |
| `packages/materials/scans/corrugated-rust/` | [CorrugatedSteel009](https://ambientcg.com/view?id=CorrugatedSteel009) | Photogrammetry; weathered galvanised sheet with light rust |
| `packages/materials/scans/painted-metal/` | [Metal063](https://ambientcg.com/view?id=Metal063) | Photographic image with approximated PBR channels (`PBRApproximated`) |
| `packages/materials/scans/wet-tile/` | [Tiles039](https://ambientcg.com/view?id=Tiles039) | Photogrammetry; ceramic reference, not a measured wetness state |
| `packages/materials/scans/asphalt/` | [Asphalt015](https://ambientcg.com/view?id=Asphalt015) | Photogrammetry |
| `packages/materials/scans/gravel-soil/` | [Ground110](https://ambientcg.com/view?id=Ground110) | Photogrammetry |
| `packages/materials/scans/bark/` | [Bark014](https://ambientcg.com/view?id=Bark014) | Photogrammetry |
| `packages/materials/scans/wood-planks/` | [Planks002](https://ambientcg.com/view?id=Planks002) | Photographic image with approximated PBR channels (`PBRApproximated`) |

Physical scales and processing are recorded in `packages/materials/scans/scans.json`. Ground110 and Bark014 use published dimensions; other scales are estimates. These are comparison references, not claims that every material is a measured scan or an exact match for its procedural variant.

## Generated material images

Author/provenance: generated for Blacksite using Google Gemini, model `gemini-3.1-flash-image`, on 2026-10-16. Each source WebP has an adjacent JSON record containing the complete prompt, model, date, intended dimensions and review notes. The source is [Gemini image generation](https://ai.google.dev/gemini-api/docs/image-generation); use is subject to the [Gemini API terms](https://ai.google.dev/gemini-api/terms), whose generated-content section states that Google does not claim ownership. These are generated outputs, not CC0 photographs or scans. No reference art was supplied to these generations.

| Source image | Prompt and provenance |
| --- | --- |
| `packages/materials/images/poured-concrete.webp` | `packages/materials/images/poured-concrete.json` |
| `packages/materials/images/precast-panel.webp` | `packages/materials/images/precast-panel.json` |
| `packages/materials/images/plaster-paint.webp` | `packages/materials/images/plaster-paint.json` |
| `packages/materials/images/brick.webp` | `packages/materials/images/brick.json` |
| `packages/materials/images/corrugated-rust.webp` | `packages/materials/images/corrugated-rust.json` |
| `packages/materials/images/painted-metal.webp` | `packages/materials/images/painted-metal.json` |
| `packages/materials/images/wet-tile.webp` | `packages/materials/images/wet-tile.json` |
| `packages/materials/images/asphalt.webp` | `packages/materials/images/asphalt.json` |
| `packages/materials/images/gravel-soil.webp` | `packages/materials/images/gravel-soil.json` |
| `packages/materials/images/bark.webp` | `packages/materials/images/bark.json` |
| `packages/materials/images/wood-planks.webp` | `packages/materials/images/wood-planks.json` |

The corresponding `packages/materials/library/*-image.json` graphs make the source tileable and derive PBR channels. Height, normal, roughness and AO from these images are authored estimates, not measured material properties; prompt dimensions are intended scale. The procedural `library/*.json` graphs and their baked textures are authored for Blacksite and contain no purchased texture content.

## Sky (Poly Haven, CC0)

`world/sky.webp` is [Overcast Soil Pure Sky](https://polyhaven.com/a/overcast_soil_puresky), graded and reduced.

## Character

The ALS mannequin and animations come from [ALS Web](https://github.com/btn0s/als-web) (MIT), served from `vendor/als-web/public/assets`.

## First-person viewmodel

The CC0 `Built` arms derive from the **MakeHuman team**'s bundled [MPFB mesh, weights and skeleton](https://github.com/makehumancommunity/mpfb2), [CC0 1.0](https://github.com/makehumancommunity/mpfb2/blob/master/LICENSE.ASSETS.md). Blacksite crops, dresses, rigs and textures the arms; its original sleeve geometry is also CC0. The application's source-code licence does not cover exported mesh output, as explained in [MPFB's licence statement](https://github.com/makehumancommunity/mpfb2/blob/master/LICENSE.md).

The `Built` rifle derives from **LonesomeDucky**'s [AKM](https://opengameart.org/content/akm), **CC0**, including its weathered PBR maps. Blacksite adds a part rig, changes orientation and reduces the embedded maps to 1024-pixel JPEGs. The `Built` pistol derives from **Quaternius**'s [Animated Guns Pack](https://quaternius.com/packs/animatedguns.html), [CC0](https://opengameart.org/content/low-poly-animated-guns), with adapted scale, orientation and part rig. The sleeve, glove and pistol surface textures listed above are by **ambientCG / Lennart Demes**, [CC0](https://docs.ambientcg.com/license/).

The default **found** arms (the Firing Range's `Found · CC BY` rig) are CC BY 4.0 works from Sketchfab. The rifle is **[AKM Assault Rifle - Animated](https://sketchfab.com/3d-models/akm-assault-rifle-animated-6348dc53e3e249c6b297cb8f3f1e3e9b)** by **[user77](https://sketchfab.com/user77)**, which combines arms and animations from **[fps AK animated](https://sketchfab.com/3d-models/fps-ak-animated-b0b1bae40337449189483f6187cf7af7)** by **[DJMaesen](https://sketchfab.com/bumstrum)** and the **[AKM](https://sketchfab.com/3d-models/akm-fe8b79ae8a8142fb9ba706912c6b9df8)** model by **[Armored Wave](https://sketchfab.com/armoredwave)**. The pistol is **[animated pistol](https://sketchfab.com/3d-models/animated-pistol-bd896167e7ca44f19597d3afe6a8d83f)** by **[DJMaesen](https://sketchfab.com/bumstrum)**. Blacksite re-baked the files, reduced textures to 1024-pixel JPEGs, removed emissive maps and retoned the sleeves olive; keyframes are unchanged. [Full attribution and changes](viewmodel/CREDITS.md); [full licence and warranty disclaimer](viewmodel/CC-BY-4.0.txt). These credits do not imply endorsement. The MakeHuman arms above remain available as the CC0 `Built` rig.

## Valley

The Valley showcase (`examples/valley`) ships these open library assets from `examples/valley/assets/library/`, processed for the web: materials as 1k WebP, sounds as Ogg and M4A, and the terrain cropped and resampled to a 16-bit PNG heightmap. Trees, grass, flowers, litter and leaf textures are procedural code in `@blacksite/landscape` and contain no third-party art.

### CC0 1.0

Licence: https://creativecommons.org/publicdomain/zero/1.0/

| Asset | Category | Author | Source |
| --- | --- | --- | --- |
| `bark-pine` Pine Bark | material | Dimitrios Savva (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/pine_bark) |
| `soil-mud-scanned` Ground 054 | material | Lennart Demes (ambientCG) | [ambientcg.com](https://ambientcg.com/a/Ground054) |

### CC BY 3.0

Licence: https://creativecommons.org/licenses/by/3.0/

| Asset | Category | Author | Source | Attribution |
| --- | --- | --- | --- | --- |
| `step-grass-oga` Footsteps on different surfaces: grass | footstep | congusbongus | [opengameart.org](https://opengameart.org/content/footsteps-on-different-surfaces) | "Footsteps on different surfaces: grass" by congusbongus (https://opengameart.org/content/footsteps-on-different-surfaces), CC BY 3.0. Derived from "footstep-grass.wav" by swuing (https://freesound.org/s/38874/), CC BY 3.0 |

### Public domain

Works of the U.S. federal government. Licence: https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits

| Asset | Category | Author | Source | Attribution |
| --- | --- | --- | --- | --- |
| `bed-wind-alpine` Wind Soundscape from Gem Lake | ambience | J. Job, Rocky Mountain National Park (National Park Service) | [www.nps.gov](https://www.nps.gov/romo/learn/photosmultimedia/sounds-ambient-soundscapes.htm) | "Wind Soundscape from Gem Lake" by J. Job, Rocky Mountain National Park (National Park Service), public domain |
| `terrain-ridge-valley` USGS 3DEP 1/3 arc-second n41w079 | terrain | U.S. Geological Survey | [www.usgs.gov](https://www.usgs.gov/3d-elevation-program) | Elevation data: U.S. Geological Survey 3D Elevation Program (public domain) |

The Valley also reuses the look world kit's `world/grass_*`, `world/dirt_*` and `world/gravel_*` surfaces (ambientCG, CC0), listed under Materials above and credited in `packages/look/assets/world/CREDITS.md`.

## Fonts (SIL Open Font License)

Barlow and Barlow Condensed by Jeremy Tribby; IBM Plex Mono by IBM. Bundled through Fontsource.

## Screenshots

`thumbs/*.webp` are captures of the site's own showcases.

## Font licence notices

### Barlow and Barlow Condensed

Source: https://raw.githubusercontent.com/jpt/barlow/main/OFL.txt

```text
Copyright 2017 The Barlow Project Authors (https://github.com/jpt/barlow)

This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

### IBM Plex Mono

Source: https://raw.githubusercontent.com/IBM/plex/master/LICENSE.txt

```text
Copyright © 2017 IBM Corp. with Reserved Font Name "Plex"

This Font Software is licensed under the SIL Open Font License, Version 1.1.

This license is copied below, and is also available with a FAQ at: http://scripts.sil.org/OFL


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded,
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```

## Open library catalog

Catalog records for separately fetched library assets. These binaries are not bundled with the main site. Installed projects receive credits for their selected assets; the starter viewer serves its own CREDITS.md.

### CC0 1.0

Licence: https://creativecommons.org/publicdomain/zero/1.0/

| Asset | Category | Author | Source |
| --- | --- | --- | --- |
| `bed-city-distant` semi-distant city traffic | ambience | janbezouska (Freesound) | [freesound.org](https://freesound.org/s/330427/) |
| `bed-drip-basement` Dripping water loop | ambience | qubodup | [opengameart.org](https://opengameart.org/content/dripping-water-loop) |
| `bed-dripping` cave dripping | ambience | Sclolex (Freesound) | [freesound.org](https://freesound.org/s/177958/) |
| `bed-fluorescent-hum` fluorescent hum | ambience | ftpalad (Freesound) | [freesound.org](https://freesound.org/s/119910/) |
| `bed-forest-spring` spring forest | ambience | bajko (Freesound) | [freesound.org](https://freesound.org/s/385280/) |
| `bed-industrial` industrial ambience | ambience | Lewente (Freesound) | [freesound.org](https://freesound.org/s/393398/) |
| `bed-nox-essentials` Essentials Series SFX | ambience | Nox_Sound_Design (itch.io) | [nox-sound-design.itch.io](https://nox-sound-design.itch.io/essentials-series-sfx-nox-sound) |
| `bed-rain-downpour` downpour | ambience | klangfabrik (Freesound) | [freesound.org](https://freesound.org/s/190546/) |
| `bed-rain-inside` rain from inside | ambience | allrealsound (Freesound) | [freesound.org](https://freesound.org/s/161705/) |
| `bed-rain-loop` Rain (loopable) | ambience | Ylmir | [opengameart.org](https://opengameart.org/content/rain-loopable) |
| `bed-transformer-hum` power transformer hum | ambience | kiefspoon (Freesound) | [freesound.org](https://freesound.org/s/144559/) |
| `bed-warehouse` abandoned warehouse | ambience | Kostrava (Freesound) | [freesound.org](https://freesound.org/s/240895/) |
| `bed-wind-leaves` autumn wind and dry leaves | ambience | Stek59 (Freesound) | [freesound.org](https://freesound.org/s/457318/) |
| `bed-wind-winter` winter wind | ambience | klangfabrik (Freesound) | [freesound.org](https://freesound.org/s/117513/) |
| `anim-mesh2motion-addon` Mesh2Motion human add-on animations | animation | Scott Petrovic (Mesh2Motion) | [github.com](https://github.com/Mesh2Motion/mesh2motion-app) |
| `anim-mesh2motion-mocap` Mesh2Motion mocopi captures | animation | Scott Petrovic (Mesh2Motion) | [github.com](https://github.com/Mesh2Motion/mesh2motion-app) |
| `character-mesh2motion-mannequin` Mesh2Motion human base model | character | Scott Petrovic (Mesh2Motion) | [github.com](https://github.com/Mesh2Motion/mesh2motion-app) |
| `branches-dry` Dry Branches Medium 01 | foliage | Rico Cilliers (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/dry_branches_medium_01) |
| `fern` Fern 02 | foliage | Rob Tuytel and Rico Cilliers (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/fern_02) |
| `log-dead` Dead Tree Trunk | foliage | Rob Tuytel (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/dead_tree_trunk) |
| `nettles` Nettle Plant | foliage | Rob Tuytel and Rico Cilliers (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/nettle_plant) |
| `shrub` Shrub 03 | foliage | Rico Cilliers (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/shrub_03) |
| `tree-stump` Tree Stump 01 | foliage | Rob Tuytel (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/tree_stump_01) |
| `weeds` Weed Plant 02 | foliage | Rob Tuytel and Rico Cilliers (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/weed_plant_02) |
| `step-concrete` Footsteps on concrete | footstep | florianreichelt (Freesound) | [freesound.org](https://freesound.org/s/459964/) |
| `step-concrete-corridor` Footsteps in corridor | footstep | cris (Freesound) | [freesound.org](https://freesound.org/s/167686/) |
| `step-concrete-kenney` Footsteps concrete | footstep | Kenney | [kenney.nl](https://kenney.nl/assets/impact-sounds) |
| `step-dirt` Footsteps on dirt | footstep | aglinder (Freesound) | [freesound.org](https://freesound.org/s/264469/) |
| `step-grass` Footsteps on grass | footstep | Yuval (Freesound) | [freesound.org](https://freesound.org/s/206030/) |
| `step-grass-kenney` Footsteps grass | footstep | Kenney | [kenney.nl](https://kenney.nl/assets/impact-sounds) |
| `step-gravel` Footsteps on gravel | footstep | rempen (Freesound) | [freesound.org](https://freesound.org/s/274832/) |
| `step-metal` Footsteps on metal | footstep | conleec (Freesound) | [freesound.org](https://freesound.org/s/149454/) |
| `step-metal-grate` Footsteps on metal grate | footstep | Oilcan03 (Freesound) | [freesound.org](https://freesound.org/s/786977/) |
| `step-mud` Footsteps in mud | footstep | Alex_hears_things (Freesound) | [freesound.org](https://freesound.org/s/376809/) |
| `step-puddle` Footsteps in puddles | footstep | patchytherat (Freesound) | [freesound.org](https://freesound.org/s/531566/) |
| `step-wet-rubberduck` 100 CC0 SFX #2: wet footsteps | footstep | rubberduck | [opengameart.org](https://opengameart.org/content/100-cc0-sfx-2) |
| `step-wood` Footsteps on wood | footstep | Mydo1 (Freesound) | [freesound.org](https://freesound.org/s/198962/) |
| `step-wood-kenney` Footsteps wood | footstep | Kenney | [kenney.nl](https://kenney.nl/assets/impact-sounds) |
| `sky-abandoned-slipway` Abandoned Slipway | hdri | Philip Modin (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/abandoned_slipway) |
| `sky-misty-pines` Misty Pines | hdri | Greg Zaal (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/misty_pines) |
| `sky-overcast-kloofendal` Kloofendal Overcast (Pure Sky) | hdri | Greg Zaal (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/kloofendal_overcast_puresky) |
| `sky-overcast-mud-road` Mud Road (Pure Sky) | hdri | Sergey Rudavin and Jarod Guest (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/mud_road_puresky) |
| `sky-overcast-soil` Overcast Soil (Pure Sky) | hdri | Jarod Guest and Sergej Majboroda (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/overcast_soil_puresky) |
| `ir-bathroom` Bathroom IR | ir | Ligidium (Freesound) | [freesound.org](https://freesound.org/s/192295/) |
| `ir-bedroom` Bedroom IR | ir | Fission9 (Freesound) | [freesound.org](https://freesound.org/s/465296/) |
| `ir-corridor` Small Corridor IR | ir | LewisEmmott5 (Freesound) | [freesound.org](https://freesound.org/s/732030/) |
| `ir-garage` Underground garage B2 IR | ir | kirkpatrick.live (Freesound) | [freesound.org](https://freesound.org/s/568095/) |
| `ir-outdoor-blocks` 5-storey residential blocks IR | ir | newlocknew (Freesound) | [freesound.org](https://freesound.org/s/816877/) |
| `ir-stairwell` Stairwell IR | ir | thesummerblues1984 (Freesound) | [freesound.org](https://freesound.org/s/818246/) |
| `ir-tunnel` 300 m steel tunnel IR | ir | modusmogulus (Freesound) | [freesound.org](https://freesound.org/s/846029/) |
| `asphalt-damaged` Road Damaged | material | Dimitrios Savva (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/road_damaged) |
| `bark-pine` Pine Bark | material | Dimitrios Savva (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/pine_bark) |
| `brick-factory` Factory Brick | material | Rob Tuytel (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/factory_brick) |
| `concrete-floor-cracked` Damaged Concrete Floor 02 | material | Rob Tuytel (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/damaged_concrete_floor_02) |
| `concrete-floor-plain` Concrete 048 | material | Lennart Demes (ambientCG) | [ambientcg.com](https://ambientcg.com/a/Concrete048) |
| `concrete-wall-stained` Concrete Wall 008 | material | Dario Barresi and Charlotte Baglioni (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/concrete_wall_008) |
| `forest-floor-leaves` Forest Leaves 02 | material | Rob Tuytel (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/forest_leaves_02) |
| `metal-painted-green-rust` Green Metal Rust | material | Rob Tuytel (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/green_metal_rust) |
| `metal-painted-shutter` Painted Metal Shutter | material | Dario Barresi, Rico Cilliers and Charlotte Baglioni (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/painted_metal_shutter) |
| `metal-rusted-shutter` Rusted Shutter | material | Dimitrios Savva (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/rusted_shutter) |
| `metal-walkway-grate` Metal Walkway 014 | material | Lennart Demes (ambientCG) | [ambientcg.com](https://ambientcg.com/a/MetalWalkway014) |
| `pavers-soviet` Floor Tiles 09 | material | Rob Tuytel (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/floor_tiles_09) |
| `plaster-peeling` Peeling Painted Wall | material | Dimitrios Savva (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/peeling_painted_wall) |
| `rust-heavy` Rust Coarse 01 | material | Dimitrios Savva and Rico Cilliers (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/rust_coarse_01) |
| `soil-mud` Brown Mud 03 | material | Rob Tuytel (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/brown_mud_03) |
| `soil-mud-scanned` Ground 054 | material | Lennart Demes (ambientCG) | [ambientcg.com](https://ambientcg.com/a/Ground054) |
| `tile-dirty-floor` Dirty Tiles | material | Matterfield and Jenelle van Heerden (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/dirty_tiles) |
| `tile-white-chipped` Long White Tiles | material | Jenelle van Heerden and Sergej Majboroda (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/long_white_tiles) |
| `wood-planks-old` Old Planks 02 | material | Rob Tuytel (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/old_planks_02) |
| `barrel-steel` Barrel 03 | prop | Serhii Khromov (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/barrel_03) |
| `barrier-concrete` Concrete Road Barrier | prop | Amal Kumar (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/concrete_road_barrier) |
| `bed-frame-old` Old Bed Frame | prop | Luca B (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/old_bed_frame) |
| `chair-wooden` Painted Wooden Chair 02 | prop | Kirill Sannikov (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/painted_wooden_chair_02) |
| `crate-military` Old Military Crate | prop | Jack Mava (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/old_military_crate) |
| `fence-chainlink` Modular Chainlink Fence | prop | James Ray Cock and Amal Kumar (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/modular_chainlink_fence) |
| `fire-extinguisher` Korean Fire Extinguisher 01 | prop | UM JOORIN (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/korean_fire_extinguisher_01) |
| `food-cans` Russian Food Cans 01 | prop | Kosan Aziz (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/russian_food_cans_01) |
| `gas-mask` Old Gas Mask | prop | Michał Wiśniewski (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/old_gas_mask) |
| `jerrycan-metal` Metal Jerrycan | prop | Sean Buckley (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/metal_jerrycan) |
| `lights-fluorescent` Mounted Fluorescent Lights | prop | Ulan Cabanilla (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/mounted_fluorescent_lights) |
| `pipes-industrial` Modular Industrial Pipes 01 | prop | Jorge Camacho (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/modular_industrial_pipes_01) |
| `power-box` Power Box 01 | prop | Rico Cilliers and Yann Kervran (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/power_box_01) |
| `props-psx-soviet-apartment` PSX Soviet Apartment Props | prop | Flipperside (itch.io) | [flipperside.itch.io](https://flipperside.itch.io/psx-soviet-apartment-props) |
| `shelves-steel` Steel Frame Shelves 01 | prop | James Ray Cock (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/steel_frame_shelves_01) |
| `shutter-door` Rollershutter Door | prop | MP (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/rollershutter_door) |
| `street-lamp` Street Lamp 01 | prop | Josh Dean (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/street_lamp_01) |
| `table-wooden` Painted Wooden Table | prop | Kirill Sannikov (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/painted_wooden_table) |
| `trash-bin` Metal Trash Can | prop | GurJas Studios (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/metal_trash_can) |
| `tyre-old` Old Tyre | prop | MP (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/old_tyre) |
| `utility-cabinet` Utility Box 02 | prop | James Ray Cock (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/utility_box_02) |
| `wheelchair` Wheelchair 01 | prop | Garreth Dean (Poly Haven) | [polyhaven.com](https://polyhaven.com/a/wheelchair_01) |
| `casing-concrete` Brass casing drop on concrete | sound | GrayJoy (Freesound) | [freesound.org](https://freesound.org/s/210102/) |
| `foley-bolt-clicks` Equipment Clicks III | sound | LFA | [opengameart.org](https://opengameart.org/content/equipment-clicks-iii) |
| `gunfire-ak47` The Free Firearm Sound Library: AK-47, near, single shots | sound | Ben Jaszczak, Brian Nelson, Kevin Heras and Matthew Nanney | [opengameart.org](https://opengameart.org/content/the-free-firearm-sound-library) |
| `gunfire-ak47-burst` The Free Firearm Sound Library: AK-47, near, short burst | sound | Ben Jaszczak, Brian Nelson, Kevin Heras and Matthew Nanney | [opengameart.org](https://opengameart.org/content/the-free-firearm-sound-library) |
| `gunfire-ak47-mid` The Free Firearm Sound Library: AK-47, mid distance | sound | Ben Jaszczak, Brian Nelson, Kevin Heras and Matthew Nanney | [opengameart.org](https://opengameart.org/content/the-free-firearm-sound-library) |
| `gunfire-pistol-45` The Free Firearm Sound Library: 1911 .45, near | sound | Ben Jaszczak, Brian Nelson, Kevin Heras and Matthew Nanney | [opengameart.org](https://opengameart.org/content/the-free-firearm-sound-library) |
| `gunfire-pistol-9mm` The Free Firearm Sound Library: Walther PPQ 9 mm, near | sound | Ben Jaszczak, Brian Nelson, Kevin Heras and Matthew Nanney | [opengameart.org](https://opengameart.org/content/the-free-firearm-sound-library) |
| `gunfire-shotgun` The Free Firearm Sound Library: Nova 12 gauge pump, near | sound | Ben Jaszczak, Brian Nelson, Kevin Heras and Matthew Nanney | [opengameart.org](https://opengameart.org/content/the-free-firearm-sound-library) |
| `impact-bullets` bullet impacts | sound | pushkin (Freesound) | [freesound.org](https://freesound.org/s/144444/) |
| `impact-flesh` Bullets hitting Gore | sound | bananplyte (Freesound) | [freesound.org](https://freesound.org/s/452155/) |
| `impact-glass` Glass | sound | Kenney | [kenney.nl](https://kenney.nl/assets/impact-sounds) |
| `impact-metal` Metal | sound | Kenney | [kenney.nl](https://kenney.nl/assets/impact-sounds) |
| `impact-plate` Plate | sound | Kenney | [kenney.nl](https://kenney.nl/assets/impact-sounds) |
| `impact-punch` Punch | sound | Kenney | [kenney.nl](https://kenney.nl/assets/impact-sounds) |
| `impact-soft` Soft | sound | Kenney | [kenney.nl](https://kenney.nl/assets/impact-sounds) |
| `impact-wood` Wood | sound | Kenney | [kenney.nl](https://kenney.nl/assets/impact-sounds) |
| `reload-pistol` Pistol reload | sound | MaximBomba (Freesound) | [freesound.org](https://freesound.org/s/432139/) |
| `reload-pistol-zer0sol` Handgun Reload Sound Effect | sound | zer0_sol | [opengameart.org](https://opengameart.org/content/handgun-reload-sound-effect) |
| `reload-rifle` Rifle or shotgun reload | sound | MaximBomba (Freesound) | [freesound.org](https://freesound.org/s/432141/) |
| `reload-shotgun-zer0sol` Shotgun Reload Sound Effects | sound | zer0_sol | [opengameart.org](https://opengameart.org/content/shotgun-reload-sound-effects) |
| `ricochet` bullet ricochet | sound | aust_paul (Freesound) | [freesound.org](https://freesound.org/s/30932/) |
| `shot-ak47` AK47 Shot | sound | LeMudCrab (Freesound) | [freesound.org](https://freesound.org/s/163457/) |
| `shot-ak47-outdoor` AK-47 being shot | sound | serøutōnin--deprivəd (Freesound) | [freesound.org](https://freesound.org/s/855842/) |
| `shot-kalashnikov-indoor` Kalashnikov 1 (indoor) | sound | mahecic (Freesound) | [freesound.org](https://freesound.org/s/812210/) |
| `shot-pistol` Pistol Shot | sound | LeMudCrab (Freesound) | [freesound.org](https://freesound.org/s/163456/) |
| `shot-pistol-9mm` 9mm pistol shot | sound | michorvath (Freesound) | [freesound.org](https://freesound.org/s/427592/) |
| `shot-shotgun` shotgun.wav | sound | Marregheriti (Freesound) | [freesound.org](https://freesound.org/s/266105/) |
| `weapon-akm` AKM | weapon | LonesomeDucky (OpenGameArt) | [opengameart.org](https://opengameart.org/content/akm) |

### CC BY 3.0

Licence: https://creativecommons.org/licenses/by/3.0/

| Asset | Category | Author | Source | Attribution |
| --- | --- | --- | --- | --- |
| `step-boots-concrete` Footsteps on different surfaces: boots | footstep | congusbongus | [opengameart.org](https://opengameart.org/content/footsteps-on-different-surfaces) | "Footsteps on different surfaces: boots" by congusbongus (https://opengameart.org/content/footsteps-on-different-surfaces), CC BY 3.0. Derived from "footstep-concrete.wav" by swuing (https://freesound.org/s/38873/), CC BY 3.0 |
| `step-grass-oga` Footsteps on different surfaces: grass | footstep | congusbongus | [opengameart.org](https://opengameart.org/content/footsteps-on-different-surfaces) | "Footsteps on different surfaces: grass" by congusbongus (https://opengameart.org/content/footsteps-on-different-surfaces), CC BY 3.0. Derived from "footstep-grass.wav" by swuing (https://freesound.org/s/38874/), CC BY 3.0 |
| `step-gravel-oga` Footsteps on different surfaces: gravel | footstep | congusbongus | [opengameart.org](https://opengameart.org/content/footsteps-on-different-surfaces) | "Footsteps on different surfaces: gravel" by congusbongus (https://opengameart.org/content/footsteps-on-different-surfaces), CC BY 3.0. Derived from the Gravel Footsteps pack by Ali_6868 (https://freesound.org/people/Ali_6868/packs/21608/), CC0 |
| `step-metal-ladder` Footsteps on different surfaces: metal | footstep | congusbongus | [opengameart.org](https://opengameart.org/content/footsteps-on-different-surfaces) | "Footsteps on different surfaces: metal" by congusbongus (https://opengameart.org/content/footsteps-on-different-surfaces), CC BY 3.0. Derived from "fboots on aluminum ladder 01" by Eelke (https://freesound.org/s/462598/), CC BY |
| `step-tile-oga` Footsteps on different surfaces: tile | footstep | congusbongus | [opengameart.org](https://opengameart.org/content/footsteps-on-different-surfaces) | "Footsteps on different surfaces: tile" by congusbongus (https://opengameart.org/content/footsteps-on-different-surfaces), CC BY 3.0. Derived from "footstep-concrete.wav" by swuing (https://freesound.org/s/38873/) and "Squeaky footstep.wav" by ceberation (https://freesound.org/s/235524/), CC BY 3.0 |
| `step-water-oga` Footsteps on different surfaces: water | footstep | congusbongus | [opengameart.org](https://opengameart.org/content/footsteps-on-different-surfaces) | "Footsteps on different surfaces: water" by congusbongus (https://opengameart.org/content/footsteps-on-different-surfaces), CC BY 3.0. Derived from "Water Footsteps" by EminYILDIRIM (https://freesound.org/s/608663/) and "footstep-concrete.wav" by swuing (https://freesound.org/s/38873/), CC BY |
| `step-wood-oga` Footsteps on different surfaces: wood | footstep | congusbongus | [opengameart.org](https://opengameart.org/content/footsteps-on-different-surfaces) | "Footsteps on different surfaces: wood" by congusbongus (https://opengameart.org/content/footsteps-on-different-surfaces), CC BY 3.0. Derived from "footstep-wood.wav" by swuing (https://freesound.org/s/38876/), CC BY 3.0 |

### CC BY 4.0

Licence: https://creativecommons.org/licenses/by/4.0/

| Asset | Category | Author | Source | Attribution |
| --- | --- | --- | --- | --- |
| `bed-horror-obsydianx` Horror SFX Volume 1 | ambience | ObsydianX (itch.io) | [obsydianx.itch.io](https://obsydianx.itch.io/horror-sfx-volume-1) | "Horror SFX Volume 1" by ObsydianX (https://obsydianx.itch.io/horror-sfx-volume-1), CC BY 4.0 |
| `bed-hum-ups` WWS UPS – uninterruptible power supply | ambience | Work With Sounds / Torsten Nilsson | [commons.wikimedia.org](https://commons.wikimedia.org/wiki/File:WWS_UPS8211uninterruptiblepowersupply.ogg) | "WWS UPS – uninterruptible power supply" by Work With Sounds / Torsten Nilsson (https://commons.wikimedia.org/wiki/File:WWS_UPS8211uninterruptiblepowersupply.ogg), CC BY 4.0 |
| `bed-mine-winding` WWS Steam winding engine soundscape | ambience | Work With Sounds | [commons.wikimedia.org](https://commons.wikimedia.org/wiki/File:WWS_Steamwindingenginesoundscape.ogg) | "WWS Steam winding engine soundscape" by Work With Sounds (https://commons.wikimedia.org/wiki/File:WWS_Steamwindingenginesoundscape.ogg), CC BY 4.0 |
| `bed-station-tunnel` WWS The Station Tunnel of the Tampere Station | ambience | Work With Sounds | [commons.wikimedia.org](https://commons.wikimedia.org/wiki/File:WWS_TheStationTunnelOfTheTampereStation.ogg) | "WWS The Station Tunnel of the Tampere Station" by Work With Sounds (https://commons.wikimedia.org/wiki/File:WWS_TheStationTunnelOfTheTampereStation.ogg), CC BY 4.0 |
| `bed-storm-wind` Storm Arwen 2022 | ambience | Tsorthan Grove | [opengameart.org](https://opengameart.org/content/storm-arwen-2022) | "Storm Arwen 2022" by Tsorthan Grove (https://opengameart.org/content/storm-arwen-2022), CC BY 4.0 |
| `step-heyheythere` Footsteps SFX Free | footstep | heyheythere (itch.io) | [heyheythere.itch.io](https://heyheythere.itch.io/footsteps-sfx-free) | "Footsteps SFX Free" by heyheythere (https://heyheythere.itch.io/footsteps-sfx-free), CC BY 4.0 |
| `ir-classroom` Classroom omni IR (TH Köln spatial RIR database) | ir | Lübeck, Arend and Pörschmann (TH Köln) | [zenodo.org](https://zenodo.org/records/5031335) | "Classroom omni IR (TH Köln spatial RIR database)" by Lübeck, Arend and Pörschmann (TH Köln) (https://zenodo.org/records/5031335), CC BY 4.0 |
| `ir-lecture-hall` Audimax omni IR (TH Köln spatial RIR database) | ir | Lübeck, Arend and Pörschmann (TH Köln) | [zenodo.org](https://zenodo.org/records/5031335) | "Audimax omni IR (TH Köln spatial RIR database)" by Lübeck, Arend and Pörschmann (TH Köln) (https://zenodo.org/records/5031335), CC BY 4.0 |
| `ir-open-air` Ancient open-air theatre of Tyndaris, S1 R9 | ir | Astolfi, Bo and Shtrepi (Politecnico di Torino) | [zenodo.org](https://zenodo.org/records/7928804) | "Ancient open-air theatre of Tyndaris, S1 R9" by Astolfi, Bo and Shtrepi (Politecnico di Torino) (https://zenodo.org/records/7928804), CC BY 4.0 |
| `kit-psx-soviet-blocks` PSX Soviet Block Kit Free | prop | heyheythere (itch.io) | [heyheythere.itch.io](https://heyheythere.itch.io/psx-soviet-block-kit-free) | "PSX Soviet Block Kit Free" by heyheythere (https://heyheythere.itch.io/psx-soviet-block-kit-free), CC BY 4.0 |
| `gunfire-rifle-distant` Audio data for gunshot detection, recorded on the savannah: assault rifle at 150 m | sound | Jakob Wirén and Kasper Nordenram | [zenodo.org](https://zenodo.org/records/14824927) | "Audio data for gunshot detection, recorded on the savannah: assault rifle at 150 m" by Jakob Wirén and Kasper Nordenram (https://zenodo.org/records/14824927), CC BY 4.0 |
| `sfx-psx-horror` PSX Horror SFX Free | sound | heyheythere (itch.io) | [heyheythere.itch.io](https://heyheythere.itch.io/psx-horror-sfx-free) | "PSX Horror SFX Free" by heyheythere (https://heyheythere.itch.io/psx-horror-sfx-free), CC BY 4.0 |

### MIT

Licence: https://opensource.org/license/mit

| Asset | Category | Author | Source | Attribution |
| --- | --- | --- | --- | --- |
| `anim-rocketbox-crouch-idle` Rocketbox crouch idle | animation | Microsoft and Rocketbox Studios | [github.com](https://github.com/microsoft/Microsoft-Rocketbox/tree/master/Assets/Animations) | Microsoft Rocketbox Avatar Library (https://github.com/microsoft/Microsoft-Rocketbox), Copyright (c) 2020 Microsoft, MIT License |
| `anim-rocketbox-idle` Rocketbox idle neutral | animation | Microsoft and Rocketbox Studios | [github.com](https://github.com/microsoft/Microsoft-Rocketbox/tree/master/Assets/Animations) | Microsoft Rocketbox Avatar Library (https://github.com/microsoft/Microsoft-Rocketbox), Copyright (c) 2020 Microsoft, MIT License |
| `anim-rocketbox-run` Rocketbox run neutral | animation | Microsoft and Rocketbox Studios | [github.com](https://github.com/microsoft/Microsoft-Rocketbox/tree/master/Assets/Animations) | Microsoft Rocketbox Avatar Library (https://github.com/microsoft/Microsoft-Rocketbox), Copyright (c) 2020 Microsoft, MIT License |
| `anim-rocketbox-walk` Rocketbox walk neutral | animation | Microsoft and Rocketbox Studios | [github.com](https://github.com/microsoft/Microsoft-Rocketbox/tree/master/Assets/Animations) | Microsoft Rocketbox Avatar Library (https://github.com/microsoft/Microsoft-Rocketbox), Copyright (c) 2020 Microsoft, MIT License |
| `character-rocketbox-soldier` Rocketbox Military Male 02 | character | Microsoft and Rocketbox Studios | [github.com](https://github.com/microsoft/Microsoft-Rocketbox/tree/master/Assets/Avatars/Professions/Military_Male_02) | Microsoft Rocketbox Avatar Library (https://github.com/microsoft/Microsoft-Rocketbox), Copyright (c) 2020 Microsoft, MIT License |

MIT License

Copyright (c) 2020 Microsoft

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### Public domain

Licence: https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits

| Asset | Category | Author | Source |
| --- | --- | --- | --- |
| `bed-stream` Stream Soundscape from the Black Canyon Trail | ambience | J. Job / National Park Service, Rocky Mountain National Park | [www.nps.gov](https://www.nps.gov/romo/learn/photosmultimedia/sounds-ambient-soundscapes.htm) |
| `bed-wind-alpine` Wind Soundscape from Gem Lake | ambience | J. Job, Rocky Mountain National Park (National Park Service) | [www.nps.gov](https://www.nps.gov/romo/learn/photosmultimedia/sounds-ambient-soundscapes.htm) |
| `terrain-ridge-valley` USGS 3DEP 1/3 arc-second n41w079 | terrain | U.S. Geological Survey | [www.usgs.gov](https://www.usgs.gov/3d-elevation-program) |

## Traverse recorded audio

The Traverse example ships the following selected open-library recordings. Blacksite normalized and encoded them as Opus with AAC fallback. Traverse retains five original takes per footstep surface, decodes at 24 kHz, and divides wind and drips into three excerpts with 400 ms wrap crossfades. Landings layer a synthesized low thump under recorded footsteps.

- "Dripping water loop" by qubodup (https://opengameart.org/content/dripping-water-loop), CC0 1.0.
- "Wind Soundscape from Gem Lake" by J. Job, Rocky Mountain National Park (National Park Service) (https://www.nps.gov/romo/learn/photosmultimedia/sounds-ambient-soundscapes.htm), public domain.
- "Footsteps on different surfaces: boots" by congusbongus (https://opengameart.org/content/footsteps-on-different-surfaces), CC BY 3.0. Derived from "footstep-concrete.wav" by swuing (https://freesound.org/s/38873/), CC BY 3.0.
- "Footsteps on different surfaces: gravel" by congusbongus (https://opengameart.org/content/footsteps-on-different-surfaces), CC BY 3.0. Derived from the Gravel Footsteps pack by Ali_6868 (https://freesound.org/people/Ali_6868/packs/21608/), CC0.
- "Footsteps on different surfaces: metal" by congusbongus (https://opengameart.org/content/footsteps-on-different-surfaces), CC BY 3.0. Derived from "fboots on aluminum ladder 01" by Eelke (https://freesound.org/s/462598/), CC BY.
- "Footsteps on different surfaces: water" by congusbongus (https://opengameart.org/content/footsteps-on-different-surfaces), CC BY 3.0. Derived from "Water Footsteps" by EminYILDIRIM (https://freesound.org/s/608663/) and "footstep-concrete.wav" by swuing (https://freesound.org/s/38873/), CC BY.

Footstep derivatives are licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). The basement drip is [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/); the National Park Service wind recording is public domain.
