# Sound

Sound is part of the scene's structure. A finished space has a continuous bed, located spot sounds, body foley, event cues, and a tail that tells the player what room they are in. Build those layers with `@blacksite/soundscape`. Read `packages/soundscape/AGENTS.md` for the mental model, public API, recipes, and symptom fixes.

## Start with the scene parts list

| Layer | What the player hears | Typical source |
|---|---|---|
| Bed | Continuous air or room tone that crosses zone boundaries smoothly | Wind, rain, ventilation |
| Spot | Loops and occasional calls at places in the world | Generator, creaking metal, distant dogs |
| Foley | The player and other bodies | Surface footsteps at foot plants, landing, cloth |
| Events | Actions and their results | Gunfire, impacts, doors, explosions |
| Interface | Dry, centred confirmation | Menu actions, hit markers |
| Music and voice | Story and direction, with priority over the bed | Score, dialogue |

For a Slice, list at least a bed, a spot emitter, two event families, surface foley and the acoustic zones before building. Make every action audible as well as visible and tactile. Keep the sound budget in the same model as the game's other budgets.

## The standard path

Create one Soundscape mixer for the game. Call `prepare()` while the scene loads, then `start()` from the first click, key, or touch. Update the listener pose from the game camera each frame; set the current zone as the listener crosses its boundary; play cues by name from animation and game events. Pass a world position for spatial sounds. A local interface cue has no position. Expose `soundscape.sample()` as the check contract's `audio()` and set `model.budget.voices` to the game's voice cap.

The package starts with synthetic variants for rifle and pistol shots, impacts and footsteps by surface, casing foley, and wind. These make a new scene audible without downloading recordings. Add content by registering cue data rather than building a new audio graph beside the mixer. A cue may contain layered transients, body, and tail, while one play chooses one variant. Keep the source name stable so the audio check can detect repetition.

Footsteps come from animation foot plants, with a surface tag supplied by the world. Use concrete, metal, wood, dirt, and water where the geometry warrants them. Scale landing sounds by fall speed. Armory's `shot`, `reload-started`, `switch-started`, `trigger-blocked`, and `impact` events are the weapon hooks. Cascade's destruction events drive debris and collapse cues. Relay's `shot` and `hit` messages drive remote combat cues.

## Acoustic rules

- A repeated cue has at least three variants. The default pitch jitter is about ±5% and volume jitter about ±1.5 dB. Selection must not play the same variant twice in a row. A cooldown prevents an event stream from becoming a buzz.
- World sounds attenuate by cue class. The desktop tier uses HRTF or stereo panning; the phone tier uses a cheaper path and a lower voice cap. The caller provides a ray test for occlusion; the mixer lowers gain and rolls off high frequencies when blocked.
- The listener's zone sets the convolution tail. A loud shot in a room takes on that room's tail; outside it keeps an open-air response. Procedural small-room, corridor, hall, and outdoor impulses are defaults. Recorded, redistributable impulses can replace them later.
- Delay far events at 343 m/s. A flash 200 m away arrives about 0.58 s before its sound. Avoid that delay for the player's own gun and other immediate feedback.
- Prioritise voice and nearby, loud action over distant detail. Virtualise inaudible sources. When the cap is reached, steal a low-priority voice with a short fade; do not cut a gunshot transient abruptly.
- Send every cue through the named buses: master, sfx, weapons, ambience, music, ui, and voice. Weapons duck ambience; dialogue ducks the other buses. The master ends in a limiter.

## Provenance and verification

Synthesised content can ship with the repository. Ship a recording or impulse response only with a redistributable licence and credit it in `site/public/CREDITS.md`. Do not copy a sound from a purchased pack into a public game.

Run `blacksite check <url> --only audio` on desktop and phone. Its `audio()` poll reports active voice peak and back-to-back sample repeats. A pass proves the cap and selector behaviour; listen to the mix, spatial image, reverb, and phone speaker on real devices as well. The [verification reference](verify.md) explains the check contract and reports.
