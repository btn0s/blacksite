# Enemies

What players read as a smart enemy: one that perceives like a person, reacts a beat late, says what it's doing, and moves with its squad. A chase in a straight line with perfect aim reads as a machine however good its logic is. Wiring for Warden, Blacksite's squad AI, is in [building-blocks.md](building-blocks.md#enemies-warden).

## Numbers

| Number | Value |
|---|---|
| Vision | 37 m, about 155° wide |
| Hearing | 32 m |
| Memory | Sightings last 5 s; belief confidence decays at exp(−0.12·age) |
| Reaction | 0.12 + (1 − skill) × 0.28 s, about 0.22 s at default skill |
| Radio latency | 0.4 s |
| Thinking | 30 Hz tick, observations at 15 Hz |
| Replanning | Each agent every 6 ticks, staggered, or on a new threat |
| Cover rescoring | Every 30 ticks; squad plan every 15; team order every 60 |
| Squad size | Up to 8 per team |

An enemy knows only what it has seen, heard or been told on the radio, never the world's true state. Aim starts wide and tightens as the enemy acquires the target, so the player has time to react. Squads bound, flank, set crossfires and breach, and reserve cover so two agents never take the same spot.

## Telegraphing (proposed)

From Breach (`examples/breach/src/model.ts`), whose enemies were tuned so a player can read and counter a squad.

| Number | Value | Why |
|---|---|---|
| Callout lead | 0.8 s between the bark ("Flanking!") and the move, with a subtitle | The bark announces intent before it happens |
| Bark spacing | 2.5 s per soldier, 0.9 s across the squad | Lines never overlap |
| First burst | Always misses, landing 0.5–1.4 m from the player | The player learns where fire comes from before it hurts |
| Hit chance | 15% rising to 45% over 3 s of exposure; ×0.6 moving, ×0.4 sprinting, ×0.8 crouched | Aim starts wide and tightens; movement is rewarded |
| Shooters at once | 2 attack tokens, held 3 s, 1.2 s cooldown | A crowd never fires all at once |
| Bursts | 3–5 rounds at 9 rounds/s, 0.6–1.2 s pauses | The pause is the player's window |
| Damage to the player | 12 a hit, about 9 hits to die | About 3 s of exposure to two shooters |
| Reaction | 0.35–0.6 s | Above the 0.25 s of human visual reaction; the squad sim's 0.22 s is for agents fighting each other |

## Rules

- **Barks are what players read as smart.** Say out loud what the enemy is doing ("Flanking left!", "Reloading!") so the player can counter it. A flank the player never hears about reads as a cheat.
- **One enemy type doesn't need a squad.** For a single enemy type, a small state machine (patrol, investigate, search, attack, flee) with the same perception numbers often reads better than a squad.
- **The parts list names behaviours.** A Slice has at least two enemy behaviours, for example patrol and investigate a sound.
- **Animate far agents less often.** Pose LOD took a 5v5 round from about 21 ms to 6–10 ms a frame (`performance.md`).
- **Snapshots sized for rendering.** The AI worker sent 557 KB a tick including decision traces and the map. Sending only what presentation draws cut it to a few KB.
- **A cheap pre-reject on hot searches.** A heap-based search with a bounding-box pre-reject was 3.5× faster with identical results; a 5v5 tick fell from 15–18 ms to 4–7 ms.
