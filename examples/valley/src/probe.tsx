import { useEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { sampleView } from '@blacksite/check'
import type { CharacterHandle } from '@blacksite/subject'
import type { Shared } from './Game'
import type { ValleyWorld } from './world'

export function Probe({ shared, walker, world }: { shared: Shared; walker: CharacterHandle; world: ValleyWorld }) {
  const { camera } = useThree()
  const ready = useRef(false)
  useFrame(() => {
    if (shared.warm.current > 0) shared.warm.current++
    ready.current = walker.als.pose.current.ready && !!shared.landscape.current && shared.warm.current > 10
  }, 0.6)
  useEffect(() => {
    const valley = {
      camera,
      world,
      ready: () => ready.current,
      state: () => ({
        ready: ready.current,
        warmFrames: shared.warm.current,
        position: walker.position.toArray(),
        view: sampleView(camera),
        terrain: shared.landscape.current?.terrain.stats,
        cover: shared.landscape.current?.cover.stats,
        forest: shared.landscape.current?.forest.stats,
        rocks: shared.landscape.current?.rocks.stats,
        timings: world.timings,
      }),
    }
    Object.assign(window, { __valley: valley })
    return () => { if ((window as { __valley?: unknown }).__valley === valley) delete (window as { __valley?: unknown }).__valley }
  }, [camera, shared, walker, world])
  return null
}
