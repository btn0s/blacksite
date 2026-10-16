import { createDestructibleBoxes } from '../../destruction-authoring/src/boxes'
import { scaleFrameBoxes, type ScaleFrame } from '../../destruction-testkit/src/scale-frame'

export function createShowcaseFrame(shape: ScaleFrame = { name: 'showcase', baysX: 4, baysZ: 2, storeys: 5 }) {
  const { manifest } = createDestructibleBoxes(scaleFrameBoxes(shape), {
    id: shape.name,
    cellSize: 1,
    maxFragments: 10_000,
  })
  manifest.level = {
    boxes: [],
    camera: { position: [43, 27, 48], target: [0, 9, 0] },
    spawn: { position: [0, 0.05, 20], yaw: 0 },
  }
  return manifest
}
