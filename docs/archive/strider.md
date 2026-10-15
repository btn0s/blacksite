# ALS integration

The ALS runtime lives in the pinned `vendor/als-web` Git submodule (`als-ue5-r3f`), not in a Blacksite package. Operator uses `als-ue5-r3f/app/AlsPlayer` and `als-ue5-r3f/engine/alsFramePipeline`.

A consuming game adds the Blacksite submodule recursively and includes both `vendor/blacksite/packages/operator` and `vendor/blacksite/vendor/als-web` in its `pnpm-workspace.yaml`. Declare `@blacksite/operator` and `als-ue5-r3f` as `workspace:*` dependencies and import from their source exports.

ALS model and audio assets remain in the ALS submodule. Serve that submodule's `public/assets` at `/assets` when mounting its scene. The pinned ALS commit exposes a player command bridge. Its exported `Character` input source does not consume all of the former Strider bridge's jump and ragdoll commands.
