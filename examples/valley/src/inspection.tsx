import { useCallback } from 'react'
import type { Inspector } from '@blacksite/inspect'
import type { CharacterHandle } from '@blacksite/subject'
import { SceneInspection, type InspectionContent, type TelemetryAction } from '../../shared/Inspection'
import type { Shared } from './Game'

export type { TelemetryAction } from '../../shared/Inspection'

export function Inspection({ shared, walker, inspector, telemetry }: { shared: Shared; walker: CharacterHandle; inspector: Inspector; telemetry: TelemetryAction }) {
  const content = useCallback((): InspectionContent | null => {
    const landscape = shared.landscape.current
    if (!landscape) return null
    return {
      identity: landscape,
      roots: [landscape.terrain.object, landscape.cover.object, landscape.forest.object, landscape.rocks.object],
      sources: [landscape.terrain.stats, landscape.cover.stats, landscape.forest.stats, landscape.rocks.stats],
      techniques: [
        { id: 'terrain-lod', label: 'Terrain LOD', description: 'Off: finest grid within 256 m; LOD beyond the cap.', enabled: true, setEnabled: landscape.terrain.setLodEnabled },
        { id: 'tree-lod', label: 'Tree LOD / impostors', description: `Off: source meshes within ${landscape.forest.fallbackDistance} m.`, enabled: true, setEnabled: landscape.forest.setLodEnabled },
        { id: 'tree-culling', label: 'GPU tree culling', description: `Off: all trees within ${landscape.forest.fallbackDistance} m.`, enabled: true, setEnabled: landscape.forest.setCullingEnabled },
        { id: 'cover-culling', label: 'GPU ground-cover culling', description: `Off: all cover within ${landscape.cover.fallbackDistance} m.`, enabled: true, setEnabled: landscape.cover.setCullingEnabled },
        { id: 'cover-lod', label: 'Ground-cover impostors', description: `Off: source meshes within ${landscape.cover.fallbackDistance} m.`, enabled: true, setEnabled: landscape.cover.setLodEnabled },
        { id: 'meshlet-lod', label: 'Stone meshlet LOD', description: 'Off: source detail within 120 m.', enabled: true, setEnabled: landscape.rocks.setLodEnabled },
        { id: 'meshlet-occlusion', label: 'Stone HiZ culling', description: 'Terrain, trees and stonework occlude stone clusters.', enabled: true, setEnabled: landscape.rocks.setOcclusionEnabled },
        { id: 'meshlet-shadows', label: 'Stone cascade shadows', description: 'Each sun cascade selects its own clusters.', enabled: true, setEnabled: landscape.rocks.setShadowEnabled },
      ],
      setView(view) {
        const lod = view === 'lod'
        landscape.terrain.setLodView(lod)
        landscape.forest.setLodView(lod)
        landscape.cover.setLodView(lod)
        landscape.rocks.setLodView(lod)
        shared.look.current?.setDebug(lod)
      },
      details: () => ({ terrain: { ...landscape.terrain.stats }, cover: { ...landscape.cover.stats }, forest: { ...landscape.forest.stats }, rocks: { ...landscape.rocks.stats } }),
    }
  }, [shared])
  return <SceneInspection name="valley" look={shared.look} warm={shared.warm} walker={walker} inspector={inspector} telemetry={telemetry} content={content} />
}
