import { bakeTacticalNodes, type Rect, type RuntimeWorld, type TacticalMap, type Vec3 } from '@blacksite/warden'
import { ANCHORS, ENCOUNTERS, LEVEL, REGIONS, START, WORLD, type Encounter } from './layout'

const point = (x: number, z: number): Vec3 => ({ x, y: 0, z })

function clip(id: string, minX: number, minZ: number, maxX: number, maxZ: number, height: number): Rect | null {
  const x0 = Math.max(minX, -WORLD.width / 2), x1 = Math.min(maxX, WORLD.width / 2)
  const z0 = Math.max(minZ, -WORLD.depth / 2), z1 = Math.min(maxZ, WORLD.depth / 2)
  if (x1 - x0 < 0.01 || z1 - z0 < 0.01) return null
  return { id, x: (x0 + x1) / 2, z: (z0 + z1) / 2, width: x1 - x0, depth: z1 - z0, height }
}

export function obstacles(): Rect[] {
  const rects: Rect[] = []
  for (const block of LEVEL.blocks) {
    if (!block.solid || block.min[1] > 0.3 || block.max[1] < 0.5) continue
    const rect = clip(block.id, block.min[0], block.min[2], block.max[0], block.max[2], block.max[1])
    if (rect) rects.push(rect)
  }
  LEVEL.voids.forEach((area, index) => {
    const rect = clip(`void-${index}`, area.min[0], area.min[1], area.max[0], area.max[1], 8)
    if (rect) rects.push(rect)
  })
  return rects
}

let baked: TacticalMap | null = null

export function buildingMap(): TacticalMap {
  if (baked) return baked
  const map: TacticalMap = {
    id: 'breach-building',
    name: 'Ruined works',
    version: 'breach/1',
    width: WORLD.width,
    depth: WORLD.depth,
    nodes: [],
    objectives: ENCOUNTERS.map(encounter => ({ id: encounter.id, position: point(...encounter.objective), regionId: regionOf(encounter) })),
    obstacles: obstacles(),
    regions: REGIONS.map(region => ({ id: region.id, name: region.name, center: point(...region.center), neighbors: region.neighbors })),
    spawns: { alpha: [], bravo: [] },
  }
  map.nodes = bakeTacticalNodes(map, ANCHORS, { spacing: 1.5 })
  baked = map
  return map
}

function regionOf(encounter: Encounter) {
  return encounter.id === 'lobby' ? 'lobby' : encounter.id === 'hall' ? 'hall-south' : 'office'
}

export function encounterWorld(encounter: Encounter): RuntimeWorld {
  const base = buildingMap()
  return {
    map: {
      ...base,
      id: `breach-${encounter.id}`,
      objectives: base.objectives.filter(objective => objective.id === encounter.id),
      spawns: { alpha: [point(START.position[0], Math.min(START.position[2], WORLD.depth / 2 - 1))], bravo: encounter.soldiers.map(soldier => point(...soldier.at)) },
    },
    initialAmmo: 24,
  }
}
