# Process

The game-specific parts of the work: interviewing the user, sizing, the design and parts list, the project, prototypes, joining them, assets and shipping. Each step leaves a file, so the work can resume in a fresh context.

Sections: [Interview](#interview) · [Design files](#design-files) · [Set up](#set-up) · [Prototype](#prototype) · [Combine](#combine) · [Assets](#assets) · [Ship](#ship)

## Interview

Turn an idea into an approved `docs/game-design.md`, a `budget.config.json` and a set of prototype contracts. The user owns every product choice; you own the craft that makes their choice look shipped. Ask one question, record the answer, then ask the next. Never ask what you can answer from the idea, the code or the references; make the call, say it in one line and move on. Keep an undecided question open and marked as open; don't fill it in.

1. **Players.** Single-player or multiplayer. Ask this first; it picks the template.
2. **Camera.** First person, third person, top-down or another view.
3. **Fantasy.** One sentence the player would say: "I'm the last engineer holding a collapsing dam."
4. **Verbs.** The three to five things the player does every minute.
5. **The loop.** What the player does, what pushes back, and what they get for it, in one line.
6. **Pillars.** Three words the loop must deliver. Every later choice is checked against them.
7. **Target.** Desktop, phone or both. The answer sets the budget.
8. **Size.** Mechanic, Slice or Game (SKILL.md). Propose a Slice for anything bigger and say what it will prove.
9. **Kill list.** What the game deliberately won't have. Write it down; it's what keeps the build out of feature soup.

| Answer | Profile | Uses |
|---|---|---|
| Solo, first person | `fpp` | The Character Controller with `['arms']`: found arms, rifle and pistol through Armory. |
| Solo, third person | `tpp` | The Character Controller with `['shoulder']` (`building-blocks.md`). |
| Multiplayer, first or third person | `mp` | The controller with `['arms', 'shoulder']` under Replication, ALS remote bodies, Relay over Colyseus with an offline loopback, V switching the view. |
| Anything else | `blank` | A walker in the starter yard, with the look, input, sound and check already wired. |

Add Warden for squads, Cascade for destruction and Armory for weapons only where the design calls for them.

## Design files

- **The numbers first.** `src/game/model.ts` is a pure module with no rendering that holds the real numbers and rules: speeds, acceleration, jump apex, fire rate, damage, ranges, budgets and timings, taken from the references, not invented. Everything else imports it, including the check contract, so a wrong number has one place to fix.
- **The parts list is the scope.** Before building, write what the shipped version has, with a minimum count for each part, using the counts in `craft.md`, `sound.md` and `feel.md` for the kind of space, then add the game's own. Nothing goes in that isn't on it, and nothing on it is skipped. For a Slice in a ruined yard: at least 3 light sources including 2 practicals, 4 surface materials, 12 prop types in clusters, decals on every wall at eye height, 3 sound layers (ambience, foley, events) and 2 enemy behaviours. `craft.md` has a full night-time car park.
- **Prototype contracts.** Split the loop into the parts nobody knows will work. For each, write the question playing it answers ("Does sliding under barriers feel fast enough to escape?"), its inputs and outputs, the Koota traits, XState events and Effect services it owns (`architecture.md`), and the numbers from the model it uses. A contract with no play question is a feature, not a prototype.
- `docs/game-design.md` holds the fantasy, verbs, loop, pillars, camera, target, size, kill list, the parts list, the prototypes, the assets and the open questions. `budget.config.json` is written by the scaffold; adjust its byte budgets only when the target demands it, and record why. Show the user the document and wait for approval before building.
- **Running the whole flow.** With `bb` available, build each prototype in its own worker thread and worktree; each brief restates the repository rules, the contract, the play question, the game path and the gate. Without `bb`, build them one after another. Clear context at a phase boundary if you need to; the files must be enough to resume.

## Set up

1. Run `blacksite doctor`. It checks Node, pnpm, git, bb and the assets tool.
2. Run `blacksite scaffold --profile <fpp|tpp|mp|blank> --name "<name>" --dir <absolute-dir> --json --gate`. The NDJSON stream ends in `ok` when the shell is installed and `pnpm check` passed. Use `--systems armory,warden,cascade` to add systems, and `blacksite new … --assets id,...` to install owned assets in the same step.
3. Copy the approved `docs/game-design.md` into the project.
4. Run `pnpm build` and `blacksite check dist`. A fresh scaffold passes every check on desktop; this is the bar the game has to stay at.
5. Put the design's numbers into `src/game/model.ts` before writing gameplay code.

What the scaffold contains, file by file, is in [building-blocks.md](building-blocks.md#the-scaffold). Done when `pnpm check` and `blacksite check dist` pass, every route opens, and `pnpm dev --host 0.0.0.0` serves the shell; with bb, `bb connect expose 5173` gives the user a link.

## Prototype

Build one risky mechanic on its own, playable from the developer menu, and answer its play question.

1. Read the contract in `docs/game-design.md` and the reference for each block it uses.
2. Run `blacksite prototype new <name> --with <kit> --project <dir>`: `fpp` (arms-only Subject and Armory, first person), `tpp` or `als-tpp` (the ALS body and camera), `mp` (a Colyseus room with an offline loopback and a switchable camera), or `subject`, `armory`, `warden`, `cascade` (adds that package and its closure, with an empty mode). It writes `src/prototypes/<name>/mode.tsx` and `docs/prototypes/<name>.md`.
3. Build the shipped version of the mechanic, not a placeholder: its row from SKILL.md's table, its feedback, its sound. A prototype that only proves the logic answers the wrong question, because feel is the question.
4. Keep the contract current: inputs, outputs, traits, events, services, state, and what playing it revealed.
5. Run `pnpm check`, play it, and run `blacksite check` on its page with `--only feel,perf`. Write the answer to the play question in the contract.

Rules that came from prototypes:

- **Load on demand.** Each prototype is its own chunk. When the ALS viewmodel brought the whole animation graph into the `fpp` and `mp` scaffolds, the fix was to load gameplay scenes on demand, not to raise the bundle budget.
- **One copy of every runtime.** A generated game once loaded a second, uninitialized Rapier, and camera collision queries failed silently. Another threw `rawshape_ball` until Vite pre-bundled Rapier once. Check that three, React, React Three Fiber and Rapier each resolve once.
- **Fix vendored errors where they live.** A jump between walk and run speed threw inside the ALS runtime, and each throw skipped a frame. The fix went into the pinned fork. Don't catch or ignore a throw from a vendored runtime.

Done when the mode is playable from the developer menu, the gate passes, and the contract records a concrete answer.

## Combine

Promote the prototypes that worked into one loop reachable from Main menu → Play.

1. Read every `docs/prototypes/<name>.md`. On paper, give every trait, event, service, input and piece of state exactly one owner (`architecture.md`). Two prototypes that both read the mouse, or both own the player's position, will fight (`feel.md`: one owner for the view, one set of arms, frame order).
2. Run `blacksite prototype promote <name...> --project <dir>`. It copies the prototypes into `src/game/` and writes a combined `src/game/mode.tsx` and `docs/prototypes/promotion.md`.
3. Join them in one session: one Koota world, one tick, one input owner, one camera owner. Move every shared number into `src/game/model.ts`.
4. Dress the space against the parts list and make it live (`craft.md`). This is where a set of mechanics becomes a game.
5. Run `pnpm check` and `blacksite check`, play the loop end to end, and record what changed from the contracts in `docs/prototypes/promotion.md`.

Done when Main menu → Play reaches the whole loop, the gates pass, and every part on the parts list is in.

## Assets

Use packs the user already owns from Fab or itch.io through the `blacksite assets` commands, which search an index of metadata and install what the user picks. Assets are optional: a game can ship on procedural geometry, the world kit's CC0 surfaces and synthesized sound.

- Use only the CLI's indexed metadata: `blacksite assets list|search|suggest|formats|add`. Credentials stay with the user's terminal and the CLI, which never prints them. Never read credential stores or any file whose name contains login, token, secret, key or credential.
- Never copy purchased content into a repository, a public site or a shared example. Purchased assets install into the user's own game and stay out of version control unless the user says otherwise.
- Anything you ship publicly needs a licence that allows redistribution: CC0 is best, CC-BY with credit is fine. Record each one with its source, author and licence.

With an index (`blacksite assets list --json` shows one):

1. `blacksite assets suggest --idea "<idea>" --json` gives the top five per role: characters, environments, models, animations, materials, VFX, audio and UI.
2. `blacksite assets search "<query>" --category <role> --json` narrows a role.
3. Propose one pick at a time, with what it adds to the parts list. Wait for the user's choice.
4. `blacksite assets add <id...> --project <absolute-dir> --json` installs the approved ones and records them in `assets.lock.json`.

Convert what you install to the budget's formats: KTX2 textures and meshopt-compressed glTF (`performance.md`).

Without one, plan procedural or purpose-made visuals, CC0 textures and synthesized sound, and name each gap in the design without blocking work on it. If the user wants to connect their libraries, ask them to run `blacksite assets login fab|itch|all` and `blacksite assets sync` in their own terminal, then continue with the index.

## Ship

Deploy only when the user asks, to a target they name.

1. Run `pnpm check` and `blacksite check` on the production build. Confirm the environment, the domain and that the user has granted access. Nothing goes live without that.
2. **A single-player game** is static: deploy `dist/` as Cloudflare Workers static assets.
3. **A multiplayer game** serves the client the same way and routes `/relay` through Workers VPC → Cloudflare Tunnel → a Docker container running the Colyseus match server (Hetzner is the reference host). Keep the public path and `VITE_RELAY_URL` aligned.
4. Open the live URL, play the main menu and the loop with the user, and hand it over.

The deploy templates are incomplete. `templates/deploy/` (Dockerfile, compose.yaml, wrangler.jsonc, worker.ts, deploy.mjs) is a starting point, not a working pipeline:

- The Dockerfile runs `pnpm server:start`, which no scaffold defines. Add it (`tsx server/index.ts`).
- `worker.ts` proxies `/api/` and `/room/`, not `/relay`.
- `wrangler.jsonc` declares no binding for the game server.
- `deploy.mjs` only builds.

Relay v0 has no interest management, lag compensation, reconnection or clock sync (`multiplayer.md`). Tell the user before calling a multiplayer game ready for strangers. Done when the live URL works on desktop and phone, and the user has it.
