# World surfaces

Each folder is the 512 px KTX2 bake of a `@blacksite/materials` graph: `color` (ETC1S, sRGB), `normal` (UASTC, tangent normal with height in alpha), `orm` (UASTC, occlusion, roughness, metalness) and `masks` (UASTC, edge, cavity, low/wet, damage). Every graph reads a CC0 ambientCG scan from `packages/materials/scans/`, delights it and weathers it from its own height. Rebake with `node packages/look/scripts/bake-surfaces.mjs`.

| Surface | Graph | Scan |
| --- | --- | --- |
| `cast` | `cast-concrete-scan` | [Concrete044D](https://ambientcg.com/view?id=Concrete044D) |
| `panel` | `panel-concrete-scan` | [Concrete042A](https://ambientcg.com/view?id=Concrete042A) |
| `slab` | `slab-concrete-scan` | [Concrete031](https://ambientcg.com/view?id=Concrete031) |
| `stained` | `stained-concrete-scan` | [Concrete042A](https://ambientcg.com/view?id=Concrete042A) |
| `paint` | `painted-plaster-scan` | [PaintedPlaster015](https://ambientcg.com/view?id=PaintedPlaster015) |
| `brick` | `brick-scan` | [Bricks097](https://ambientcg.com/view?id=Bricks097) |
| `rust` | `rust-scan` | [Rust009](https://ambientcg.com/view?id=Rust009) |
| `metal` | `painted-metal-scan` | [Metal063](https://ambientcg.com/view?id=Metal063) |
| `corrugated` | `corrugated-rust-scan` | [CorrugatedSteel009](https://ambientcg.com/view?id=CorrugatedSteel009) |
| `asphalt` | `asphalt-scan` | [Asphalt015](https://ambientcg.com/view?id=Asphalt015) |
| `dirt` | `soil-scan` | [Ground103](https://ambientcg.com/view?id=Ground103) |
| `grass` | `grass-scan` | [Ground037](https://ambientcg.com/view?id=Ground037) |
| `gravel` | `gravel-soil-scan` | [Ground110](https://ambientcg.com/view?id=Ground110) |
| `wood` | `wood-planks-scan` | [Planks002](https://ambientcg.com/view?id=Planks002) |
