import { createDestructibleBoxes, type DestructibleBox } from '@blacksite/cascade'

type Vec3 = [number, number, number]

export const BLOCK = { bays: 10, bay: 3.6, depth: 12, storeys: 6, storey: 3, slab: 0.25, wall: 0.3, window: 1.6 }
export const BLOCK_LENGTH = BLOCK.bays * BLOCK.bay
export const BLOCK_HEIGHT = BLOCK.storeys * BLOCK.storey

const entrances = new Set([2, 7])
const balconies = new Set([1, 4, 5, 8])

export function blockBoxes() {
  const boxes: DestructibleBox[] = []
  const { bays, bay, depth, storeys, storey, slab, wall, window } = BLOCK
  const x0 = -BLOCK_LENGTH / 2
  const z1 = depth / 2
  const add = (id: string, element: DestructibleBox['element'], min: Vec3, max: Vec3, anchored = false) => boxes.push({ id, element, min, max, anchored })
  for (let s = 0; s < storeys; s++) {
    const base = s * storey
    const top = base + storey - slab
    const ground = s === 0
    for (const side of [-1, 1]) {
      const zi = side > 0 ? z1 - wall : -z1
      const zo = side > 0 ? z1 : -z1 + wall
      for (let b = 0; b < bays; b++) {
        const x = x0 + b * bay
        const left = x + (bay - window) / 2
        const right = left + window
        const tag = `${s}-${side > 0 ? 'f' : 'r'}-${b}`
        add(`pier-l-${tag}`, 'wall', [x, base, zi], [left, top, zo], ground)
        add(`pier-r-${tag}`, 'wall', [right, base, zi], [x + bay, top, zo], ground)
        const door = ground && side > 0 && entrances.has(b)
        if (!door) {
          add(`sill-${tag}`, 'wall', [left, base, zi], [right, base + 0.9, zo], ground)
          add(`glass-${tag}`, 'glass', [left + 0.04, base + 0.9, (zi + zo) / 2 - 0.03], [right - 0.04, base + 2.4, (zi + zo) / 2 + 0.03])
        }
        add(`lintel-${tag}`, 'wall', [left, door ? base + 2.2 : base + 2.4, zi], [right, top, zo])
        if (side > 0 && s > 0 && balconies.has(b)) {
          add(`balcony-${tag}`, 'slab', [left - 0.5, base - slab, z1], [right + 0.5, base, z1 + 1.15])
          add(`rail-${tag}`, 'trim', [left - 0.5, base, z1 + 1.03], [right + 0.5, base + 1, z1 + 1.15])
        }
      }
    }
    for (const side of [-1, 1]) {
      const x = side * BLOCK_LENGTH / 2
      add(`gable-${s}-${side}`, 'wall', [side > 0 ? x - wall : x, base, -z1 + wall], [side > 0 ? x : x + wall, top, z1 - wall], ground)
    }
    for (let c = 1; c < 5; c++) {
      const x = x0 + c * bay * 2
      add(`cross-${s}-${c}-a`, 'wall', [x - 0.1, base, -z1 + wall], [x + 0.1, top, -0.7], ground)
      add(`cross-${s}-${c}-b`, 'wall', [x - 0.1, base, 0.7], [x + 0.1, top, z1 - wall], ground)
    }
    add(`slab-${s}`, s === storeys - 1 ? 'roof' : 'slab', [x0, top, -z1], [-x0, base + storey, z1])
  }
  const roof = storeys * storey
  add('parapet-f', 'trim', [x0, roof, z1 - 0.25], [-x0, roof + 0.6, z1])
  add('parapet-r', 'trim', [x0, roof, -z1], [-x0, roof + 0.6, -z1 + 0.25])
  add('stair-hut', 'wall', [-3, roof, -3], [1.5, roof + 2.4, 1])
  return boxes
}

export function createBlock(maxFragments = 4200) {
  const { manifest, fragmentSource } = createDestructibleBoxes(blockBoxes(), { id: 'air-strike-block', cellSize: 1.6, maxFragments, storeyHeight: BLOCK.storey, panelWidth: BLOCK.bay * 2 })
  manifest.level = { boxes: [], camera: { position: [-34, 10, 64], target: [0, 8, 0] }, spawn: { position: [0, 0.05, 30], yaw: 0 } }
  return { manifest, fragmentSource }
}
