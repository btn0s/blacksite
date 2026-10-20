import { Box3, PerspectiveCamera, Vector3 } from 'three'

export const ruinsViews = {
  overview: 'Overview',
  spawn: 'Spawn',
  archway: 'Archway',
  pits: 'Pits',
  cliffs: 'Cliffs',
} as const

export type RuinsView = keyof typeof ruinsViews
export type RuinsLandmarks = Record<'archway' | 'pits' | 'cliffs', Box3>

export function createRuinsHome(archway: Box3) {
  const base = archway.getCenter(new Vector3()).setY(archway.min.y)
  return {
    id: 1,
    name: 'Spawn',
    position: base.clone().add(new Vector3(0, 2, 7.1)).toArray() as [number, number, number],
    target: base.clone().add(new Vector3(0, 6, 0)).toArray() as [number, number, number],
    note: '',
  }
}

export function createRuinsCameras(bounds: Box3, landmarks: RuinsLandmarks) {
  const centre = bounds.getCenter(new Vector3())
  const diameter = bounds.getSize(new Vector3()).length()
  const aspect = window.innerWidth / window.innerHeight
  const home = createRuinsHome(landmarks.archway)
  const cameraFor = (box: Box3, direction: Vector3) => {
    const camera = new PerspectiveCamera(55, aspect)
    const target = box.getCenter(new Vector3())
    const halfFov = Math.min(Math.atan(Math.tan(camera.fov * Math.PI / 360) * aspect), camera.fov * Math.PI / 360)
    const distance = box.getSize(new Vector3()).length() * 0.55 / Math.sin(halfFov)
    camera.position.copy(target).addScaledVector(direction.normalize(), distance)
    camera.near = Math.max(0.1, bounds.distanceToPoint(camera.position) / 1000)
    camera.far = Math.max(diameter, camera.position.distanceTo(centre) + diameter / 2) * 1.1
    camera.lookAt(target)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
    return camera
  }
  const coastDirection = landmarks.cliffs.getCenter(new Vector3()).sub(landmarks.archway.getCenter(new Vector3())).setY(0).normalize().setY(0.35)
  const spawn = new PerspectiveCamera(55, aspect, 0.1, diameter * 1.1)
  spawn.position.set(...home.position).add(new Vector3(0, 1.6, 0))
  spawn.lookAt(new Vector3(...home.target))
  spawn.updateMatrixWorld()
  return {
    overview: cameraFor(bounds, new Vector3(-0.45, 0.85, -0.5)),
    spawn,
    archway: cameraFor(landmarks.archway, new Vector3(0, 0.18, 1)),
    pits: cameraFor(landmarks.pits, new Vector3(-0.4, 0.9, 0.75)),
    cliffs: cameraFor(landmarks.cliffs, coastDirection),
  }
}
