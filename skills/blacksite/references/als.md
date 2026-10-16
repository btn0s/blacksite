# ALS

Characters in Blacksite are driven by ALS Web, an MIT-licensed port of the ALS Refactored animation system to three.js: [github.com/btn0s/als-web](https://github.com/btn0s/als-web). It ships its own agent guide, so read that instead of guessing.

- **Where the guide is:** `vendor/als-web/docs/guide/` in Blacksite, or `vendor/blacksite/vendor/als-web/docs/guide/` in a generated game.
- **Where to start:** `overview.md` (who owns what, frame order, units), then the recipe for the task in `recipes/` (local, camera, weapon, montage, actions, remote, fpp-arms, foot-ik, lifecycle, performance), with `api.md` for imports and `gotchas.md` for symptoms.
- **Blacksite-specific:** for the check contract, apply a camera pose override at `ALS_FRAME_PRIORITY.Camera + 0.05`, before the look renders at priority 1 (see `verify.md`).
