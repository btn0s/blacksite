# Blacksite

**Skills and building blocks that let game-dev agents build seriously good browser games.**

A coding agent can write a game loop. What it can't do in an afternoon is write a character with hundreds of animations, multiplayer that feels right, buildings that collapse, or squads that flank you, and keep all of it at 120 fps on a desktop and 60 fps on a phone. Blacksite gives the agent two things:

- **One skill** teaches the agent to build the version of each feature that shipped games built, not the tutorial version: footsteps that follow the feet, fog that layers the distance, enemies that react a beat late. It sizes the work, writes the real numbers down first, lists the parts a shipped game has, builds them and checks the result like a critic. Every building block also has a reference, so the agent uses it the right way instead of guessing.
- **Building blocks** are finished game systems the agent snaps together instead of writing from scratch.

You describe the game. The agent builds it with these.

[See the demos](https://blacksite-sable.vercel.app)

## Quickstart

```sh
curl -fsSL https://raw.githubusercontent.com/btn0s/blacksite/main/install.sh | sh
```

Then describe a game to your agent. The skill loads by itself for anything game-related; in Claude Code you can also run `/blacksite:blacksite <your idea>`. The installer clones this repository into `~/.blacksite` and puts `blacksite` on your PATH. On Windows, run [install.ps1](install.ps1) in PowerShell. An agent installing it can follow [AGENTS.md](AGENTS.md).

## The skill

`skills/blacksite/` is the whole skill: a [SKILL.md](skills/blacksite/SKILL.md) the agent always reads, and references it loads when the work calls for them.

| Reference | What the agent does with it |
| --- | --- |
| `design`, `setup`, `prototype`, `combine`, `optimise`, `ship` | The workflow: interview one question at a time, create the project, build each risky mechanic alone, join what works, bring it within budget, and deploy only when you ask. |
| `craft`, `feel`, `sound`, `performance` | How a shipped game is lit, dressed, tuned and mixed, with numbers, and what gives way first when the frame is over budget. |
| `characters`, `als`, `weapons`, `ai`, `destruction`, `multiplayer`, `input` | One per building block, pointing to its guide, with its numbers, its gaps and the failures that shaped it. |
| `architecture`, `assets`, `catalog` | Who owns which state, how to use assets you already own, and every package and command. |
| `verify` | `blacksite check`: frame time, hitches, pop-in, movement feel, audio repeats and critic captures on desktop and phone. |

```mermaid
flowchart LR
  A[Size] --> B[Truth]
  B --> C[Parts list]
  C --> D[Build]
  D --> E[Make it live]
  E --> F[Verify]
  F -. only on request .-> G[Ship]
```

Each step writes a file into the game project, and the work ends with checks the agent has to pass, so you can stop and resume anywhere.

## Building blocks

| Block | What it gives your game | Status |
| --- | --- | --- |
| [Player templates](docs/player-templates.md) | Ready-to-play starting points: `fpp` (first person), `tpp` (third person), `mp` (multiplayer, switch views with V), `blank` | Usable |
| Characters (ALS Web) | A full animated character: walk, run, sprint, crouch, mantle, roll, ragdoll, aim. A port of ALS Refactored. | Usable |
| First-person arms | Rigged, animated arms holding a rifle or pistol | Usable |
| Weapons (Armory) | Firing, reloading, aiming and recoil, with hits the server can check | Usable |
| Multiplayer (Relay) | Rooms on Colyseus, or in one browser tab for demos and tests; other players animate like the local one | Usable v0 |
| Destruction (Cascade) | Concrete buildings that crack and collapse, simulated off the main thread | Experimental |
| AI (Warden) | Squads that take cover, flank and coordinate | Experimental |
| Input and UI | Keyboard, mouse, gamepad and touch; menus, pause and settings screens | Usable |
| Assets | Use art you already own from Fab or itch.io, compressed for the web | Experimental |

Every project also gets the same base: React Three Fiber for rendering, Rapier for physics, Koota for game state, XState for flow, Effect for services, Vite for the dev server.

## Using the CLI directly

Agents call these for you, but you can too:

- `blacksite scaffold --profile fpp|tpp|mp|blank --name "My Game" --dir /absolute/path` creates a game.
- `blacksite prototype new <name> [--with als-tpp|fpp|warden|cascade]` adds a prototype; `list` and `promote` manage them.
- `blacksite assets login fab|itch|all`, then `blacksite assets sync`, connects art you own.
- `blacksite --help` lists everything.

## Roadmap

Now: demos for every block, guides for the remaining blocks, touch controls for the player templates, and measurement on real devices. Next: automatic quality settings, so games hold their frame rate on any device without extra work. Later: open worlds, bigger destruction, crowds, larger multiplayer, and 2.5D/2D. See [ROADMAP.md](ROADMAP.md).

## Repository layout

`skills/` holds the skill; `packages/` the building blocks; `templates/` the player templates and game shell; `cli/` the `blacksite` command; `site/` the demo site; `docs/` longer guides; `evals/` agent test scenarios.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for workspace layout and gates.

## License

Blacksite uses the [Functional Source License 1.1 with Apache-2.0 future license](LICENSE.md). You may use, modify, and ship games with it, including closed-source commercial games. You may not offer Blacksite or a substitute as a competing product. Each release converts to Apache-2.0 two years after that release is made available.
