import { loadFoliageModel } from '@blacksite/landscape'
import { loadMeshletModel } from '@blacksite/geometry'

export async function loadOwned() {
  const [foliage, rock, cliff] = await Promise.all([
    Promise.all(['scots-pine', 'birch', 'meadow-grass', 'bunch-grass', 'dry-brome', 'gooseberry', 'nettle', 'dock', 'thistle', 'ivy'].map(name => loadFoliageModel(`/owned/rileyb3d/${name}.glb`))),
    loadMeshletModel('/owned/meshlets/field-rock/manifest.json'),
    loadMeshletModel('/owned/meshlets/coastal-cliff/manifest.json'),
  ])
  const [pine, birch, meadow, bunch, brome, gooseberry, nettle, dock, thistle, ivy] = foliage
  const pineLod = await loadFoliageModel('/owned/rileyb3d/scots-pine-lod.glb', { materialsFrom: pine })
  return { pine, pineLod, birch, meadow, bunch, brome, gooseberry, nettle, dock, thistle, ivy, rock, cliff }
}

export type Owned = Awaited<ReturnType<typeof loadOwned>>
