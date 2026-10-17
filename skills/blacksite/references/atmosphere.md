# Atmosphere

The air between the camera and everything else: a sky lit by the sun, distance that turns blue and pale, haze that pools in valleys, and clouds with shape. Outdoors, atmosphere is what makes a kilometre read as a kilometre. Without it, a mountain at 5 km has the same contrast as a rock at 5 m, and the world reads as a model on a table. `@blacksite/look` owns it, as plain atmosphere data the post stack, sky, fog and lights all read.

## Guides

- `packages/look/README.md` and `packages/look/AGENTS.md`: the `Atmosphere` data, the presets, the sky, the quality tiers and the overlay.
- `examples/valley/src/atmosphere.ts` and `src/Game.tsx`: an open-world atmosphere and its `<Look>` wiring.
- `craft.md` for the key, fill and fog rules every scene follows; `far-field.md` for what the haze is hiding.

## Choose the preset

| Preset | For | Feel |
|---|---|---|
| `zone` | Ruins, yards, interiors, short sight lines | Cold overcast, linear fog from 14 to 150 m, a LUT grade with grain and aberration |
| `haze` | Warm late afternoon at street scale | Amber low sun, exponential fog, warm LUT |
| `nature` | Open landscapes: meadows, forests, mountains, kilometres of sight line | A scattering sky with a real sun and soft clouds, aerial perspective, valley height fog, a filmic curve, gentle warm and cool split and slightly lowered saturation |

`nature` is selected the same way as `zone` (`atmosphere="nature"` or `NATURE`). Its `physical` block is what switches on the scattering sky and the aerial perspective pass; `zone` and `haze` have none, so their pipeline is exactly what it was. Copy it and change the numbers rather than starting from scratch: `{ ...NATURE, physical: { ...NATURE.physical, mie: 7 } }`.

## Sky and sun

- **The sun is a direction, not a lamp.** One directional light whose direction, colour and strength come from the atmosphere; the sky's glow and disc sit exactly where it points. Pass your `DirectionalLight` and `HemisphereLight` to the look (`sun`, `fill`) so the atmosphere drives both.
- **Low sun, long shadows.** An elevation of 20–30° gives grazing light across terrain and back-lit grass (`foliage.md`). A noon sun flattens every slope.
- **Physically based scattering.** A clear sky is blue overhead and pale at the horizon because of scattering through more air, and it warms toward the sun near the horizon. With a `physical` block the look computes that once into small lookup tables (transmittance, multiple scattering, and a sky view redrawn only when the sun moves), so the per-pixel sky is a few texture reads. `rayleigh` deepens the blue; `mie` whitens the horizon and brightens the glow round the sun. A two-colour gradient is the cheap version.
- **Bake the sky into the environment.** `environment` on the look PMREM-bakes the sky into `scene.environment`, so every material picks up the sky's colour in its reflections and ambient light. Rebake when the sun moves far.

## Aerial perspective

Distance does three things to colour: contrast falls, colour shifts toward the sky's horizon colour, and the side facing the sun picks up warm in-scatter. With a `physical` block the look applies it to everything in one pass after ambient occlusion, reading depth: each pixel is dimmed by the air's transmittance along its ray and gains the sky's in-scattered light, so terrain, impostors and the far canopy all take the same haze for free. `aerial` scales the distance the air acts over; raise it for a hazier day. Without a `physical` block, exponential fog in a colour matching the horizon is the cheap version. A mountain range should step back in four or five clearly paler layers. If the third ridge has the same value as the first, the fog is too thin; if you can't see the second, it's too thick.

## Height fog

Air near the ground is denser. Height fog thickens toward low altitudes, so haze pools in valleys and thins over ridges, and a view down into a valley reads deeper than a view across it. `physical.heightFog` sets a density that falls off exponentially (`falloff`, metres) above a `base` height, integrated exactly along each ray in the same pass as the aerial perspective and lit by the sky and the sun. Hide the end of the terrain in it: the last terrain node should sit well inside full fog, never against the sky.

## Clouds

- **Shape, not texture.** Clouds need large, irregular masses with lit tops and darker bases, thinning toward the sun. A uniform noise cover reads as a texture glued to the sky. `physical.clouds` draws one layer on a sphere above the ground, self-shadowed toward the sun, with octaves that fade before they alias and an analytic edge so silhouettes stay smooth at any distance.
- **Motion.** Clouds drift with `clouds.wind`. A static sky is the first thing a still capture gives away.
- **They're far away.** Clouds sit behind the aerial perspective, so they fade and warm toward the horizon like the mountains.

## Standard use

```tsx
<Look atmosphere="nature" quality={tier} sky fog environment sun={sun} fill={fill} />
```

The quality tier sizes the sky view table, its ray-march steps, the cloud octaves and shadow taps. Phones run the low tier.

Keep the atmosphere in `src/game/atmosphere.ts` or the model, one per tier if the tiers differ. The look owns tone mapping and exposure (`craft.md`); never set them on the renderer.

## What isn't there yet

- One cloud layer, no high cirrus layer and no volumetric clouds.
- No cloud shadows on the ground.
- No temporal antialiasing. Foliage stays stable through MSAA with alpha-to-coverage and sharpened alpha (`foliage.md`); measure it with `blacksite check --only shimmer`.
- No time of day: move the sun yourself and rebake the environment.

## Rules

- **Fog colour matches the horizon.** A grey fog under a blue horizon draws a line around the world.
- **Every outdoor shot has fog between the camera and the far plane.** Including the meadow at your feet: a little haze at 200 m is what makes the forest at 600 m look far.
- **Judge the layers.** Read the valley and ridge captures for four or five distinct depth layers before touching the grade.
