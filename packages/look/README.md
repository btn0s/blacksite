# @blacksite/look

A post-processing and atmosphere stack for three.js: HDR composer, ambient occlusion, bloom, a single grade pass, linear or exponential fog, and a procedural overcast sky. It works with vanilla three and with React Three Fiber. three is a peer dependency; `react` and `@react-three/fiber` are optional peers used only by `@blacksite/look/r3f`.

## Pipeline

`EffectComposer` (HalfFloat buffers, MSAA by tier) runs `RenderPass`, `N8AOPostPass` (half resolution, depth-aware upsampling, radius 0.35, intensity 1.8, one denoise iteration), `BloomEffect` (intensity 0.8, threshold 1.35, smoothing 0.2, radius 0.45, mipmap blur), then `GradeEffect`. The grade applies exposure, a shoulder tonemap (linear to 0.72, exponential roll-off above), an optional 3D LUT in display space, night split toning, vignette, chromatic aberration and film grain. The grade is the only tonemapper and `atmosphere.exposure` the only exposure: `createLook` sets `renderer.toneMapping = NoToneMapping` and restores the previous value on `dispose()`, and nothing else in the package touches tone mapping. To change exposure, pass an atmosphere with your own value, such as `{ ...ZONE, exposure: 1.22 }`. `renderer.toneMappingExposure` has no effect while the composer runs, because the scene renders into the composer's buffers.

## Vanilla three

```ts
import { createLook } from '@blacksite/look'

const look = createLook(renderer, scene, camera, { atmosphere: 'zone', quality: 'high', environment: true, sun, fill })
look.setSize(innerWidth, innerHeight)

renderer.setAnimationLoop(() => look.render(clock.getDelta()))
addEventListener('resize', () => look.setSize(innerWidth, innerHeight))

look.setAberration(0.8)
look.setAtmosphere('haze')
look.setQuality('low')
look.dispose()
```

`createLook` returns `{ composer, grade, sky, atmosphere, quality, render(dt), setSize(w, h, updateStyle?), setAtmosphere(atmosphere | name), setQuality(tier), setAberration(extra), addOverlay(scene, camera), dispose() }`. Options: `atmosphere` (default `'zone'`), `quality` (default `autoQuality()`), `sky` (default true; adds the dome to the scene), `environment` (default false; PMREM-bakes the sky into `scene.environment`), `fog` (default true), `sun` (a `DirectionalLight` to drive) and `fill` (a `HemisphereLight` to drive).

## Broad textured surfaces

Use `applyStochasticTiling` by default on broad unstructured surfaces such as mud, concrete, asphalt, rust, plaster and forest floor. Repeating one photographed patch over a large floor produces an obvious grid even when the source is seamless. Keep the source's metre scale and break its repetition with transformed patches:

```ts
import { applyStochasticTiling } from '@blacksite/look'

const ground = new MeshStandardMaterial({ map: colour, normalMap: normal, roughnessMap: orm, metalnessMap: orm, aoMap: orm })
const removeStochasticTiling = applyStochasticTiling(ground)
```

All maps must use `RepeatWrapping`, the same UV channel and the same repeat/offset/rotation transform. Set those transforms before applying the helper. Colour uses the usual sRGB texture setting; normal and ORM use no colour space. The material keeps its physical texture scale. Three fixed patches blend on a triangular grid, with the same offsets, rotations and weights for colour, tangent-space normal and ORM. Each sampled normal's tangent XY is inverse-rotated after applying `normalScale`, including signed or unequal scales. Explicit rotated derivatives retain mip selection and anisotropic filtering across patch edges. Nothing changes over time.

`tileSpan` defaults to 1 source repeat per lattice edge; `blendSharpness` defaults to 4 to keep one patch dominant and limit blending softness; `seed` defaults to 0. `rotation` defaults to `'quarter-turn'` for irregular surfaces; `'half-turn'` permits only 0°/180°, and `'none'` uses offsets alone. Use `'none'` or `'half-turn'` on directional bark or grain so it never turns sideways. This is a lightweight three-patch blend, not histogram-preserving synthesis: transition regions can still soften high-contrast detail. Use `tileSpan` 0.5–2 and avoid excessive sharpness, which exposes patch edges. No additional texture files or dependencies are needed. Colour + normal + packed ORM costs 9 texture reads per fragment, versus 5 for the stock material; shared ORM sources with matching sampling settings are sampled once. Separate ORM sources cost up to 15 reads. Use it on broad surfaces where repetition is visible and retain ordinary sampling on small props and material swatches.

Keep authored brick, tile, paver, plank, corrugated sheet and grate patterns ordered. The directional modes preserve course orientation, but random offsets can still break joints. For continuous authored joints, keep ordinary sampling and break repetition through material variants, macro wear or decals. The asset viewer enables **Reduce tiling** by default for unstructured floors and disables it for ordered surfaces; the switch supports a comparison at the same camera position.

The helper supports `MeshStandardMaterial` with colour, tangent normal and ORM maps in `WebGLRenderer`. Separate bump, displacement, alpha and emissive maps are rejected because their features would lose alignment. It chains existing `onBeforeCompile` and cache hooks, accepts already-expanded stock sampling chunks, and returns an idempotent removal function. Hooks are not copied by Three's material cloning; apply the helper after cloning and after installing other hooks. Reapply after changing the material's map layout. Existing hooks must retain standard map UV/sampler names and the normal mapping expressions; unsupported replacements fail explicitly.

Float colour textures from `liveMaterial` use `DECODE_VIDEO_TEXTURE` to decode stored sRGB in the shader. The helper detects that define: it decodes each sampled colour before blending, then re-encodes the blend for the existing decode stage. This preserves both linear-light blending and the existing material hook's effect. Hardware-decoded sRGB textures use the cheaper ordinary path. If an older/custom hook decodes `sampledDiffuseColor` without that define, pass `{ shaderDecodesSRGB: true }`; this option describes an existing decode stage and does not add one. Every rotation/decode variant and the previous hook's cache identifier contribute to `customProgramCacheKey`.

The sampling layout follows the three-patch construction described by [Heitz and Neyret](https://eheitzresearch.wordpress.com/722-2/); the full histogram-preserving method and its preprocessing are described by [Deliot and Heitz](https://eheitzresearch.wordpress.com/738-2/). Shader integration uses Three's documented [material compilation and cache hooks](https://threejs.org/docs/pages/Material.html).

## Overlays

`addOverlay(scene, camera)` draws a second scene over the world, for a first-person viewmodel or held props. It runs after ambient occlusion and before bloom, so the overlay gets the same bloom, grade, vignette and grain as the world but no world AO. Depth is cleared first, so the overlay never clips into walls, and the overlay scene's background is ignored. It returns a function that removes the pass. Several overlays draw in the order they were added. Keep the overlay's lights in the overlay scene, and update its camera's aspect yourself.

```ts
const removeViewmodel = look.addOverlay(viewmodelScene, viewmodelCamera)
```

## Soft particles

`SoftParticles` from `@blacksite/look/soft` is the one way to draw dust, smoke, steam, ash, sparks and embers. It is a mesh of camera-facing quads; add it to your scene like any other object and the look's soft pass draws it after the scene render, depth-tested and faded against a copy of the frame's depth.

```ts
const dust = new SoftParticles({ capacity: 256 })
scene.add(dust)
dust.emit({ position, velocity, acceleration: { x: 0, y: 0.35, z: 0 }, drag: 2.2, life: 1.2, size: 0.3, grow: 2.7, opacity: 0.55, tint })
dust.advance(dt)
```

- Lighting: every particle is lit by the same lights as the surfaces around it (directional, point, spot, hemisphere, ambient and light probes, through three's light uniforms). Directional lights that cast shadows shade each particle by their shadow map, sampled once at its centre, so a puff in shade is not sunlit. Each quad is shaded as a soft sphere with wrapped diffuse and mild forward scattering, then fogged with `scene.fog`.
- Self-shadowing: each `SoftParticles` gathers its live particles into a 16³ density volume every frame and attenuates every light, and the sky and ground terms, by the transmittance through that volume between the particle and the light. A dense cloud lit by a fire inside it is bright on the fire-facing side and near the flames, and keeps its own colour in its body. Particles in different `SoftParticles` do not shadow each other, so one cloud is one instance. A field that is optically thin (under 1% mean optical depth through its thickest view, such as ash or motes) skips the volume. The cost is linear in live particles plus a fixed blur over the grid.
- Motion runs on the GPU from the spawn state: `velocity`, constant `acceleration` (gravity or buoyancy), and exponential `drag`, which damps all motion, so a particle settles at the terminal velocity `acceleration / drag`; dust that falls 5 m in 3 s at drag 1.4 has an acceleration of -3.05. `emit` writes one slot of a ring of `capacity` slots and uploads only the slots written that frame; `advance(dt)` moves the clock.
- Life: with `life > 0` a particle fades in over the first 8% of its life and out as `(1 - t)^1.5`, and its diameter grows from `size` to `size * (1 + grow)`.
- Over-life curves: `curve(keys)` registers a curve and returns its id; `emit({ ..., curve: id })` uses it. Each key has `at` (0 to 1 of life) and any of `color` (multiplies `tint`), `glow` and `opacity` (multiply the particle's values). Each channel interpolates linearly between the keys that set it; a channel no key sets keeps the default (colour 1, glow and opacity the fade above). With a white `tint`, colour keys are absolute: a flame goes white-hot, orange, then dark smoke by keying `color` and handing `glow` over to `opacity`. Curve 0 is the default. With `life <= 0` it lives until overwritten, for fields such as ash or motes. `delay` (seconds) starts its life later, for effects known ahead of time, such as a puff where a bullet will land.
- `opacity` is how much the particle hides what is behind it; `glow` adds `tint * glow` of emitted light, unlit and unshadowed. Dust has opacity and no glow; sparks and embers have glow and no opacity; both blend in one premultiplied pass.
- `stretch` (seconds) elongates the quad along its screen-space velocity, for sparks. `flutter` (metres) adds a slow seeded sway, for ash.
- `wrap(center, size)` keeps particles inside a box in the object's space, wrapping each axis with a non-zero size and fading them near its faces; pass `null` to stop. `still = true` freezes motion and growth for reduced motion. `reset()` empties the ring.
- Options: `capacity` (default 256), `softness` (contact fade depth as a fraction of the radius, default 1) and `scatter` (forward-scatter gain toward the light, default 0.8).

`surfaceAlbedo(hit)` from `@blacksite/look/world` returns the linear albedo under a raycast hit (material colour × texture mean × instance or vertex colour), for tinting what comes off a surface.

## React Three Fiber

```tsx
import { Canvas } from '@react-three/fiber'
import { Look } from '@blacksite/look/r3f'

<Canvas dpr={[1, QUALITY[tier].maxPixelRatio]}>
  <Look atmosphere="zone" quality={tier} environment aberration={hit} />
  <World />
</Canvas>
```

`<Look>` creates the stack on mount, follows the canvas size and pixel ratio, and renders with `useFrame` priority 1, so R3F stops its own render. Props mirror the options above plus `aberration`, `overlay` (`{ scene, camera }`, added with `addOverlay` and removed when it changes) and `onReady(look)`.

## World kit

`@blacksite/look/world` is the ruins kit the showcases and examples build from. Its CC0 photographic surfaces (`cast`, `panel`, `slab`, `stained`, `paint`, `brick`, `rust`, `metal`, `corrugated`, `asphalt`, `dirt`, `grass`, `gravel`) ship in `assets/world/` and resolve through bundler `?url` imports, so a game that depends on the package gets hashed copies in its build with no public folder to set up.

```ts
import { LevelBuilder, groundMaterial, worldPlaneGeometry, apartmentBlock, lada, texturesReady } from '@blacksite/look/world'

const level = new LevelBuilder()
level.box([4, 3, 0.3], { name: 'panel' }, { at: [0, 1.5, -6] })
apartmentBlock(level, { at: [-20, 0, -30], floors: 5, bays: 4, seed: 3 })
lada(level, [3, 0, 2], 1.1)
scene.add(level.build())
await texturesReady()
```

- `surface(name, options)` returns a cached `MeshStandardMaterial` with colour and normal maps and ground-height AO; `meterSurface()` is the same with UVs in metres for geometry you made yourself.
- `worldBoxGeometry`, `worldPlaneGeometry` and `worldCylinderGeometry` make primitives whose UVs tile at the surface's real size; `contactShadow` is a soft blob for anything resting on the ground.
- `groundMaterial()` blends dirt, grass and gravel by world-space noise; `puddleMaterial()` is a dark mirror for decals on it.
- `LevelBuilder` merges every box, cylinder and plane by material into one mesh each, adds contact shadows, and collects box and cylinder colliders for your physics.
- Props: `apartmentBlock`, `lada`, `shed`, `waterTower`, `apc`, `deadTree`.
- `createAtmosphere(scene, renderer)` is the world kit's photographic overcast sky dome, sun with a texel-snapped shadow that `follow(target)` moves, hemisphere fill and exponential fog. It leaves tone mapping and exposure to the look: pair it with `createLook(…, { sky: false, fog: false })` or `<Look sky={false} fog={false} />`. `internalPixelRatio()`, `isTouchDevice()`, `setAnisotropy()`, `preloadSurfaces()` and `texturesReady()` cover loading and resolution.

Credits for the textures are in `assets/world/CREDITS.md`.

## Atmospheres

An `Atmosphere` is plain data: `exposure`; `fog` as `{ color, near, far }` (`Fog`) or `{ color, density }` (`FogExp2`); `sky` as `{ zenith, horizon, ground, overcast }`; `sun` as `{ color, direction, strength }`; `fill` as `{ sky, ground, strength }`; and `grade` as `{ lut, vignette, split, aberration, grain }`, with optional `curve`, `saturation`, `bloom` and `tint` (a linear RGB multiplier applied before saturation). Colours are linear RGB triples. Set `grade.lut` to a `.cube` URL or `null`.

| Preset | Feel | Exposure | Fog | Sky overcast | Sun | Grade |
| --- | --- | --- | --- | --- | --- | --- |
| `zone` (`ZONE`) | Cold overcast grey-green ruins | 1.12 | linear 14 to 150, `[0.34, 0.37, 0.35]` | 0.85 | strength 1.5, pale | `luts/zone.cube`, vignette 0.38, aberration 0.12, grain 0.035 |
| `haze` (`HAZE`) | Warm late-afternoon haze | 1.08 | exp2 density 0.011, `[0.55, 0.5, 0.37]` | 0.25 | strength 3.4, amber, low | `luts/haze.cube`, vignette 0.42, aberration 0.1, grain 0.025 |
| `nature` (`NATURE`) | Warm, soft, filmic open country | 1.42 | physical: aerial perspective and height fog | creamy pale physical sky (`sky` 2.2, `clear` 1500 m) with cumulus, coverage 0.37 | physical, 5.5 illuminance, warm | filmic curve, `luts/nature.cube`, bloom 0.45, vignette 0.16, grain 0.006 |

The sky dome is a back-faced unit sphere drawn at the far plane, so its size never fights the camera. It blends horizon to zenith, projects three-octave fbm cloud cover onto the dome, thins the cover toward the sun, adds a sun glow and disc when the overcast is low, and fades below the horizon into the ground colour. `createSky`, `createSkyMaterial` and `bakeSkyEnvironment` are exported for scenes that manage their own composer.

Set `atmosphere.physical` and the look draws a physically based sky instead: transmittance, multiple-scattering and sky-view lookup tables, a cumulus cloud layer with billowed noise, lit tops and shaded bases near the horizon and analytic edge antialiasing, an environment baked from that sky, and an aerial-perspective pass that reads the depth buffer to add in-scattering and height fog to every surface, replacing three's fog. `createPhysicalSky`, `createAtmosphereLuts` and `AerialEffect` are exported. `physical.clear` (metres) keeps the first stretch of air in front of the camera free of haze, scaling optical depth by `1 - clear / distance`, so the middle distance keeps its contrast while far hills stay hazy. `physical.sky` brightens the visible sky and the ambient term of the clouds without changing the baked environment or the aerial in-scattering, so a paler sky does not wash out the land. The quality tier sets the lookup table sizes and cloud octaves. The technique is ported from web-ocean under MIT; see `NOTICE.md`.

## Quality tiers

| Tier | MSAA | AO | Bloom | Aberration | Grain | Max pixel ratio |
| --- | --- | --- | --- | --- | --- | --- |
| `high` | 4 | half res, 8 samples | 8 mip levels | on | on | 2 |
| `medium` | 2 | half res, 4 samples | 5 mip levels | on | on | 1.5 |
| `low` | 0 | off | off | off | on | 1.25 |

`autoQuality()` returns `low` for a coarse pointer or a screen smaller than 600 px, `medium` for four or fewer cores, and `high` otherwise. The targets are 120 fps on desktop and 60 fps on phones. The look does not change the renderer pixel ratio; cap it with `QUALITY[tier].maxPixelRatio`.

## LUTs

`luts/zone.cube`, `luts/haze.cube` and `luts/nature.cube` are generated in this repository by `scripts/make-lut.mjs`. The script grades display-referred input with a luminance-weighted shadow, mid and highlight tint, saturation that keeps the warm-olive band, a green lift on warm hues, an `olive` shift that pulls saturated greens toward olive, a lifted toe, an S-curve and a soft highlight shoulder. Regenerate with `node packages/look/scripts/make-lut.mjs all [size]` (default size 33) or one preset by name. Load any `.cube` with `loadLut(url)` or `parseLut(text)`.

## WebGPU

`@blacksite/look/webgpu` exports `createWebGPULook(renderer, scene, camera, options)`. Initialize a three `WebGPURenderer` with `trackTimestamp: true`, await the look, then call `look.render(delta)` each frame. `@blacksite/look/webgpu-r3f` provides `<WebGPULook onReady={look => ...} onError={error => ...} />` and owns rendering at priority 1. This entry requires WebGPU and a physical atmosphere; existing WebGL consumers use the original entry points.

The WebGPU chain uses three's native SunLight, GTAO, TRAA, bloom, Neutral tone mapping and LUT nodes. Its physical sky keeps the nature atmosphere's transmittance, multiple-scattering and sky-view tables, clouds and aerial/height fog as native WGSL nodes. The look owns lighting and exposure: `sunlight: { sunLux, skyLux, ev100 }` controls sun illuminance and environment irradiance, with the latter measured through three's LightProbeGenerator. `atmosphere.exposure` is the artistic exposure compensation. Camera options support temperature, tint, contrast, toe, shoulder and optional peripheral lens softness. Low quality keeps TRAA and the grade while omitting GTAO, bloom and lens blur.

`shadowMap` and `shadowDistance` set sun coverage. Native SunLight has two cascades on every tier. `shadowLayers` adds caster layers to the active view's layers on both native cascade cameras. The returned `sun` is available to vegetation and impostor lighting; it has a direction in `position`, with no target. LightProbeGrid's native node is registered for bounded, authored probe volumes; the open Valley uses its sky environment and does not bake a world-sized probe grid.

`look.timings()` returns GPU milliseconds by native render pass when timestamp queries are available, or `null` otherwise. Measurements use three's InspectorBase hooks and timestamp readback, never CPU submission duration. `look.setDebug(true)` selects an ungraded scene output for the host's LOD-colour materials. The host owns the pixel ratio, stats UI, technique controls and device reporting.
