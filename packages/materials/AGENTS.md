# Materials

A graph is an authoring asset. Compile and preview it while making the material; bake it before shipping. A game loads four textures and a small descriptor. It does not evaluate the graph each frame.

Read this guide before authoring a graph, adding a node, baking a material or changing its loader. The game-facing workflow is also in `skills/blacksite/references/materials.md`.

## Work in this order

1. Choose a real material, its viewing distance and its physical repeat size. Open the matching `library/<id>.json` and the reference metadata in `scans/scans.json`. For image input, also read `images/<id>.json`.
2. Build the structure in height first: joints, boards, grains and cavities. Derive colour and roughness from related fields, with independent fine variation. Keep base metalness zero for paint, rust, concrete, wood and soil; expose metal only where the actual metal is visible.
3. Add weather as a consequence of structure: dirt in cavities, wear on convex edges, moisture in low areas. Check the clean material first; weather must not conceal broken scale or tiling.
4. Compare graph, image-derived and reference materials in `/frames/materials.html`, with the same mesh, camera, light and metres per repeat. Inspect the wall corner, cube and sphere at normal viewing distance and close up. Check at least two repeats in each direction. Record which source wins; keep the reference as the default until a replacement earns it.
5. Bake 512 and 1024 px, load the baked result in the viewer and repeat the comparison. Check both KTX2 and WebP because compression can change normals and masks. Run the game's `blacksite budget`; the bake's per-file byte check alone is not the game budget.

Completion means the graph validates, CPU/GPU checks pass, baked output loads, repeated borders hold, the budget passes, and the quality decision has captures at 1× and 4×. A successful bake does not prove photographic quality.

## Mental model

`MaterialGraph` is plain JSON data. Parse external JSON with `parseGraph(unknown)`; `validate(unknown)` returns diagnostic strings. Each node has a typed `op` and only that operation's fields. The compiler also checks unused nodes for bad references and cycles. `nodes` is a dictionary; an input is a node id, a scalar, `#rgb`/`#rrggbb`, or an RGB triple in 0–1. Referenced nodes form a directed acyclic graph. Declaration order does not matter. Node names cannot contain `:` or `#`, which the compiler reserves. Renaming a seeded node changes its random pattern, so preserve ids when only reorganising a graph.

`size` is the square repeat's width in metres. `depth` is the physical height range in metres, not a normal-strength knob. `cell`, `tile`, `spacing`, `radius`, blur radii and warp amounts use metres unless specified below. Feature counts are rounded to fit a whole number of repeats, so requested dimensions are approximate. `seed` and per-node `seed` determine the random pattern. Companion shape nodes for height, random colour and masks must share an explicit seed and the same shape parameters to align. Without an explicit node seed, the node id selects its pattern; the graph seed affects all patterns. Image generation itself is not reproducible from the graph seed: preserve the source image and its provenance.

The compiler expands weather and multi-pass filters into a shared program. `evaluate()` in `@blacksite/materials/cpu` is the deterministic reference and build-time path. `createGpuEvaluator(renderer)` in `@blacksite/materials/gpu` evaluates the same program into WebGL2 render targets for authoring previews. GPU floating-point results are checked with tolerances; do not promise byte-identical results across graphics hardware. Dispose evaluators when their previews close. Keep the GPU evaluator and Node image/encoder dependencies out of the shipped game.

Graph colour is stored as sRGB-like authored values; normal, ORM and masks are data. Use `liveMaterial()` for floating-point preview targets and `loadBaked()` for baked textures so colour is decoded once. Do not mark normal or ORM as sRGB.

## Node vocabulary

Each row names the JSON `op`. Inputs named below are node ids or constants. Defaults and exact types live in `src/graph.ts`; the table explains intent and units.

| Op | Inputs and controls | Use |
| --- | --- | --- |
| `const` | `value` | A scalar or colour. Inline constants are usually shorter. |
| `value` | `cell`, `seed` | Soft lattice noise. |
| `perlin` | `cell`, `seed` | Gradient noise with less obvious square structure. |
| `cellular` | `cell`, `mode`: `f1`, `f2`, `edge`, `id`; `jitter` | Worley distances, cracks and per-cell variation. |
| `fbm` | `cell`, `basis`: `value`, `perlin`, `cellular`; `octaves`, `gain` | Several scales of noise. Octaves are capped by resolution. |
| `ridged` | `cell`, `octaves`, `gain`, `sharpness` | Creases and bark ridges. |
| `wave` | `period`, `axis`: `u`/`v`, `shape`: `sine`/`triangle`/`saw`, `phase` | Corrugation and regular ribs. Phase is in cycles. |
| `tiles`, `bricks`, `planks`, `panels` | `tile`: metres or `[width,height]`; `gap`, `bevel`, `offset`, `offsetJitter`, `lengthJitter`, `jitter`, `seed`, `output` | Related layouts with different defaults. Offset is a fraction of a cell. Outputs: `height`, `random`, `mask`, `distance`. |
| `rivets` | `spacing`, `radius`, `offset`, `output` | Periodic domes or attachment masks. Offset is a fraction of rivet spacing. |
| `scatter` | `cell`, `radius`, `density`, `sizeJitter`, `shape`: `disc`/`crater`/`chip`/`blob`/`streak`; `stretch`, `rotate`, `seed`, `output` | Pores, stones, flakes and local damage. Density and jitter are fractions. |
| `image` | `src` relative to the graph file | A generated or photographed source. Node decoding is in `@blacksite/materials/node`; the GPU evaluator receives an image-texture map. |
| `seamless` | `input`, `width` in UV fractions | Wraps an image by offset blending along both axes. It can ghost features; inspect the result. |
| `delight` | `input`, `radius`, `strength` | Removes broad luminance variation while preserving colour. It cannot recover physically measured albedo. |
| `highpass` | `input`, `radius` | Detail minus a blurred copy, centred on 0.5. Useful before image-derived height. |
| `warp` | `input`, `by`, optional `byY`, `amount` | Displace by a slope field, or by two explicit vector channels. |
| `blur` | `input`, `radius` | Separable, wrap-aware smoothing. Broad radii are expensive during authoring. |
| `slopeBlur` | `input`, `slope`, `amount`, `samples` 1–32, `mode`: `blur`/`min`/`max` | Erode or spread details along a slope map. |
| `levels`, `invert` | `input`, `in`: `[low,high]`, `out`: `[low,high]`, `gamma` | Remap a field or turn it into a mask. `invert` defaults to output `[1,0]`. |
| `curvature` | `input`, `radius`, `strength` | Signed edge response around 0.5: higher is convex, lower is concave. Threshold it before using it as wear. |
| `normal` | `input`, `strength` | Tangent-space normal from height. Final material normals are generated from final weathered height. |
| `ao` | `input`, `radius`, `strength` | Local height-based occlusion. It does not know about other meshes. |
| `blend` | `a`, `b`, optional `mask`, `opacity`, `mode` | Mix related fields without flattening their structure. |
| `ramp` | `input`, `stops`: 1–16 ascending `[position,colour]` pairs | Map a scalar into material colours. |
| `hsv` | `input`, `hue`, `saturation`, `value` | Hue offset in turns, saturation/value multipliers. |
| `channel` | `input`, `channel`: `r`/`g`/`b`/`a`/`luma` | Extract one channel as grayscale. |
| `transform` | `input`, integer `repeat`, UV `offset`, `rotate` in multiples of 90°, `flip` | Reuse a field while preserving a periodic square tile. |

Blend modes are `mix`, `add`, `subtract`, `multiply`, `screen`, `overlay`, `max`, `min`, `difference` and `highpass`. A mask of zero keeps `a`; a mask of one applies the blend at full opacity.

## Outputs and weather

`outputs.color` is required. `height`, `roughness`, `metalness` and `ao` are optional. Defaults are height 0.5, roughness 0.85 and metalness zero. The compiler derives normal and AO after weathering. `outputs.ao`, when present, multiplies the derived AO. `finish.normal` scales the final normal and `finish.ao` controls radius/strength. Height is retained for custom shaders; the standard loader does not displace geometry.

Weather amounts are 0–1. `compile(graph, resolution, { weather: null })` disables weather. Passing a weather object replaces the graph's weather object; merge explicitly when overriding one field.

| Parameter | Consequence |
| --- | --- |
| `age` | Desaturates and stains; uses vertical streaks on walls and blotches on floors. |
| `dirt`, `dirtColor` | Cavity/low-area dirt, higher roughness. |
| `moisture`, `porosity` on graph | Darker porous surfaces and lower roughness. Porosity controls the darkening response. |
| `puddles` | Low-area wet masks, smooth height and low roughness. Floor graphs infer puddles from high moisture unless explicitly set. |
| `rust` | Rust-coloured, rough, nonmetal patches with fine relief. |
| `wear` | Curvature-driven exposed edges. A number uses the graph's `wear` underlayer; an object accepts `amount`, `color`, `roughness`, `metalness`. |
| `damage.chips`, `.bullets`, `.scorch` | Repeating chip, crater and scorch patterns. Use decals for unique events; a baked bullet hole repeats on every tile. |
| `seed`, `damage.seed` | Repeatable placement of weather and damage. |

Four packed maps carry the complete set:

| Texture | RGB | Alpha | Colour space |
| --- | --- | --- | --- |
| `color` | Base colour | Opaque | sRGB |
| `normal` | Tangent normal, +Y convention | Height in 0–1 | Linear data |
| `orm` | R: AO, G: roughness, B: metalness | Opaque | Linear data |
| `masks` | R: combined rust/wear, G: dirt, B: wetness | Combined chip/bullet/scorch mask | Linear data |

Masks are aggregate fields, not independent outputs for every damage type. Keep separate graph nodes or bake separate variants if gameplay needs to distinguish individual damage categories. Normals provide shading relief; silhouette breaks and deep corrugations still need geometry.

## Recipes

**Water-stained, bullet-chipped concrete.** Start with `library/poured-concrete.json`. Keep board spacing near 0.12 m and a low physical depth. Set weather to `{"age":0.55,"dirt":0.35,"moisture":0.25,"damage":{"chips":0.25,"bullets":0.08,"seed":4}}`. Check that cavities stay visible under fog, the surface stays mostly rough, and no bright crater looks like exposed metal.

**Painted metal with exposed steel.** Start with `library/painted-metal.json`. Paint and rust are dielectric; define the wear underlayer with `metalness: 1`, reduce its roughness and let curvature plus broken noise expose it. A uniform metalness of one turns the paint into a mirror. Check the cube edge as well as the wall.

**Wet tiles.** Start with `library/wet-tile.json`, `orientation: "floor"`. Grout stays lower than ceramic. Moisture darkens and lowers roughness; puddles flatten the local height. Review the roughness map directly: a dark base colour alone does not make a surface wet.

**An image turned into a material.** Start with `library/<id>-image.json`. The chain is `image → seamless → delight` for colour and `channel(luma) → highpass → blur → levels` for height. Derive restrained roughness and then refine with structural masks; keep metalness explicit. Preserve model, prompt, date, provider and source size in `images/<id>.json`, plus a source/terms URL in credits. A prompt that requests a two-metre area is an intended scale, not a measured one.

One colour image cannot determine height, roughness, metalness or hidden geometry. A dark painted mark may be mistaken for a recess; a highlight may become a bump. These are authored approximations, even when the base colour looks photographic. Use structure nodes to correct joints and boards, inspect normals under grazing light, and retain the reference if relief looks inflated or seams smear.

## Bake and load

Run from the repository root:

```sh
corepack pnpm --filter @blacksite/materials bake library/poured-concrete.json --out baked --sizes 512,1024 --formats ktx2,webp
corepack pnpm --filter @blacksite/materials bake library/poured-concrete-image.json --out baked --sizes 512,1024 --formats ktx2,webp
```

`pnpm --filter` runs in the package directory. To author inside a game, run the same CLI with absolute graph/output paths, or call `bake(graph, graphFile, outDir, options)` from `@blacksite/materials/bake` in a build script. `--weather none` bakes a clean material; `--weather '<JSON>'` replaces weather. `--budget /absolute/path/budget.config.json` checks each baked file against `maxAssetBytes`.

Each material directory contains a JSON manifest and descriptors for both formats. `index.ts` is the KTX2 all-resolution descriptor; `webp.ts` is the WebP equivalent. Prefer a single-resolution descriptor (`512.ts`, `1024.ts`, `512.webp.ts` or `1024.webp.ts`) in a scene that needs only one size. An all-resolution import exposes every texture URL to the bundler, even though the loader fetches only the selected size. KTX2 uses mipmaps, ETC1S for colour and UASTC for normal/ORM/masks. WebP is an explicit fallback, not an automatic retry after a failed KTX2 load.

WebP data maps require `cwebp` on PATH from the [WebP command-line tools](https://developers.google.com/speed/webp/docs/cwebp) (`brew install webp` on macOS). They use `-lossless -exact`: ordinary image encoders discard RGB beneath zero alpha, which destroys wetness and dirt when alpha holds damage. Colour uses lossy WebP. KTX2-only baking needs no `cwebp`. The four data channels are preserved without repacking or treating alpha as opacity.

To verify real decoder behaviour after changing an encoder or loader, run `corepack pnpm exec tsx packages/materials/proof/bake-check.ts` from the repository root, then open `/frames/materials.html?verify=bake` on the site dev server. `window.__materialBake` records CPU-to-decoded and cross-format channel errors, asymmetric orientation checks and sampled RGBA values. The small baked fixture stays in ignored `proof/baked/`. Review failures without increasing the check thresholds.

```ts
import concrete from './materials/poured-concrete/1024'
import { loadBakedSurface } from '@blacksite/materials/three'
import { surface, worldBoxGeometry } from '@blacksite/look/world'

const source = await loadBakedSurface(concrete, { renderer, resolution: 1024 })
const material = surface(source)
const geometry = worldBoxGeometry(3, 2.4, 0.2, material.userData.tile)
```

The switch at the world-kit call site is `surface('cast')` to `surface(source)`. Existing named surfaces keep their defaults. `meterSurface(source)` is for geometry whose UVs already express metres. Do not also divide those UVs by the tile size. `loadBakedSurface` includes the mask texture on the source for custom decal/response shaders; `surface()` uses the standard PBR maps. KTX2 loading requires the renderer to select a supported GPU format. WebP loading does not.

For irregular gravel, soil or patchy wall materials, `applyStochasticTiling` from `@blacksite/look` breaks up repetition while keeping colour, tangent normal and ORM samples aligned:

```ts
import { applyStochasticTiling } from '@blacksite/look'

const wall = surface(source)
const restoreSampling = applyStochasticTiling(wall)
```

It modifies the material and returns a cleanup function, not another material. Apply it once to a cached material, then call `restoreSampling()` when removing the effect. Every map must use repeat wrapping and the same UV transform. Keep structured brick, tile, plank, panel and corrugation patterns on direct sampling so joints remain aligned. `liveMaterial()` uses the native colour-decoding path and preserves standard shader chunks, so floating-point authoring previews support the same helper without decoding colour twice. The helper samples colour/normal/ORM; custom shaders using the separate damage masks must deliberately match its sampling.

Import only `@blacksite/materials/three` at runtime. Authoring imports from the package root include evaluators; `/bake` and `/node` are Node-only. Load during scene warmup and account for the textures in the scene budget. `surface()` caches by source identity, so load once and reuse the same source object. On unload, `releaseSurface(source)` from the world kit disposes its cached material variants; then `disposeSurfaceSource(source)` from `/three` disposes the four source textures once each. A `meterSurface()` result owns cloned maps: dispose that material and its distinct cloned maps separately.

For a KTX2 release build, include only the selected descriptors and their textures. If a release also delivers WebP, list those intentional fallback files in the game's existing budget policy and count their bytes; do not hide an unbounded library in a public directory. Run `blacksite budget` on the actual game build with its warmup and fixed-step contract.

## Gotchas by symptom

| Symptom | Check and fix |
| --- | --- |
| A material looks like gravel at a distance | Check `size`, physical feature sizes and `depth` before sharpening or increasing normal strength. |
| A wet material stays matte | Read ORM green, verify `roughness: 1` multiplies the texture, and provide an environment to reflect. |
| A dark or washed-out bake differs from preview | Use the provided live/baked loaders; decode base colour once and keep all data maps linear. |
| Paint looks metallic | Metalness is zero under paint and rust; a mask exposes only bare metal. |
| Image-derived pores swell into bubbles | Luminance includes pigmentation and baked light. Reduce depth; correct height with structure masks instead of increasing contrast. |
| A cross or doubled feature repeats | `seamless` blended an incompatible pair. Use a less structured source or rebuild the pattern with tiles/planks. |
| A scan develops a seam | Preserve the complete source image and its aspect ratio. Cropping a periodic rectangular tile to a square destroys its edge correspondence. |
| Brick or plank rows drift at a border | Use dimensions and offsets that close over the tile; transforms must use integer repeats and right-angle rotations. |
| Normal detail changes between 512 and 1024 | Fine features may be below the coarse texture's sampling limit. Enlarge important features; do not rely on subpixel noise. |
| Dirt appears on a wall as puddles | Check `orientation`, explicit `puddles` and the height field. |
| The graph changes after an innocent rename | Node ids participate in deterministic seeds. Keep established ids stable. |
| The game downloads the whole library | Import only a scene's baked descriptors, never the viewer, eager library glob or authoring entrypoint. |
| The bake passes but the game budget fails | The bake checks individual files. The game also checks shipped formats, chunks, warmup and fixed-step configuration. |

## Reference honesty

The library has eleven procedural graphs and eleven image-input variants. References are CC0 ambientCG assets with original creation methods and physical-scale notes in `scans/scans.json`. `PBRPhotogrammetry` is a scan; `PBRApproximated` is a photographic material with derived channels. Treat estimated dimensions and intended image-generation dimensions as estimates. Generated images are generated output under their provider terms, not CC0 scans. Quality decisions belong to the captures and report; preserve the conservative reference default until a material has been accepted.
