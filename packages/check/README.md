# @blacksite/check

Headless checks that end in numbers: frame time, hitches, pop-in, movement feel, critic captures, audio voices, z-fighting and a stress run that fails on the first error.

```sh
blacksite check http://localhost:4173/ --out shots/check
blacksite check dist --only feel,pop --profile desktop
```

A game opts in by exposing the contract once its first playable frame is on screen:

```ts
import { applyCameraPose, exposeCheck } from '@blacksite/check'

const check = exposeCheck({
  bookmarks: [{ name: 'spawn', position: [-4, 2, 0], target: [12, 1, 0] }, { name: 'street', position: [40, 2, 3], target: [82, 9, -6] }],
  camera(pose) { override = pose },
  player() { return { position: body.translation() } },
  input: { move: 'KeyW', sprint: 'ShiftLeft', jump: 'Space' },
  character: player.check,
  model: { feel: { moveSpeed: 4.5, sprintSpeed: 6.5, jumpApex: 1.1 }, budget: { frameMs: 8.3 } },
})
check.ready()
```

Each frame, while `override` is set, call `applyCameraPose(camera, override, size)` after the game's camera and before render.

Results go to `report.json` with `critic/`, `pop/`, `pop-sheet.png` and `pop-still.png` beside it. Chrome comes from the system install, or from `CHROME_PATH`. See `skills/blacksite/references/verify.md` for every check, its threshold and how to read it.

## Z-fighting

`blacksite check … --only zfight` renders an object-ID buffer at every bookmark with sub-pixel jitter and tiny camera nudges, using the game's own materials, render target and depth format, and rings the pixels whose winning ID flips (`zfight/<profile>-<bookmark>.png`). `blacksite lint <dir|url|file.glb>` does the same job without rendering: it finds near-coplanar triangle pairs with a BVH and asks whether the gap between them is under what the depth buffer resolves at the distance each bookmark sees them.

```ts
import { lintZFighting } from '@blacksite/check'

const report = lintZFighting(scene, { cameras: bookmarks, near: 0.1, far: 400, bits: 24 })
if (!report.pass) throw new Error(report.problems.map(problem => problem.labels.join(' / ')).join('\n'))
```

Input is any `THREE.Object3D`, including a `LevelBuilder` level; a glTF is read with `blacksite lint scene.glb`. Reversed, logarithmic, float and orthographic depth are modelled. Meshes that don't write depth are only compared with meshes that do; faces pointing away from every bookmark are ignored; `material.userData.decalBias` (set by `decalBias()` in `@blacksite/look/world`) is credited against the gap. Meshes whose transforms live on the GPU (pooled batched meshes) are skipped and counted under `skipped.pooled`.
