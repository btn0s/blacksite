# Player templates

| Profile | Use when | Current state |
| --- | --- | --- |
| `fpp` | Single-player first person; arms-only `@blacksite/subject-fpp` + Armory, without ALS | Usable |
| `tpp` | Single-player third person; ALS body and camera | Usable |
| `mp` | Multiplayer FPP/TPP; local arms, remote ALS bodies, Colyseus and offline loopback | Usable v0 |
| `blank` | Empty game shell for a custom player | Usable |

The CLI scaffolds `mp` with a local Colyseus room under `pnpm dev`; Play joins through the same-origin `/relay` path and Offline uses loopback. Open a second tab to join the online room. The local camera starts in FPP with rigged ALS arms (rifle and pistol; see [arms](arms.md)), and V switches to TPP while the canvas has focus even without pointer lock; set `cameraMode="fpp"` or `cameraMode="tpp"` on `MultiplayerSubject` to lock a game's camera. Remote players always use ALS bodies, and camera choice stays local. Vite accepts `*.getbb.app` and `*.ts.net` preview hosts by default; `VITE_ALLOWED_HOSTS` adds comma-separated hostnames. `VITE_RELAY_URL` overrides the room endpoint for another deployment topology. [Game architecture](../skills/game-architecture/SKILL.md) explains the ownership model and transport choices. For a static two-player demo, mount `LoopbackSplitView` from `@blacksite/subject`; it creates two connections through `createLoopbackRoom()` from `@blacksite/relay` and renders both canvases. Relay v0 has full snapshots, owner movement, and Armory-validated hits; see [Relay limits](../packages/relay/AGENTS.md).
