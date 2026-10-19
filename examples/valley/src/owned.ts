import { loadFoliageModel } from '@blacksite/landscape'
import { loadMeshletModel } from '@blacksite/geometry'
import { ruinPieces, type RuinPiece, type Triple } from './stonework'

type KitManifest = { pieces: { id: string; dimensions: Triple; manifest: string }[] }

async function loadRuinKit() {
  const response = await fetch('/owned/valley-ruins/manifest.json')
  if (!response.ok) throw new Error(`Missing ruin kit manifest (${response.status})`)
  const kit = await response.json() as KitManifest
  const entries = await Promise.all(ruinPieces.map(async id => {
    const piece = kit.pieces.find(entry => entry.id === id)
    if (!piece) throw new Error(`The ruin kit has no ${id}`)
    return [id, { model: await loadMeshletModel(`/owned/valley-ruins/${piece.manifest}`), dimensions: piece.dimensions }] as const
  }))
  return Object.fromEntries(entries) as Record<RuinPiece, { model: Awaited<ReturnType<typeof loadMeshletModel>>; dimensions: Triple }>
}

export async function loadOwned() {
  const [foliage, ruins] = await Promise.all([
    Promise.all(['scots-pine', 'birch', 'meadow-grass', 'bunch-grass', 'dry-brome', 'gooseberry', 'nettle', 'dock', 'thistle', 'ivy'].map(name => loadFoliageModel(`/owned/rileyb3d/${name}.glb`))),
    loadRuinKit(),
  ])
  const [pine, birch, meadow, bunch, brome, gooseberry, nettle, dock, thistle, ivy] = foliage
  const pineLod = await loadFoliageModel('/owned/rileyb3d/scots-pine-lod.glb', { materialsFrom: pine })
  return { pine, pineLod, birch, meadow, bunch, brome, gooseberry, nettle, dock, thistle, ivy, ruins }
}

export type Owned = Awaited<ReturnType<typeof loadOwned>>
