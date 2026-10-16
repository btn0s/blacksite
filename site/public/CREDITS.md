# Site credits

World textures and the sky below are CC0. The material viewer also includes generated images, identified separately with their provider and provenance. World files are resized to 512 px (sky 1024 × 512) and compressed to WebP; material references retain their recorded tile aspect ratio.

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

## Fonts (SIL Open Font License)

Barlow and Barlow Condensed by Jeremy Tribby; IBM Plex Mono by IBM. Bundled through Fontsource.

## Screenshots

`thumbs/*.webp` are captures of the site's own showcases.
