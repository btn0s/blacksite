import { PerspectiveCamera, Vector3 } from 'three'

export const archwayViews = {
  wide: { label: 'Wide', position: [0, 9, 34], target: [0, 7, 0], fov: 55 },
  close: { label: 'Close', position: [-6.7, 2.5, 7.1], target: [-6.7, 2.5, 4.9], fov: 55 },
} satisfies Record<string, { label: string; position: [number, number, number]; target: [number, number, number]; fov: number }>

export type ArchwayView = keyof typeof archwayViews | 'walk'

export function createArchwayHome(centre: [number, number, number]) {
  return { id: 1, name: 'Archway', position: new Vector3(0, 2, 7.1).add(new Vector3(...centre)).toArray() as [number, number, number], target: new Vector3(0, 6, 0).add(new Vector3(...centre)).toArray() as [number, number, number], note: '' }
}

export function createArchwayCameras(centre: [number, number, number]) {
  const origin = new Vector3(...centre)
  const cameraFor = (view: typeof archwayViews[keyof typeof archwayViews]) => {
    const camera = new PerspectiveCamera(view.fov, 16 / 9, 0.1, 500)
    camera.position.set(...view.position).add(origin)
    camera.lookAt(new Vector3(...view.target).add(origin))
    camera.updateMatrixWorld()
    return camera
  }
  return {
    wide: cameraFor(archwayViews.wide),
    close: cameraFor(archwayViews.close),
    walk: new PerspectiveCamera(55, 16 / 9, 0.1, 500),
  }
}
