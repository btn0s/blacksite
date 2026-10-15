# Capture: diorama 2.5D (HD-2D style)

Stage: capture. Profile: `2.5d`. Chamber: Diorama village.

Reference: [Lumina](https://gitlab.com/stubborn-hug/lumina) (three.js r186, WebGL2, plain JS, studied at `5044d1f`, October 2026). **It has no licence**, so it is all-rights-reserved: we take techniques, never code or shader text. Everything below is our own description of the ideas.

## The look, in order of impact

1. **Post stack carries most of it.** Hand-rolled passes in a half-float target with 4× MSAA:
   - half-res depth of field with a tilt-shift band around the focus distance, gather blur plus scattered bokeh sprites, in-focus pixels left untouched;
   - soft-knee bloom with threshold above 1.0, so only emissives and HDR effects glow;
   - ACES tone map, applied once;
   - grade pass: chromatic aberration, sharpen, white balance, contrast and saturation, teal shadows and warm highlights, vignette, grain stepped at 24 fps, 8×8 dither.
   - Focus follows the player's chest, not the camera target.
2. **Diorama camera.** Perspective (not orthographic): FOV about 28°, pitch about 32°, distance about 30 world units (zoom 18–42), yaw limited to ±60°.
3. **Billboard sprites in a real 3D world.** Characters are vertical quads rotated about Y by one shared camera-yaw uniform (no per-sprite CPU work). Terrain, stairs, cliffs, houses and props are real geometry.
4. **One texel density.** 16 texels per world unit everywhere, world-space UVs, nearest magnification. No pixel snapping or low-res render: the uniform texel size alone reads as pixel art. Sprites have no mipmaps; distant terrain does.
5. **Sprite lighting without normal maps.** The shading normal bends between "toward camera" and "up", plus a horizontal roundness term so side lights rim one edge, plus wrap diffuse so backlit sprites keep form.
6. **Sprite shadows.** A hidden duplicate quad turned to face the sun casts a full silhouette shadow; a lookup offset stops self-shadowing; an instanced blob shadow sits under the feet.
7. **Palette.** Hue-shifted ramps: shadows lean blue-violet, highlights warm yellow; outlines dark plum, never black.

## Lighting and atmosphere

- Time of day: 13 keyframes over 24 hours, smoothly interpolated, drive sky, sun or moon, hemisphere light, fog, exposure and shadow strength.
- One 2048² sun shadow map, PCF, centre snapped to whole shadow texels to stop shimmer; shadow frustum depth kept tight; shadow-only proxy geometry.
- At most 12 point lights, count fixed at load so shaders never recompile; on large levels a pool scores candidates every 0.2 s and cross-fades swaps over 0.35 s.
- Emissive window and lantern masks ramp with a night factor; flicker uses smooth noise.
- Fog starts at camera distance minus about 7 units, so the diorama stays crisp and the distance melts into the horizon colour.
- Effects: water (depth bands, shore/flow texture, pixel ripples, glints that bloom), waterfall, flame quantised to the texel grid and stepped at 12 fps, stateless GPU particle emitters, sun god-rays, gradient sky, atlas combat effects in one draw, decals draped over a height texture.

## Performance discipline

- Constant shader program keys and a warm-up that compiles every variant (including shadow depth and late effects) against the real render target; program count stays fixed for the session.
- Static props merged per material, big batches split with a k-d tree and culled by box (their biggest single win).
- Instanced foliage, particles and blob shadows; shared per-frame uniforms.
- Resolution governor: buffer capped near 2.1 MP, render scale stepped 0.7–1.0 from median GPU time.
- Level builds run as step generators in idle time.
- Movement is circle-vs-grid on XZ with a height lookup; no physics engine.

## Content and tooling

- Level format: JSON with a tile legend (top/side/lip textures, walkable, water, stairs), `tiles` and `heights` string grids, environment block (time, weather, camera, fog), typed objects; byte-stable serialisation.
- Editor: one state store with transactions and undo; tools work in a 2D map and a 3D viewport built with the game's own builders through a time-sliced job queue; F5 play-test.
- Agent support: onboarding and task playbooks, additive-only contracts, `window.__game` test hooks, a fixed-step deterministic mode, and a scripted headless harness that records screenshots and fps.
- Art is generated in code (no PNGs); Blacksite will import authored sprite sheets instead.

## Blacksite shape

| Lumina | Blacksite |
|---|---|
| `onBeforeCompile` string patches on Lambert materials | TSL node materials (WebGPU and WebGL2), so patches survive Three upgrades |
| Imperative classes | Koota traits for sprites, lights, time of day; render reads projections |
| Hand-rolled post passes | A `2.5d` post preset on the shared post stack, dialled by quality tier |
| Grid movement | Rapier 3D by default; grid + height controller as an option for tile games |
| Procedural art | Sprite-sheet import with texel-density check in the asset pipeline |
| Fixed 12-light count | Light pool as a shared capability, budget per quality tier |

Benchmark: Diorama village chamber, 120 fps desktop and 60 fps sustained mobile with the full post stack at the tier's resolution.
