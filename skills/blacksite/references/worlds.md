# Worlds and scale

What makes a kilometre read as a kilometre: air between the camera and everything else, terrain and forests that carry on past where you can walk without ever visibly changing, ground cover dense at your feet, and one wind moving all of it. Without atmosphere, a mountain at 5 km has the same contrast as a rock at 5 m, and the world reads as a model on a table. `examples/valley/` is the complete reference; wiring for `@blacksite/landscape` and the look's `nature` atmosphere is in [building-blocks.md](building-blocks.md#open-worlds-landscape).

Sections: [Sky, sun and air](#sky-sun-and-air) · [The far field](#the-far-field) · [Terrain](#terrain-to-the-horizon) · [Ground cover](#ground-cover) · [Trees](#trees) · [Wind](#wind) · [Rules](#rules)

## Sky, sun and air

| Atmosphere | For | Feel |
|---|---|---|
| `zone` | Ruins, yards, interiors, short sight lines | Cold overcast, linear fog from 14 to 150 m, a LUT grade with grain and aberration |
| `haze` | Warm late afternoon at street scale | Amber low sun, exponential fog, warm LUT |
| `nature` | Open landscapes: meadows, forests, mountains, kilometres of sight line | A scattering sky with a real sun and soft clouds, aerial perspective, valley height fog, a filmic curve, gentle warm and cool split and slightly lowered saturation |

- **The sun is a direction, not a lamp.** One directional light whose direction, colour and strength come from the atmosphere; the sky's glow and disc sit exactly where it points, and the same data drives the hemisphere fill.
- **Low sun, long shadows.** An elevation of 20–30° gives grazing light across terrain and back-lit grass. A noon sun flattens every slope.
- **The sky scatters.** A clear sky is blue overhead and pale at the horizon because of scattering through more air, and it warms toward the sun near the horizon. Rayleigh scattering deepens the blue; Mie whitens the horizon and brightens the glow round the sun. Computed once into small lookup tables, the per-pixel sky is a few texture reads. A two-colour gradient is the cheap version.
- **Bake the sky into the environment,** so every material picks up the sky's colour in its reflections and ambient light. Rebake when the sun moves far.
- **Distance does three things to colour:** contrast falls, colour shifts toward the horizon colour, and the side facing the sun picks up warm in-scatter. Apply it to everything in one depth pass, so terrain, impostors and the far canopy all take the same haze. Without that pass, exponential fog in the horizon's colour is the cheap version.
- **Ridges step back in four or five layers.** If the third ridge has the same value as the first, the fog is too thin; if you can't see the second, it's too thick.
- **Tune the air in one pass.** Valley's aerial perspective and height fog read the composer's depth in a single pass after AO and replace scene fog; it settled at an aerial multiplier of 3 (from 9) and a height-fog density of 0.00028 (from 0.0009).
- **Haze pools in valleys.** Air near the ground is denser: height fog thickens toward low altitudes and thins over ridges, so a view down into a valley reads deeper than a view across it.
- **Clouds have shape, not texture.** Large, irregular masses with lit tops and darker bases, thinning toward the sun. A uniform noise cover reads as a texture glued to the sky. Clouds drift (a static sky is the first thing a still capture gives away), and they sit behind the aerial perspective, so they fade and warm toward the horizon like the mountains.

## The far field

The player never sees a representation change. They see one forest at every distance. Every tree passes through three forms as it recedes, and each handover is a band, not a line, wide enough that nothing pops.

| Distance (Valley, high tier) | Form |
|---|---|
| 0–70 m | Instanced mesh: trunk, branches, leaf cards, real shadows |
| 48–940 m | Octahedral impostor: one camera-facing quad per tree |
| 550 m to the horizon | Far canopy: the terrain lifted by the crown height and shaded as lumpy crowns |

Medium pulls the bands in to 40–58 m and 560–820 m; low to 28–42 m and 440–660 m. Keep the numbers in `src/game/model.ts` with the tier, never inline. The canopy groups crowns into clumps of 2, 4 and 8 as a crown's footprint shrinks to a few pixels, so it doesn't shimmer; on phones it takes over about 350 m out.

- **Bake the impostor from the same tree.** An impostor painted separately from its mesh never matches its silhouette, and the swap reads as a different tree. Valley renders each procedural model from a hemi-octahedral grid of 8 × 8 view directions into albedo and normal atlases (192 px frames on high, 160 on medium and low) while the scene loads: 35–45 ms for three species in the latest measurement, about 230 ms in an earlier one. If the tree changes, rebake; never hand-edit an atlas.
- **Blend four frames, not one,** so the tree turns smoothly as you walk round it. Snap to the nearest frame on the low tier only.
- **Light the impostor.** Rotate the normal atlas by each tree's yaw and light it with the scene, so a far crown has a sunlit and a shaded side that match the near mesh. A flat-shaded billboard reads as a cut-out.
- **Smudge the distance.** Bias the impostor's mip and widen its coverage edge with distance, so far crowns soften the way they do through air instead of aliasing into sparkle. A crisp silhouette at 800 m reads as a model; a soft one reads as a forest.
- **Dither, never alpha-blend.** The near mesh discards where a screen-space dither falls below its fade; the impostor discards where the same dither falls above its fade-in. The masks are complementary, so in the band every pixel belongs to exactly one form: no double-bright overlap, no hole, no sorting.
- **Fade by root distance,** not per pixel, so a tall tree crossfades as one object.
- **Hand the far end to the canopy early.** The canopy starts rising about 90 m before the impostors fade, so by the time a tree has dithered out the ground under it is already shaded as crown.
- **Pick one level per pixel on phones.** Blending two crown levels in the far canopy pushed phone p50 from 12 to 21 ms; a dither that picks one level per pixel on the low tier brought p95 back to about 12 ms.
- **Keep shadows through the swap.** Beyond the mesh band, an invisible proxy (a cone for conifers, an ellipsoid for broadleaf) on a shadow-only layer casts the tree's shadow out to the shadow distance. Without it, shadows vanish at the mesh band and the ground brightens in a ring.

## Terrain to the horizon

- **One continuous LOD, no cracks.** A quadtree of fixed world-space nodes sharing one grid mesh, each vertex morphing toward the next coarser grid as it nears its node's range edge (CDLOD). That removes the T-junction cracks of plain chunked LOD without skirts or stitching strips.
- **No swimming.** Nodes sit at fixed world positions and the morph depends only on distance, so heights never slide under a moving camera. A grid that follows the camera in steps shimmers on every ridge line.
- **One ground truth.** Every vertex reads the heightfield at its own world position with a shared bilinear fetch, so nodes, cover, trees and the CPU height query agree to the centimetre.
- **Near and far fields blend.** A near heightfield at 1 m spacing covers the walkable square; a far field at 8 m runs to the horizon. They blend over a 200 m band, so the edge of the playable area has no step.
- **Detail fades, macro stays.** Splat layers fade to their average colour past a detail distance (260 m high, 140 m low), while low-frequency macro variation keeps far slopes from going flat.
- **No visible tiling.** Read each layer at three randomly offset tiles on a hexagonal grid and blend with the variance kept, so a 3 m texture never shows its repeat across a 1 km slope. Any repeating texture on a large surface wants the same treatment.
- **Light from full-precision normals.** An 8-bit normal on a gentle slope bands into contour stripes under a low sun. Light from the heightfield's own normal and pass the true slope normal to shadow sampling, so a slope neither stripes nor acnes.
- **The horizon is fog, not a far plane.** Set the camera far beyond the last terrain node and let the atmosphere swallow it; the last node sits well inside full fog, never against the sky. Valley's far plane is 16 km, past the far field's reach of about 11.6 km, so terrain never rounds to the sky's depth of 1.0; its terrain quadtree has up to 14 levels.
- **Sun shadows in cascades.** Three cascades out to 180 m with 2048 maps on high, two out to 130 m on medium, two out to 90 m with 1024 maps on phones, faded between cascades; the cascade frustums rebuild only when the camera moves. Trees beyond their mesh band cast through shadow proxies.
- **Streaming is not built yet.** Both heightfields load whole. Shipped open worlds stream cells around the player under a per-frame budget so a bigger world costs no more per frame; that is the next step past Valley's size (proposed).
- **Phone first playable is a world-build problem.** Valley's phone first playable was 18 s. Halving both heightfields' resolution on the low tier and giving the path-distance grid numeric keys took the world build from about 4.2 s to 1.0 s and first playable to 6.2 s. Waiting for the look's first ten frames before reporting ready moved the composer and sky lookup work out of play.

## Ground cover

Shipped ground cover is dense at the feet, thins with distance without a visible line, holds still in a still camera, glows when the sun is behind it, and moves with the wind.

- **Mask-placed, not scattered.** Each family has a mask over the terrain at the blade's root: grass where there is no forest, no path and a gentle slope; flowers as the grass mask times a low-frequency noise, so they come in drifts; litter and understory under the forest; pebbles on paths and steep ground. One expression per family replaces hand-painted density maps and stays in step with the terrain.
- **World-stable patches.** Cover is drawn in 8 m patches on a fixed world grid, each the same blades flipped and rotated by a seed from its cell, so nothing reshuffles as the camera moves and the eye finds no repeating tile. Placement that follows the camera crawls.
- **The GPU does the work.** Positions, heights, mask, fade and wind run in the vertex shader; the CPU only lists visible patches, so 80,000 blades cost a few draw calls.
- **Real counts.** Valley high: 420 grass blades, 28 flowers, 70 understory, 54 litter cards and 16 pebbles per 8 m patch, out to 75 m. A Slice's wilderness needs at least grass, a flower or accent, litter and stones.
- **Every blade has a threshold.** Blades are laid out along a low-discrepancy sequence with rising thresholds, so any prefix covers the patch evenly. A blade survives while mask × distance reach exceeds its threshold, and shrinks to nothing over a short range instead of vanishing. Reach falls on a smoothstep from 0.45 to 1.0 of the cover distance (34–75 m on high, 27–60 m on medium, 20–45 m on low); a family that should end sooner scales that whole window by its `fade`, never just its far end.
- **The ground is the grass seen from afar.** Where the blades end, the eye compares them with the ground beneath, so the terrain under any cover mask draws what the blades look like at that distance: the same masks, the same patch-tone noise, and each family's texture averaged by alpha with its darkening up the blade, weighted by blade area per square metre. Under near blades it is that colour times the root `ao`, and it brightens to the full average on the same reach curve the blades thin on, then stays to the horizon. Swap the ground layer's detail for a light two-octave mottle (±18% at 1.9 and 5.3 per metre, faded with the detail distance) and flatten its detail normal, or you get plates and cracks between tufts. Measure it: render a view with the cover on and off. In Valley the ratio is 0.89–1.04 at every distance on every tier, against up to 1.28 and a greener ground before. No far layer is needed once the ratio is flat.
- **Rings cut cost, not blades.** Patches fall into rings at 0.3, 0.62 and 1.0 of the cover distance; a far ring draws only the prefix that can still survive at its nearest edge, so density stays continuous across the edge. Far blades widen as their neighbours drop out (up to 1.9× for clumps).
- **Tiers scale density, not the look.** 1.0 at 75 m on high, 0.8 at 60 m on medium, 0.55 at 45 m on low, with the same seeds and masks, so a phone sees the same meadow, thinner.
- **Alpha to coverage with sharpened alpha.** With MSAA, sharpen the alpha across one pixel, `(a - 0.5) / fwidth(a) + 0.5`, and turn it into sub-sample coverage, so the edge is crisp up close and antialiased far away. Boost alpha with the mip level so coverage doesn't erode at distance. Without MSAA, a 0.5 alpha test with fewer, wider blades. Plain alpha test on thin blades sparkles in motion; plain alpha blending needs sorting and haloes.
- **Back-lit translucency.** Grass, flowers and leaves add the sun's colour when the camera looks toward the sun through them, scaled by height up the blade. Without it, back-lit grass goes black.
- **Darker at the root,** so the ground between blades reads as shade, not as a green carpet. The ground's own near shade is the same `ao`, so the two agree.
- **Colour by patch, not by blade.** Three colours per family mixed by low-frequency world noise, with a little per-blade variation. Drifts of dry and green grass read as a field; per-blade noise reads as static.
- **Cover never casts sun shadows.** Its own darkening and ambient occlusion carry the shade; shadow maps can't resolve blades and would shimmer.

## Trees

- **Three or four species**, at a scale range of about 0.75–1.3 with random yaw, clustered around clearings, with undergrowth, rocks and fallen trunks between them.
- **Placement by density and choice.** Jitter candidates on a grid, keep one where a density function passes a hash, and choose the species by place: pines high, broadleaf low, birch at the thin edges. Clearings come from the density function, not from deleting trees.
- **Same seed for every tier.** The low tier keeps the first 28,000 of the same 64,000 ranked candidates, so the forest thins rather than rearranges.
- **Ground them.** Trees sit 0.15 m into the ground, and understory and litter follow the forest mask, so every trunk stands in its own litter.

## Wind

One wind for the whole world. Grass, crowns, impostors, particles and the ambience all read the same field, so a gust is a thing with a place and a speed: you see it cross the meadow, hear it rise around you, and watch it reach the trees. Separate sine waves per system move everything at once and read as a screensaver.

- **Strength = base sway + travelling gusts.** Valley's breeze: strength 0.45, gust 0.75, gusts about 38 m across travelling downwind at 7 m/s. Sway is a slow swell whose phase moves along the wind; gusts are noise scrolled downwind and passed through a smoothstep, so they're separate patches with calm between them.
- **CPU and GPU agree.** The shader and the CPU sample the same hash, noise and constants, so a sound, a particle and a blade at the same spot see the same gust at the same moment.
- **One clock,** updated once per frame before its readers, with `dt` clamped to 0.1 s so a stalled tab doesn't jump the gusts.
- **Weather is data.** Lower strength and gust for a calm morning, raise both for a storm; keep each preset in the model, and ease a change of direction over several seconds.
- **Every consumer bends the same way.** Blades bend downwind, quadratically with height, with the tip dropping so blades keep their length, and flutter sideways at a per-blade rate. Trunks sway weighted by height, branches and leaves flutter at a per-tree phase, and shadow casters run the same motion so shadows move with the crowns. Impostors sway their tops by the same field, so a far tree moves like the near one it replaced. Particles (pollen, leaves, dust, smoke) drift downwind, faster in gusts.
- **Sound follows the same gust.** Valley's wind bed sits at 0.25 + strength × 0.7 and a leaves bed under the canopy at canopy × (0.2 + gust × 0.9), quantised to 1/50 and faded over 0.35–0.5 s so the mixer isn't touched every frame.

## Rules

- **Fog colour matches the horizon.** A grey fog under a blue horizon draws a line around the world.
- **Every outdoor shot has fog between the camera and the far plane,** including the meadow at your feet: a little haze at 200 m is what makes the forest at 600 m look far.
- **Every handover is a band, and both sides of it draw.** A fade on one side with a cut on the other leaves a ring you can see from the next hill.
- **Thinning is invisible or it's broken.** Walk forward slowly across the cover edge; a line you can see is a bug.
- **Stable in a still frame.** Freeze the wind and hold the camera still: if any blade flickers, the alpha or the fade is wrong, not the wind.
- **One field.** If two systems keep their own wind, they will disagree in the first gust.
- **Gusts travel.** A gust that appears everywhere at once is a global timer. Check that you can watch one cross the meadow.
- **Freeze for measurements, never for the player.** Shimmer and pop captures freeze the wind; play never does.
- **Judge the layers and judge in motion.** Read the valley and ridge captures for four or five distinct depth layers before touching the grade. Walk and fly through every band, put the route in the check contract's `flyover` poses, run `blacksite check --only flyover,shimmer,pop,critic` and read the flyover sheet frame by frame ([verify.md](verify.md)); a still capture hides pops and shimmer.
