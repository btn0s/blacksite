# Valley

A walk from a mountain tarn down a cascading creek to a river that reaches the sea, across a valley floor held by a mountain horseshoe, under the Blacksite WebGPU look. The ten-minute test is walking the whole way without a crack, a pop, a hitch or a seam where the heightfield meets the sky.

## The world

`@blacksite/landscape` owns the shape. `valleyShape` (a valley floor, a horseshoe of mountains to the east, south and west, a sea to the north, a river with a spilling tarn and creek) is baked by `blacksiteLandscape()` in `vite.config.ts` into a near field (4,096 m at 2 m) and a far field (16,384 m at 8 m) plus the water layout. The bake is a generated artifact in the Vite cache, never committed. `src/world.ts` loads it, splats four CC0 layers (meadow grass, soil, beach sand, cliff rock) and derives the forest density the trees are placed from.

| Quantity | High / medium / low |
|---|---|
| Walkable heightfield | 4,096 m, 2,049 samples |
| Camera far | 16,000 m, with the aerial pass fading the finite ground into the sky |
| Trees | 96,000 / 64,000 / 40,000, two procedural species, impostors to 2,600 / 2,000 / 1,300 m |
| Ground cover | four procedural families to 120 / 100 / 80 m |
| Sun shadows | two cascades, 260 / 200 / 140 m |
| Main-thread p95 | 8.3 ms desktop, 16.7 ms phone |

Numbers live in `src/model.ts`; targets are not results.

## Camera bookmarks

Positions are metres above the ground. Forward down the valley is negative Z.

1. **Tarn** at the tarn's shore, the valley opening to the west.
2. **Cascade** above the creek's fall.
3. **River** on the bank, looking downstream toward the sea.
4. **Shore** at the river mouth, the open sea to the horizon.
5. **Range** across the valley floor to the southern wall.

## Assets and licensing

Ground layers are CC0 scans from ambientCG, installed through the open library (`blacksite assets add`) and credited in `CREDITS.md`. Trees, grass, flowers and leaf textures are procedural code in `@blacksite/landscape`. No owned or purchased content is used.
