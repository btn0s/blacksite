# Open asset library

Draft for `skills/<spine>/references/assets.md`. The library is a curated catalog of art, animation and sound whose licences allow three things at once: redistribution in an open repository, use in a commercial game, and use on a public demo site. The bar is a PS2-era zone game with photographic materials: scanned concrete, plaster, rust and soil under an overcast sky, with gunfire, impacts, footsteps and room tone that do not repeat audibly.

Owned content is separate. `blacksite assets login/sync` and the `game-assets` skill index what a user has bought on Fab or itch. Those files never enter this catalog, never get committed, and never ship on the public site.

## Use it

```sh
blacksite assets library                      # everything, one line each
blacksite assets library rust --category material
blacksite assets packs                        # starter, zone, ...
blacksite assets show concrete-wall-stained   # full catalog entry
blacksite assets add --pack starter --project /abs/game
blacksite assets add barrel-steel rust-heavy --project /abs/game
blacksite assets credits --project /abs/game  # regenerate CREDITS.md
```

`add` downloads each file from its original source, checks its SHA-256 against the catalog, processes it for the web into `public/assets/library/<id>/`, and records it in `assets.credits.json` and `CREDITS.md` in the project. Downloads are cached in `~/.cache/blacksite/library` (override with `BLACKSITE_LIBRARY_CACHE_DIR`). A hash mismatch stops the install: the upstream file changed, so look at it before running again with `--update`.

Some sources forbid scripted downloads. Their entries say `"acquire": "manual"`. Download the original yourself from the entry's source page, then:

```sh
blacksite assets fetch step-concrete --from ~/Downloads/459964__florianreichelt__footsteps.wav
```

Processing needs `ffmpeg` for audio and Blender on `PATH` for `.blend`, `.fbx` and `.obj` sources. Everything else runs in Node.

## Licence rules

Accept CC0, public domain, MIT/Apache/BSD-style, and CC BY 3.0 or 4.0 with attribution. Reject everything else, including anything ambiguous. `blacksite assets library --check` enforces the allowlist, requires attribution text for attribution licences, and rejects denied hosts.

Two stores are allowed only with evidence. Fab listings whose seller chose CC BY 4.0 instead of the Standard License follow CC terms; record the listing's licence wording in `licenceEvidence.page`. On itch.io every asset has its own creator licence and the default is all rights reserved; accept a listing only when the page and the licence file inside the download both say CC0 or CC BY, and record both in `licenceEvidence.page` and `licenceEvidence.file`. Both stores need a login to download, so these entries are `acquire: "manual"`. `--check` enforces all three rules.

Read the licence page, not the badge. Three sources that look open are not:

- **Quaternius** still labels its packs CC0, but its Quaternius Asset License v1.0 (28 August 2026) says "You may not… redistribute the Assets (in original or modified form) as a standalone asset, asset pack…", whatever the platform. The two licences conflict, so the library holds Quaternius out until the author confirms in writing.
- **ShareTextures** calls its licence "Custom CC0" and forbids redistribution and automated downloads.
- **Freesound** sounds are licensed per sound, and CC0 or CC BY sounds are fine, but its terms forbid harvesting by script and originals need a login. Those entries are manual.

Rejected sources, with the clause that rules them out:

| Source | Why |
| --- | --- |
| Fab Standard License listings, Megascans and other marketplace content | Platform EULA; engine-only content; no standalone redistribution |
| Mixamo | Raw character and animation files may not be distributed |
| Sonniss GDC bundles | May not supply the sounds "as sound effects… as part of… an asset pack" |
| Pixabay | No standalone distribution; bans systematic copying |
| BBC Sound Effects | Personal, educational or research use |
| EchoThief IRs | Bars use in games and software |
| Voxengo IRs | No "direct or indirect profit"; unaltered copies only |
| Bandai Namco motion, LaFAN1, AMASS | Non-commercial or no-derivatives |
| Rokoko free library | No licence text found |
| Sketchfab (all) | Downloads need a login; many CC BY uploads are ripped game assets. CC0 and CC BY models are fine if a user downloads them and provenance is clear |
| CMU motion capture | Custom terms: free to redistribute and to use in commercial games, but "you may not resell this data directly". Allowed only as a clearly separated, never-sold extra; not in the catalog today |

## Sources

| Source | Licence | What to take | Acquisition |
| --- | --- | --- | --- |
| [Poly Haven](https://polyhaven.com) | CC0 | Scanned materials with real-world size, overcast HDRIs, photo-textured props and plants | Script; public API with a `user-agent` naming the tool; resolved file URLs are pinned in the catalog |
| [ambientCG](https://ambientcg.com) | CC0 | Scanned concrete, ground, grates with alpha. Skip its procedural metal and tile | Script; API v2 |
| [Kenney](https://kenney.nl) | CC0 | Impact Sounds: 130 short takes on metal, wood, plate, glass, soft and footsteps | Script; direct zip |
| [OpenGameArt](https://opengameart.org) | Per asset: CC0, CC BY, OGA-BY | The CC0 AKM by LonesomeDucky; check each page's licence block | Script; direct file |
| [Freesound](https://freesound.org) | Per sound: CC0, CC BY | Gunshots, footsteps, ambience beds, impulse responses | Manual |
| [USGS 3DEP](https://www.usgs.gov/3d-elevation-program) | Public domain | 1/3 arc-second GeoTIFF tiles for valleys | Script; S3 |
| Copernicus DEM GLO-30 | Custom, attribution | Eastern European terrain (Carpathians, Polesia) | Script; S3. Carries a required notice and a liability disclaimer that must pass to users, so add only with that text in `attribution` |
| MakeHuman core assets | CC0 | Realistic base humans and clothing, exported locally | Manual (generate) |

Poly Haven props are photo-textured models, mostly not photogrammetry, and some are far over a web budget (the pine and fir trees are millions of triangles). The catalog sets `process.simplify` on heavy ones and drops extra LOD nodes. Pick by triangle count in the catalog, not by thumbnail.

There is no realistic CC0 pistol, shotgun or character that a script can download in a ready format. The AKM is the one realistic gun; everything else is a manual Sketchfab CC BY download or a gap.

## Catalog fields

`assets/catalog.json` is the source of truth. Each entry has `id`, `title`, `category`, `tags`, `source` (`site`, `id`, `url`), `author`, `licence` (an id from the allowlist), `attribution` (the exact credit line), `use` (where it belongs), `files` (`url`, `name`, `sha256`, `size`, `extract` for archives), optional `scale.tile` (metres covered by one texture repeat, from the scan), optional `triangles`, optional `process` (per-asset processing hints) and optional `acquire: "manual"`. `packs` groups ids.

To add an asset: write the entry with an empty `files` list (Poly Haven and ambientCG resolve themselves), run `blacksite assets lock <id>` to download it and record hashes and sizes, run `blacksite assets build <id>` and look at it in the viewer, then commit the catalog change.

## Processing and budgets

| Category | Output | Budget per asset |
| --- | --- | --- |
| material | `1k/` and `512/`: `c` (sRGB colour, alpha if any), `n` (OpenGL normal), `orm` (R occlusion, G roughness, B metalness) as WebP, plus KTX2 (ETC1S colour, UASTC+Zstd normal and ORM) | 900 KB for 1K WebP; KTX2 1K is larger to download (about 1.5 MB) and four times smaller in GPU memory |
| hdri | `sky.webp` (2048 × 1024 display-referred backdrop), `env.hdr` (512 × 256 RGBE for PMREM) | 1.4 MB |
| prop, foliage, weapon | `model.glb`: meshopt, welded, deduplicated, textures as 1K WebP | 1.5 MB (weapon 2 MB), 30 000 triangles |
| character | as above, skinned | 3 MB, 40 000 triangles |
| animation | GLB clip library, resampled, meshopt | 4 MB |
| sound | mono Opus 64 kb/s `.ogg` plus AAC `.m4a` fallback, peak −1 dBFS, leading silence trimmed, 4 s max | 80 KB per take |
| footstep | as sound; long recordings split into takes at onsets | 60 KB per take |
| ambience | stereo Opus 96 kb/s, loudness −26 LUFS, 90 s max, 50 ms fades for looping | 1.6 MB |
| ir | stereo Opus 128 kb/s, 4 s max, peak −6 dBFS | 250 KB |
| terrain | `height.png` 16-bit 1025 × 1025 plus `height.json` (min and max metres, metres per pixel) | 3 MB |

Every build writes `asset.json` beside its files with the shipped files, byte sizes, triangle count, real size in metres, clip names or takes, and whether it is within budget. Ship WebP on desktop and KTX2 where GPU memory matters (phones). Use `512/` on the low tier.

Safari before 18.4 cannot play Opus in Ogg; list the `.m4a` second as a fallback. Load one-shots into `AudioBuffer`s and pick a random take each time; three takes is the minimum that does not audibly repeat, six is comfortable for footsteps.

Materials keep their scan's real size in `scale.tile`. Set UV repeat from it (`repeat = surface metres / tile`) so a brick is brick-sized. Scaling by eye is how a wall ends up with knee-high bricks.

## Hosting

Default: fetch from source with pinned hashes. Nothing large is committed to this repository, sources stay credited, and the licence travels with the file. The cost is that sources move and vanish (OpenAIR's impulse-response site was suspended when this catalog was written) and the first build encodes KTX2 locally.

Games and flagships commit their processed files. `blacksite assets add` puts web-ready files into the game's `public/assets/library/` with a generated `CREDITS.md`, so a game builds offline and its demo deploys without fetching anything. Keep a flagship's committed library under 25 MB.

Not used: Git LFS. Its bandwidth quota is charged to the repository owner on every clone and fork, contributors need `git-lfs`, and the site host needs LFS enabled.

Proposed next step: a mirror of processed packs, such as release assets on the Blacksite repository, each with its `CREDITS.md`. `add` would try the mirror first (same hashes) and fall back to the source. This makes manual Freesound entries one command for users, since CC0 allows re-hosting. Publishing it needs the maintainer's go-ahead.

## Crediting

`CREDITS.md` is generated, grouped by licence. CC0 and public domain entries list title, author and source as a courtesy. CC BY entries add the exact `attribution` line, which follows the form `"Title" by Author (source URL), licence`. Show the credits somewhere a player can reach them: an in-game credits screen or a link from the menu. The site's credits live at `site/public/CREDITS.md`.
