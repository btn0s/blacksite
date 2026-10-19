import { loadFoliageModel } from '@blacksite/landscape'
import { loadMeshletModel } from '@blacksite/geometry'
import { ruinDimensions, type RuinPiece } from './stonework'

export async function loadOwned() {
  const [foliage, rock, ruinEntries] = await Promise.all([
    Promise.all(['scots-pine', 'birch', 'meadow-grass', 'bunch-grass', 'dry-brome', 'gooseberry', 'nettle', 'dock', 'thistle', 'ivy'].map(name => loadFoliageModel(`/owned/rileyb3d/${name}.glb`))),
    loadMeshletModel('/owned/meshlets/field-rock/manifest.json'),
    Promise.all((Object.keys(ruinDimensions) as RuinPiece[]).map(async id => [id, await loadMeshletModel(`/owned/valley-ruins/meshlets/${id}/manifest.json`)] as const)),
  ])
  const ruins = Object.fromEntries(ruinEntries) as Record<RuinPiece, Awaited<ReturnType<typeof loadMeshletModel>>>
  const [pine, birch, meadow, bunch, brome, gooseberry, nettle, dock, thistle, ivy] = foliage
  const pineLod = await loadFoliageModel('/owned/rileyb3d/scots-pine-lod.glb', { materialsFrom: pine })
  return { pine, pineLod, birch, meadow, bunch, brome, gooseberry, nettle, dock, thistle, ivy, rock, ruins }
}

export type Owned = Awaited<ReturnType<typeof loadOwned>>
