import type { AlsFootstepAudioRuntime } from 'als-ue5-r3f/engine/alsAudioBridge'
import { createAudioLog } from '@blacksite/check'
import { createSoundscape } from '@blacksite/soundscape'

type Footstep = Parameters<AlsFootstepAudioRuntime['PlayFootstepSound']>[0]
type Listener = Parameters<AlsFootstepAudioRuntime['SetListenerTransform']>[0]
type Surface = 'concrete' | 'metal' | 'dirt' | 'water'

const puddles: readonly [number, number, number, number][] = [
  [4.5, -1.2, 2.6, 1.4],
  [18, 1.5, 3.4, 1.8],
  [39, -3, 4.2, 2.4],
  [47, 3.2, 2.2, 1.3],
  [56, -1, 3, 1.5],
  [-6, 1, 3.6, 2],
]

function insideRoom(x: number, y: number, z: number) {
  return x > 35.5 && x < 52.5 && y < 3.4 && z > 9.7 && z < 18.7
}

function surfaceAt({ x, y, z }: Footstep['Location']): Surface {
  if (y < 0.25 && puddles.some(([px, pz, width, depth]) => {
    const dx = (x - px) * 2 / width
    const dz = (z - pz) * 2 / depth
    return dx * dx + dz * dz < 1
  })) return 'water'
  if (y > 2.2 && x > 32.9 && x < 43 && z > -12 && z < -6) return 'metal'
  if (insideRoom(x, y, z) || (x > 21 && x < 67 && z > -15 && z < 11) || (x > -90 && x < 170 && Math.abs(z) < 3.75)) return 'concrete'
  return 'dirt'
}

export function createCheckpointAudio(tier: 'desktop' | 'phone') {
  const cap = tier === 'phone' ? 16 : 32
  const soundscape = createSoundscape({ tier, voiceCap: cap, log: createAudioLog() })
  let zone: 'outdoor' | 'small-room' = 'outdoor'
  let fallSpeed = 0

  soundscape.setZone(zone)

  return {
    cap,
    zone() { return soundscape.zone },
    get state() { return soundscape.state },
    PlayFootstepSound(request: Footstep) {
      const surface = surfaceAt(request.Location)
      const landing = request.SoundType === 'Land'
      const volume = request.VolumeMultiplier * (landing ? Math.min(1.5, 0.6 + fallSpeed * 0.12) : 1)
      soundscape.play(`${landing ? 'landing' : 'footstep'}.${surface}`, {
        position: [request.Location.x, request.Location.y, request.Location.z],
        volume,
        pitch: request.PitchMultiplier,
      })
      fallSpeed = 0
    },
    SetListenerTransform(transform: Listener) {
      const { Location, Forward } = transform
      soundscape.setListener({ position: [Location.x, Location.y, Location.z], forward: [Forward.x, Forward.y, Forward.z] })
      const next = insideRoom(Location.x, Location.y, Location.z) ? 'small-room' : 'outdoor'
      if (next !== zone) {
        zone = next
        soundscape.setZone(zone)
      }
    },
    captureVerticalSpeed(speed: number) {
      if (speed < -0.2) fallSpeed = Math.max(fallSpeed, -speed)
      else if (speed > 0.2) fallSpeed = 0
    },
    prepare() { soundscape.prepare() },
    start() { return soundscape.start() },
    update(delta: number) { soundscape.update(delta) },
    sample() { return soundscape.sample() },
    dispose() { soundscape.dispose() },
  }
}

export type CheckpointAudio = ReturnType<typeof createCheckpointAudio>
