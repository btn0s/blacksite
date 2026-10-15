# Contributing

Blacksite is a pnpm source workspace. Put reusable engine systems in `packages/`, deterministic agent tools in `cli/`, the generated game shell in `templates/`, phase skills in `skills/`, and design guidance in `docs/`. Games consume this repository as one recursive Git submodule and list only needed package paths in their workspaces.

Use Node 22.12 or newer and pnpm. Initialize `vendor/als-web` before installing. Run `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm check:boundaries`, and the touched engine package Vitest suites. Keep Cascade's invariant suite green. Run `pnpm build` for bundle changes and `pnpm build:asset-ports` after changing either asset port source. For tools and skills, run `node scripts/check-skills.mjs`, `node scripts/generate-kit.mjs`, `claude plugin validate .`, and scaffold a disposable game with `--gate`.

Engine packages use small contract tests. Generated game templates contain no tests or code comments. Do not commit generated builds or purchased assets. The patched Rapier tarballs under `vendor/rapier` are retained for Cascade development; generated games use stock Rapier.
