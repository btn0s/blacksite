# Wind

One wind for the whole world. Grass, tree crowns, impostors, particles and the ambience all read the same field, so a gust is a thing with a place and a speed: you see it cross the meadow, hear it rise around you, and watch it reach the trees. Separate sine waves per system move everything at once and read as a screensaver. `@blacksite/landscape` provides the field as `createWind`; `examples/valley/` wires every consumer to it.

## Guides

- `packages/landscape/AGENTS.md`: the wind API and how the shaders include it.
- `examples/valley/src/Landscape.tsx` (grass, trees, impostors) and `src/audio.ts` (the wind and leaves beds).
- `foliage.md` and `far-field.md` for the consumers, `sound.md` for the beds.

## The field

`createWind(BREEZE)` returns one `Wind`. `BREEZE` is `{ direction: [0.8, -0.6], strength: 0.45, gust: 0.75, gustScale: 38, gustSpeed: 7 }`: a steady breeze, gusts about 38 m across, travelling downwind at 7 m/s.

- **Strength = base sway + travelling gusts.** `sample(x, z)` returns `strength × sway + gust × gust(x, z)`. Sway is a slow swell with a phase that moves along the wind direction; `gust(x, z)` is two octaves of value noise scrolled downwind and passed through a smoothstep, so gusts are separate patches with calm between them.
- **CPU and GPU agree.** `WIND_GLSL` defines `windAt(xz)` and `windGustAt(xz)` with the same hash, noise and constants as `sample` and `gust`. Merge `wind.uniforms` into a material's uniforms and prepend `NOISE_GLSL` and `WIND_GLSL`; `patchMaterial` does this cleanly for stock materials. A sound, a particle and a blade at the same spot therefore see the same gust at the same moment.
- **One clock.** Call `wind.update(dt)` once per frame, before the systems that read it. It clamps `dt` to 0.1 s so a stalled tab doesn't jump the gusts. Set `wind.frozen = true` to hold the field still for shimmer captures; the shaders keep the frozen time.
- **Change weather by data.** `wind.set({ strength, gust })` retunes the field live: lower both for a calm morning, raise both for a storm. Keep each preset in `src/game/model.ts`.

## Consumers

| Consumer | What it reads | What it does |
|---|---|---|
| Grass and flowers (`createCover`) | `windAt` at the blade root | Bends the blade downwind, quadratic with height, and flutters it sideways at a per-blade rate. The tip drops as it bends so blades keep their length. |
| Tree meshes (`createForest`) | `windAt` at the tree root | Sways the trunk downwind, weighted by the `treeWind` attribute, and flutters branches and leaves at a per-tree phase. Shadow depth materials run the same motion, so shadows move with the crowns. |
| Impostors | `windAt` at the tree root | Sways the top of the quad by the same field, so a far tree moves like the near one it replaced. |
| Particles | `sample` and `gust` on the CPU, or `windAt` in the shader | Drift pollen, leaves, dust and smoke downwind, faster in gusts. |
| Soundscape beds | `sample` and `gust` at the listener | Sets the wind bed's volume from the local strength, and a leaves bed from gusts under the canopy. |

The audio side in Valley: the wind bed sits at `0.25 + strength × 0.7` and the leaves bed at `canopy × (0.2 + gust × 0.9)`, quantised to 1/50 and faded over 0.35–0.5 s so the mixer isn't touched every frame. Register the bed as a looping `ambience` cue and change its volume through the returned handle (`sound.md`).

## Standard use

```ts
import { BREEZE, createWind } from '@blacksite/landscape'

const wind = createWind(BREEZE)
const cover = createCover({ terrain: terrain.uniforms, wind, families, heightAt })
const forest = createForest({ renderer, wind, species, ... })

function frame(dt: number) {
  wind.update(dt)
  cover.update(camera)
  forest.update(camera)
  sound.listen(camera.position, forward, wind, canopy, dt)
}
```

## What isn't there yet

- No particle system in the package; a game's particles read the field as above.
- No wind on cloth, flags or the player; wire them to `sample` the same way.
- No direction change over time; `set` swaps it instantly, so ease it over several seconds yourself.

## Rules

- **One field.** If two systems keep their own wind, they will disagree in the first gust. Pass the same `Wind` everywhere.
- **Gusts travel.** A gust that appears everywhere at once is a global timer. Check that you can watch one cross the meadow.
- **Sound follows the same gust.** The bed reads the field at the listener, so the wind gets louder exactly when the grass at your feet bends.
- **Freeze for measurements, never for the player.** Shimmer and pop captures freeze the wind; play never does.
