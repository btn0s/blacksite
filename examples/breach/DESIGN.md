# Breach: design

Size: **Slice.** One ruined building with full look, sound and feel, about a three-minute loop. Enter from the yard, clear the lobby, the machine hall and the records office, then exfil through the blown wall to the waiting APC. Death or exfil restarts the loop.

The one idea: **every shot is answered, and every enemy says what it is about to do.** Gun feel comes from an authored spray you can learn, five responses to every hit and a room that changes the gunshot. AI feels smart because the squad calls its move before making it, holds cover, flanks through the side passage, and only two of them may shoot at once.

## Model

All numbers live in `src/model.ts` and drive the game. Metres, seconds and degrees.

### Movement (feel.md, ALS movement settings)

| Number | Value | Source |
| --- | --- | --- |
| Walk / run / sprint | 1.75 / 3.75 / 6.5 m/s | ALS movement settings |
| Crouch / aiming | 2.0 / 1.65 m/s | ALS crouched run and aiming walk |
| Acceleration | 20 m/s² from rest, falling to 7.5 at sprint | ALS; 90% of run speed in 0.2 s |
| Braking | 15, then 12.5 at run, then 5 at sprint | ALS |
| Air control | 25% | Tuned |
| Jump | 4.2 m/s at 9.8 m/s², a 0.9 m apex | ALS |
| Coyote time / jump buffer | 0.1 s / 0.1 s | feel.md |
| Capsule | radius 0.3 m, height 1.8 m standing, 1.12 m crouched; 0.45 m step | ALS |
| Eye height | 1.63 m standing, 1.0 m crouched, smoothed at exp(−20·dt) | feel.md |
| Landing dip | 6 cm | Tuned |
| Sprint-out time | 0.22 s | Tuned; the delay before a sprinting player can fire |

The body is our own: a capsule that slides on the level's boxes with exact ballistic gravity (the standalone first-person subject has no gravity or collision).

### View

| Number | Value | Source |
| --- | --- | --- |
| World FOV | 75° vertical, blended at 14/s | feel.md |
| Viewmodel FOV | 56° | Subject FPP default |
| Shot camera kick | 0.18°, decays at 9/s | Tuned visual punch on top of the pattern climb |
| Damage camera punch | 1.4° | Tuned |

### Weapons (Armory definitions built by `armoryDefinitions()`)

| Number | Rifle | Pistol | Source |
| --- | --- | --- | --- |
| Rate | 10 rounds/s (600 rpm) | 5 rounds/s cap, semi | CS:GO AK-47 `cycletime 0.1` |
| Magazine / reserve | 30 / 150 | 8 / 40 | Standard rifle and Makarov magazines |
| Reload | 2.43 s | 1.6 s | CS:GO AK-47 reload 2.43 s; PM tuned |
| Equip | 0.5 s | 0.35 s | Tuned |
| Damage / range | 36 / 120 m | 28 / 60 m | CS:GO AK-47 36 base damage |
| Head / chest / limb multiplier | 4 / 1 / 0.75 | same | CS:GO hitgroup multipliers |
| ADS time | 0.25 s | 0.15 s | Typical assault rifle and pistol ADS times in modern military shooters |
| ADS FOV | 55° | 62° | Tuned iron-sight zoom (1.35× and 1.2×) |
| Hip / ADS cone | 1.1° / 0.12° | 0.9° / 0.15° | Tuned so ADS is a sniper and the hip is a room-clearing shotgun |
| Moving / crouched | +1.6° / ×0.75 | +1.2° / ×0.8 | Tuned after CS:GO's stance inaccuracy |
| Bloom | +0.18° per shot, cap 2.2°, recovers in 0.43 s | +0.35°, cap 1.8°, 0.3 s | CS:GO AK-47 `recovery time stand` 0.43 s |
| Spray | 30-shot authored pattern: 9 shots climb about 6.5°, then pulls left, right, left | 8-shot alternating climb of 1.3–1.5° | Shaped after the CS:GO AK-47 spray (climb then sway) |
| Spray reset | 0.43 s without a shot | 0.3 s | Same as recovery |
| Climb recovery | 60% of the climb returns over 0.43 s after release | 85% over 0.25 s | Tuned; Battlefield and Rainbow Six recover part of the climb |

Bloom recovery waits one firing interval after the last shot (0.1 s rifle, 0.2 s pistol), then recovers over 0.43 s or 0.3 s. Sustained fire therefore accumulates the authored per-shot bloom. Sprinting lowers the weapon; leaving sprint starts the 0.22 s sprint-out delay before a shot may fire. Recoil recovery follows the currently equipped weapon.

The pattern is deterministic apart from a small jitter (0.04° rifle, 0.1° pistol): pull down and slightly right through the first nine rounds and the decals stay in a fist-sized group at 10 m.

### Player

Health 100. Regenerates at 25 per second after 5 s without damage (the regenerating health of modern military shooters keeps a short loop flowing). Death restarts after 3.5 s; exfil restarts after 5 s.

### Squad AI (Warden)

| Number | Value | Source |
| --- | --- | --- |
| Senses | Warden vision 37 m, ±77°; hearing 32 m | Warden `ObservationGenerator` defaults |
| Attack tokens | 2 shooters at once; hold 3 s, cooldown 1.2 s | DOOM (2016) token system for simultaneous attackers |
| Callout lead | 0.8 s between "Flanking!" and the move | F.E.A.R. (Orkin, GDC 2006): barks announce squad intent before it happens |
| Bark spacing | 2.5 s per soldier, 0.9 s across the squad | Tuned so lines never overlap |
| Fire | 9 rounds/s in 3–5 round bursts, 0.6–1.2 s pauses | Tuned controlled-pair cadence |
| Damage to player | 12 per hit | Tuned: about 9 hits; 3 s of exposure to two shooters |
| First burst | Always misses, landing 0.5–1.4 m from the player | Naughty Dog's and Halo's deliberate first miss: the player learns where fire comes from |
| Hit chance | 15% rising to 45% over 3 s of exposure; ×0.6 moving, ×0.4 sprinting, ×0.8 crouched | Tuned |
| Reaction | 0.35–0.6 s | Above the 0.25 s human visual reaction |

### Acoustics (Sabine RT60 = 0.161 V / (S·α))

| Room | Size | α | RT60 | Pre-delay |
| --- | --- | --- | --- | --- |
| Yard and exfil | outdoors | – | 0.6 s slap | 120 ms off the facade, 90 ms at exfil |
| Lobby | 10 × 8 × 3.2 m | 0.10 | 1.5 s | 18 ms |
| Corridor | 2.4 × 7 × 3 m | 0.12 | 0.75 s | 7 ms |
| Store room | 3.5 × 6.5 × 3 m | 0.20 | 0.53 s | 8 ms |
| Machine hall | 14 × 12 × 5 m | 0.08 | 2.8 s | 30 ms |
| Records office | 9 × 8 × 3 m | 0.22 | 0.6 s | 14 ms |

Gunshot tails come from impulse responses generated at these RT60s; the reverb crossfades over 0.35 s when the listener crosses a room boundary.

All sound sits behind `src/audio.ts` (`createBreachAudio`) through the public Soundscape API. Its cue interface (`shot`, `impact`, `crack`, `bark`, `footstep`, `sting` and others) and `setListener(position, room)` use 27 recorded takes: four rifle, three pistol and four each for concrete, metal, wood, rubble and water footsteps. Gun recordings are CC0; footsteps are CC BY 3.0, credited in the shipped credits. Rifle and pistol recordings trim the original outdoor tail to 0.55 s and 0.45 s before the room convolution. Dirt steps, landing, handling, impacts, markers, barks and stings retain four first-party synthetic variants. No cue immediately repeats its previous variant. Soundscape prioritises shots and barks, caps voices at 28 desktop / 16 phone, and delays distant sounds by distance at 343 m/s. `prepare()` decodes the recordings and warms all seven reverb paths before the scene starts. The 18 s wind buffer carries slow gusts; room tone and the three spot-source families fill the interior. Headphone mix judgement remains part of the user playtest.

### Footsteps

Interval 0.4 s walking, 0.3 s running (Source `m_flStepSoundTime` 400 / 300 ms), 0.26 s sprinting, 0.5 s crouched. Surfaces: concrete, rubble, metal grating, wood, dirt and water, with four recorded takes on concrete, rubble, metal, wood and water; dirt remains a distinct filtered impact.

### Budgets

| Number | Value |
| --- | --- |
| Frame, firefight, desktop | never over 16 ms; target 8.3 ms (120 fps) |
| Frame, phone | 16.7 ms (60 fps) |
| Draw calls | 260 desktop, 160 phone |
| Point lights | constant count per quality tier, never toggled (a toggle recompiles every lit shader) |
| Audio voices | 28 desktop / 16 phone |
| Decals | 256 pooled |
| First playable | under 5 s |

## Feedback contract

Every shot gets: shot sound with room tail, muzzle flash and light, camera kick, viewmodel kick, ejected casing. Every impact gets: impact sound for the surface (delayed by distance at 343 m/s), a decal, particles (chips, dust or sparks) and, on a hero cover piece, a Cascade chip. Every hit on a soldier gets: hit marker (0.12 s; red kill marker 0.32 s), flesh sound, blood puff, a flinch, and a bark from a squadmate on a kill.

## Parts list

Minimums from `craft.md`: each interior room has a key from a window or roof hole and 2 practicals, 4 materials and 8 prop types; the yard has 3 practicals, 5 materials and 12 prop types. Every wall at eye height carries a decal, fixture or prop; props sit in clusters of 3–7.

### Set dressing

- **Kit:** exterior walls with door and window openings, interior partitions, door frames, concrete pillars, a ceiling with roof holes, an overhead crane beam, broken window sills, a blown breach in the office wall, a perimeter wall with closed rust gates.
- **Materials (5+):** cast concrete, brick, rusted metal, photographic old wood, packed dirt and rubble, standing water. The starter library’s CC0 Old Planks 02 by Rob Tuytel / Poly Haven supplies 1k colour, tangent normal and packed ORM at its 2 m physical tile size. It covers the records-office floor, crates and pallets; three WebP maps add 366 KB. Existing world-kit photographic surfaces remain on concrete and metal.
- **Props:** lathes, workbenches, steel shelving, oil drums, crates, a burning barrel, an overturned reception desk, chairs, filing cabinets, desks, a safe, rubble piles, fallen slab pieces, sandbags, a wrecked Lada and an APC in the yards, apartment blocks on the skyline.
- **Decals:** water stains, soot, cracks, peeling paint, painted room numbers, oil on the hall floor, puddles in the yard; bullet holes, scuffs and blood from play (256 pooled).

### Built count ledger

Counts below distinguish prop types from their small mesh pieces. Shared-material parts are merged before rendering. The `layout.ts` inventory has 183 collision/structure blocks, 839 dressing pieces, 40 rounded sandbags, 118 photographed wood pieces and 8 Cascade hero-cover meshes. `level.ts` adds the facade detail, skyline, wall fixtures, decals and atmosphere.

| Space | Materials in layout, before floor/decals | Prop types and placed groups | Visible practicals |
| --- | --- | --- | --- |
| Yard | 10, plus ground blend / asphalt / water | 15+: two Ladas, two containers, one guard booth, one dumpster, seven drums, three tyre stacks, three pallet stacks plus one leaning pallet, two benches, six sandbag stacks, three rubble piles, two footings pairs, one cable spool, one lamp pole, eight distant dead trees and weeds | 3 |
| Lobby | 8 | 12: reception desk, sofa, locker, counter, three chairs plus one fallen seat, two radiators, noticeboard, rubble pile, fallen slab, exposed rebar, service pipes and extinguisher | 2 |
| Corridor | 6 | 8: fallen locker, two service pipes, cable tray, rubble pile, hose cabinet, posters, junction box and clamped conduit | 2 |
| Store room | 6 | 10: four crates, three drums, shelving, shelf boxes, ladder, two gas cylinders, workbench and tools, tyre stack, posters and clamped conduit | 2 |
| Machine hall | 8 | 14+: two lathes, two machine tables, drill press, three plinths, two shelving units, shelf boxes, three crates, seven drums plus fire barrel, two rubble piles and slabs, crane beam and suspended hooks, pipe runs, workbench, control cabinet and posters | 4 |
| Records office | 6, plus wood floor | 13: four desks, three typewriters, four filing cabinets, two partitions, safe, fallen shelf, radiator, hanging coat, ten binders, paper litter, noticeboard, clock and framed print | 2 |
| Exfil yard | 7, plus ground blend / water | 12: APC, rubble pile, two crates, two drums, pallet stack, tyre stack, cable spool, footings pair, two gas cylinders, broken bench, papers and weeds | 3 |

Three roof openings carry three dust clouds (60 motes each on high, 24 on low) and three shaft volumes. Smoke rises from the yard barrel, the distant skyline and the exfil flare. Five caution-tape runs sway in the yard. Four atlas decal families (blotch, streak, crack, soot) cover interior wall edges, floors and ceilings; every wall also gets fixtures or posters. Three sky apartment blocks, a water tower and one chimney layer the skyline behind the playable building.

### Lighting

- **Key:** overcast sun with shadows from the key only, through the window openings and roof holes; the shadow frustum follows the player, texel-snapped, refreshed every other frame.
- **Fill:** sky hemisphere from Look at about a third of the key.
- **Practicals:** lobby pendant and luminous exit sign; two corridor cages; store-room cage and exit sign; two hall fluorescents, the burning barrel and exit sign; office emergency lamp and desk lamp; yard sodium lamp, fire barrel and amber gate fixture; two amber exfil wall fixtures and the signal flare. All 18 visible sources remain on phone. Nearest-source local light pools use a fixed count of 3 high / 2 medium / 0 low, reserving two transient shot lights within the model’s total caps of 5 / 4 / 2. Pool assignments use the player or critic camera with distance hysteresis and fade through zero before moving, so shaders never recompile and light positions never pop at full intensity. Fixture emissives remain visible on phone; its overcast sky and hemisphere carry the interior.

### Motion

Dust motes in the light shafts, additive light-shaft cards under the roof holes, the barrel's flicker and smoke, the flickering tube, idle animation on every soldier, impact dust and Cascade chips.

### Audio

- **Beds (2):** wind outside with slow gusts, low room tone indoors; they crossfade at the facade.
- **Spot sources (3):** fluorescent hum in the hall, fire crackle at the barrel, radio static in the office. Each is panned and attenuated by distance and muffled through walls.
- **Events:** shots with room tails, impacts per surface, casings per floor, footsteps per surface, reload and equip foley, flesh hits and markers, enemy fire with distance and occlusion, near-miss cracks, barks, room-clear, exfil and death stings, and structural creaks indoors.
- **Reverb zones (7):** yard, lobby, corridor, store room, hall, office and exfil.

### Enemy behaviours

Warden intents, each barked 0.8 s before it happens with a subtitle: advance, flank, take cover, engage, suppress, reload, fall back, search and hold. Attack tokens limit fire to 2 soldiers at once.

## Camera bookmarks (critic captures)

| Name | Position (x, y, z) | Look at | What it shows |
| --- | --- | --- | --- |
| `yard` | 0, 1.63, 20 | 0, 1.6, 10 | Spawn: the facade, the Lada and the APC, the skyline: the 10-second look |
| `door` | -1.6, 1.63, 13.2 | 0.4, 1.4, 8 | Contact at the lobby door |
| `lobby` | 3.6, 1.63, 9.2 | -2, 1.2, 3 | Pillars, the overturned desk, the bulb and the roof-hole shaft |
| `corridor` | 0, 1.63, 1.4 | 0, 1.5, -6 | The tight corridor and the store-room opening |
| `hall` | 0, 1.63, -5.8 | -1, 1.5, -15 | Lathes, shafts, the burning barrel and the fluorescent tube |
| `hall-north` | 4.4, 1.63, -16.4 | -4, 1.4, -7 | The longest sightline, back across the hall |
| `office` | -1.4, 1.63, -21 | -6, 1.3, -21.8 | Desks, cabinets, the red lamp |
| `exfil` | -0.6, 1.63, -21.2 | 9, 1.4, -22 | The breach out to the APC |

## Architecture

- `src/model.ts` holds every number above; `check.tsx` hands `FEEL` and the budgets to the check contract.
- The squad runs in a module worker (`squad.worker.ts`): one Warden `TacticalRuntime` per encounter at 30 Hz with our own `BreachAuthority`. A fight wakes when the player enters its trigger or shoots one of its soldiers. The worker posts soldier views and events (fire, flinch, intent, died, alert); the main thread draws the soldiers 110 ms behind with the ALS snapshot buffer and plays every event as sound, effects and subtitles.
- Player shots are traced on the main thread against soldier hit zones and then the level; hits go to the worker as damage.
- Soldiers are ALS bodies with animation LOD, drawn only in rooms the player can see. Shaders are compiled before the game reports ready.

## Flow

1. **Yard:** start at the gate. A hint shows the controls. No enemies.
2. **Lobby (2 soldiers):** one behind a pillar, one behind the desk. Contact at the door.
3. **Corridor and store room:** the store room is the flank route into the hall.
4. **Machine hall (4 soldiers):** support holds the north end, point covers the corridor door, the flanker goes round through the store room and calls it first.
5. **Records office (3 soldiers):** two hold behind desks; one comes through the breach.
6. **Exfil:** walk into the marker by the APC. The run ends with time, accuracy and kills, then restarts.
