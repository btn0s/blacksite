import { Box3, PerspectiveCamera, Vector3, type Matrix4 } from 'three'

export const ruinsViews = {
  overview: 'Overview',
  spawn: 'Spawn',
  archway: 'Archway',
  pits: 'Pits',
  cliffs: 'Cliffs',
} as const

export type RuinsView = keyof typeof ruinsViews
export type RuinsViewGeometry = {
  bounds: Box3
  placements: { bounds: Box3; matrix: Matrix4 }[]
}
export type RuinsViews = Record<Exclude<RuinsView, 'spawn'>, RuinsViewGeometry>

export const ruinsNearRadius = 12
export const ruinsHorizon = 16000

export const ruinsHome = {
  id: 1,
  name: 'Spawn',
  position: [25.8, 25.8, 4.6] as [number, number, number],
  target: [35.8, 27, 4.6] as [number, number, number],
  note: '',
}

export function createRuinsCameras(views: RuinsViews) {
  const bounds = views.overview.bounds
  const centre = bounds.getCenter(new Vector3())
  const diameter = bounds.getSize(new Vector3()).length()
  const aspect = window.innerWidth / window.innerHeight
  const home = ruinsHome
  const cameraFor = (geometry: RuinsViewGeometry, direction: Vector3) => {
    const camera = new PerspectiveCamera(55, aspect)
    const target = geometry.bounds.getCenter(new Vector3())
    const back = direction.normalize()
    const right = new Vector3(0, 1, 0).cross(back).normalize()
    const up = back.clone().cross(right)
    const tanY = Math.tan(camera.fov * Math.PI / 360) / 1.08
    const tanX = tanY * aspect
    const point = new Vector3()
    let left = -Infinity, rightLimit = Infinity, bottom = -Infinity, top = Infinity, front = -Infinity
    for (const placement of geometry.placements) {
      for (let corner = 0; corner < 8; corner++) {
        point.set(
          corner & 1 ? placement.bounds.max.x : placement.bounds.min.x,
          corner & 2 ? placement.bounds.max.y : placement.bounds.min.y,
          corner & 4 ? placement.bounds.max.z : placement.bounds.min.z,
        ).applyMatrix4(placement.matrix).sub(target)
        const x = point.dot(right), y = point.dot(up), z = point.dot(back)
        left = Math.max(left, x + z * tanX)
        rightLimit = Math.min(rightLimit, x - z * tanX)
        bottom = Math.max(bottom, y + z * tanY)
        top = Math.min(top, y - z * tanY)
        front = Math.max(front, z)
      }
    }
    const distance = Math.max((left - rightLimit) / (2 * tanX), (bottom - top) / (2 * tanY), front + 0.1)
    target.addScaledVector(right, (left + rightLimit) / 2).addScaledVector(up, (bottom + top) / 2)
    camera.position.copy(target).addScaledVector(back, distance)
    camera.near = Math.max(0.1, bounds.distanceToPoint(camera.position) / 1000)
    camera.far = Math.max(Math.max(diameter, camera.position.distanceTo(centre) + diameter / 2) * 1.1, ruinsHorizon)
    camera.lookAt(target)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld()
    return camera
  }
  const coastDirection = views.archway.bounds.getCenter(new Vector3()).sub(views.cliffs.bounds.getCenter(new Vector3())).setY(0).normalize().setY(0.35)
  const spawn = new PerspectiveCamera(55, aspect, 0.1, Math.max(diameter * 1.1, ruinsHorizon))
  spawn.position.set(...home.position).add(new Vector3(0, 1.6, 0))
  spawn.lookAt(new Vector3(...home.target))
  spawn.updateMatrixWorld()
  return {
    overview: cameraFor(views.overview, new Vector3(-0.45, 0.85, -0.5)),
    spawn,
    archway: cameraFor(views.archway, new Vector3(0, 0.18, 1)),
    pits: cameraFor(views.pits, new Vector3(0, 1, 0.1)),
    cliffs: cameraFor(views.cliffs, coastDirection),
  }
}
