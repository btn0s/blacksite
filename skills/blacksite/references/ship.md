# Ship

Deploy only when the user asks, to a target they name.

1. Run `pnpm check` and `blacksite check` on the production build. Confirm the environment, the domain and that the user has granted access. Nothing goes live without that.
2. **A single-player game** is static: deploy `dist/` as Cloudflare Workers static assets.
3. **A multiplayer game** serves the client the same way and routes `/relay` through Workers VPC → Cloudflare Tunnel → a Docker container running the Colyseus match server (Hetzner is the reference host). Keep the public path and `VITE_RELAY_URL` aligned.
4. Open the live URL, play the main menu and the loop with the user, and hand it over.

## The deploy templates are incomplete

`templates/deploy/` (Dockerfile, compose.yaml, wrangler.jsonc, worker.ts, deploy.mjs) is a starting point, not a working pipeline. Check each piece before relying on it:

- The Dockerfile runs `pnpm server:start`, which no scaffold defines. Add it (`tsx server/index.ts`).
- `worker.ts` proxies `/api/` and `/room/`, not `/relay`.
- `wrangler.jsonc` declares no binding for the game server.
- `deploy.mjs` only builds.

Relay v0 has no interest management, lag compensation, reconnection or clock sync (`multiplayer.md`). Tell the user before calling a multiplayer game ready for strangers.

## Done when

The live URL works on desktop and phone, and the user has it.
