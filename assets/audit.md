# Shipped asset audit

Checked 16 October 2026. 101 tracked files, 21,675,061 bytes. Exact SHA-256 values, evidence and recommendations: [audit.json](audit.json).

All tracked binary files plus text SVG/LUT/animation data. ALS excluded entirely by owner instruction. Dependencies, build output, caches and gitignored files excluded. No assets removed.

The inventory includes software archives for completeness. It adds text LUTs, SVG and authored animation data because an art audit based only on binary detection would miss them. Fonts enter through six explicit Fontsource CSS imports; dependency binaries and generated build output were excluded as requested. Their source and licence are recorded separately in the JSON.

## Findings

- Existing ambientCG materials and Poly Haven sky have explicit CC0 provenance. The 27 KTX2 derivatives retain those sources. Nothing requires removal.
- `packages/subject-fpp/assets/materials/CREDITS.md` already exists; the earlier report claiming it was missing was incorrect. Authored arms animation data carries MIT and its own permission notice.
- The root licence is FSL-1.1-ALv2. Generated LUTs and site art have no separate permissive asset grant in this checkout. FSL limits competing uses and is outside this catalog’s allowlist; this does not imply the owner cannot keep using their own site images. Keep these files and ask the owner for an explicit CC0/MIT asset grant only if promoting them into the reusable library.
- Font upstream licences allow bundling under OFL 1.1 with copyright and licence notices. The site credits now include the full upstream Barlow and IBM Plex notices, also retained in `assets/font-notices.md`. Font binary metadata was not inspected.
- No tracked standalone model, audio or font binaries exist outside the excluded ALS submodule. New library sources/builds are local cached or ignored outputs, recorded in the catalog rather than this shipped-file snapshot.

## Every tracked file

| File | Bytes | Source | Licence / result |
| --- | ---: | --- | --- |
| `packages/look/assets/world/asphalt_c.ktx2` | 288933 | [Asphalt031](https://ambientcg.com/a/Asphalt031) | CC0-1.0 |
| `packages/look/assets/world/asphalt_n.ktx2` | 288662 | [Asphalt031](https://ambientcg.com/a/Asphalt031) | CC0-1.0 |
| `packages/look/assets/world/brick_c.ktx2` | 333711 | [Bricks059](https://ambientcg.com/a/Bricks059) | CC0-1.0 |
| `packages/look/assets/world/brick_n.ktx2` | 299110 | [Bricks059](https://ambientcg.com/a/Bricks059) | CC0-1.0 |
| `packages/look/assets/world/cast_c.ktx2` | 231934 | [Concrete044D](https://ambientcg.com/a/Concrete044D) | CC0-1.0 |
| `packages/look/assets/world/cast_n.ktx2` | 264454 | [Concrete044D](https://ambientcg.com/a/Concrete044D) | CC0-1.0 |
| `packages/look/assets/world/corrugated_c.ktx2` | 225393 | [CorrugatedSteel005](https://ambientcg.com/a/CorrugatedSteel005) | CC0-1.0 |
| `packages/look/assets/world/corrugated_n.ktx2` | 100534 | [CorrugatedSteel005](https://ambientcg.com/a/CorrugatedSteel005) | CC0-1.0 |
| `packages/look/assets/world/dirt_c.ktx2` | 325750 | [Ground103](https://ambientcg.com/a/Ground103) | CC0-1.0 |
| `packages/look/assets/world/dirt_n.ktx2` | 339089 | [Ground103](https://ambientcg.com/a/Ground103) | CC0-1.0 |
| `packages/look/assets/world/grass_c.ktx2` | 347749 | [Ground037](https://ambientcg.com/a/Ground037) | CC0-1.0 |
| `packages/look/assets/world/grass_n.ktx2` | 339637 | [Ground037](https://ambientcg.com/a/Ground037) | CC0-1.0 |
| `packages/look/assets/world/gravel_c.ktx2` | 337108 | [Gravel043](https://ambientcg.com/a/Gravel043) | CC0-1.0 |
| `packages/look/assets/world/gravel_n.ktx2` | 336220 | [Gravel043](https://ambientcg.com/a/Gravel043) | CC0-1.0 |
| `packages/look/assets/world/metal_c.ktx2` | 327067 | [Metal041B](https://ambientcg.com/a/Metal041B) | CC0-1.0 |
| `packages/look/assets/world/metal_n.ktx2` | 17077 | [Metal041B](https://ambientcg.com/a/Metal041B) | CC0-1.0 |
| `packages/look/assets/world/paint_c.ktx2` | 235270 | [PaintedPlaster015](https://ambientcg.com/a/PaintedPlaster015) | CC0-1.0 |
| `packages/look/assets/world/paint_n.ktx2` | 333609 | [PaintedPlaster015](https://ambientcg.com/a/PaintedPlaster015) | CC0-1.0 |
| `packages/look/assets/world/panel_c.ktx2` | 149932 | [Concrete042A](https://ambientcg.com/a/Concrete042A) | CC0-1.0 |
| `packages/look/assets/world/panel_n.ktx2` | 172111 | [Concrete042A](https://ambientcg.com/a/Concrete042A) | CC0-1.0 |
| `packages/look/assets/world/rust_c.ktx2` | 281797 | [Rust009](https://ambientcg.com/a/Rust009) | CC0-1.0 |
| `packages/look/assets/world/rust_n.ktx2` | 187088 | [Rust009](https://ambientcg.com/a/Rust009) | CC0-1.0 |
| `packages/look/assets/world/sky.ktx2` | 211718 | [overcast_soil_puresky](https://polyhaven.com/a/overcast_soil_puresky) | CC0-1.0 |
| `packages/look/assets/world/slab_c.ktx2` | 186097 | [Concrete031](https://ambientcg.com/a/Concrete031) | CC0-1.0 |
| `packages/look/assets/world/slab_n.ktx2` | 247729 | [Concrete031](https://ambientcg.com/a/Concrete031) | CC0-1.0 |
| `packages/look/assets/world/stained_c.ktx2` | 222605 | [Concrete046](https://ambientcg.com/a/Concrete046) | CC0-1.0 |
| `packages/look/assets/world/stained_n.ktx2` | 35184 | [Concrete046](https://ambientcg.com/a/Concrete046) | CC0-1.0 |
| `packages/look/luts/haze.cube` | 862580 | packages/look/scripts/make-lut.mjs | FSL-1.1-ALv2 (repository notice; no asset-specific grant found) |
| `packages/look/luts/zone.cube` | 862580 | packages/look/scripts/make-lut.mjs | FSL-1.1-ALv2 (repository notice; no asset-specific grant found) |
| `packages/subject-fpp/assets/arms-actions.json` | 1842 | packages/subject-fpp/assets/arms-actions.json | MIT |
| `packages/subject-fpp/assets/materials/glove_c.webp` | 38178 | [Leather032](https://ambientcg.com/a/Leather032) | CC0-1.0 |
| `packages/subject-fpp/assets/materials/glove_n.webp` | 3752 | [Leather032](https://ambientcg.com/a/Leather032) | CC0-1.0 |
| `packages/subject-fpp/assets/materials/gunmetal_c.webp` | 27684 | [Metal046B](https://ambientcg.com/a/Metal046B) | CC0-1.0 |
| `packages/subject-fpp/assets/materials/gunmetal_n.webp` | 2940 | [Metal046B](https://ambientcg.com/a/Metal046B) | CC0-1.0 |
| `packages/subject-fpp/assets/materials/paint_c.webp` | 19358 | [PaintedMetal005](https://ambientcg.com/a/PaintedMetal005) | CC0-1.0 |
| `packages/subject-fpp/assets/materials/paint_n.webp` | 9270 | [PaintedMetal005](https://ambientcg.com/a/PaintedMetal005) | CC0-1.0 |
| `packages/subject-fpp/assets/materials/polymer_c.webp` | 2628 | [Plastic012B](https://ambientcg.com/a/Plastic012B) | CC0-1.0 |
| `packages/subject-fpp/assets/materials/polymer_n.webp` | 1974 | [Plastic012B](https://ambientcg.com/a/Plastic012B) | CC0-1.0 |
| `packages/subject-fpp/assets/materials/sleeve_c.webp` | 70930 | [Fabric030](https://ambientcg.com/a/Fabric030) | CC0-1.0 |
| `packages/subject-fpp/assets/materials/sleeve_n.webp` | 119596 | [Fabric030](https://ambientcg.com/a/Fabric030) | CC0-1.0 |
| `site/public/apple-touch-icon.png` | 1157 | scripts/meta-images.ts | FSL-1.1-ALv2 (repository notice; no separate image grant found) |
| `site/public/favicon-32.png` | 241 | scripts/meta-images.ts | FSL-1.1-ALv2 (repository notice; no separate image grant found) |
| `site/public/favicon.svg` | 152 | scripts/meta-images.ts | FSL-1.1-ALv2 (repository notice; no separate image grant found) |
| `site/public/icon-512.png` | 8847 | scripts/meta-images.ts | FSL-1.1-ALv2 (repository notice; no separate image grant found) |
| `site/public/look/asphalt_c.webp` | 82376 | [Asphalt031](https://ambientcg.com/a/Asphalt031) | CC0-1.0 |
| `site/public/look/asphalt_n.webp` | 60536 | [Asphalt031](https://ambientcg.com/a/Asphalt031) | CC0-1.0 |
| `site/public/look/brick_c.webp` | 46940 | [Bricks059](https://ambientcg.com/a/Bricks059) | CC0-1.0 |
| `site/public/look/brick_n.webp` | 55760 | [Bricks059](https://ambientcg.com/a/Bricks059) | CC0-1.0 |
| `site/public/look/cast_c.webp` | 26774 | [Concrete044D](https://ambientcg.com/a/Concrete044D) | CC0-1.0 |
| `site/public/look/cast_n.webp` | 36774 | [Concrete044D](https://ambientcg.com/a/Concrete044D) | CC0-1.0 |
| `site/public/look/corrugated_c.webp` | 22096 | [CorrugatedSteel005](https://ambientcg.com/a/CorrugatedSteel005) | CC0-1.0 |
| `site/public/look/corrugated_n.webp` | 6488 | [CorrugatedSteel005](https://ambientcg.com/a/CorrugatedSteel005) | CC0-1.0 |
| `site/public/look/dirt_c.webp` | 67858 | [Ground103](https://ambientcg.com/a/Ground103) | CC0-1.0 |
| `site/public/look/dirt_n.webp` | 91926 | [Ground103](https://ambientcg.com/a/Ground103) | CC0-1.0 |
| `site/public/look/grass_c.webp` | 116880 | [Ground037](https://ambientcg.com/a/Ground037) | CC0-1.0 |
| `site/public/look/grass_n.webp` | 107064 | [Ground037](https://ambientcg.com/a/Ground037) | CC0-1.0 |
| `site/public/look/gravel_c.webp` | 85592 | [Gravel043](https://ambientcg.com/a/Gravel043) | CC0-1.0 |
| `site/public/look/gravel_n.webp` | 99192 | [Gravel043](https://ambientcg.com/a/Gravel043) | CC0-1.0 |
| `site/public/look/metal_c.webp` | 58022 | [Metal041B](https://ambientcg.com/a/Metal041B) | CC0-1.0 |
| `site/public/look/metal_n.webp` | 2134 | [Metal041B](https://ambientcg.com/a/Metal041B) | CC0-1.0 |
| `site/public/look/paint_c.webp` | 27838 | [PaintedPlaster015](https://ambientcg.com/a/PaintedPlaster015) | CC0-1.0 |
| `site/public/look/paint_n.webp` | 57032 | [PaintedPlaster015](https://ambientcg.com/a/PaintedPlaster015) | CC0-1.0 |
| `site/public/look/panel_c.webp` | 12122 | [Concrete042A](https://ambientcg.com/a/Concrete042A) | CC0-1.0 |
| `site/public/look/panel_n.webp` | 13434 | [Concrete042A](https://ambientcg.com/a/Concrete042A) | CC0-1.0 |
| `site/public/look/rust_c.webp` | 33724 | [Rust009](https://ambientcg.com/a/Rust009) | CC0-1.0 |
| `site/public/look/rust_n.webp` | 15564 | [Rust009](https://ambientcg.com/a/Rust009) | CC0-1.0 |
| `site/public/look/sky.webp` | 8908 | [overcast_soil_puresky](https://polyhaven.com/a/overcast_soil_puresky) | CC0-1.0 |
| `site/public/look/slab_c.webp` | 14654 | [Concrete031](https://ambientcg.com/a/Concrete031) | CC0-1.0 |
| `site/public/look/slab_n.webp` | 30678 | [Concrete031](https://ambientcg.com/a/Concrete031) | CC0-1.0 |
| `site/public/look/stained_c.webp` | 23932 | [Concrete046](https://ambientcg.com/a/Concrete046) | CC0-1.0 |
| `site/public/look/stained_n.webp` | 2758 | [Concrete046](https://ambientcg.com/a/Concrete046) | CC0-1.0 |
| `site/public/og/ai.jpg` | 43179 | scripts/meta-images.ts; site/src/meta-images.ts; site/public/thumbs/ | FSL-1.1-ALv2 (repository notice; no separate image grant found) |
| `site/public/og/characters.jpg` | 48920 | scripts/meta-images.ts; site/src/meta-images.ts; site/public/thumbs/ | FSL-1.1-ALv2 (repository notice; no separate image grant found) |
| `site/public/og/destruction.jpg` | 43293 | scripts/meta-images.ts; site/src/meta-images.ts; site/public/thumbs/ | FSL-1.1-ALv2 (repository notice; no separate image grant found) |
| `site/public/og/get-started.jpg` | 28518 | scripts/meta-images.ts; site/src/meta-images.ts; site/public/thumbs/ | FSL-1.1-ALv2 (repository notice; no separate image grant found) |
| `site/public/og/home.jpg` | 49380 | scripts/meta-images.ts; site/src/meta-images.ts; site/public/thumbs/ | FSL-1.1-ALv2 (repository notice; no separate image grant found) |
| `site/public/og/input.jpg` | 28406 | scripts/meta-images.ts; site/src/meta-images.ts; site/public/thumbs/ | FSL-1.1-ALv2 (repository notice; no separate image grant found) |
| `site/public/og/multiplayer.jpg` | 49441 | scripts/meta-images.ts; site/src/meta-images.ts; site/public/thumbs/ | FSL-1.1-ALv2 (repository notice; no separate image grant found) |
| `site/public/og/roadmap.jpg` | 25810 | scripts/meta-images.ts; site/src/meta-images.ts; site/public/thumbs/ | FSL-1.1-ALv2 (repository notice; no separate image grant found) |
| `site/public/og/skills.jpg` | 24258 | scripts/meta-images.ts; site/src/meta-images.ts; site/public/thumbs/ | FSL-1.1-ALv2 (repository notice; no separate image grant found) |
| `site/public/og/weapons.jpg` | 44734 | scripts/meta-images.ts; site/src/meta-images.ts; site/public/thumbs/ | FSL-1.1-ALv2 (repository notice; no separate image grant found) |
| `site/public/thumbs/ai.webp` | 117594 | Site showcase captures (declared in site/public/CREDITS.md) | FSL-1.1-ALv2 (repository notice; no separate image grant found) |
| `site/public/thumbs/characters.webp` | 76590 | Site showcase captures (declared in site/public/CREDITS.md) | FSL-1.1-ALv2 (repository notice; no separate image grant found) |
| `site/public/thumbs/destruction.webp` | 41704 | Site showcase captures (declared in site/public/CREDITS.md) | FSL-1.1-ALv2 (repository notice; no separate image grant found) |
| `site/public/thumbs/hero.webp` | 88712 | Site showcase captures (declared in site/public/CREDITS.md) | FSL-1.1-ALv2 (repository notice; no separate image grant found) |
| `site/public/thumbs/multiplayer.webp` | 36136 | Site showcase captures (declared in site/public/CREDITS.md) | FSL-1.1-ALv2 (repository notice; no separate image grant found) |
| `site/public/thumbs/weapons.webp` | 101946 | Site showcase captures (declared in site/public/CREDITS.md) | FSL-1.1-ALv2 (repository notice; no separate image grant found) |
| `site/src/showcases/firing-range/textures/canvas_c.webp` | 57444 | [Fabric045](https://ambientcg.com/a/Fabric045) | CC0-1.0 |
| `site/src/showcases/firing-range/textures/canvas_n.webp` | 110742 | [Fabric045](https://ambientcg.com/a/Fabric045) | CC0-1.0 |
| `site/src/showcases/firing-range/textures/osb_c.webp` | 38106 | [Chipboard005](https://ambientcg.com/a/Chipboard005) | CC0-1.0 |
| `site/src/showcases/firing-range/textures/osb_n.webp` | 18134 | [Chipboard005](https://ambientcg.com/a/Chipboard005) | CC0-1.0 |
| `site/src/showcases/firing-range/textures/planks_c.webp` | 26046 | [Planks037A](https://ambientcg.com/a/Planks037A) | CC0-1.0 |
| `site/src/showcases/firing-range/textures/planks_n.webp` | 12314 | [Planks037A](https://ambientcg.com/a/Planks037A) | CC0-1.0 |
| `site/src/showcases/firing-range/textures/plate_c.webp` | 67908 | [PaintedMetal005](https://ambientcg.com/a/PaintedMetal005) | CC0-1.0 |
| `site/src/showcases/firing-range/textures/plate_n.webp` | 9270 | [PaintedMetal005](https://ambientcg.com/a/PaintedMetal005) | CC0-1.0 |
| `vendor/rapier/rapier3d-0.30.1.crate` | 257358 | vendor/rapier/build.mjs; https://github.com/dimforge/rapier.js; https://github.com/dimforge/rapier | Apache-2.0 upstream; local archive notices not exhaustively audited |
| `vendor/rapier/rapier3d-compat-0.19.2-rupture.3.tgz` | 2514195 | vendor/rapier/build.mjs; https://github.com/dimforge/rapier.js; https://github.com/dimforge/rapier | Apache-2.0 upstream; local archive notices not exhaustively audited |
| `vendor/rapier/rapier3d-compat-0.19.2-rupture.4.tgz` | 2520675 | vendor/rapier/build.mjs; https://github.com/dimforge/rapier.js; https://github.com/dimforge/rapier | Apache-2.0 upstream; local archive notices not exhaustively audited |
| `vendor/rapier/rapier3d-simd-compat-0.19.2-rupture.3.tgz` | 2638157 | vendor/rapier/build.mjs; https://github.com/dimforge/rapier.js; https://github.com/dimforge/rapier | Apache-2.0 upstream; local archive notices not exhaustively audited |
| `vendor/rapier/rapier3d-simd-compat-0.19.2-rupture.4.tgz` | 2644875 | vendor/rapier/build.mjs; https://github.com/dimforge/rapier.js; https://github.com/dimforge/rapier | Apache-2.0 upstream; local archive notices not exhaustively audited |
| `vendor/rapier/rupture-bindings.bundle` | 4883 | vendor/rapier/build.mjs; https://github.com/dimforge/rapier.js; https://github.com/dimforge/rapier | Apache-2.0 upstream; local archive notices not exhaustively audited |

## Fonts imported by the site

| Import | Author | Licence |
| --- | --- | --- |
| `@fontsource/barlow/latin-400.css` | The Barlow Project Authors / Jeremy Tribby | [OFL-1.1](https://raw.githubusercontent.com/jpt/barlow/main/OFL.txt) |
| `@fontsource/barlow/latin-500.css` | The Barlow Project Authors / Jeremy Tribby | [OFL-1.1](https://raw.githubusercontent.com/jpt/barlow/main/OFL.txt) |
| `@fontsource/barlow-condensed/latin-500.css` | The Barlow Project Authors / Jeremy Tribby | [OFL-1.1](https://raw.githubusercontent.com/jpt/barlow/main/OFL.txt) |
| `@fontsource/barlow-condensed/latin-600.css` | The Barlow Project Authors / Jeremy Tribby | [OFL-1.1](https://raw.githubusercontent.com/jpt/barlow/main/OFL.txt) |
| `@fontsource/ibm-plex-mono/latin-400.css` | IBM Corp. | [OFL-1.1](https://raw.githubusercontent.com/IBM/plex/master/LICENSE.txt) |
| `@fontsource/ibm-plex-mono/latin-500.css` | IBM Corp. | [OFL-1.1](https://raw.githubusercontent.com/IBM/plex/master/LICENSE.txt) |
