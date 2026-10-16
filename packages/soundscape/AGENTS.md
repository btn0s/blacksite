# Soundscape

`@blacksite/soundscape` is the standard game mixer. The game chooses a cue and sends an event; Soundscape chooses a variant, builds its layers, places it in space, sends it to the listener's reverb zone, and accounts for its voice. A game should describe content through `registerCue` and use `play` by name. The mixer owns Web Audio nodes and the audio check log.

## Vocabulary

| Term | Meaning |
|---|---|
| Cue | Named pool of variants, such as `weapon.rifle` or `footstep.concrete`. |
| Variant | One combination of layers with a stable `id`; selection never repeats immediately by default. |
| Layer | A procedural noise burst, pitched tone, or supplied `AudioBuffer`, with its own attack, duration, filter, offset, and reverb send. |
| Voice | One playing variant, regardless of how many layers it contains. The voice cap measures these, not individual oscillators. |
| Bus | Category gain and ducking path. Weapons duck ambience and music; dialogue ducks every other bus. |
| Zone | The listener's current acoustic space: its impulse response, wet level, beds, and ambient one shots. |
| Emitter | A voice with a position in metres. Desktop uses HRTF; phone uses stereo panning. |

## Standard recipe

```ts
import { createSoundscape } from '@blacksite/soundscape'

const audio = createSoundscape({ tier: 'desktop', voiceCap: 32, occlusion: rayBlocked })
audio.setZone('outdoor')
audio.setListener({ position: [x, y, z], forward: [fx, fy, fz] })
audio.play('footstep.concrete', { position: [x, y, z] })
audio.play('weapon.rifle', { position: muzzle })
audio.play('impact.steel', { position: plate, delay: true })
audio.update(dt)
```

Call `audio.prepare()` during scene setup, before the first measured frame. It allocates the graph and generates the built-in zone impulse responses without resuming audio or starting beds. Call `audio.start()` from the first pointer, touch, or key gesture; it reuses the prepared graph and starts the current zone's ambience after audio resumes. The package also installs a one-time gesture listener and suspends when the document is hidden. `play` constructs a graph if needed, so scripted checks still record events before a user gesture. Dispose the mixer when the scene unmounts. The phone tier defaults to 16 voices and uses shorter impulse responses; desktop defaults to 32 voices.

Coordinates are `[x, y, z]` tuples in metres. Pass current listener position and forward every camera frame. An emitter can call the returned handle's `setPosition` when it moves. `update` manages virtual loops and the current zone's random ambient one shots. A far single event is dropped if inaudible; a far loop keeps its handle and resumes when audible again. For an explosion or strike, set `delay: true`; the travel time is distance divided by 343 m/s. `impact.*` and `impact.steel` enable that delay by default.

## Cues and content

The starter set is automatically registered: layered rifle and pistol shots, dry fire, staged reloads, equip, steel ringing, `impact.<surface>`, `footstep.<surface>`, `landing.<surface>`, casing, wind, room tone, distant dogs, and metal creaks. Surfaces are concrete, metal, wood, dirt, water, paper, and canvas. The built-in cue object is `STARTER_CUES` if a game needs to derive a variation. A game can replace any cue through `registerCue(name, definition)`.

```ts
audio.registerCue('door.heavy', {
  class: 'sfx', bus: 'sfx', cooldown: 0.08,
  variants: [
    { id: 'a', layers: [{ kind: 'noise', gain: 0.7, duration: 0.2, filter: { type: 'lowpass', frequency: 800 } }] },
    { id: 'b', layers: [{ kind: 'noise', gain: 0.75, duration: 0.23, filter: { type: 'lowpass', frequency: 920 } }] },
  ],
})
```

Variants default to random selection without an immediate repeat. Use `selection: 'round-robin'` for a fixed cycle. Default jitter is ±5% pitch and ±1.5 dB volume. Add `offset` to stage layers, such as a reload, and `loop: true` for a continuous cue. An `AudioBuffer` layer is supported for a licensed recording; Soundscape does not fetch assets. A supplied buffer defaults to its full duration. A `VoiceHandle` can fade, reposition, and stop the sound.

## Zones and mixer

`setZone('outdoor' | 'small-room' | 'corridor' | 'hall')` crossfades ambience beds over about 1.2–1.4 seconds and makes new sounds use the destination zone's convolution reverb. At a full voice cap, the beds use a short fade-out/fade-in handoff. Existing reverb tails keep ringing in the zone where they began. `registerZone` accepts custom beds and ambient one shots, and `setImpulseResponse(zoneName, buffer)` swaps a generated IR for a recorded one. The buffer's sample rate must match the `AudioContext` sample rate. The zone is chosen at the listener, not at the emitter, so a gunshot heard from within a room has the room's tail.

`setBusVolume('weapons' | 'sfx' | 'ambience' | 'music' | 'ui' | 'voice' | 'master', gain)` adjusts category levels. The master uses a peak limiter as a safety net. Leave headroom in cue gains; the limiter should catch bursts, not hold down a firefight. Voice stealing compares class priority and loudness at the listener, including occlusion. A stolen voice gets a short fade and the replacement waits for it, so the click transient is not severed abruptly.

Expose `audio.sample()` as the check contract's `audio()` function. It drains the play log and reports active voice count through `createAudioLog()` from `@blacksite/check`. You can pass a log in `createSoundscape({ log })` if another system needs to share it. Every audible start logs the cue and chosen variant ID; layers do not count as separate plays.

## Gotchas by symptom

| Symptom | Check |
|---|---|
| No audio on first load | The browser needs a gesture; call `start()` on pointer, touch, or key input. Scripted checks can still inspect the log. |
| Footsteps repeat | Trigger on animation foot plants and use one cue per surface; let variant selection run in the mixer. |
| An impact sounds before the hit | `delayByDistance` is intended for far physical events. Turn it off on a custom cue for a close, immediate UI or weapon response. |
| Distant steel is inaudible | Use `impact.steel`, which has a wider attenuation curve than ordinary impacts. Set an actual world position and listener pose. |
| Sound behind a wall stays bright | Provide `occlusion(listener, source)` from the game's ray query. Return `true` or a fraction from 0 to 1. |
| Wind keeps playing inside | Set the zone when the listener crosses the building boundary; `setZone` handles the bed crossfade. |
| Voice count climbs | Stop loop handles when an emitter or scene is removed, and call `dispose()` on unmount. |
| Recorded IR throws | Its sample rate must equal the current audio context's sample rate; resample the recording before calling `setImpulseResponse`. |
