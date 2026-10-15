/** Column-and-slab frames with a stair core: the fixture behind the Cascade scale benchmark and demo. */
import type { DestructibleBox } from '../../destruction-authoring/src/boxes';

export const CAST = 0; // Cast concrete: columns and core walls
export const FLOOR = 1; // Floor concrete: slabs

export interface ScaleFrame {
  name: string;
  baysX: number;
  baysZ: number;
  storeys: number;
}
export const SCALE_FRAMES: ScaleFrame[] = [
  { name: 'small', baysX: 3, baysZ: 2, storeys: 4 },
  { name: 'medium', baysX: 4, baysZ: 3, storeys: 6 },
  { name: 'large', baysX: 6, baysZ: 3, storeys: 8 },
  { name: 'xl', baysX: 8, baysZ: 4, storeys: 10 },
];
export const SCALE_BAY = 6,
  SCALE_STOREY = 3.5,
  SCALE_CELL = 1;
const BAY = SCALE_BAY,
  STOREY = SCALE_STOREY,
  SLAB = 0.3,
  COLUMN = 0.6,
  WALL = 0.3;

export function scaleFrameBoxes({ baysX, baysZ, storeys }: ScaleFrame): DestructibleBox[] {
  const boxes: DestructibleBox[] = [];
  const x0 = (-baysX * BAY) / 2,
    z0 = (-baysZ * BAY) / 2;
  const core = { ix: 0, iz: 0 }; // stair core fills the corner bay
  for (let s = 0; s < storeys; s++) {
    const base = s * STOREY,
      top = base + STOREY - SLAB;
    for (let ix = 0; ix <= baysX; ix++)
      for (let iz = 0; iz <= baysZ; iz++) {
        const x = x0 + ix * BAY,
          z = z0 + iz * BAY,
          h = COLUMN / 2;
        boxes.push({
          id: `c${s}-${ix}-${iz}`,
          element: 'column',
          material: CAST,
          anchored: s === 0,
          min: [x - h, base, z - h],
          max: [x + h, top, z + h],
        });
      }
    // Core: four walls around the corner bay, between the columns.
    const cx = x0 + core.ix * BAY,
      cz = z0 + core.iz * BAY,
      h = COLUMN / 2;
    boxes.push({
      id: `w${s}-s`,
      element: 'wall',
      material: CAST,
      anchored: s === 0,
      min: [cx + h, base, cz - WALL / 2],
      max: [cx + BAY - h, top, cz + WALL / 2],
    });
    boxes.push({
      id: `w${s}-n`,
      element: 'wall',
      material: CAST,
      anchored: s === 0,
      min: [cx + h, base, cz + BAY - WALL / 2],
      max: [cx + BAY - h, top, cz + BAY + WALL / 2],
    });
    boxes.push({
      id: `w${s}-w`,
      element: 'wall',
      material: CAST,
      anchored: s === 0,
      min: [cx - WALL / 2, base, cz + h],
      max: [cx + WALL / 2, top, cz + BAY - h],
    });
    boxes.push({
      id: `w${s}-e`,
      element: 'wall',
      material: CAST,
      anchored: s === 0,
      min: [cx + BAY - WALL / 2, base, cz + h],
      max: [cx + BAY + WALL / 2, top, cz + BAY - h],
    });
    // Slab over the whole plate, one box per bay so cells stay square.
    for (let ix = 0; ix < baysX; ix++)
      for (let iz = 0; iz < baysZ; iz++)
        boxes.push({
          id: `s${s}-${ix}-${iz}`,
          element: 'slab',
          material: FLOOR,
          min: [x0 - h + ix * BAY + (ix ? h : 0), top, z0 - h + iz * BAY + (iz ? h : 0)],
          max: [
            x0 + h + (ix + 1) * BAY - (ix < baysX - 1 ? h : 0),
            top + SLAB,
            z0 + h + (iz + 1) * BAY - (iz < baysZ - 1 ? h : 0),
          ],
        });
  }
  return boxes;
}

// Knee is the gating protocol; `--charges=column` also takes out the upper half of the ground storey.
