# Blacksite Engine vocabulary

Blacksite Engine is a composable browser game engine consumed as source packages in a pnpm workspace. The CLI and Claude plugin are both named `blacksite`.

System names describe gameplay capabilities: Subject owns player input and camera intent, Armory owns weapon rules, Warden owns squad AI, and Cascade owns structural destruction. Subject FPP is the arms-only solo variant. Cascade's `destruction-*` and Warden's `ai-*` packages are descriptive internals, not separate system brands.

Platform packages use plain names such as `ui`, `input`, `client-r3f`, `sim-core`, and `server`. They remain headless or narrowly scoped and do not take a game theme or product opinion.

Relay (replication and transport adapters), Sector (world streaming and terrain), Scanner (significance and LOD), Flare (GPU VFX), and Horde (crowds) are roadmap names. No package exists for them yet. Playable proof and benchmark scenes belong in `chambers/`.
