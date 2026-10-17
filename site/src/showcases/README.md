# Showcases

A showcase is one live demo on a tool page. Adding one touches only its own files.

## Files

- `site/src/showcases/<name>/`: the code. Put everything for the demo here.
- `site/src/showcases/<name>/meta.ts`: the registration. Its folder name is the showcase id.
- `site/frames/<name>.html`: the page the tool page embeds. It must use the same name as the folder.

The frame is a full-screen page with one root and one module script:

```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,user-scalable=no"><meta name="theme-color" content="#0d0f0c"><title>Squad · AI · Blacksite</title></head><body><div id="root"></div><script type="module" src="../src/showcases/squad/main.tsx"></script></body></html>
```

The build picks up every `site/frames/*.html` automatically, so `site/vite.config.ts` needs no edit.

## Registration

`meta.ts` exports one `showcase`. The registry finds it with `import.meta.glob`, so no shell file changes:

```ts
import type { Showcase } from '../registry'

export const showcase: Showcase = {
  tool: 'ai',
  title: 'Squad',
  summary: 'Watch two squads take cover and flank each other across a container yard.',
  tryThis: 'Click a soldier to follow them, or press T for the tactical view.',
  thumbnail: 'thumbs/ai.webp',
  keyboard: [{ action: 'Follow a soldier', keys: ['Click'] }],
  touch: [{ action: 'Follow a soldier', keys: ['Tap'] }],
}
```

- `tool` is the tool slug: `characters`, `destruction`, `weapons`, `multiplayer`, `ai` or `input`.
- `summary` says what the demo is and `tryThis` gives one thing to do in it. The tool page shows `summary` under the demo's name and `tryThis` as a caption under the stage; the home page shows only `summary`. Write `summary` as one plain sentence about what you do in the game, with no measurements, and keep `tryThis` short.
- `keyboard` and `touch` fill the "?" panel in the corner of the canvas. Keep the in-canvas `Hints` to five keys or fewer.
- `thumbnail` is a 1600×900 WebP in `site/public/thumbs/`. It is the poster before the demo starts and the image for the tool's share card. When you add or change a thumbnail, run `pnpm meta:images` to rebuild the 1200×630 share images in `site/public/og/`. The site tests fail until you do.
- `order` sorts several showcases on one tool page. Each one gets a name, its summary, a full-width stage and a Play button.

Registered showcases replace the old demos listed in `content.ts` for that tool.

## Look

- `@blacksite/look` handles fog, sky and post. With React Three Fiber use `<Look atmosphere="zone" quality={autoQuality()} />` from `@blacksite/look/r3f`. With plain three use `createLook(renderer, scene, camera, { atmosphere: 'zone', quality: autoQuality() })`, then call `look.render(dt)` instead of `renderer.render`.
- `@blacksite/look/world` has the CC0 surfaces: `surface()`, plus `meterSurface()` for geometry with UVs in metres. It also has the ground material, `internalPixelRatio()`, the `LevelBuilder` for level geometry, and the ruins props: apartment blocks, Ladas, sheds, trees and the APC.

## HUD and touch

`@blacksite/ui/hud` provides:

- `Screen`, a wrapper that adds grain and the vignette;
- `TitleCard`, the small in-canvas tag, for example `AI · Squad`;
- `Hints`, one line that fades;
- `Prompt` and `Loading`;
- `Status` and `Actions`, for buttons in the bottom-right corner;
- `TouchPad` and `useTouch`, the stick, look area and buttons for phones.

## Rules

- Use public `@blacksite/*` packages only.
- Call `attachPerfProbe(renderer)` from `@blacksite/ui/perf-overlay` so the page shows the frame rate.
- Hold 120 fps on desktop and 60 fps on phones. Every demo must be playable with touch at 390 px wide.
- Only use CC0 assets. Record each one in `site/public/CREDITS.md`.
- Do not edit the shell: `content.ts`, the pages, `site.css` and `vite.config.ts`.
