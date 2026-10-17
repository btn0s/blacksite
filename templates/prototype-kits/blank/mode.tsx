import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type * as THREE from 'three'
import { CheckProbe } from '../../game-shell/src/game/check'
import { PlayHud } from '../../game-shell/src/game/hud'
import { FEEL } from '../../game-shell/src/game/model'
import { Stage, surfacesReady, useSurfaces } from '../../game-shell/src/game/stage'
import { WalkerBody, createWalker, type Walker } from '../../game-shell/src/game/walker'

function Body({ walker }: { walker: Walker }) {
  const mesh = useRef<THREE.Mesh>(null)
  useFrame(() => {
    const body = mesh.current
    if (!body) return
    body.position.set(walker.position.x, walker.position.y + FEEL.capsuleHeight / 2, walker.position.z)
    body.rotation.y = -walker.yaw
  }, 0.2)
  return <mesh ref={mesh} castShadow receiveShadow>
    <capsuleGeometry args={[FEEL.capsuleRadius, FEEL.capsuleHeight - FEEL.capsuleRadius * 2, 6, 14]} />
    <meshStandardMaterial color="#7d8070" roughness={0.85} />
  </mesh>
}

export default function Mode() {
  const walker = useMemo(createWalker, [])
  const ready = useSurfaces()
  return <>
    <Stage>
      <WalkerBody walker={walker} view="follow" />
      <Body walker={walker} />
      <CheckProbe
        ready={surfacesReady}
        reset={walker.reset}
        player={() => ({ position: [walker.position.x, walker.position.y, walker.position.z], velocity: [walker.motor.velocity.x, walker.motor.velocity.y, walker.motor.velocity.z], grounded: walker.motor.grounded })} />
    </Stage>
    <PlayHud ready={ready} hints={[['WASD', 'Move'], ['Mouse', 'Look'], ['Shift', 'Sprint'], ['Space', 'Jump'], ['Esc', 'Pause']]} buttons={[{ id: 'jump', label: 'Jump' }, { id: 'sprint', label: 'Sprint' }]} />
  </>
}
