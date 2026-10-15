---
name: combine-prototypes
description: Promote proven Blacksite prototypes into one end-to-end core loop. Use after prototype contracts show what works.
---

# Combine prototypes

1. Read every selected `docs/prototypes/<name>.md` and Call the Skill tool with "game-architecture". Resolve shared trait names, events, services, input ownership, and state ownership on paper. Done when every interface has one owner.
2. Run `blacksite prototype promote <name...> --project <dir>`. Integrate promoted systems in `src/game/` so they share one session and the core loop flows end to end. Done when Main menu → Play reaches that loop.
3. Run `pnpm check` and play through the loop. Update `docs/prototypes/promotion.md` with changes from the contracts. Done when the gate passes and the combined loop works.
