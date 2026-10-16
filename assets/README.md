# Open asset library

Draft for the spine's `references/assets.md`. This library selects assets that allow redistribution of the files in an open repository, commercial game use and public demo use. The target is a muted industrial zone with photographic surfaces, readable geometry and varied recorded sound. A compatible licence is the entry requirement; a useful result still needs scale, appearance, motion, audio and performance review.

The [source research](research.md) records primary licence evidence and category choices. The [shipped-file audit](audit.md), with exact paths and hashes in [audit.json](audit.json), covers the existing repository. ALS is excluded by owner instruction. The catalog is a set of selected sources, not a claim that every entry has already been fetched and judged in a game.

Purchased content stays in the separate `blacksite assets login/sync` workflow and `game-assets` skill. It never enters this library or its public previews.

## Use it

```sh
blacksite assets library
blacksite assets library rust --category material
blacksite assets library --check
blacksite assets packs
blacksite assets show concrete-wall-stained
blacksite assets add --pack starter --project /abs/game
blacksite assets add barrel-steel rust-heavy --project /abs/game
blacksite assets credits --project /abs/game
```

`add` fetches from the recorded source or licensed mirror, verifies any catalog SHA-256, processes into the game's `public/assets/library/<id>/`, and writes `assets.credits.json` and `CREDITS.md`. The cache is `~/.cache/blacksite/library`, overridable with `BLACKSITE_LIBRARY_CACHE_DIR`. A changed pinned file stops the install. Inspect the change before using `--update`; that option accepts new bytes for the operation, while `lock` is the command that writes updated hashes and sizes back to the catalog.

Manual entries are marked `acquire: "manual"`. They are discovery records until the original has been supplied; they may not yet have a pinned size/hash. Manual acquisition is this CLI's current workflow, not a claim that the host prohibits all scripted access or universally requires sign-in.

```sh
blacksite assets fetch step-concrete --from /abs/download.wav
blacksite assets add step-concrete --project /abs/game
```

`--from` accepts a single file or a folder containing the listed files. `fetch` stores its measured hashes in the local cache, and installation records the fetched file metadata in project credits. `lock` skips manual entries: review and pin their file metadata explicitly before promoting them into an automatic pack.

For local review in this checkout:

```sh
blacksite assets build --pack starter
node assets/scripts/verify-build.mjs starter
corepack pnpm exec vite --config assets/vite.config.ts --port 5187
```

The viewer reads ignored local outputs under `assets/.build/`. `build --index-only` refreshes its index and credits without encoding again. Successful builds are cached by source content, processing settings and processor version; `add` reuses that cache for another project. It shows material previews, models, animation clips and audio players. `build` skips unavailable manual entries and reports processing failures; read its output and the viewer's built count before claiming a pack is complete. `ffmpeg`/`ffprobe` are needed for audio and Blender for `.blend`, `.fbx` and `.obj` sources. Dependency installation supplies the image, glTF and KTX2 tools.

## Licence rules

The validator accepts CC0, public domain, CC BY 3.0/4.0, MIT, Apache 2.0 and BSD 2/3-Clause. CC BY needs attribution. MIT/Apache/BSD entries also need `licenceNotice` containing the supplied copyright, full licence and any required upstream notices; builds retain it as `LICENSE.txt`, and generated credits retain it. Approval is per asset, including incorporated work, not per host.

Reject NC, ND, standalone-redistribution restrictions and ambiguous grants. Read the actual terms and preserve evidence. A “free for commercial use” badge does not establish permission to publish the raw file in this repository. A copyright licence also does not grant trademarks or a depicted person's publicity rights.

For itch.io, record both the listing grant and the licence inside the download in `licenceEvidence.page` and `.file`. For an individual Fab CC BY listing, record the page grant. The validator requires manual acquisition for those stores. Fab Standard content remains excluded. Neither a zero price nor ownership of a purchased pack changes these rules.

The [research notes](research.md) explain the important exceptions: Quaternius' current QAL restricts standalone redistribution but says updates are not retroactive, so genuine older CC0 grants need version-specific treatment; ShareTextures' current custom terms restrict redistribution; Freesound is licensed per sound and has a separate authorized API policy. CMU has custom resale restrictions. Copernicus DEM is not public domain. None of these distinctions should be replaced with a blanket claim about every file on a site.

## Where to start

| Need | Selected sources | Practical limit |
| --- | --- | --- |
| Photographic PBR surfaces and overcast sky | Poly Haven, ambientCG | Use the scan's real dimensions. Choose the surface for the space, not just the thumbnail. |
| Props and vegetation | Poly Haven; per-asset OpenGameArt | Heavy foliage needs a measured triangle budget. A complete canopy tree set remains a gap. |
| Weapons | OpenGameArt's CC0 AKM by LonesomeDucky | Pistol and shotgun models remain unselected. |
| Clothed characters and motion | Microsoft Rocketbox MIT; selected Mesh2Motion CC0 clips | Rocketbox's clips share its rig. Other libraries need retarget/contact review; the processor is not a generic retargeter. |
| Custom humans | MakeHuman/MPFB core CC0 exports | Manual generation/export; community additions require separate checks. |
| Gunfire and weapon handling | Free Firearm Sound Library on OGA, zer0_sol foley, CC BY Zenodo distant rifles | Multiple events in source files need deliberate take selection and listening. |
| Impacts and surface footsteps | Kenney, credited OGA packs; per-sound Freesound | Preserve original authors in composite packs; vary takes at runtime. |
| Outdoor and industrial ambience | NPS public-domain recordings, Work With Sounds CC BY | Loop processing cannot guarantee a perceptually seamless bed. |
| Impulse responses | TH Köln and Tyndaris Zenodo records, CC BY | Measured spaces; keep lossless source references for acoustic comparisons. |
| Terrain | USGS-produced 3DEP data | Check the selected tile, crop scale and nodata. |
| Future hero props / decals | Marked Smithsonian CC0 objects, cgbookcase | Researched candidates, not a complete pinned starter collection. |

OpenAIR needs recoverable item-level licence metadata before selection. 100STYLE is a promising CC BY locomotion set with individual BVH downloads, but BVH conversion/retargeting is not implemented. Sketchfab CC0/CC BY models can qualify after item-level provenance review. The source notes distinguish these gaps from rejected licences.

## Catalog maintenance

`assets/catalog.json` records `id`, title, category, tags, source URL/site/id, author, licence, attribution, recommended `use`, and file URLs/names/hashes/sizes. Optional fields include manual acquisition, licence evidence/notices, archive extraction selection, measured source triangles, `scale.tile` in metres and processing hints. `packs` groups ids.

For Poly Haven or ambientCG, an initially empty `files` list can be resolved by `blacksite assets lock <id>`. Other sources need explicit file records. Inspect the licence, run `lock`, then `build` and the viewer. Inspect all selected archive contents: a multi-model archive does not automatically become a complete kit, because the processor selects a model entry rather than importing every model. Commit reviewed catalog changes and notices; raw caches stay local.

## Processing and budgets

| Category | Output | Budget |
| --- | --- | --- |
| Material | 1K and 512 colour/normal/ORM WebP; optional KTX2 using ETC1S colour and UASTC+Zstd data maps | 900,000 B for the 1K WebP set |
| HDRI | 2048 × 1024 WebP backdrop and 512 × 256 RGBE environment | 1,400,000 B |
| Prop / foliage | Meshopt GLB, welded/deduplicated, 1K WebP textures | 1,500,000 B; 30,000 triangles |
| Weapon | As above | 2,000,000 B; 30,000 triangles |
| Character | Skinned GLB | 3,000,000 B; 40,000 triangles |
| Animation | Resampled meshopt GLB clips | 4,000,000 B |
| Sound / footstep | Mono Opus 64 kb/s plus AAC fallback; peak −1 dBFS; normally at most 4 s | 80,000 / 60,000 B per take |
| Ambience | Stereo Opus 96 kb/s plus AAC; −26 LUFS; at most 90 s; short edge fades | 1,600,000 B |
| Impulse response | Stereo Opus 128 kb/s plus AAC; at most 4 s; peak −6 dBFS | 250,000 B |
| Terrain | 16-bit 1025 × 1025 PNG plus height/scale metadata | 3,000,000 B |

The processing source lives in `assets/scripts/process.mjs`. `--no-ktx2` omits KTX2 generation. KTX2 reduces GPU texture memory after hardware transcoding; download size varies by image and encoding mode. Do not assert a fixed memory/download ratio. Retain WebP and AAC where the game's supported browsers need them. Load only the selected quality variant; exporting alternatives is not permission to preload all of them.

Each output has `asset.json` with shipped filenames, file sizes, relevant geometry/clip/take/scale metadata and `withinBudget`. Over-budget builds are reported, not automatically rejected. `bytes` is the largest Opus take for sound/footstep categories and the selected shipping total for other categories; it is not the size of every exported alternative. For a real pack/deployment total, sum the selected `ship` file sizes across entries. KTX2 totals are reported separately. Processed outputs have sizes; catalog hashes refer to source downloads.

For broad unstructured surfaces, apply `applyStochasticTiling` from `@blacksite/look` by default after configuring matching PBR map transforms. It keeps the source scale while reducing repetition; use its directional mode for ordered surfaces. See the [Look material guide](../packages/look/README.md) for hook composition, rotation and sampling cost. The viewer enables reduced tiling on its irregular ground and provides a comparison toggle.

For materials, `c` is sRGB colour, `n` is an OpenGL normal and `orm` packs occlusion/roughness/metalness into RGB. Use `repeat = surface metres / scale.tile` so a brick stays brick-sized. For audio, alternate takes and avoid immediate repetition; listen at game level and distance before judging the mix. Lossy IR output is a game-delivery option, not an unchanged scientific reference. For animation, inspect foot contact, root motion and transitions on the actual character.

## Hosting and credit

The current default is direct fetch from a recorded source or licensed mirror, with pinned hashes. It avoids committing large raw archives but depends on upstream availability and local processing. The local starter viewer is separate from the main site's shipped files. The catalog itself is not an offline asset bundle.

For a game or flagship, commit the selected processed output and generated credits into that project's public directory so runtime does not depend on an upstream download. Keep a slice's selected library under 25 MB, and load only what its first space needs. `add` copies the generated variants, so remove unused variants from deployment deliberately rather than mistaking the selected-shipping budget for the installed folder size.

Git LFS is not used: it adds a client/tooling and hosting dependency and can move bandwidth cost to repository maintainers. A future mirror of approved processed packs could improve availability and make manual acquisitions easier for downstream users. It would need versioned manifests, source hashes and full notices; no account, upload or mirror has been created, and the current CLI has no mirror-first fetch mode.

Project `CREDITS.md` groups assets by licence, includes source/author attribution, and retains required notices. CC0/public-domain attribution is courteous; CC BY attribution, licence links and change notices are required. Keep credits reachable from the game's menu or site. Run `node assets/scripts/site-credits.mjs` after catalog changes to refresh `site/public/CREDITS.md`, including the catalog ledger and the fonts' full OFL notices; listing a catalog item there does not mean the main site downloads it at runtime.
