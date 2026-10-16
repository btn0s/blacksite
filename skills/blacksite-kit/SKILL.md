---
name: blacksite-kit
description: Blacksite package, template, and CLI catalog for choosing game systems. Use when exploring the kit or choosing a prototype system.
---

# Blacksite kit

Run `blacksite catalog --json` for the live catalog and read `catalog.md` here for its release snapshot. Call the Skill tool with "game-architecture" before wiring systems. Select Subject, Armory, Warden, and Cascade by gameplay need; keep platform packages such as UI, input, client, sim, and server independent of those themes. Relay v0 supplies Colyseus and loopback for `mp`; Sector, Scanner, Flare, and Horde remain roadmap names. Done when each selected kit piece has a concrete use in the design or prototype contract.

Call the Skill tool with "als" when selecting `tpp`, `mp`, or Subject's ALS body; follow the consumer recipe before wiring input, camera or replication.

Regenerate the snapshot with `node scripts/generate-kit.mjs` before release. Done when the generated catalog matches the command output.
