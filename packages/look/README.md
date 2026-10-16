# @blacksite/look

A post-processing and atmosphere stack for three.js: HDR composer, ambient occlusion, bloom, a single grade pass, linear or exponential fog, and a procedural overcast sky. It works with vanilla three and with React Three Fiber. three is a peer dependency; `react` and `@react-three/fiber` are optional peers used only by `@blacksite/look/r3f`.

## Pipeline

`EffectComposer` (HalfFloat buffers, MSAA by tier) runs `RenderPass`, `N8AOPostPass` (half resolution, depth-aware upsampling, radius 0.35, intensity 1.8, one denoise iteration), `BloomEffect` (intensity 0.8, threshold 1.35, smoothing 0.2, radius 0.45, mipmap blur), then `GradeEffect`. The grade applies exposure, a shoulder tonemap (linear to 0.72, exponential roll-off above), an optional 3D LUT in display space, night split toning, vignette, chromatic aberration and film grain. `createLook` sets `renderer.toneMapping = NoToneMapping`, because the shoulder is the tonemapper, and restores the previous value on `dispose()`.

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
- `createAtmosphere(scene, renderer)` is the plain-three overcast sky, sun and fog the showcases use without the composer; `internalPixelRatio()`, `isTouchDevice()`, `setAnisotropy()`, `preloadSurfaces()` and `texturesReady()` cover loading and resolution.

Credits for the textures are in `assets/world/CREDITS.md`.

## Atmospheres

An `Atmosphere` is plain data: `exposure`; `fog` as `{ color, near, far }` (`Fog`) or `{ color, density }` (`FogExp2`); `sky` as `{ zenith, horizon, ground, overcast }`; `sun` as `{ color, direction, strength }`; `fill` as `{ sky, ground, strength }`; and `grade` as `{ lut, vignette, split, aberration, grain }`. Colours are linear RGB triples. Set `grade.lut` to a `.cube` URL or `null`.

| Preset | Feel | Exposure | Fog | Sky overcast | Sun | Grade |
| --- | --- | --- | --- | --- | --- | --- |
| `zone` (`ZONE`) | Cold overcast grey-green ruins | 1.12 | linear 14 to 150, `[0.34, 0.37, 0.35]` | 0.85 | strength 1.5, pale | `luts/zone.cube`, vignette 0.38, aberration 0.12, grain 0.035 |
| `haze` (`HAZE`) | Warm late-afternoon haze | 1.08 | exp2 density 0.011, `[0.55, 0.5, 0.37]` | 0.25 | strength 3.4, amber, low | `luts/haze.cube`, vignette 0.42, aberration 0.1, grain 0.025 |

The sky dome is a back-faced unit sphere drawn at the far plane, so its size never fights the camera. It blends horizon to zenith, projects three-octave fbm cloud cover onto the dome, thins the cover toward the sun, adds a sun glow and disc when the overcast is low, and fades below the horizon into the ground colour. `createSky`, `createSkyMaterial` and `bakeSkyEnvironment` are exported for scenes that manage their own composer.

## Quality tiers

| Tier | MSAA | AO | Bloom | Aberration | Grain | Max pixel ratio |
| --- | --- | --- | --- | --- | --- | --- |
| `high` | 4 | half res, 8 samples | 8 mip levels | on | on | 2 |
| `medium` | 2 | half res, 4 samples | 5 mip levels | on | on | 1.5 |
| `low` | 0 | off | off | off | on | 1.25 |

`autoQuality()` returns `low` for a coarse pointer or a screen smaller than 600 px, `medium` for four or fewer cores, and `high` otherwise. The targets are 120 fps on desktop and 60 fps on phones. The look does not change the renderer pixel ratio; cap it with `QUALITY[tier].maxPixelRatio`.

## LUTs

`luts/zone.cube` and `luts/haze.cube` are generated in this repository by `scripts/make-lut.mjs`. The script grades display-referred input with a luminance-weighted shadow, mid and highlight tint, saturation that keeps the warm-olive band, a green lift on warm hues, a lifted toe, an S-curve and a soft highlight shoulder. Regenerate with `node packages/look/scripts/make-lut.mjs all [size]` (default size 33) or one preset by name. Load any `.cube` with `loadLut(url)` or `parseLut(text)`.
