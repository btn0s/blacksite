---
name: ship-game
description: Deploy a verified Blacksite game and provide its live URL. Use only after the user asks to ship or deploy.
---

# Ship game

1. Run `pnpm check` and confirm the requested environment, domain, and deployment access with the user. Done when the gate passes and the target is specified.
2. For a static game, deploy built assets to Cloudflare Workers static assets. For multiplayer, route Colyseus through Workers VPC → Tunnel → Docker on Hetzner using the game deployment template. Done when deployment completes.
3. Open the live URL and verify the main menu and core loop with the user. Done when the URL works and is handed over.
