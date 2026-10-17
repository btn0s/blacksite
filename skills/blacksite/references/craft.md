# Craft

How a space reads as shipped: light, materials, dressing and motion. Work through it with the parts list open, then judge the result in the critic captures ([verify.md](verify.md)). Outdoor sky, haze, terrain and foliage are in [worlds.md](worlds.md); wiring for the look stack, the world kit and the materials pipeline is in [building-blocks.md](building-blocks.md).

## Light

- **One key, one fill, practicals.** The key is the sun, the moon or the strongest lamp. The fill is a hemisphere at about a third of the key. Practicals are visible sources (lamps, screens, fire, signage) that explain the light in each area; give every interior at least two. A space lit only by an ambient term looks unlit.
- **Shadows from the key only, near the player.** One shadow-casting directional light with a texel-snapped frustum that follows the player: 2048 maps on desktop, 1024 on touch. Small practicals don't cast. A flashlight is the exception: it's the only shadow-casting light near the player while it's on, with a cookie texture, about 0.08 s of lag behind the view, a little bounce light, and a beam you can see in the haze.
- **A shadow frustum that follows without swimming.** Move the shadow camera with the player and snap its position to the shadow map's texel size, so shadow edges don't crawl as you walk: a 40 m half-extent, bias −0.0004 and normal bias 0.03 in the world kit. Open worlds use three cascades out to 180 m with 2048 maps and fading between them (`worlds.md`).
- **A fixed number of lights.** Changing the light count recompiles every lit shader. Keep a constant pool of local lights per tier and move it between sources, fading through zero (`performance.md`).
- **Contrast at the focal point.** The brightest value and the strongest saturation go where the player should look: the exit, the objective, the enemy. Darken what doesn't matter.
- **Fog layers depth.** Every outdoor shot has fog between the camera and the far plane, so a mid-ground silhouette reads against a lighter background. The `zone` atmosphere uses linear fog from 14 to 150 m; `haze` uses exponential fog at a density of 0.011. Match the fog colour to the horizon.
- **Emissives bloom, nothing else does.** Bloom's threshold is 1.35, so only emissive surfaces and lights above that glow. Raising bloom to make a scene "pop" washes it out.
- **The post stack is one HDR chain.** Render into a half-float buffer with the composer's MSAA (4× high, 2× medium, off on low), then half-resolution AO with depth-aware upsampling, bloom from a mip blur, and one grade pass. The grade is a single fullscreen pass: chromatic aberration, a shoulder tonemap (knee 0.72), gamma, a 33³ LUT, split tone, tint, saturation, vignette and grain, each compiled in or out by a define so a disabled feature costs nothing. Generate LUTs in the repository (`packages/look/scripts/make-lut.mjs`); never copy LUT images from elsewhere. The whole stack took Checkpoint from 199 fps (p95 6.6 ms) to 137 fps (p95 10.1 ms), which is why phones run the low tier.
- **One tonemapper, one exposure.** The look's grade is the only tonemapper and `atmosphere.exposure` the only exposure. The world kit once set ACES at 1.05 and Air Strike asked it for 1.02, and neither did anything: the composer renders into its own buffers, where the renderer's tone mapping never applies. Arena's arms were drawn after the composer with ACES, so they skipped the grade, the vignette and the grain. Never set `renderer.toneMapping` or `toneMappingExposure` in a game, and draw viewmodels through the look's overlay so they get the same grade as the world.

## Materials

- **Never flat colour.** Every surface has colour, roughness and normal maps, from textures of at least 512 px mapped at real-world scale (`size` in metres per repeat, `depth` in metres of relief). Use 512 px for distant surfaces and phones; keep 1024 px for surfaces that earn it.
- **Break up repetition.** Blend ground materials by world-space noise, vary roughness with grime, and add decals: stains, cracks, puddles, graffiti, tyre marks.
- **Weather follows structure.** Dirt belongs in cavities, exposed metal belongs under paint, and wetness changes colour and roughness together. Baked damage repeats; use a decal for a unique hit.
- **Ground every prop.** Anything resting on the ground gets a contact shadow. A prop without one floats.
- **Two surfaces never share a plane.** A floor slab and the plane laid over it, a crate top flush with a plinth, a sign painted at the wall's own depth: the depth buffer can't tell them apart and the pixels flip between them as the camera moves. It looks fine at 2 m and shimmers at 60. A 1 cm gap held at 2 m and flickered across 20,000 pixels at 150 m in 24-bit depth. Push the smaller face clear (`LevelBuilder` moves same-direction faces within 1 cm by 2 cm and warns), and give overlays that must sit flat a depth bias that grows with distance (`decalBias`, 0.03% of the distance along the view ray).
- **Find z-fighting before the player does.** It hides in a still frame, so the check renders an object-ID buffer several times with sub-pixel jitter and a 0.7 mm camera nudge, then with the nudges alone; only a pixel that flips under the nudge alone, in a patch at least 4 px across, is z-fighting. The static lint finds triangle pairs within 1° of coplanar through a BVH and compares their gap with the depth step at the camera's distance (690 ms on a 257,000-triangle scene). Squad's container roofs, 0 mm apart, failed at 63,485 px on desktop and passed at 22 after the fix. A view-ray bias by draw order hid overlays on phones (11,053 px); layering them at least 12 mm apart fixed it, and an asphalt plane that needed 33 mm swallowed the puddles at 40.
- **Resolve coplanar faces at build time, cheaply.** `LevelBuilder` pushes the smaller of two coplanar faces 2 cm clear, at most six passes, using a hash grid of 8 m cells and re-checking only the faces that moved. Before the grid it spent about 480 ms of Breach's 555 ms level build, about 2.2 s on a throttled phone, which broke first playable; after, the build took about 210 ms.
- **Pick the near plane for the depth buffer, not the eye.** Depth resolution goes with 1/near: 0.1 m (high), 0.15 m (medium) and 0.2 m (low), where the old 0.05 m cost 2–4× the resolution at every distance. The first-person viewmodel renders in its own pass, so a larger near plane never clips the weapon. Use logarithmic depth only past a 1 km far plane, and give every custom shader its `logdepthbuf` chunks. Reversed depth is not a default: with the stack's AO it produced a white frame.
- **Judge a material at the distance the player sees it.** An olive paint-wear pattern on the first-person rifle read as camouflage at viewmodel distance.
- **Ship compressed textures.** KTX2, with ETC1S for colour and UASTC for normals, roughness and masks, transcoded on the GPU; meshes as glTF with meshopt compression. The budget check rejects PNG, JPEG, WebP and other formats outside the legacy list. A lossless WebP fallback must be exact (`cwebp -lossless -exact`): lossy WebP damaged the dirt, wetness and normal data packed in alpha. The 22-material library is 12.8 MB in KTX2 at 512 px against 21.4 MB in WebP, and 47.7 MB against 83.9 MB at 1024 px; pick 512 on phones and coarse pointers.
- **A graph that runs is not yet a photographic material.** Keep the existing surface until a replacement wins a side-by-side comparison under the same camera, light, fog, grade and metre scale, at 1× and 4×, clean and weathered. Image-derived PBR is an approximation: luminance can't separate pigment, illumination and relief, so derive a restrained height and set metalness from the material's structure, not from brightness. Record the result honestly; a successful bake doesn't establish visual parity with a scan.

## Dressing

Dress in clusters, not spreads: 3–7 props grouped against walls, at corners and around a focal point, with clear paths between groups. Even spacing on open floor reads as a test map. Every wall at eye height carries a decal, a fixture or a prop.

Minimum counts for a Slice, by kind of space:

| Space | Light sources | Materials | Prop types | Motion | Sound layers |
|---|---|---|---|---|---|
| Interior room | Key from a window or lamp, 2 practicals | 4 | 8 | Dust in the light, a flicker or a fan | Room tone, one source in the room, one outside |
| Street or yard | Sun or moon, 3 practicals | 5 | 12 | Wind in tape, trees or litter; smoke | Wind, distant traffic or city, a near source |
| Wilderness | Sun or moon, fog | 4 ground blends | 3–4 species and rocks, undergrowth, fallen trunks | Wind in crowns and grass; birds or insects | Wind, wildlife, water if any |
| Arena | Key, rim lights on cover | 4 | 6 cover types, signage | Banners, screens | Crowd or room tone, announcer or music |

A night-time car park, for example: 1 moon key, 4 sodium practicals, a flashlight and emissive signage; asphalt, wet asphalt, concrete, painted lines and metal; 12 prop types in clusters of 3–7 (cars, barriers, bins, cones, pillars, pipes); oil stains, tyre marks, graffiti and cracks on every wall and floor at eye height; rain, fluttering tape, a flickering tube and idle on every character; a rain bed, distant traffic, hum from the lights, footsteps per surface and events; enemies that patrol, investigate a sound, search and attack.

## Layout and pacing (proposed)

From Breach and Traverse (`examples/*/DESIGN.md`).

- **The first space teaches and is safe.** Breach's yard has no enemies and a controls hint; contact comes at the next door.
- **Teach a verb in rising order before the first choice.** Traverse puts every ledge height on its route, lowest first, before the first fork; the first two (0.50 and 0.75 m) teach the mantle.
- **Every fight has a second route.** Breach's store room is the flank route into the hall, and an enemy uses it and calls it first.
- **Bookmark the longest sightline.** It's the view a critic judges the space from, and the one that costs the most to draw.
- **Size the loop.** Breach's loop runs about 3 minutes; a time-trial course runs 45–90 s (Traverse: about 260 m, a checkpoint per space). Health that regenerates (25/s after 5 s without damage) keeps a short loop flowing; a restart comes 3.5 s after death.

## Make it live

Nothing on screen is perfectly still for more than a second, and nothing is silent:

- Wind on foliage, cloth, tape and litter; dust motes in light shafts.
- A practical that flickers or a screen that changes.
- Idle animation on every character, including the player's own viewmodel (breathing sway).
- Distant activity: smoke, birds, traffic, a far explosion.
- A reaction to every player action: a sound, a particle, a camera response ([combat.md](combat.md)).
