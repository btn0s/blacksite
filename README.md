# Blacksite

**The game-dev instincts your coding agent is missing.**

Blacksite gives your agents best practices from real games, top-quality examples to learn from, and building blocks to build on.

Blacksite covers characters with hundreds of animations, multiplayer, buildings that collapse and squads that flank you, at 120 fps on a desktop and 60 fps on a phone. It gives the agent:

- **One skill.** `SKILL.md` is what the agent reads for anything about a game. It tells the agent what each feature includes in real games: footsteps triggered by the feet, 3 to 5 samples per surface and never the same one twice; enemies with a 0.2 s reaction delay and aim that starts wide. Guides by area cover how the player moves, how combat and enemies read, how a game should sound, how a scene is lit, how a world reaches the horizon, how to keep every frame smooth on a phone, and how to wire each building block.
- **Building blocks.** Finished game systems the agent builds your game from.
- **Templates, an open asset library and checks.** Four starting projects, 146 open-licence assets, and `blacksite check`, which measures a running game on desktop and phone.
- **Example games.** Breach, Traverse and Valley, each built only on the public packages.

[See the demos](https://blacksite-sable.vercel.app)

## Quickstart

```sh
curl -fsSL https://raw.githubusercontent.com/btn0s/blacksite/main/install.sh | sh
```

Then describe a game to your agent. The skill loads by itself for anything game-related; in Claude Code you can also run `/blacksite:blacksite <your idea>`. The installer clones this repository into `~/.blacksite` and puts `blacksite` on your PATH. On Windows, run [install.ps1](install.ps1) in PowerShell. If you added the skill with `npx skills add btn0s/blacksite`, install the rest with `sh -s -- --skip-agents` at the end of the command above (or `install.ps1 --skip-agents`), so the installer doesn't register a second copy of the skill. An agent installing it can follow [AGENTS.md](AGENTS.md).

## The skill

`skills/blacksite/` is the whole skill: a [SKILL.md](skills/blacksite/SKILL.md) the agent always reads, and references it loads when the work calls for them.

| Reference | What the agent does with it |
| --- | --- |
| `design`, `setup`, `prototype`, `combine`, `optimise`, `ship` | The workflow: interview one question at a time, create the project, build each risky mechanic alone, join what works, bring it within budget, and deploy only when you ask. |
| `craft`, `feel`, `sound`, `performance` | How to light, dress, tune and mix a game, with exact values, and what to cut first when a frame takes too long. |
| `characters`, `als`, `weapons`, `ai`, `destruction`, `multiplayer`, `input` | One per building block, pointing to its guide, with its settings, its gaps and the failures that shaped it. |
| `architecture`, `assets`, `catalog` | Who owns which state, how to use assets you already own, and every package and command. |
| `verify` | `blacksite check`: how long frames take, frames over 33 ms, objects that appear late, movement speed, sounds that repeat, and screenshots to review, on desktop and phone. |

The agent asks one question at a time and sizes the job, writes the game's speeds, ranges and frame times into one file, lists the parts the finished scene needs, builds the risky parts alone and joins them, makes the scene move and make sound, and checks its own work before it hands you a link. It deploys only when you ask. Each step writes a file into the game project, so you can stop and resume anywhere.

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
