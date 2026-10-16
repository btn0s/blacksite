# Sound

Half of how a game feels is how it sounds, and a silent scene is the fastest way to read as unfinished. There is no Blacksite audio package yet: the ALS footstep runtime is the only packaged sound. Build a small mixer in the game; the showcases' synthesizers are the reference (`site/src/showcases/firing-range/audio.ts`, `squad/fx.ts`, `multiplayer/audio.ts`).

## The layers

| Layer | What | Example |
|---|---|---|
| Bed | A continuous ambience per space, crossfaded over 1–2 s at boundaries | Wind, room tone, rain, distant city |
| Spot | Looping sources placed in the world, panned and attenuated | A humming light, a generator, a radio |
| Foley | The player's body | Footsteps per surface, cloth on turns, breathing after sprint |
| Events | Actions and their results | Shots, impacts, reloads, explosions, doors |
| Interface | Menus, hit markers, pickups | Short, dry, centred |
| Music | Optional, and ducked under events | |

## Rules

- **Never the same sample twice in a row.** Give every repeated cue 3–5 variants, chosen without immediate repeats (the ALS footstep runtime's selector does this), with ±5% pitch and ±2 dB of random volume. `blacksite check --only audio` fails a cue that repeats a sample back to back.
- **Footsteps come from the animation.** Trigger them on foot plants, by surface, and scale the landing sound by fall speed. The ALS character emits plants through `footstepSoundSink`; `AlsFootstepAudioRuntime` plays them with distance attenuation.
- **Sound travels at 343 m/s.** Delay distant events by distance over 343, low-pass them with distance, and lower their gain. An explosion 200 m away arrives 0.6 s after its flash, and that gap sells the distance.
- **Cap voices at 32.** Count active voices; when over the cap, drop the quietest or farthest. Squad caps gunfire at 15 voices.
- **Match the space.** Shots in a room get a short bright tail; outdoors a long slap off distant walls. The Firing Range builds a convolution reverb procedurally.
- **Compress the master.** A `DynamicsCompressor` before the master gain keeps a firefight from clipping.
- **Unlock on the first gesture.** Browsers start audio suspended. Resume the context on the first click, key or touch.

## Provenance

Ship only sound you can prove you may redistribute, or synthesize it. Cascade's walk mode shipped silent because nobody could establish where its footstep recordings came from. The Firing Range and Squad then synthesized every sound in WebAudio (shots, room reverb and slap, ringing steel, casings and foley) with distance delay at 343 m/s. CC0 recordings are fine; record them in the credits. Owned packs are in `assets.md`.

## Hooks

Armory's `shot`, `reload-started`, `switch-started`, `trigger-blocked` and `impact` events and Relay's `shot` and `hit` messages are where weapon sound attaches. Cascade's frame events (`DestructionEvent`) drive debris and collapse sound.

## Verify

Expose `audio()` in the check contract with `createAudioLog()` from `@blacksite/check`: call `start(cue, sample)` and `end()` from the mixer. The check reports peak voices and back-to-back repeats. Mixing balance and spatial sense are for the user, in headphones.
