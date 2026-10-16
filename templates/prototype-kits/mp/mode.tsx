import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useFrame, type RootState } from '@react-three/fiber'
import { MultiplayerScene, createSubject, driveSubject, pressSubject, wrapYaw, type MultiplayerShot, type MultiplayerStatus, type SubjectState } from '@blacksite/subject'
import { createLoopbackRoom, type Connection } from '@blacksite/relay'
import { createColyseusTransport } from '@blacksite/relay/colyseus'
import type { ArmsPresentation } from '@blacksite/subject-fpp/arms'
import { CheckProbe } from '../../game-shell/src/game/check'
import { PlayHud } from '../../game-shell/src/game/hud'
import { held, take, value } from '../../game-shell/src/game/input'
import { FEEL } from '../../game-shell/src/game/model'
import { sound } from '../../game-shell/src/game/sound'
import { Stage, Yard, surfacesReady, useSurfaces } from '../../game-shell/src/game/stage'
import { yard } from '../../game-shell/src/game/yard'

const DEGREES = 180 / Math.PI
const feel = { moveSpeed: FEEL.moveSpeed, sprintSpeed: FEEL.sprintSpeed, jumpApex: FEEL.jumpApex, tolerance: 0.12 }
const relay = import.meta.env.VITE_RELAY_URL || (import.meta.env.DEV ? `${location.origin}/relay` : '')

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

function Drive({ subject }: { subject: SubjectState }) {
  useFrame(() => {
    const look = value('look')
    const command = subject.player.command
    command.yaw = wrapYaw(command.yaw + look.x * DEGREES)
    command.pitch = Math.max(-85, Math.min(85, command.pitch - look.y * DEGREES))
    const move = value('move')
    driveSubject(subject, { forward: move.y, right: move.x, sprint: held('sprint'), crouch: held('crouch'), walk: held('walk'), fire: held('fire'), aim: held('aim') })
    for (const press of ['jump', 'reload', 'view', 'rifle', 'pistol'] as const) if (take(press)) pressSubject(subject, press)
    const eye = subject.frame.eye
    const forward = subject.frame.aimDirection
    sound.setListener({ position: [eye.x, eye.y, eye.z], forward: [forward.x, forward.y, forward.z] })
    sound.update(1 / 60)
  }, -5)
  return null
}

export default function Mode({ onCreated, physicsProbe }: { onCreated?: (state: RootState) => void; physicsProbe?: ReactNode } = {}) {
  const joined = useConnection()
  const subject = useMemo(() => createSubject({ cameraMode: 'switchable', spawn: yard.spawn }), [])
  const [arms, setArms] = useState<ArmsPresentation | null>(null)
  const [status, setStatus] = useState<MultiplayerStatus | null>(null)
  const ready = useSurfaces()
  useEffect(() => subject.setVirtual(true), [subject])
  const shot = (event: MultiplayerShot) => {
    sound.play(`weapon.${subject.weapon}`, { position: [event.origin.x, event.origin.y, event.origin.z] })
    if (event.point) sound.play('impact.concrete', { position: [event.point.x, event.point.y, event.point.z], delay: true })
  }
  return <>
    <Stage physics={false} overlay={arms} onCreated={onCreated}>
      <Drive subject={subject} />
      {joined && <MultiplayerScene key={joined.connection.id} connection={joined.connection} offline={!joined.online} subject={subject} input="external" onArmsPresentation={setArms} onStatus={setStatus} onShot={shot} physicsProbe={physicsProbe}>
        <Yard />
      </MultiplayerScene>}
      <CheckProbe
        feel={feel}
        priority={-0.2}
        ready={() => surfacesReady() && subject.frame.ready}
        player={() => subject.frame.ready ? { position: [subject.frame.position.x, subject.frame.position.y, subject.frame.position.z], velocity: [subject.frame.velocity.x, subject.frame.velocity.y, subject.frame.velocity.z], grounded: subject.frame.grounded } : null} />
    </Stage>
    {status?.view !== 'third-person' && <div className="reticle" aria-hidden="true" />}
    <div className="room-status">{joined ? `${joined.online ? 'Online' : 'Offline'} · ${status?.players ?? 1} ${status?.players === 1 ? 'player' : 'players'} · ${status?.health ?? 100} hp` : 'Joining…'}</div>
    <PlayHud ready={ready} hints={[['WASD', 'Move'], ['Mouse', 'Look'], ['LMB', 'Fire'], ['RMB', 'Aim'], ['R', 'Reload'], ['V', 'View'], ['1 / 2', 'Weapon'], ['Space', 'Jump']]} buttons={[{ id: 'fire', label: 'Fire' }, { id: 'aim', label: 'Aim' }, { id: 'jump', label: 'Jump' }, { id: 'reload', label: 'Reload' }, { id: 'view', label: 'View' }, { id: 'sprint', label: 'Sprint' }]} />
  </>
}
