import { useEffect, useImperativeHandle, useMemo, useRef, type MutableRefObject, type RefObject } from 'react'
import * as THREE from 'three'
import { useFrame, useThree } from '@react-three/fiber'
import type { CharacterPoseSample } from 'als-ue5-r3f/app/CharacterPoseSample'
import type { Route } from './route'
import type { TraverseAudio } from './audio'
import { input as tuning, look } from './model'
import { isTouchDevice, surfaceAlbedo } from '@blacksite/look/world'
import { SoftParticles } from '@blacksite/look/soft'
import { ALS_FRAME_PRIORITY } from 'als-ue5-r3f/engine/alsFramePipeline'

export type EffectsHandle = { flash(at: readonly [number, number, number]): void; dust(at: THREE.Vector3, amount: number): void }

const powder = { floor: 0.3, gain: 0.5, chroma: 0.6 }
const smokeShade = new THREE.Color(0.3, 0.29, 0.27)
const steamShade = new THREE.Color(0.68, 0.71, 0.67)
const flashShade = new THREE.Color(1.0, 0.75, 0.38)
const ashBox = new THREE.Vector3(2 * look.ashRadius, 14, 2 * look.ashRadius)

export function Effects({ route, pose, handle, sound }: { route: Route; pose: MutableRefObject<CharacterPoseSample>; handle: { current: EffectsHandle | null }; sound: TraverseAudio }) {
  const { camera } = useThree()
  const count = useMemo(() => Math.round(look.ash * (isTouchDevice() ? look.phoneDensity : 1)), [])
  const ash = useMemo(() => {
    const field = new SoftParticles({ capacity: count })
    for (let i = 0; i < count; i++) {
      const shade = 0.62 + Math.random() * 0.2
      field.emit({
        position: { x: (Math.random() - 0.5) * ashBox.x, y: Math.random() * ashBox.y, z: (Math.random() - 0.5) * ashBox.z },
        velocity: { x: 0.22, y: -(0.18 + Math.random() * 0.16), z: 0 },
        life: 0,
        size: 0.018 + Math.random() * 0.03,
        opacity: 0.55 + Math.random() * 0.35,
        tint: { r: shade, g: shade * 0.98, b: shade * 0.94 },
        flutter: 0.26,
      })
    }
    return field
  }, [count])
  const media = useMemo(() => new SoftParticles({ capacity: 320 }), [])
  useEffect(() => () => { ash.dispose(); media.dispose() }, [ash, media])
  const smokeClock = useRef(0)
  const previous = useRef<{ mode: string | null; action: string | null; vz: number; airborne: number }>({ mode: null, action: null, vz: 0, airborne: 0 })
  const forward = useMemo(() => new THREE.Vector3(), [])
  const spot = useMemo(() => new THREE.Vector3(), [])
  const dip = useRef({ y: 0, v: 0 })
  const probe = useMemo(() => ({ ray: new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0), 0, 0.8), tint: new THREE.Color() }), [])

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 20)
    const state = dip.current
    const omega = tuning.landingDipRecovery
    state.v += (-omega * omega * state.y - 2 * omega * state.v) * dt
    state.y += state.v * dt
    if (Math.abs(state.y) < 1e-4 && Math.abs(state.v) < 1e-3) state.y = state.v = 0
    camera.position.y += state.y
  }, ALS_FRAME_PRIORITY.Camera + 0.02)

  const surfaceTint = (at: THREE.Vector3): THREE.Color | null => {
    if (route.surfaceAt(at.x, at.y, at.z) === 'water') return null
    probe.ray.ray.origin.set(at.x, at.y + 0.4, at.z)
    for (const hit of probe.ray.intersectObject(route.group, true)) {
      const albedo = surfaceAlbedo(hit, probe.tint)
      if (albedo) {
        const luminance = Math.max(1e-3, 0.2126 * albedo.r + 0.7152 * albedo.g + 0.0722 * albedo.b)
        const lift = (powder.floor + powder.gain * luminance) / luminance
        return albedo.setRGB(...([albedo.r, albedo.g, albedo.b].map(channel => (luminance + (channel - luminance) * powder.chroma) * lift) as [number, number, number]))
      }
    }
    return null
  }
  const api = useMemo<EffectsHandle>(() => ({
    flash(at) {
      for (let i = 0; i < 26; i++) {
        const angle = (i / 26) * Math.PI * 2
        media.emit({ position: { x: at[0], y: at[1] - 0.6 + Math.random() * 1.6, z: at[2] }, velocity: { x: Math.cos(angle) * 0.4, y: 0.6 + Math.random() * 0.8, z: Math.sin(angle) * 1.6 }, drag: 2.2, life: 0.7 + Math.random() * 0.4, size: 0.1, grow: 0.15, tint: flashShade, glow: 0.9 })
      }
    },
    dust(at, amount) {
      const tint = surfaceTint(at)
      if (!tint) return
      const count = Math.round(6 + amount * 12)
      for (let i = 0; i < count; i++) {
        const angle = Math.random() * Math.PI * 2
        const speed = 0.5 + Math.random() * 1.2 * amount
        media.emit({ position: { x: at.x, y: at.y + 0.05, z: at.z }, velocity: { x: Math.cos(angle) * speed, y: 0.15 + Math.random() * 0.35, z: Math.sin(angle) * speed }, acceleration: { x: 0, y: 0.35, z: 0 }, drag: 2.2, life: 0.9 + Math.random() * 0.7, size: 0.25 + Math.random() * 0.2, grow: 2.7, opacity: 0.7 * Math.min(1, 0.5 + amount), tint })
      }
    },
  }), [media])
  useImperativeHandle(handle as RefObject<EffectsHandle>, () => api, [api])

  const fires = useMemo(() => route.emitters.filter(emitter => emitter.kind === 'fire'), [route])
  const vents = useMemo(() => route.emitters.filter(emitter => emitter.kind === 'steam'), [route])

  useFrame((_, rawDelta) => {
    const dt = Math.min(rawDelta, 1 / 20)
    const cx = camera.position.x
    const cz = camera.position.z
    ash.advance(dt)
    media.advance(dt)
    ash.wrap({ x: cx, y: camera.position.y + 3, z: cz }, ashBox)

    smokeClock.current += dt
    if (smokeClock.current > 0.16) {
      smokeClock.current = 0
      for (const fire of fires) {
        if (Math.hypot(fire.at[0] - cx, fire.at[2] - cz) > 45) continue
        media.emit({ position: { x: fire.at[0] + (Math.random() - 0.5) * 0.3, y: fire.at[1] + 0.4, z: fire.at[2] + (Math.random() - 0.5) * 0.3 }, velocity: { x: 0.15 + Math.random() * 0.1, y: 0.7 + Math.random() * 0.3, z: (Math.random() - 0.5) * 0.1 }, drag: 0.8, life: 3.2, size: 0.35, grow: 2.1, opacity: 0.32, tint: smokeShade })
        if (Math.random() < 0.5) media.emit({ position: { x: fire.at[0], y: fire.at[1] + 0.25, z: fire.at[2] }, velocity: { x: (Math.random() - 0.5) * 0.6, y: 1.6 + Math.random() * 1.2, z: (Math.random() - 0.5) * 0.6 }, acceleration: { x: 0, y: -3, z: 0 }, drag: 0.8, life: 0.6 + Math.random() * 0.5, size: 0.035, tint: flashShade, glow: 1, stretch: 0.03 })
      }
      for (const vent of vents) {
        if (Math.hypot(vent.at[0] - cx, vent.at[2] - cz) > 45) continue
        media.emit({ position: { x: vent.at[0], y: vent.at[1], z: vent.at[2] }, velocity: { x: 0.1 + Math.random() * 0.16, y: 0.65 + Math.random() * 0.3, z: 0.6 + Math.random() * 0.3 }, drag: 0.8, life: 2.4, size: 0.2, grow: 4.8, opacity: 0.3, tint: steamShade })
      }
    }

    const sample = pose.current
    const character = sample.character
    if (sample.ready && character) {
      const state = previous.current
      const vz = character.movement.velocity.z
      const mode = character.locomotionMode
      const action = character.locomotionAction
      if (mode === 'InAir') state.airborne += dt
      if (state.mode === 'InAir' && mode === 'Grounded' && state.airborne > 0.12) {
        const strength = Math.min(1, Math.max(0, (-state.vz - 2) / 6))
        if (strength > 0) {
          spot.copy(sample.leftFoot).add(sample.rightFoot).multiplyScalar(0.5)
          spot.y = sample.ground.y
          api.dust(spot, strength)
          sound.play('land', strength)
          dip.current.v -= tuning.landingDip * strength * tuning.landingDipRecovery * Math.E
        }
      }
      if (mode === 'Grounded') state.airborne = 0
      if (action !== state.action) {
        if (action === 'Mantling') sound.play('mantle')
        if (action === 'Rolling') { sound.play('roll'); spot.copy(sample.ground); api.dust(spot, 0.4) }
        if (action === 'Ragdolling') { sound.play('ragdoll', 0.8); spot.copy(sample.pelvis); spot.y = sample.ground.y; api.dust(spot, 0.9) }
      }
      state.mode = mode
      state.action = action
      state.vz = vz
    }

    camera.getWorldDirection(forward)
    sound.listen(camera.position, forward, sample.ready ? sample.ground.y : 0, rawDelta)
  })

  return <>
    <primitive object={ash} />
    <primitive object={media} />
  </>
}
