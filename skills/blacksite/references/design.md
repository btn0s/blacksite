# Design

Turn an idea into an approved `docs/game-design.md`, a `budget.config.json` and a set of prototype contracts. The user owns every product choice; you own the craft that makes their choice look shipped.

## The interview

Ask one question, record the answer, then ask the next. Never ask what you can answer from the idea, the code or the references. Make the call, say it in one line and move on.

1. **Players.** Single-player or multiplayer. Ask this first; it picks the template.
2. **Camera.** First person, third person, top-down or another view.
3. **Fantasy.** One sentence the player would say: "I'm the last engineer holding a collapsing dam."
4. **Verbs.** The three to five things the player does every minute.
5. **The loop.** What the player does, what pushes back, and what they get for it, in one line.
6. **Pillars.** Three words the loop must deliver. Every later choice is checked against them.
7. **Target.** Desktop, phone or both. The answer sets the budget.
8. **Size.** Mechanic, Slice or Game (see SKILL.md). Propose a Slice for anything bigger and say what it will prove.
9. **Kill list.** What the game deliberately won't have. Write it down; it's what keeps the build out of feature soup.

Keep a question open, marked as open, if the user hasn't decided. Don't fill it in.

## Pick the template

| Answer | Profile | Uses |
|---|---|---|
| Solo, first person | `fpp` | Arms-only `@blacksite/subject-fpp` and Armory. Bring your own character physics; the standalone subject has no gravity or collision. |
| Solo, third person | `tpp` | The ALS body and camera. Read `als.md`. |
| Multiplayer, first or third person | `mp` | Local arms, ALS remote bodies, Relay over Colyseus with an offline loopback, V switching the view. |
| Anything else | `blank` | The shell with an empty scene. |

Add Warden for squads, Cascade for destruction and Armory for weapons only where the design calls for them.

## The parts list

Write the shipped version's parts with a minimum count each, before anything is built. It is the scope. Use the counts in `craft.md`, `sound.md` and `feel.md` for the kind of space, then add the game's own. A Slice in a night-time car park, for example:

| Part | Minimum |
|---|---|
| Light sources | 1 moon key, 4 sodium practicals, 1 flashlight, emissive signage |
| Surface materials | Asphalt, wet asphalt, concrete, painted lines, metal |
| Prop types | 12, in clusters of 3–7: cars, barriers, bins, cones, pillars, pipes |
| Decals | Oil stains, tyre marks, graffiti, cracks: every wall and floor at eye height |
| Motion | Rain, fluttering tape, flickering tube, idle on every character |
| Sound layers | Rain bed, distant traffic, hum from the lights, footsteps per surface, events |
| Enemy behaviours | Patrol, investigate a sound, search, attack |
| Feedback per action | A sound, a particle and a camera response on every verb |

## Prototype contracts

Split the loop into the parts nobody knows will work, and build each as its own prototype. For each, write:

- **The question** playing it answers: "Does sliding under barriers feel fast enough to escape?"
- **Inputs and outputs**: what it reads and what it changes.
- **Koota traits, XState events and Effect services** it owns (`architecture.md`).
- **The numbers** from `src/game/model.ts` that it uses.

A prototype contract with no play question is a feature, not a prototype.

## Assets

If `blacksite assets list --json` shows a synced index, read `assets.md` and propose one pick at a time. Otherwise plan procedural or purpose-made visuals, CC0 textures, and synthesized sound. Name each gap in the design without blocking work on it.

## The files

`docs/game-design.md` holds: the fantasy, verbs, loop, pillars, camera, target, size, kill list, the parts list, the prototypes, the assets and the open questions. `budget.config.json` is written by the scaffold; adjust its byte budgets only when the target demands it, and record why. Show the user the document and wait for approval before building.

## Running the whole flow

With `bb` available, build each prototype in its own worker thread and worktree. Each brief restates the repository rules, the contract, the play question, the game path and the gate. Collect the files and the answers. Without `bb`, build them one after another. Clear context at a phase boundary if you need to; the files must be enough to resume.
