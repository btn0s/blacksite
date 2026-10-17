import * as THREE from 'three'
import { exposeCheck, type Bookmark, type Vec3 } from '@blacksite/check'
import type { AirStrikeScene } from './scene'

const CORNER: Vec3 = [-16.2, 1.5, 6]
const STRIKES = 3
const BETWEEN = 3.5
const COLLAPSE = 6

function wait(seconds: number) {
  return new Promise<void>(resolve => window.setTimeout(resolve, seconds * 1000))
}

export function exposeAirStrikeCheck(scene: AirStrikeScene) {
  const target = scene.rig.target.toArray() as Vec3
  const view = (name: string, yaw: number, pitch: number, distance: number): Bookmark => ({ name, position: scene.rig.place(yaw, pitch, distance).toArray() as Vec3, target })
  return exposeCheck({
    bookmarks: [view('front', -0.52, 0.13, 64), view('corner', -1.2, 0.2, 48), view('high', 0.6, 0.55, 80)],
    camera: pose => scene.aim(pose),
    scripts: {
      async perf() {
        scene.choose('missile')
        for (let i = 0; i < STRIKES; i++) {
          if (i > 0) await wait(BETWEEN)
          scene.callStrike(new THREE.Vector3(...CORNER))
        }
        await wait(COLLAPSE)
        const down = scene.state.detached
        if (down === 0) throw new Error(`${STRIKES} missiles at the corner [${CORNER.join(', ')}] brought nothing down`)
        scene.rebuild()
        await wait(1)
      },
      async freeze() { scene.hold(true) },
      async unfreeze() { scene.hold(false) },
    },
    model: { scripts: { perf: (STRIKES - 1) * BETWEEN + COLLAPSE + 2 } },
  })
}
