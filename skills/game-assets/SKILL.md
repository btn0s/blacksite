---
name: game-assets
description: Reference for optional owned Fab and itch.io assets through the Blacksite CLI. Use when choosing, syncing, or installing content for a game.
---

# Game assets

Assets are optional. Agents call `blacksite assets list|search|suggest|add` and use only indexed metadata; credentials stay with the user's own terminal and the CLI. Never read credential files, print secrets, or copy purchased content into the repository.

If an index exists, run `blacksite assets suggest --idea "<idea>" --json`, search useful categories, propose one pick at a time, and install approved IDs with `blacksite assets add <id...> --project <dir> --json`. Done when the asset lock records selected assets.

If no index exists, use image generation or procedural, purpose-made visuals. If the user chooses to connect libraries, ask them to run `blacksite assets login fab|itch|all` and `blacksite assets sync` in their own terminal, then resume metadata search. Done when an asset path is selected without blocking game work.
