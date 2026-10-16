# Breach: design

Size: **Slice.** One ruined building with full look, sound and feel, about a three-minute loop. Enter from the yard, clear the lobby, the machine hall and the records office, then exfil through the blown wall to the waiting APC. Death or exfil restarts the loop.

The one idea: **every shot is answered, and every enemy says what it is about to do.** Gun feel comes from an authored spray you can learn, five responses to every hit and a room that changes the gunshot. AI feels smart because the squad calls its move before making it, holds cover, flanks through the side passage, and only two of them may shoot at once.

## Model

All numbers live in `src/model.ts` and drive the game. Metres, seconds and degrees.

### Movement (Half-Life 2 / Source, 1 unit = 1 inch = 0.0254 m)

| Number | Value | Source |
| --- | --- | --- |
| Eye height | 1.63 m (64 u) | HL2 `VEC_VIEW` |
| Crouched eye | 1.17 m (46 u) | Source `VEC_DUCK_VIEW` (CS:GO) |
| Body radius | 0.41 m (16 u) | Source player hull 32 u wide |
| Step height | 0.46 m (18 u) | Source `sv_stepsize 18` |
| Walk / run / sprint | 3.81 / 4.83 / 8.13 m/s (150 / 190 / 320 u/s) | HL2 `hl2_walkspeed`, `hl2_normspeed`, `hl2_sprintspeed` |
| Crouch speed | 1.61 m/s (one third of run) | Source duck speed multiplier 0.333 |
| Ground acceleration | 10 | Source `sv_accelerate 10`: reaches full run in about 0.1 s |
| Friction / stop speed | 4 / 2.54 m/s | Source `sv_friction 4`, `sv_stopspeed 100` |
| Aim-down-sights move scale | 0.55 | Tuned; HL2 has no ADS. Close to the ADS walk of modern military shooters |
| Sprint-out time | 0.22 s | Tuned; the delay before a sprinting player can fire |

### View

| Number | Value | Source |
| --- | --- | --- |
| World FOV | 74° vertical | CS:GO `fov 90` horizontal at 4:3 is 73.7° vertical |
| Viewmodel FOV | 56° | Subject FPP default (HL2 `viewmodel_fov 54`) |
| Shot camera kick | 0.18°, decays at 9/s | Tuned visual punch on top of the pattern climb |
| Damage camera punch | 1.4° | Tuned |

### Weapons (Armory definitions built by `armoryDefinitions()`)

| Number | AK-74 | PM pistol | Source |
| --- | --- | --- | --- |
| Rate | 10 rounds/s (600 rpm) | 5 rounds/s cap, semi | CS:GO AK-47 `cycletime 0.1`; AK-74 cyclic 600–650 rpm |
| Magazine / reserve | 30 / 150 | 8 / 40 | AK-74 30-round magazine; Makarov PM 8-round magazine |
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
| Yard | outdoors | – | 0.6 s slap | 120 ms off the facade |
| Lobby | 10 × 8 × 3.2 m | 0.10 | 1.5 s | 18 ms |
| Corridor | 2.4 × 7 × 3 m | 0.12 | 0.75 s | 7 ms |
| Machine hall | 14 × 12 × 5 m | 0.08 | 2.8 s | 30 ms |
| Records office | 9 × 8 × 3 m | 0.22 | 0.6 s | 14 ms |

Gunshot tails come from impulse responses generated at these RT60s; the reverb crossfades when the listener crosses a room boundary.

### Footsteps

Interval 0.4 s walking, 0.3 s running (Source `m_flStepSoundTime` 400 / 300 ms), 0.26 s sprinting, 0.5 s crouched. Surfaces: concrete, rubble, metal grating, wood, dirt and water, each a distinct filtered impact.

### Budgets

| Number | Value |
| --- | --- |
| Frame, firefight, desktop | never over 16 ms; target 8.3 ms (120 fps) |
| Frame, phone | 16.7 ms (60 fps) |
| Draw calls | 260 desktop, 160 phone |
| Point lights | 5 high, 4 medium, 2 low |
| Audio voices | 28 |
| Decals | 256 pooled |
| First playable | under 5 s |

## Feedback contract

Every shot gets: shot sound with room tail, muzzle flash and light, camera kick, viewmodel kick, ejected casing. Every impact gets: impact sound for the surface (delayed by distance at 343 m/s), a decal, particles (chips, dust or sparks) and, on a hero cover piece, a Cascade chip. Every hit on a soldier gets: hit marker (0.12 s; red kill marker 0.32 s), flesh sound, blood puff, a flinch, and a bark from a squadmate on a kill.

## Parts list

### Set dressing (counts are minimums)

- **Kit pieces (60):** exterior walls with door and window openings, interior partitions, door frames, 6 concrete pillars, ceiling slabs with two roof holes, an overhead crane beam, a stair core, broken window sills, a blown breach in the office wall.
- **Trims (40):** skirting and kick plates, door and window frames, ceiling beams, cable trays, pipe runs, radiator under each window.
- **Decals (30):** water stains, soot over the fire barrel, cracks, peeling paint patches, painted room numbers, an arrow stencil, oil on the hall floor, puddles in the yard.
- **Props (70):** two lathes and a drill press, workbenches, steel shelving, 8 oil drums, crates, a burning barrel, an overturned reception desk, chairs, a sofa, filing cabinets, desks with typewriters and paper, partitions, a safe, rubble piles, fallen slab pieces, rebar, a mattress, a Lada and an APC in the yards, sandbags, apartment blocks on the skyline, dead trees.

### Lighting

- **Key:** overcast sun with shadows, through the window openings and roof holes.
- **Fill:** sky hemisphere from Look.
- **Bounce:** two warm, unshadowed point lights under the roof holes.
- **Practicals (4, all emissive meshes):** a bare bulb in the lobby, a flickering fluorescent tube in the hall, the burning barrel's flicker, a red emergency lamp in the office.

### Atmosphere

Look `zone` fog pulled in for interiors; dust motes in the light shafts (instanced, 300); three additive light-shaft cards under the roof holes; smoke from the burning barrel; impact dust from Cascade's effects.

### Audio

- **Beds (2):** wind outside, a low room tone indoors.
- **Spot emitters (4):** fluorescent buzz, fire crackle, a dripping pipe, a distant radio in the office.
- **One-shots:** shots, tails, impacts per surface, casings, footsteps per surface, reload and equip foley, flesh hits, enemy fire with distance and occlusion, near-miss cracks, barks.
- **Reverb zones (5):** yard, lobby, corridor, hall and office.

## Camera bookmarks (critic captures)

| Name | Position (x, y, z) | Look at | What it shows |
| --- | --- | --- | --- |
| `yard` | 0, 1.63, 20 | 0, 1.6, 10 | The facade, the Lada and APC, the skyline: the 10-second look |
| `lobby` | 3.6, 1.63, 9.2 | -2, 1.2, 3 | Pillars, the overturned desk, the bulb and the roof-hole shaft |
| `corridor` | 0, 1.63, 1.6 | 0, 1.5, -6 | The tight corridor and the side-passage opening |
| `hall` | 0, 1.63, -5.8 | -1, 1.5, -15 | Lathes, shafts, the burning barrel and the fluorescent tube |
| `office` | -1, 1.63, -18 | -5, 1.2, -23 | Desks, cabinets, the red lamp and the blown breach |
| `exfil` | 1.2, 1.63, -21 | 9, 1.4, -22 | The breach out to the APC |

## Flow

1. **Yard:** start at the gate. A hint shows the controls. No enemies.
2. **Lobby (2 soldiers):** one behind a pillar, one behind the desk. Contact at the door.
3. **Corridor:** the hall squad hears the lobby fight and sets up.
4. **Machine hall (4 soldiers):** support holds the north end, point covers the corridor door, the flanker goes round the side passage and calls it first.
5. **Records office (3 soldiers):** two hold behind desks; one comes through the breach.
6. **Exfil:** the APC's engine turns over; walk into the marker.
