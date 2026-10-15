# Migration map

| Previous path or command | Current path or command | Reason |
| --- | --- | --- |
| `skills/stack/scripts/scaffold.mjs` | `blacksite scaffold` / `cli/scaffold.mjs` | The deterministic tool runs from the repository clone without a skill path. |
| `skills/make-game/scripts/budget-check.mjs` | `blacksite budget` / `cli/budget-check.mjs` | Budget checks have a stable command. |
| `skills/stack/assets/starters/{tpp,fpp,blank}` | `templates/game-shell` | One navigable game shell, with controller prototypes added by profile. |
| `skills/stack/assets/{lint,loading,monorepo}` | `templates/{lint,loading,monorepo}` | Scaffold support stays beside the game template. |
| `skills/stack`, `skills/game-design`, `skills/prototypes`, `skills/orchestrate`, `skills/kit`, `skills/architecture` | Phase skills plus `game-architecture`, `blacksite-kit`, and `game-assets` | One skill per phase or shared reference. |
| `blacksite prototype combine` | `blacksite prototype promote` | Promotion copies proven modes into `src/game/`. |
| ALS-bound first-person controller | `@blacksite/subject-fpp` for solo FPP | Arms-only FPP no longer loads ALS; ALS Subject remains for ALS player bridges. |
| `@blacksite/operator`, `packages/operator` | `@blacksite/subject`, `packages/subject` | ALS-bound player controller and camera bridge. Exported `Operator` / `createOperator` become `Subject` / `createSubject`; the focused path is `/Subject`. |
| `@blacksite/operator-fpp`, `packages/operator-fpp` | `@blacksite/subject-fpp`, `packages/subject-fpp` | Arms-only FPP exports `StandaloneSubject` and keeps the intent contract. |
| `@blacksite/arsenal`, `packages/arsenal` | `@blacksite/armory`, `packages/armory` | Weapon runtime and presets retain their focused subpaths. |
| `@blacksite/rupture`, `packages/rupture` | `@blacksite/cascade`, `packages/cascade` | Destruction facade renamed; descriptive `destruction-*` internals keep their names and boundaries. |
| `blacksite prototype new --with rupture` | `blacksite prototype new --with cascade` | System kit follows the new public name. `fpp`, `tpp`, and `fpp-mp` profile names stay stable. |
| `labs/<name>/` | `chambers/<name>/` | Playable lab and benchmark scenes share one destination. |

The pnpm workspace/submodule consumption model remains stable. Existing consumers must update package names and imports when they advance their Blacksite submodule. Generated games keep their own existing layouts; only new scaffold output uses the game shell. See `README.md` for the current commands.
