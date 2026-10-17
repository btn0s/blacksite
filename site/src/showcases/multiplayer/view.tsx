import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, type RootState } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import { CuboidCollider, CylinderCollider, RigidBody } from '@react-three/rapier'
import * as THREE from 'three'
import { Look } from '@blacksite/look/r3f'
import { QUALITY, depthDefaults, type QualityTier } from '@blacksite/look/quality'
import { MultiplayerScene, type MultiplayerReplica, type MultiplayerShot, type MultiplayerStatus, type SubjectState } from '@blacksite/subject'
import type { Connection } from '@blacksite/relay'
import type { ArmsPresentation } from '@blacksite/subject-fpp/arms'
import { internalPixelRatio, type Collider } from '@blacksite/look/world'
import { Bot } from './bot'
import { EffectsLayer, useEffects, type Effects } from './effects'
import { playShot, playTick } from './audio'
import { gunmetal, WEAPON_URLS } from './outfit'

export type Level = { group: THREE.Group; colliders: Collider[] }

function LevelBody({ level }: { level: Level }) {
  const group = useMemo(() => level.group.clone(), [level])
  return <>
    <primitive object={group} />
    <RigidBody type="fixed" colliders={false}>
      {level.colliders.map((collider, index) => collider.kind === 'box'
        ? <CuboidCollider key={index} args={collider.half} position={collider.position} rotation={collider.rotation} />
        : <CylinderCollider key={index} args={[collider.halfHeight, collider.radius]} position={collider.position} rotation={collider.rotation} />)}
    </RigidBody>
  </>
}

function Lights({ tier, onLights }: { tier: QualityTier; onLights: (lights: { sun: THREE.DirectionalLight; fill: THREE.HemisphereLight }) => void }) {
  const lights = useMemo(() => {
    const sun = new THREE.DirectionalLight('#ffffff', 1.5)
    sun.castShadow = true
    sun.shadow.mapSize.setScalar(tier === 'low' ? 1024 : 2048)
    sun.shadow.bias = -0.0004
    sun.shadow.normalBias = 0.03
    sun.shadow.radius = 3
    Object.assign(sun.shadow.camera, { left: -27, right: 27, top: 27, bottom: -27, near: 1, far: 110 })
    sun.shadow.camera.updateProjectionMatrix()
    const fill = new THREE.HemisphereLight('#ffffff', '#222222', 1)
    return { sun, fill }
  }, [tier])
  useEffect(() => onLights(lights), [lights, onLights])
  return <><primitive object={lights.sun} /><primitive object={lights.sun.target} /><primitive object={lights.fill} /></>
}

function Gunmetal() {
  const rifle = useGLTF(WEAPON_URLS[0])
  const pistol = useGLTF(WEAPON_URLS[1])
  useMemo(() => { gunmetal(rifle.scene); gunmetal(pistol.scene) }, [rifle, pistol])
  return null
}

function Silent() {
  useFrame(() => {}, 1)
  return null
}

function Listener({ camera }: { camera: { current: THREE.Camera | null } }) {
  useFrame(state => { camera.current = state.camera })
  return null
}

export type Hud = { hit: number; kill: number; hurt: number; hurtAngle: number; down: number; kills: number }

export function PlayerView({ index, connection, subject, level, tier, mode, listening, onCreated, onReplica }: {
  index: number
  connection: Connection
  subject: SubjectState
  level: Level
  tier: QualityTier
  mode: 'human' | 'bot' | 'touch' | 'hidden'
  listening: boolean
  onCreated?: (state: RootState) => void
  onReplica: (index: number, replica: MultiplayerReplica | null) => void
}) {
  const effects = useEffects()
  const [replica, setReplica] = useState<MultiplayerReplica | null>(null)
  const [arms, setArms] = useState<ArmsPresentation | null>(null)
  const [lights, setLights] = useState<{ sun: THREE.DirectionalLight; fill: THREE.HemisphereLight } | null>(null)
  const [status, setStatus] = useState<MultiplayerStatus | null>(null)
  const [hud, setHud] = useState<Hud>({ hit: 0, kill: 0, hurt: 0, hurtAngle: 0, down: 0, kills: 0 })
  const camera = useRef<THREE.Camera | null>(null)
  const listen = useRef(listening)
  listen.current = listening
  const hidden = mode === 'hidden'

  const handleReplica = useCallback((value: MultiplayerReplica | null) => { setReplica(value); onReplica(index, value) }, [index, onReplica])
  const handleShot = useCallback((shot: MultiplayerShot) => {
    if (hidden) return
    effects.tracer(shot.origin.clone().addScaledVector(shot.direction, 0.6), shot.point ?? shot.origin.clone().addScaledVector(shot.direction, 120))
    if (shot.point) effects.puff(shot.point, 'dust')
    if (shot.point) effects.puff(shot.point, 'spark')
    if (listen.current) playShot(0, subject.weapon === 'pistol')
  }, [effects, hidden, subject])

  useEffect(() => {
    if (!replica) return
    const scratch = new THREE.Vector3()
    return replica.onMessage(message => {
      if (message.type === 'shot' && message.shooter !== replica.id && !hidden) {
        const origin = { x: message.origin.x + message.direction.x * 0.7, y: message.origin.y - 0.12, z: message.origin.z + message.direction.z * 0.7 }
        effects.tracer(origin, message.end)
        effects.flash(origin)
        if (listen.current && camera.current) playShot(scratch.set(origin.x, origin.y, origin.z).distanceTo(camera.current.position), message.weapon === 'pistol')
      }
      if (message.type === 'hit') {
        if (message.point && !hidden) effects.puff(message.point, 'blood')
        if (message.shooter === replica.id) {
          const kill = message.health <= 0
          setHud(value => ({ ...value, hit: performance.now(), kill: kill ? performance.now() : value.kill, kills: value.kills + (kill ? 1 : 0) }))
          if (listen.current) playTick(kill)
        }
        if (message.target === replica.id) {
          const shooter = replica.states.get(message.shooter)
          const own = replica.states.get(replica.id)
          let angle = 0
          if (shooter && own) {
            const bearing = Math.atan2(shooter.position.z - own.position.z, shooter.position.x - own.position.x) * 180 / Math.PI
            angle = bearing - subject.player.command.yaw
          }
          setHud(value => ({ ...value, hurt: performance.now(), hurtAngle: angle, down: message.health <= 0 ? performance.now() : value.down }))
        }
      }
    })
  }, [replica, effects, hidden, subject])

  const dpr = Math.min(QUALITY[tier].maxPixelRatio, internalPixelRatio())
  const health = status?.health ?? 100
  return <div className={`mp-view mp-view--${mode}`}>
    <Canvas shadows="percentage" dpr={hidden ? 0.25 : [1, dpr]} camera={{ fov: 75, near: depthDefaults(tier).near, far: 400, position: [0, 1.63, 0] }} gl={{ antialias: false, powerPreference: 'high-performance', stencil: false }} onCreated={onCreated}>
      <Lights tier={tier} onLights={setLights} />
      {!hidden && lights && <Look atmosphere="zone" quality={tier} environment sun={lights.sun} fill={lights.fill} overlay={arms} />}
      {hidden && <Silent />}
      <Suspense fallback={null}><Gunmetal /></Suspense>
      <Listener camera={camera} />
      <EffectsLayer effects={effects} />
      <MultiplayerScene connection={connection} offline subject={subject} onArmsPresentation={setArms} onReplica={handleReplica} onStatus={setStatus} onShot={handleShot}>
        <LevelBody level={level} />
        <Bot subject={subject} replica={replica} active={mode === 'bot' || mode === 'hidden'} />
      </MultiplayerScene>
    </Canvas>
    {!hidden && <ViewHud index={index} mode={mode} hud={hud} health={health} view={status?.view ?? 'first-person'} />}
  </div>
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => performance.now())
  useEffect(() => {
    if (!active) return
    let frame = 0
    const tick = () => { setNow(performance.now()); frame = requestAnimationFrame(tick) }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [active])
  return now
}

function ViewHud({ index, mode, hud, health, view }: { index: number; mode: string; hud: Hud; health: number; view: string }) {
  const latest = Math.max(hud.hit, hud.hurt, hud.down)
  const animating = performance.now() - latest < 3200 || health <= 0
  const now = useNow(animating)
  const since = (time: number) => Math.max(0, now - time)
  const hitAge = since(hud.hit)
  const killAge = since(hud.kill)
  const hurtAge = since(hud.hurt)
  const downAge = since(hud.down)
  const dead = health <= 0
  const respawnIn = Math.max(1, Math.ceil((3000 - downAge) / 1000))
  return <div className="mp-hud" aria-hidden="true">
    <div className="mp-tag"><b>P{index + 1}</b><span>{mode === 'bot' ? 'Bot' : 'You'}</span>{hud.kills > 0 && <span>{hud.kills} {hud.kills === 1 ? 'kill' : 'kills'}</span>}</div>
    {!dead && <div className={`mp-cross${view === 'third-person' ? ' mp-cross--tpp' : ''}`}><i /><i /><i /><i /></div>}
    {hitAge < 160 && <div className={`mp-hit${killAge < 400 ? ' mp-hit--kill' : ''}`} style={{ opacity: 1 - hitAge / 160 }}><i /><i /><i /><i /></div>}
    {killAge < 1300 && <div className="mp-banner" style={{ opacity: Math.min(1, (1300 - killAge) / 300) }}>Eliminated</div>}
    {hurtAge < 700 && <div className="mp-hurt" style={{ opacity: 1 - hurtAge / 700 }} />}
    {hurtAge < 900 && !dead && <div className="mp-arrow" style={{ transform: `translate(-50%, -50%) rotate(${hud.hurtAngle}deg)`, opacity: 1 - hurtAge / 900 }}><i /></div>}
    {dead && <div className="mp-banner mp-banner--down">Down<small>Back in {respawnIn}</small></div>}
    <div className="mp-health"><i style={{ transform: `scaleX(${health / 100})` }} className={health < 35 ? 'mp-health--low' : ''} /><span>{health}</span></div>
  </div>
}
