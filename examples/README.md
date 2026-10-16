# Examples

Flagship games, one per popular game type. Each is the quality bar for its genre, built only on public Blacksite packages, the way your game would be built. Open the closest one before you start a game.

| Example | Type | Bar for |
| --- | --- | --- |
| `breach` | First-person shooter | Gun feel, impact feedback, squad AI |
| `traverse` | Third-person action | Character feel and camera |
| `blackout` | Horror / immersive | Lighting, sound and atmosphere |
| `arena` | Multiplayer | Netcode that feels local |
| `valley` | Open world | Streaming and scale |

Each example is a workspace package (`@blacksite/example-<name>`) that exports `mount(element)` and runs on its own with `pnpm --filter @blacksite/example-<name> dev`. The demo site embeds it.
