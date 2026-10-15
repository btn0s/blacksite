---
name: make-game
description: Make a playable Blacksite game from an idea or continue its design, prototype, integration, and optimization phases.
argument-hint: <idea>
---

# Make game

Use `$ARGUMENTS` as the initial idea. If empty, ask **What would you like to do?** with the `start` menu and wait for the user's choice. Keep this progress checklist visible and mark each phase complete only when its artifact and gate exist:

- [ ] User-approved `docs/game-design.md` and `budget.config.json`
- [ ] Navigable shell with `pnpm check` green
- [ ] Each prototype playable from the developer menu, documented, and green
- [ ] Promoted core loop playable from Main menu → Play, with gate green
- [ ] Budget check green and playable link delivered

1. Call the Skill tool with "design-game". Pass the idea and persist decisions in `docs/game-design.md`. Done when the user approves the document.
2. Call the Skill tool with "setup-project". Carry the design file into the generated project. Done when `pnpm check` passes and the shell navigates.
3. For each design prototype, Call the Skill tool with "build-prototype". If `bb` is available, create one BB worker thread per prototype in its own worktree with full permissions; each brief restates repository rules, contract, design question, game path, and gate. Collect files and results. Otherwise build sequentially. Done when every selected prototype has a playable mode and contract document.
4. Call the Skill tool with "combine-prototypes". Done when Main menu → Play reaches the complete core loop and the gate passes.
5. Call the Skill tool with "optimize-game". Start `pnpm dev --host 0.0.0.0`, use `bb connect expose 5173` when available, and hand the user the playable URL and controls. Done when the budget passes and the user can open the link.
6. Call the Skill tool with "ship-game" only when the user requests deployment. Done when the requested live URL works.

Each phase uses its files as the next phase's handoff. Clear context at a phase boundary if needed; the files must be sufficient to resume.
