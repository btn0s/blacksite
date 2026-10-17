# Foliage

Grass, flowers, undergrowth, litter, pebbles and trees: the near field that tells the player they are standing in a place. Shipped ground cover is dense at the feet, thins with distance without a visible line, holds still in a still camera, glows when the sun is behind it, and moves with the wind. `@blacksite/landscape` provides `createCover` for ground cover and `generateTree` with `createForest` for trees. `examples/valley/` is the complete reference.

## Guides

- `packages/landscape/AGENTS.md`: the API, the mask vocabulary and symptom fixes.
- `examples/valley/src/Landscape.tsx`: five cover families and three tree species, with tier numbers in `src/model.ts`.
- `far-field.md` for how trees hand over to impostors, `wind.md` for the bend.

## Ground cover

- **Mask-placed, not scattered.** Each family has a `mask`: a GLSL expression over the terrain at the blade's root. It can read `bsSurface` (the terrain's surface texture: forest mask in `.b`, path or rock mask in `.a`), `bsSlope`, `bsRoot` and `bsNoise(bsRoot * scale, seed)`. Grass grows where there is no forest, no path and a gentle slope; flowers take the grass mask times a low-frequency noise so they come in drifts; litter and understory grow under the forest; pebbles follow paths and steep ground. One expression per family replaces hand-painted density maps and stays in step with the terrain.
- **World-stable patches.** Cover is drawn in 8 m patches on a fixed world grid, each an instance of one shared blade buffer. A patch at a given world cell always has the same blades, flipped and rotated by a seed from its cell, so nothing reshuffles as the camera moves and the eye finds no repeating tile. Placement that follows the camera crawls.
- **The GPU does the work.** Blade positions, heights from the terrain texture, mask, fade and wind all run in the vertex shader. The CPU only lists the visible patches each frame (`cover.update(camera)`), so 80,000 blades cost a few draw calls.
- **Real counts.** Valley high: 420 grass blades, 28 flowers, 70 understory, 54 litter cards and 16 pebbles per patch, out to 75 m. A Slice's wilderness needs at least grass, a flower or accent, litter and stones (`craft.md`).

## Thinning without a ring

- **Every blade has a threshold.** Blades in the shared buffer are laid out along a low-discrepancy sequence with a rising threshold, so any prefix of the buffer covers the patch evenly. A blade survives while the mask times the distance reach exceeds its threshold, and it shrinks to nothing over a short range instead of vanishing. Density therefore falls smoothly, blade by blade, with distance and with the mask.
- **Rings cut cost, not blades.** Patches fall into three distance rings (0.3, 0.62 and 1.0 of the cover distance). A far ring draws only the prefix of the buffer that can still survive at its nearest edge, so far patches cost less while the visible density stays continuous across the ring edge.
- **Widen what remains.** Far blades get wider as their neighbours drop out (up to 1.9× for clumps), so coverage holds while the count falls.
- **Tiers scale density, not the look.** `density` and `distance` per tier: 1.0 at 75 m on high, 0.8 at 60 m on medium, 0.55 at 45 m on low. The same seeds and masks run on every tier, so a phone sees the same meadow, thinner.

## Antialiasing thin geometry

- **Alpha to coverage with sharpened alpha.** With MSAA on (high and medium), `alphaToCoverage: true` turns a blade's alpha into sub-sample coverage. The shader first sharpens the alpha across one pixel, `(a - 0.5) / fwidth(a) + 0.5`, so the edge is crisp up close and antialiased far away. Plain alpha test on thin blades sparkles in motion; plain alpha blending needs sorting and haloes.
- **Keep alpha through the mips.** Alpha is boosted with the mip level, so a blade's coverage doesn't erode into nothing at distance.
- **Alpha test where there is no MSAA.** The low tier has no MSAA, so it uses a 0.5 alpha test, and fewer, wider blades hide the aliasing.

## Light through leaves

- **Back-lit translucency.** Grass, flowers and leaves add the sun's colour when the camera looks toward the sun through them, scaled by `translucency` and by height up the blade. A meadow against a low sun glows at the tips; without it, back-lit grass goes black.
- **Darker at the root.** `ao` darkens each blade toward its base, so the ground between blades reads as shade, not as a green carpet.
- **Colour by patch, not by blade.** Three colours per family mix by low-frequency world noise, with a little per-blade variation. Drifts of dry and green grass read as a field; per-blade noise reads as static.

## Trees

- **Procedural, three or four species.** `generateTree(OAK)`, `PINE` and `BIRCH` build trunk, branch and leaf-card geometry from a seed, with a `treeWind` attribute weighting how far each vertex sways. Pass each with bark and leaf textures and a scale range of about 0.75–1.3.
- **Placement by density and choice.** `createForest` jitters candidates on a `spacing` grid, keeps one where `density(x, z)` passes a hash, and asks `choose(x, z, random)` for the species: pines high, broadleaf low, birch at the thin edges. Clearings come from the density function, not from deleting trees.
- **Same seed for every tier.** The low tier keeps the first 28,000 of the same 64,000 ranked candidates, so the forest thins rather than rearranges.
- **Ground them.** Trees sit 0.15 m into the ground; understory and litter masks follow the forest mask, so every trunk stands in its own litter.

## What isn't there yet

- No GPU placement compute; patches come from a shared buffer and a CPU visibility pass.
- No hero dressing kit: rocks, fallen trunks and ferns are placed by the game.
- No interaction: blades don't part around the player.

## Rules

- **Stable in a still frame.** Freeze the wind and hold the camera still: if any blade flickers, the alpha or the fade is wrong, not the wind.
- **Thinning is invisible or it's broken.** Walk forward slowly across the cover edge; a line you can see is a bug.
- **Cover never casts shadows from the sun.** Its own darkening and ambient occlusion carry the shade; shadow maps can't resolve blades and would shimmer.
