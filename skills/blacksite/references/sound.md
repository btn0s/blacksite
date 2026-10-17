# Sound

Sound is part of the scene's structure. A finished space has a continuous bed, located spot sounds, body foley, event cues, and a tail that tells the player what room they are in. A silent action reads as broken; a repeated sample reads as cheap. Wiring for `@blacksite/soundscape` is in [building-blocks.md](building-blocks.md#sound-soundscape) and `packages/soundscape/AGENTS.md`.

## Layers

| Layer | What the player hears | Typical source |
|---|---|---|
| Bed | Continuous air or room tone that crosses zone boundaries smoothly | Wind, rain, ventilation |
| Spot | Loops and occasional calls at places in the world | Generator, creaking metal, distant dogs |
| Foley | The player and other bodies | Surface footsteps at foot plants, landing, cloth |
| Events | Actions and their results | Gunfire, impacts, doors, explosions |
| Interface | Dry, centred confirmation | Menu actions, hit markers |
| Music and voice | Story and direction, with priority over the bed | Score, dialogue |

For a Slice, list at least a bed, a spot emitter, two event families, surface foley and the acoustic zones before building. Make every action audible as well as visible and tactile. Keep the sound budget in the same model as the game's other budgets.

## Footsteps

Footsteps come from the animation's foot plants, never a timer, with a surface tag supplied by the world. Use concrete, metal, wood, dirt and water where the geometry warrants them. Each surface has a set of 3–5 samples. Scale landing sounds by fall speed. Attenuate by distance.

## Rules

- **Never the same sample twice in a row.** A repeated cue has at least three variants. The default pitch jitter is about ±5% and volume jitter about ±1.5 dB. Selection must not play the same variant twice in a row, and a cooldown prevents an event stream from becoming a buzz. Keep the source name stable so the audio check can detect repetition.
- **Sound travels.** Delay far events at 343 m/s: a flash 200 m away arrives about 0.58 s before its sound. Avoid that delay for the player's own gun and other immediate feedback.
- **The room has a tail.** The listener's zone sets the convolution tail. A loud shot in a room takes on that room's tail; outside it keeps an open-air response. Procedural small-room, corridor, hall and outdoor impulses are the defaults; recorded, redistributable impulses can replace them later.
- **Attenuate and occlude by class.** World sounds attenuate by cue class. The desktop tier uses HRTF; the phone tier uses stereo panning and a lower voice cap (16 by default). Blocked sounds lose gain and high frequencies, from a ray test the game provides.
- **Cap voices and steal gently.** Cap active voices at 32. Prioritise voice and nearby, loud action over distant detail, and virtualise inaudible sources. When the cap is reached, steal a low-priority voice with a short fade; never cut a gunshot transient abruptly.
- **Mix through buses.** Send every cue through the named buses: master, sfx, weapons, ambience, music, ui and voice. Weapons duck ambience; dialogue ducks the other buses. The master ends in a limiter, as a safety net: leave headroom in cue gains so it catches bursts rather than holding down a firefight.
- **Wind and weather follow the world.** The wind bed reads the same field as the grass (`worlds.md`), so it rises exactly when the grass at your feet bends.
- **Build the graph while loading.** Call `prepare()` behind the loading screen so every zone's impulse responses exist before play, and `start()` on the first gesture. Building audio during play caused a 250 ms hitch, and a convolver built for a first chime hitched a phone (`performance.md`).
- **Low health changes the mix.** Muffle the world at low health, and let the player hear regeneration start.

## The mix (proposed)

Soundscape's defaults (`packages/soundscape/src/`) and Breach's rooms. They are the measured starting point, not yet tuned in headphones across several games.

- **Ducking depths.** Dialogue ducks every other bus to 0.38 (about −8.4 dB); a playing weapon ducks ambience and music to 0.53 (about −5.5 dB). Duck in 18 ms, release over 180 ms.
- **The limiter is a safety net.** −3 dB threshold, 20:1, 2 ms attack, 140 ms release, then the master at 0.7.
- **Priority when stealing.** Interface 8, voice 7, weapons 6, sfx 4, foley 3, music 2, ambience 1.
- **Distance by class (near / far, metres).** Weapons 3 / 200, ambience 4 / 160, sfx 2 / 100, voice 2 / 55, foley 1.5 / 45.
- **Reverb from the room's size.** Breach sets each room's tail from Sabine's RT60 = 0.161 V ÷ (S·α): a 14 × 12 × 5 m hall rings for about 2.8 s, a corridor for about 0.75 s, outdoors for 0.6 s; phones use 0.7× the tail.
- **First person with no body** has no foot plants: step on a stride clock at the gait's cadence (Breach: 0.4 s walking, 0.3 s running, 0.26 s sprinting, 0.5 s crouched), with landings above 1.5 m/s scaled by speed.

## Provenance and verification

Synthesised content can ship with the repository. Ship a recording or impulse response only with a redistributable licence and credit it in `site/public/CREDITS.md`. Never copy a sound from a purchased pack into a public game.

Run `blacksite check <url> --only audio` on desktop and phone. Its `audio()` poll reports active voice peak and back-to-back sample repeats. A pass proves the cap and selector behaviour; listen to the mix, spatial image, reverb and phone speaker on real devices as well ([verify.md](verify.md)).
