import { useEffect, useMemo, type ReactNode } from 'react'
import type { RootState } from '@react-three/fiber'
import { InputProvider } from '@blacksite/input'
import { CharacterController, CharacterOverlay, createCharacterController, type CharacterEvents } from '@blacksite/subject'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import { CheckProbe } from '../../game-shell/src/game/check'
import { footsteps } from '../../game-shell/src/game/footsteps'
import { input } from '../../game-shell/src/game/input'
import { CHARACTER_FEEL, GAIT_SPEEDS } from '../../game-shell/src/game/model'
import { Stage, surfacesReady, useSurfaces } from '../../game-shell/src/game/stage'
import { yard } from '../../game-shell/src/game/yard'

function createPlayer() {
  return createCharacterController({ views: ['shoulder'], start: { position: yard.spawn, yaw: -Math.PI / 2 }, gaits: GAIT_SPEEDS, input })
}

const events: CharacterEvents = { onFootstep: request => footsteps.PlayFootstepSound(request) }

export default function Mode({ paused = false, onCreated, physicsProbe }: { paused?: boolean; onCreated?: (state: RootState) => void; physicsProbe?: ReactNode } = {}) {
  const player = useMemo(createPlayer, [])
  const ready = useSurfaces()
  useEffect(() => player.setPaused(paused), [player, paused])
  return <InputProvider runtime={input}>
    <Stage physicsPriority={ALS_FRAME_PRIORITY.Physics} onCreated={onCreated}>
      <CharacterController controller={player} events={events} />
      <CheckProbe
        priority={ALS_FRAME_PRIORITY.Camera + 0.05}
        feel={CHARACTER_FEEL}
        reset={() => player.respawn()}
        ready={() => surfacesReady() && player.als.pose.current.ready}
        player={() => ({ position: [player.position.x, player.position.y, player.position.z], velocity: [player.velocity.x, player.velocity.y, player.velocity.z], grounded: player.grounded })}
        character={player.check} />
      {physicsProbe}
    </Stage>
    <CharacterOverlay controller={player} visible={ready} />
  </InputProvider>
}
