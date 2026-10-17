# Player templates

| Profile | Use when | Game mode |
| --- | --- | --- |
| `fpp` | Single-player first person | The Character Controller with `views: ['arms']`, found arms, rifle and pistol |
| `tpp` | Single-player third person | The Character Controller with `views: ['shoulder']` |
| `mp` | Multiplayer first and third person | The Character Controller with `views: ['arms', 'shoulder']` inside `Replication`, remote ALS bodies, Colyseus and the offline loopback |
| `blank` | A custom player | The template walker in the starter yard |

Every profile scaffolds the same shared parts in `src/game/`: `model.ts` (feel and budget numbers, read by the game and the check), `input.ts` (one `@blacksite/input` context for keyboard, mouse, gamepad and touch), `stage.tsx` (the canvas, `@blacksite/look` with `autoQuality()`, fixed-step physics and the starter yard), `check.tsx` (the `window.__blacksite` contract), `sound.ts` (`@blacksite/soundscape`) and `hud.tsx` (hints, the click-to-play prompt and touch controls). The game boots straight into play; Pause holds Settings, Main menu and the prototypes. A fresh scaffold passes `pnpm check` and `blacksite check dist` on desktop. See [Set up](../skills/blacksite/references/process.md#set-up).

The CLI scaffolds `mp` with a local Colyseus room under `pnpm dev`; Play joins through the same-origin `/relay` path and falls back to the loopback when the room is unreachable. A production build without `VITE_RELAY_URL` plays on the loopback; set it to the deployed room endpoint. Open a second tab to join the online room. The local camera starts in first person with found arms (rifle and pistol; see [arms](arms.md)), and V switches to the shoulder view; list one view in `views` to lock a game's camera. Remote players always use ALS bodies holding their current weapon, and camera choice stays local. Vite accepts `*.getbb.app` and `*.ts.net` preview hosts by default; `VITE_ALLOWED_HOSTS` adds comma-separated hostnames. [Game architecture](../skills/blacksite/references/architecture.md) explains the ownership model and transport choices. For a static demo, connect through `createLoopbackRoom()` from `@blacksite/relay`; the arena showcase runs a second, bot-driven controller on the same loopback room. Relay v0 has full snapshots, owner movement, and Armory-validated hits; see [Relay limits](../packages/relay/AGENTS.md).
