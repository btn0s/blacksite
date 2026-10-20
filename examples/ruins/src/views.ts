import { Box3, PerspectiveCamera, Vector3 } from 'three'

export const ruinsViews = {
  wide: { label: 'Overview', position: [-150, 180, 220], target: [0, 10, -80], fov: 60 },
  close: { label: 'Courtyard', position: [-8, 3, 17], target: [0, 5, 0], fov: 55 },
} satisfies Record<string, { label: string; position: [number, number, number]; target: [number, number, number]; fov: number }>

export type RuinsView = keyof typeof ruinsViews | 'walk'

export function createRuinsCameras(bounds: Box3) {
  const cameraFor = (view: typeof ruinsViews[keyof typeof ruinsViews]) => {
    const camera = new PerspectiveCamera(view.fov, 16 / 9, 0.1, 2500)
    camera.position.set(...view.position)
    camera.lookAt(...view.target)
    camera.updateMatrixWorld()
    return camera
  }
  const center = bounds.getCenter(new Vector3())
  const extent = bounds.getSize(new Vector3())
  const overview = { ...ruinsViews.wide, position: [center.x + extent.x * 0.4, bounds.max.y + extent.z * 0.5, center.z + extent.z * 0.5] as [number, number, number], target: center.toArray() as [number, number, number] }
  return { wide: cameraFor(overview), close: cameraFor(ruinsViews.close), walk: new PerspectiveCamera(55, 16 / 9, 0.1, 2500) }
}
