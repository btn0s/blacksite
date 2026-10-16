export type Vec3 = readonly [number, number, number]
export type SoundClass = 'weapons' | 'sfx' | 'foley' | 'ambience' | 'music' | 'ui' | 'voice'
export type SoundBus = 'sfx' | 'weapons' | 'ambience' | 'music' | 'ui' | 'voice'
export type Surface = 'concrete' | 'metal' | 'wood' | 'dirt' | 'water' | 'paper' | 'canvas'

export interface SoundFilter {
  type: BiquadFilterType
  frequency: number
  q?: number
}

export interface SoundLayerBase {
  gain: number
  offset?: number
  attack?: number
  send?: number
  filter?: SoundFilter
}

export interface NoiseLayer extends SoundLayerBase {
  kind: 'noise'
  duration?: number
  loop?: boolean
}

export interface ToneLayer extends SoundLayerBase {
  kind: 'tone'
  frequency: number
  endFrequency?: number
  waveform?: OscillatorType
  duration: number
}

export interface BufferLayer extends SoundLayerBase {
  kind: 'buffer'
  buffer: AudioBuffer
  duration?: number
  loop?: boolean
}

export type SoundLayer = NoiseLayer | ToneLayer | BufferLayer

export interface CueVariant {
  id: string
  layers: readonly SoundLayer[]
}

export interface Attenuation {
  near: number
  far: number
  rolloff?: number
}

export interface CueDefinition {
  variants: readonly CueVariant[]
  class?: SoundClass
  bus?: SoundBus
  selection?: 'random-no-repeat' | 'round-robin'
  pitchJitter?: number
  volumeJitterDb?: number
  cooldown?: number
  gain?: number
  attenuation?: Attenuation
  delayByDistance?: boolean
  reverbSend?: number
  loop?: boolean
}

export interface AmbientOneShot {
  cue: string
  interval: readonly [number, number]
  radius: readonly [number, number]
}

export interface SoundZone {
  name: string
  impulse?: AudioBuffer | 'small-room' | 'corridor' | 'hall' | 'outdoor'
  wet?: number
  beds?: readonly string[]
  oneShots?: readonly AmbientOneShot[]
  crossfade?: number
}

export interface PlayOptions {
  position?: Vec3
  distance?: number
  pan?: number
  volume?: number
  pitch?: number
  delay?: boolean
  loop?: boolean
}

export interface ListenerPose {
  position: Vec3
  forward?: Vec3
  up?: Vec3
}

export interface VoiceHandle {
  readonly cue: string
  readonly sample: string
  setPosition(position: Vec3): void
  setVolume(volume: number, fadeSeconds?: number): void
  stop(fadeSeconds?: number): void
}

export interface AudioLogLike {
  start(cue: string, sample: string): void
  end(): void
  sample(): { voices: number; plays?: { cue: string; sample: string }[] }
}

export interface SoundscapeOptions {
  tier?: 'desktop' | 'phone'
  voiceCap?: number
  log?: AudioLogLike
  occlusion?: (listener: Vec3, source: Vec3) => boolean | number
  context?: AudioContext
  random?: () => number
}
