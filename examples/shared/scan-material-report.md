# Whole-level surface translation

Source inventory: 301 active material paths. Before: 259 supported, 33 untranslated, 9 excluded. The translated descriptor contains 285 supported, 0 untranslated, 16 excluded.

| Translated parent | Paths | Visible placements |
| --- | ---: | ---: |
| M_GenericProps | 7 | 186 |
| M_Cutout | 1 | 3 |
| M_MS_CustomFoliage | 8 | 525 |
| M_BlendMaterial | 4 | 204 |
| MI_Massive_Nordic_Coastal_Cliff_ullqbb1ga_Dungeon → M_MS_CustomGeneral | 1 | 22 |
| M_Emissive | 2 | 5 |
| M_Metal_Burnished_Steel1 | 1 | 1 |
| BasicShapeMaterial | 1 | 3 |
| WorldGridMaterial | 1 | 6 |

Placement counts are unique within each parent, with overlaps between parents. The inherited cliff follows the parent chain and retains the child's effective parameters and texture assignments.

The prop and general graphs share authored pure-metal color modulation, vertex-color metal masks and derived roughness. This also covers the chains and sword branches previously counted as supported. Hallway surfaces blend three height-aware texture layers and the painted wet layer using source vertex colors, tiling and rotation. Foliage uses packed blue opacity, packed red light transmission, alpha-tested depth/shadows and thin-surface scattering. Rope uses its separate cutout texture. Steel and the grid use the constant images referenced by their parent graphs.

Fidelity is aimed at normal viewing distances. Foliage uses shared authored UVs; source per-actor random UV phase is omitted. Thin-surface scattering uses the stack's scattering model. Source displacement remains outside the static surface translation.

The seven additional exclusions are M_MagicEnergy (animated translucent displaced energy), MI_MS_Ocean, MI_MS_Puddle and MI_MS_Puddle_02 (scene-depth water scattering/absorption), and the three M_MS_CustomDecal instances (projected receiver/material-buffer blending). The existing flame and fog exclusions remain. Excluded paths have reasons and placement/primitive records in the material manifest; no replacement surface is generated.

`scan-material-source.mjs` resolves the complete exported material closure. `writeScanMaterialSource(source, approvedSource, uses, output, graphTextures)` accepts the geometry census's active surface uses and the source-image metadata for constant graph textures. `buildScanMaterials` writes version-2 compressed mip tails, their coverage and the exclusion inventory into a new owned build directory. Existing published manifests remain separate from this output.
