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

`createLook` returns `{ composer, grade, sky, atmosphere, quality, render(dt), setSize(w, h, updateStyle?), setAtmosphere(atmosphere | name), setQuality(tier), setAberration(extra), dispose() }`. Options: `atmosphere` (default `'zone'`), `quality` (default `autoQuality()`), `sky` (default true; adds the dome to the scene), `environment` (default false; PMREM-bakes the sky into `scene.environment`), `fog` (default true), `sun` (a `DirectionalLight` to drive) and `fill` (a `HemisphereLight` to drive).

## React Three Fiber

```tsx
import { Canvas } from '@react-three/fiber'
import { Look } from '@blacksite/look/r3f'

<Canvas dpr={[1, QUALITY[tier].maxPixelRatio]}>
  <Look atmosphere="zone" quality={tier} environment aberration={hit} />
  <World />
</Canvas>
```

`<Look>` creates the stack on mount, follows the canvas size and pixel ratio, and renders with `useFrame` priority 1, so R3F stops its own render. Props mirror the options above plus `aberration` and `onReady(look)`.

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
