# Migrating to the Blacksite submodule

Add `https://github.com/btn0s/blacksite.git` as one recursive Git submodule. List only the Blacksite package paths your game uses in `pnpm-workspace.yaml`, plus `vendor/blacksite/vendor/als-web` if ALS is needed. Depend on `@blacksite/*` packages and `als-ue5-r3f` with `workspace:*`; imports resolve to source exports.

| Former source install | Workspace package |
| --- | --- |
| Warden | `@blacksite/warden`, `@blacksite/warden-react` |
| Operator → Subject | `@blacksite/subject` |
| Operator FPP → Subject FPP | `@blacksite/subject-fpp` |
| Arsenal → Armory | `@blacksite/armory` |
| Rupture → Cascade | `@blacksite/cascade` |
| ALS Web | `als-ue5-r3f` from `vendor/als-web` |

Keep the game on stock Rapier. Blacksite's patched Rapier tarballs are for Cascade development. Existing serialized replay formats remain stable. [The migration map](../MIGRATION.md) lists renamed package paths and exports.
