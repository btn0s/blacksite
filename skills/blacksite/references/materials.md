# Materials

Use `@blacksite/materials` when a material needs controllable structure, weather, damage or an image source. Author a graph, compare it under the shared look, then bake it. Games load textures; graph evaluation belongs to authoring.

The package guide at `packages/materials/AGENTS.md` is the API source for node vocabulary, recipes, packing and symptom-based fixes. Read it before writing a graph or changing the evaluator. Its `library/` contains eleven procedural graphs and eleven image-input variants: poured concrete, precast panels, peeling plaster/paint, brick, corrugated rust, painted metal, wet tiles, asphalt, gravel/soil, bark and wood planks.

## Choose the source

Keep the existing world-kit surfaces until a replacement wins the comparison. A graph that runs is not yet a photographic material.

| Need | Starting point |
| --- | --- |
| Repeatable joints, boards, rivets or controlled damage | A procedural graph in `packages/materials/library/` |
| Irregular photographic colour where a reference is unavailable | An image-input graph, refined with structure nodes |
| Proven surface detail today | The existing surface or a redistributable reference with recorded provenance |

For an image source, use the installed local-image-generation skill when generating a new image. Record the model, complete prompt, date, provider and intended metres per image alongside it. A photograph needs its author, source URL and redistribution licence. Generated output is labelled generated, not a CC0 scan. Only ship assets whose terms permit redistribution in the destination project.

Image-derived PBR is an approximation: luminance cannot separate pigment, illumination and physical relief. `delight` removes broad gradients; it cannot measure albedo. Derive a restrained height, then correct joints and large shapes with graph nodes. Set metalness from the material's structure, not from image brightness.

## Author at real scale

Set `size` in metres per square repeat and `depth` in metres of relief. Build height, colour and roughness from related structures. The node set covers periodic noises, tiles/bricks/planks/panels, rivets, scatter shapes, image input, seamless blending, warp, blur, slope blur, levels, curvature, height normals, height AO, masked blends and colour ramps.

Weather is part of the graph: age, dirt, moisture, puddles, rust, edge wear, chips, bullet craters and scorch. Dirt belongs in cavities, exposed metal belongs under paint, and wetness changes colour and roughness together. Baked damage repeats; use a decal for a unique hit. The four packed textures hold base colour, normal plus height, AO/roughness/metalness, and wear/dirt/wet/damage masks.

## Judge before replacing

Open `/frames/materials.html` in the repository's site. Compare procedural, image-derived and CC0 reference sources on the same sphere, cube and wall corner. Keep camera, light, fog, grade and physical scale equal. The reference's recorded dimensions may be estimated; a shared metre scale does not make an estimate a measurement.

Capture desktop and phone views at 1× and 4×. Inspect repeated borders, grazing light, the wall corner, roughness changes and distant readability. Test clean and weathered variants. Read every capture. Keep a reference as the default when a graph loses in large-scale structure, photographic variation or relief. Record that result honestly; shader parity and a successful bake do not establish visual parity with a scan.

## Bake for the game

From the Blacksite repository root:

```sh
corepack pnpm --filter @blacksite/materials bake library/poured-concrete.json --out baked --sizes 512,1024 --formats ktx2,webp
```

This writes into `packages/materials/baked/`. For another game, pass absolute graph/output paths. Use its build-time script to bake the needed materials, then import descriptors from the game's source directory.

The WebP fallback needs `cwebp` on PATH (`brew install webp` on macOS). Its data maps use exact lossless RGBA so a zero damage mask does not erase the dirt/wetness channels. KTX2-only bakes do not need that tool.

```ts
import concrete from './materials/poured-concrete/1024'
import { loadBakedSurface } from '@blacksite/materials/three'
import { surface } from '@blacksite/look/world'

const source = await loadBakedSurface(concrete, { renderer, resolution: 1024 })
const wall = surface(source)
```

Replace `surface('cast')` with `surface(source)` once the source is loaded. Existing named surfaces retain their defaults. Use the world-kit geometry helpers with `wall.userData.tile`, or `meterSurface(source)` for metre UVs. Load once during scene warmup and reuse the source.

Use 512 px for distant surfaces and phones; reserve 1024 px for surfaces that earn the extra detail. Import `/three` at runtime so the graph evaluator and Node encoders stay out of the game. Single-resolution descriptors keep unused sizes out of the build; the all-resolution descriptor lets the loader select a size but makes both sizes available to the bundler. WebP has separate descriptors for an explicit fallback.

Run `blacksite budget` on the actual game build. Its limits include shipped texture formats, individual assets, JavaScript chunks and the warmup/fixed-step contract. The bake's `--budget` option checks individual texture sizes only. Judge the compressed bake again under the shared look before handing over the scene.
