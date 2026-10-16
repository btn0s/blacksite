# @blacksite/check

Headless checks that end in numbers: frame time, hitches, pop-in, movement feel, critic captures and audio voices.

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
  model: { feel: { moveSpeed: 4.5, sprintSpeed: 6.5, jumpApex: 1.1 }, budget: { frameMs: 8.3 } },
})
check.ready()
```

Each frame, while `override` is set, call `applyCameraPose(camera, override, size)` after the game's camera and before render.

Results go to `report.json` with `critic/`, `pop/`, `pop-sheet.png` and `pop-still.png` beside it. Chrome comes from the system install, or from `CHROME_PATH`. See `skills/blacksite/references/verify.md` for every check, its threshold and how to read it.
