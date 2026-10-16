import { sound } from './sound'
import { surfaceAt } from './yard'

type Point = { readonly x: number; readonly y: number; readonly z: number }

export const footsteps = {
  PlayFootstepSound(request: { readonly SoundType: string; readonly Location: Point; readonly VolumeMultiplier: number; readonly PitchMultiplier: number }) {
    const { x, y, z } = request.Location
    sound.play(`${request.SoundType === 'Land' ? 'landing' : 'footstep'}.${surfaceAt(x, y, z)}`, { position: [x, y, z], volume: request.VolumeMultiplier, pitch: request.PitchMultiplier })
  },
  SetListenerTransform(transform: { readonly Location: Point; readonly Forward: Point }) {
    sound.setListener({ position: [transform.Location.x, transform.Location.y, transform.Location.z], forward: [transform.Forward.x, transform.Forward.y, transform.Forward.z] })
  },
}
