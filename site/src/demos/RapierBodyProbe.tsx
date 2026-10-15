import { useFrame } from '@react-three/fiber'
import { useRapier } from '@react-three/rapier'
import { reportActiveBodies } from '@blacksite/ui/perf-overlay'

export function RapierBodyProbe() {
  const { world } = useRapier()
  useFrame(() => {
    let count = 0
    world.forEachRigidBody(body => { if (!body.isFixed() && !body.isSleeping()) count++ })
    reportActiveBodies(count)
  })
  return null
}
