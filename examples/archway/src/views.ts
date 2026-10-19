import { PerspectiveCamera } from 'three'

export const archwayViews = {
  wide: { label: 'Wide', position: [0, 10, 34], target: [0, 10, 0], fov: 55 },
  close: { label: 'Close', position: [-6.7, 2.5, 7.1], target: [-6.7, 2.5, 4.9], fov: 55 },
} satisfies Record<string, { label: string; position: [number, number, number]; target: [number, number, number]; fov: number }>

export type ArchwayView = keyof typeof archwayViews | 'walk'

export function createArchwayCameras() {
  const cameraFor = (view: typeof archwayViews[keyof typeof archwayViews]) => {
    const camera = new PerspectiveCamera(view.fov, 16 / 9, 0.1, 500)
    camera.position.set(...view.position)
    camera.lookAt(...view.target)
    camera.updateMatrixWorld()
    return camera
  }
  return {
    wide: cameraFor(archwayViews.wide),
    close: cameraFor(archwayViews.close),
    walk: new PerspectiveCamera(55, 16 / 9, 0.1, 500),
  }
}
