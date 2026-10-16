# Combine

Promote the prototypes that worked into one loop reachable from Main menu → Play.

1. Read every `docs/prototypes/<name>.md`. On paper, give every trait, event, service, input and piece of state exactly one owner (`architecture.md`). Two prototypes that both read the mouse, or both own the player's position, will fight.
2. Run `blacksite prototype promote <name...> --project <dir>`. It copies the prototypes into `src/game/` and writes a combined `src/game/mode.tsx` and `docs/prototypes/promotion.md`.
3. Join them in one session: one Koota world, one tick, one input owner, one camera owner. Move every shared number into `src/game/model.ts`.
4. Dress the space against the parts list and make it live (SKILL.md, steps 2 and 4). This is where a set of mechanics becomes a game.
5. Run `pnpm check` and `blacksite check`, play the loop end to end, and record what changed from the contracts in `docs/prototypes/promotion.md`.

## Ownership failures seen when combining

- **Two readers of the mouse.** Subject and the ALS camera each read the same mouse movement at different sensitivities. At 144 Hz render and 60 Hz physics the view sawtoothed by 1.748°. With one control-rotation source the error was below 1e-12°.
- **Two pairs of arms.** A first-person viewmodel was mounted while the full body stayed visible.
- **Frame order.** Physics must step before the pose and the camera, and held objects attach after the final camera. Done the other way, attachments lag one frame behind.

## Done when

Main menu → Play reaches the whole loop, the gates pass, and every part on the parts list is in.
