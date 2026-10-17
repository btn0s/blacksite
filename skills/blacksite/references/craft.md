# Craft

How a scene reads as shipped: light, materials, dressing, atmosphere, motion and feedback. Work through it with the parts list open, then judge the result in the critic captures (`verify.md`).

## Light

- **One key, one fill, practicals.** The key is the sun, the moon or the strongest lamp. The fill is a hemisphere at about a third of the key. Practicals are visible sources (lamps, screens, fire, signage) that explain the light in each area; give every interior at least two. A space lit only by an ambient term looks unlit.
- **Shadows from the key only, near the player.** One shadow-casting directional light with a texel-snapped frustum that follows the player (`createAtmosphere` does this): 2048 maps on desktop, 1024 on touch. Small practicals don't cast.
- **Contrast at the focal point.** The brightest value and the strongest saturation go where the player should look: the exit, the objective, the enemy. Darken what doesn't matter.
- **Fog layers depth.** Every outdoor shot has fog between the camera and the far plane, so a mid-ground silhouette reads against a lighter background. `ZONE` uses linear fog from 14 to 150 m; `HAZE` uses exponential fog at a density of 0.011. Match the fog colour to the horizon.
- **Emissives bloom, nothing else does.** Bloom's threshold is 1.35, so only emissive surfaces and lights above that glow. Raising bloom to make a scene "pop" washes it out.

## The look stack

Use `@blacksite/look` on every game. `<Look atmosphere="zone" quality={tier} environment sun={sun} fill={fill} />` in React Three Fiber, or `createLook(renderer, scene, camera, …)` and `look.render(dt)` in plain three. It brings HDR, half-resolution AO, bloom, a grade with a shoulder tonemap and a LUT, vignette, aberration and grain. Pass your own sun and hemisphere lights so the atmosphere drives their colour.

- **The look owns tone mapping and exposure.** The grade is the only tonemapper and `atmosphere.exposure` the only exposure; change it with an atmosphere of your own, `{ ...ZONE, exposure: 1.22 }`. The world kit's `createAtmosphere` once set ACES at 1.05 and Air Strike asked it for 1.02, and neither did anything: the composer renders the scene into its own buffers, where the renderer's tone mapping never applies. Arena's arms were drawn to the screen after the composer with ACES, so they skipped the grade, the vignette and the grain. Never set `renderer.toneMapping` or `toneMappingExposure` in a game.
- **Viewmodels go through the overlay.** In Arena the arms rendered after the composer with their own tone mapping; the Firing Range hand-inserted its own composer pass. `look.addOverlay(scene, camera)` or `<Look overlay>` replaced both: `ArmsViewmodel render="external"` hands its presentation to the look, and `MultiplayerScene` passes it out through `onArmsPresentation`. The overlay runs after AO and before bloom with depth cleared, so the arms get the same grade as the world and never clip.
- **Antialiasing comes from the composer's MSAA**, not the canvas. Create the canvas with `antialias: false`.

## Materials

- **Never flat colour.** Every surface has colour, roughness and normal maps, from textures of at least 512 px mapped at real-world scale. `surface(name)` and `meterSurface(name)` from `@blacksite/look/world` give the ruins set: cast concrete, panels, slabs, stained and painted walls, brick, rust, metal, corrugated sheet, asphalt, dirt, grass and gravel. `worldBoxGeometry` and its siblings tile UVs in metres.
- **Break up repetition.** Blend ground materials by world-space noise (`groundMaterial()`), vary roughness with grime, and add decals: stains, cracks, puddles (`puddleMaterial()`), graffiti, tyre marks.
- **Ground every prop.** Anything resting on the ground gets a contact shadow (`contactShadow`; `LevelBuilder` adds them). A prop without one floats.
- **Two surfaces never share a plane.** A floor slab and the plane laid over it, a crate top flush with a plinth, a sign painted at the wall's own depth: the depth buffer can't tell them apart and the pixels flip between them as the camera moves. It looks fine at 2 m and shimmers at 60. `LevelBuilder` finds same-direction faces within 1 cm that overlap, pushes the smaller one 2 cm clear, and warns with both names (`coplanar: 'throw'` makes it an error). Overlays that must sit flat on a surface (contact shadows, puddles, stains) use `decalBias(material)`, which pulls the decal toward the camera along the view ray by 0.03% of its distance, so the margin grows with distance the way the depth step does. A 1 cm gap held at 2 m and flickered across 20,000 pixels at 150 m in 24-bit depth.
- **Pick the near plane for the depth buffer, not the eye.** Depth resolution goes with 1/near. `depthDefaults(tier)` gives 0.1 m (high), 0.15 m (medium) and 0.2 m (low) where the old 0.05 m cost 2–4× the resolution at every distance. The first-person viewmodel renders in its own pass, so a larger near plane never clips the weapon. Reach for `logarithmic: true` only when the scene has a far plane past 1 km, and give every custom `ShaderMaterial` the `logdepthbuf` chunks or its depth test will be wrong. Reversed depth is not a default: with N8AO in the stack it produced a white frame.
- **Wear reads at its viewing distance.** An olive paint-wear pattern on the first-person rifle read as camouflage at viewmodel distance and had to be flattened. Judge a material at the distance the player sees it.
- **Cropped meshes end off screen.** Cropping a body at the elbow left rounded capsule ends in pistol aim and on phones. A sleeve on each forearm now runs past the edge of the screen in every pose and aspect.

## Dressing

Dress in clusters, not spreads: 3–7 props grouped against walls, at corners and around a focal point, with clear paths between groups. Even spacing on open floor reads as a test map. Every wall at eye height carries a decal, a fixture or a prop.

Minimum counts for a Slice, by kind of space:

| Space | Light sources | Materials | Prop types | Motion | Sound layers |
|---|---|---|---|---|---|
| Interior room | Key from a window or lamp, 2 practicals | 4 | 8 | Dust in the light, a flicker or a fan | Room tone, one source in the room, one outside |
| Street or yard | Sun or moon, 3 practicals | 5 | 12 | Wind in tape, trees or litter; smoke | Wind, distant traffic or city, a near source |
| Wilderness | Sun or moon, fog | 4 ground blends | 3–4 species and rocks, undergrowth, fallen trunks | Wind in crowns and grass; birds or insects | Wind, wildlife, water if any |
| Arena | Key, rim lights on cover | 4 | 6 cover types, signage | Banners, screens | Crowd or room tone, announcer or music |

`LevelBuilder` merges geometry by material, so dressing costs one draw per material, not one per prop. The world-kit props (`apartmentBlock`, `lada`, `shed`, `waterTower`, `apc`, `deadTree`) are a starting set; read `assets.md` for owned packs.

## Make it live

Nothing on screen is perfectly still for more than a second:

- Wind on foliage, cloth, tape and litter; dust motes in light shafts.
- A practical that flickers or a screen that changes.
- Idle animation on every character, including the player's own viewmodel (breathing sway).
- Distant activity: smoke, birds, traffic, a far explosion.

## Feedback

Every player action gets three responses: something you see, something you hear, and something the camera or controller does.

| Action | See | Hear | Feel |
|---|---|---|---|
| Fire | Muzzle flash light for one frame, tracer on one round in three, casing | Shot plus a room-matched tail | Recoil kick, viewmodel kick |
| Hit an enemy | Hit marker, blood or sparks by material, the enemy flinching | Impact by material, a hit tick | Short controller pulse |
| Take damage | Direction indicator, red vignette | Impact, a grunt | Camera shake scaled to damage |
| Land | Dust | Land sound by surface and speed | Camera dip |
| Explosion | Flash, fireball, smoke 5–10 s, debris, scorch | Delayed by distance at 343 m/s | Shake falling off with distance |

- **One tracer in three.** With a tracer on every round, Squad's bursts read as bars of light. Every shot still flashes and kicks dust.
- **Don't hide the payoff.** In Air Strike, smoke hid the building's collapse until it was darkened and thinned. And the missiles came in from behind the block, so the charges landed outside the facade and the collapse began 10 s late; moving the approach put them inside the ground storey and the block drops 3 s after impact. Check that a scripted moment happens where the camera is looking.

## First person

- One set of arms: the arms viewmodel with the local body hidden, or the full body from the head socket with the head and eyes masked (`colorWrite` and `depthWrite` off). Never both.
- The viewmodel draws last, through the overlay, with its own 56° FOV. The rifle sits lower right at about 30% of a 16:9 width. Sprint lowers and cants the weapon with bob and roll rather than swinging full-body sprint poses across the screen.
- On narrow screens, widen the vertical FOV to hold horizontal coverage, for the world and the viewmodel: below 4:3 for split views, below 0.8 aspect for portrait phones (`portraitFov`). The hip framing slides inward on portrait, with a lens offset that fades to zero in ADS so the sights stay centred.
