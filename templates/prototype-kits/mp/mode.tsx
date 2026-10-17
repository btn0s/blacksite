import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { RootState } from '@react-three/fiber'
import { ALS_WEAPONS } from '@blacksite/armory'
import { InputProvider } from '@blacksite/input'
import { createLoopbackRoom, type Connection } from '@blacksite/relay'
import { createColyseusTransport } from '@blacksite/relay/colyseus'
import { CharacterOverlay, Replication, createCharacterController, useCharacterStatus, type CharacterEvents, type ReplicationStatus } from '@blacksite/subject'
import { FIELD_SET, VIEWMODEL_WEAPONS, foundTimings, type ArmsPresentation } from '@blacksite/subject/arms'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'
import { CheckProbe } from '../../game-shell/src/game/check'
import { footsteps } from '../../game-shell/src/game/footsteps'
import { input } from '../../game-shell/src/game/input'
import { CHARACTER_FEEL, FEEL, GAIT_SPEEDS } from '../../game-shell/src/game/model'
import { sound } from '../../game-shell/src/game/sound'
import { Stage, surfacesReady, useSurfaces } from '../../game-shell/src/game/stage'
import { yard } from '../../game-shell/src/game/yard'

const relay = import.meta.env.VITE_RELAY_URL || (import.meta.env.DEV ? `${location.origin}/relay` : '')

const WEAPONS = (['rifle', 'pistol'] as const).map(id => ({
  definition: { ...ALS_WEAPONS.find(weapon => weapon.id === id)!, ...foundTimings(FIELD_SET, id) },
  adsFov: VIEWMODEL_WEAPONS[id].aimFov,
  adsSeconds: 0.2,
  overlay: id === 'pistol' ? 'PistolTwoHanded' as const : 'Rifle' as const,
}))

function createPlayer() {
  return createCharacterController({ views: ['arms', 'shoulder'], start: { position: yard.spawn, yaw: -Math.PI / 2 }, weapons: WEAPONS, gaits: GAIT_SPEEDS, fov: FEEL.fov, input })
}

const events: CharacterEvents = {
  onFootstep: request => footsteps.PlayFootstepSound(request),
  onWeapon(event) {
    if (event.type === 'shot') sound.play(`weapon.${event.weaponId}`, { position: [event.origin.x, event.origin.y, event.origin.z] })
    if (event.type === 'impact') sound.play('impact.concrete', { position: [event.hit.point.x, event.hit.point.y, event.hit.point.z], delay: true })
  },
}

function useConnection() {
  const [joined, setJoined] = useState<{ connection: Connection; online: boolean } | null>(null)
  useEffect(() => {
    let active = true
    let open: Connection | null = null
    const accept = (connection: Connection, online: boolean) => { open = connection; if (active) setJoined({ connection, online }); else connection.close() }
    const offline = () => createLoopbackRoom().connect().then(connection => accept(connection, false))
    if (relay) createColyseusTransport(relay).connect().then(connection => accept(connection, true), offline)
    else void offline()
    return () => { active = false; open?.close() }
  }, [])
  return joined
}

export default function Mode({ paused = false, onCreated, physicsProbe }: { paused?: boolean; onCreated?: (state: RootState) => void; physicsProbe?: ReactNode } = {}) {
  const joined = useConnection()
  const player = useMemo(createPlayer, [])
  const character = useCharacterStatus(player)
  const [presentation, setPresentation] = useState<ArmsPresentation | null>(null)
  const [status, setStatus] = useState<ReplicationStatus | null>(null)
  const [cameraOverride, setCameraOverride] = useState(false)
  const ready = useSurfaces()
  useEffect(() => player.setPaused(paused), [player, paused])
  return <InputProvider runtime={input}>
    <Stage physicsPriority={ALS_FRAME_PRIORITY.Physics} overlay={cameraOverride ? null : presentation} onCreated={onCreated}>
      {joined && <Replication key={joined.connection.id} connection={joined.connection} controller={player} events={events} onPresentation={setPresentation} onStatus={setStatus} />}
      <CheckProbe
        onCameraOverride={active => { player.override = active; setCameraOverride(active) }}
        feel={CHARACTER_FEEL}
        priority={ALS_FRAME_PRIORITY.Camera + 0.05}
        reset={() => player.respawn()}
        ready={() => surfacesReady() && player.als.pose.current.ready}
        player={() => ({ position: [player.position.x, player.position.y, player.position.z], velocity: [player.velocity.x, player.velocity.y, player.velocity.z], grounded: player.grounded })}
        character={player.check} />
      {physicsProbe}
    </Stage>
    {character.view === 'arms' && <div className="reticle" aria-hidden="true" />}
    <div className="room-status">{joined ? `${joined.online ? 'Online' : 'Offline'} · ${status?.players ?? 1} ${status?.players === 1 ? 'player' : 'players'} · ${status?.health ?? 100} hp` : 'Joining…'}</div>
    <CharacterOverlay controller={player} visible={ready} />
  </InputProvider>
}
