import { bakeTacticalNodes, type Rect, type Region, type RuntimeWorld, type TacticalAnchor, type TacticalMap, type Vec3 } from '@blacksite/warden'

export type Kind = 'container' | 'brick' | 'panel' | 'barrier' | 'sandbag' | 'crate' | 'generator' | 'truck' | 'lada' | 'apc' | 'tank' | 'garage' | 'kiosk' | 'pallet'

export type Block = Rect & { kind: Kind; tint?: string }

export const WIDTH = 64
export const DEPTH = 44

const block = (kind: Kind, id: string, x: number, z: number, width: number, depth: number, height: number, tint?: string): Block => ({ kind, id, x, z, width, depth, height, tint })
const point = (x: number, z: number): Vec3 => ({ x, y: 0, z })
const region = (id: string, name: string, x: number, z: number, neighbors: string[]): Region => ({ id, name, center: point(x, z), neighbors })

const mirror = (source: Block, kind: Kind = source.kind, tint = source.tint): Block => ({ ...source, kind, tint, id: `${source.id}-m`, x: -source.x, z: -source.z })

const half: Block[] = [
  block('container', 'sep-a', -20.75, -9, 2.5, 2.44, 2.6, '#6f6a52'),
  block('container', 'sep-b', -13.45, -9, 6.1, 2.44, 2.6, '#7b4f3c'),
  block('container', 'sep-c', -7.35, -9, 6.1, 2.44, 2.6, '#55615a'),
  block('brick', 'sep-d', -2.95, -9, 2.9, 0.6, 3.2),
  block('brick', 'sep-e', 3.2, -9, 3.4, 0.6, 3.2),
  block('garage', 'sep-f', 10.4, -9.6, 11, 3.6, 3.6),
  block('container', 'sep-g', 20.75, -9, 2.5, 2.44, 2.6, '#6a6b5a'),
  block('garage', 'lane-garages-w', -16, -20.4, 18, 3.2, 4.2),
  block('garage', 'lane-garages-e', 12, -20.4, 14, 3.2, 4.2),
  block('barrier', 'lane-barrier-a', -10, -14.5, 2.2, 0.62, 1),
  block('lada', 'lane-lada', -3.5, -12.8, 4, 1.7, 1.4, '#3b342d'),
  block('crate', 'lane-crate-a', 5.5, -15.8, 1.5, 1.5, 1.5),
  block('crate', 'lane-crate-b', 7, -15.6, 1.1, 1.1, 1.1),
  block('pallet', 'lane-pallets', 13.5, -13, 2.4, 1.2, 1.2),
  block('barrier', 'lane-barrier-b', 19, -15.5, 0.62, 2.2, 1),
  block('generator', 'relay-generator', -2.2, -2.6, 3, 1.8, 1.6),
  block('sandbag', 'relay-bags-a', -3.2, 1.6, 0.8, 3, 1.1),
  block('sandbag', 'relay-bags-b', 0.6, -5, 2.8, 0.8, 1.1),
  block('container', 'court-wall', -7.4, -1.6, 2.44, 6.1, 2.6, '#5f6a63'),
  block('barrier', 'court-barrier-a', -7, -6.6, 0.62, 2.2, 1),
  block('barrier', 'court-barrier-b', -7.4, 4.6, 0.62, 2.2, 1),
  block('truck', 'yard-truck', -14, 2.8, 2.4, 6, 2.4, '#4a5240'),
  block('barrier', 'yard-barrier', -11.5, -4.2, 2.2, 0.62, 1),
  block('crate', 'yard-crates', -17.6, -5.2, 1.6, 1.6, 1.6),
  block('apc', 'staging-apc', -25, -6.5, 2.6, 6, 2.4),
  block('tank', 'staging-tank', -25.5, 7, 2.5, 5, 2.5),
]

const mirrorKind: Partial<Record<string, [Kind, string?]>> = {
  'sep-b': ['container', '#8a5d45'],
  'sep-c': ['container', '#7d7a64'],
  'lane-garages-w': ['container', '#5f6a63'],
  'lane-garages-e': ['container', '#7b4f3c'],
  'lane-lada': ['truck', '#4f5a45'],
  'lane-pallets': ['crate'],
  'relay-generator': ['kiosk'],
  'court-wall': ['container', '#7d7a64'],
  'yard-truck': ['container', '#6f6a52'],
  'staging-apc': ['brick'],
  'staging-tank': ['sandbag'],
}

export const blocks: Block[] = [...half, ...half.map(source => { const swap = mirrorKind[source.id]; return mirror(source, swap?.[0], swap?.[1] ?? source.tint) })]

const regions: Region[] = [
  region('west-staging', 'West staging', -26, 0, ['west-yard', 'north-west', 'south-west']),
  region('west-yard', 'West yard', -13, 0, ['west-staging', 'relay-court', 'north-west', 'south-west']),
  region('north-west', 'North lane west', -14, -15, ['west-staging', 'west-yard', 'north-gate']),
  region('north-gate', 'North gate', 0, -15, ['north-west', 'north-east', 'relay-court']),
  region('north-east', 'North lane east', 14, -15, ['north-gate', 'east-yard', 'east-staging']),
  region('relay-court', 'Relay court', 0, 0, ['west-yard', 'east-yard', 'north-gate', 'south-gate']),
  region('south-west', 'South lane west', -14, 15, ['west-staging', 'west-yard', 'south-gate']),
  region('south-gate', 'South gate', 0, 16, ['south-west', 'south-east', 'relay-court']),
  region('south-east', 'South lane east', 14, 15, ['south-gate', 'east-yard', 'east-staging']),
  region('east-yard', 'East yard', 13, 0, ['east-staging', 'relay-court', 'north-east', 'south-east']),
  region('east-staging', 'East staging', 26, 0, ['east-yard', 'north-east', 'south-east']),
]

const anchors: TacticalAnchor[] = [
  { id: 'gate-nw', kind: 'entry', x: -18, z: -9 },
  { id: 'gate-n', kind: 'entry', x: 0, z: -8.2 },
  { id: 'gate-ne', kind: 'entry', x: 18, z: -9 },
  { id: 'gate-sw', kind: 'entry', x: -18, z: 9 },
  { id: 'gate-s', kind: 'entry', x: 0, z: 8.2 },
  { id: 'gate-se', kind: 'entry', x: 18, z: 9 },
  { id: 'court-west-angle', kind: 'overwatch', x: -8.6, z: 2.4 },
  { id: 'court-east-angle', kind: 'overwatch', x: 8.6, z: -2.4 },
]

export const objective = point(0, 0)

export const RULES: RuntimeWorld['rules'] = { damage: 20, spread: 0.06, suppressedSpread: 0.1 }

export function spawns(team: 'alpha' | 'bravo', count: number): Vec3[] {
  const side = team === 'alpha' ? -1 : 1
  return Array.from({ length: count }, (_, index) => point(side * (28.2 + (index % 2) * 1.4), side * (Math.floor(index / 2) - (Math.ceil(count / 2) - 1) / 2) * 1.8))
}

export function compoundWorld(agentsPerTeam: number, rules: RuntimeWorld['rules'] = RULES): RuntimeWorld {
  const map: TacticalMap = {
    id: 'depot-7',
    name: 'Depot 7',
    version: 'depot-7/1',
    width: WIDTH,
    depth: DEPTH,
    nodes: [],
    objectives: [{ id: 'relay', position: objective, regionId: 'relay-court' }],
    obstacles: blocks.map(({ id, x, z, width, depth, height }) => ({ id, x, z, width, depth, height })),
    regions,
    spawns: { alpha: spawns('alpha', agentsPerTeam), bravo: spawns('bravo', agentsPerTeam) },
  }
  map.nodes = bakeTacticalNodes(map, anchors)
  return { map, initialAmmo: 24, rules }
}
