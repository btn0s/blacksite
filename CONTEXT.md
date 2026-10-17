# Blacksite vocabulary

Blacksite is a system of agent skills and building blocks (source packages in a pnpm workspace) for making browser games. The CLI and Claude plugin are both named `blacksite`.

System names describe gameplay capabilities: Subject owns player input and camera intent, Armory owns weapon rules, Warden owns squad AI, and Cascade owns structural destruction. Subject's Character Controller is the one player controller for every character game, built on the ALS character. Cascade's `destruction-*` and Warden's `ai-*` packages are descriptive internals, not separate system brands.

Platform packages use plain names such as `ui`, `input`, `client-r3f`, `sim-core`, and `server`. They remain headless or narrowly scoped and do not take a game theme or product opinion.

Relay v0 is the replication and transport seam in `packages/relay`; `packages/protocol` holds shared room messages. Sector (world streaming and terrain), Scanner (significance and LOD), Flare (GPU VFX), and Horde (crowds) remain roadmap names. Playable proof and benchmark scenes belong in `chambers/`.
