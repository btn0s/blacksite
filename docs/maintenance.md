# Maintenance notes

Blacksite uses pnpm 11.25.0 with a committed lockfile. Update dependencies through pnpm, then run typecheck, boundaries, touched Vitest suites, and the production build. Games pin the Blacksite Git submodule commit and update it deliberately.

Cascade retains the patched Rapier 0.19.2-rupture.4 tarballs and `vendor/rapier/build.mjs`; these are the exception to stock game-facing Rapier. `rapier-host` supplies stock 0.21 to the cross-version host tests. ALS is a separate pinned Git submodule. Automatic pnpm peer installation is disabled so local Cascade resolves the root patched build; consuming games satisfy the package peer with stock Rapier.
