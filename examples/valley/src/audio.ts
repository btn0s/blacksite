import type { AlsFootstepAudioRuntime } from 'als-ue5-r3f/engine/alsAudioBridge'
import { createSoundscape, type CueDefinition, type SoundLayer, type VoiceHandle } from '@blacksite/soundscape'
import type { Wind } from '@blacksite/landscape'
import { asset } from './world'

type Footstep = Parameters<AlsFootstepAudioRuntime['PlayFootstepSound']>[0]

const rate = 24000

function loopVariants(buffer: AudioBuffer, name: string) {
  const span = Math.floor(buffer.length / 3)
  const overlap = Math.min(Math.floor(buffer.sampleRate * 0.4), Math.floor(span / 4))
  const length = span - overlap
  return [0, 1, 2].map(index => {
    const loop = new AudioBuffer({ length, sampleRate: buffer.sampleRate, numberOfChannels: buffer.numberOfChannels })
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const source = buffer.getChannelData(channel)
      const target = loop.getChannelData(channel)
      for (let frame = 0; frame < length; frame++) {
        const blend = Math.max(0, (frame - length + overlap) / overlap)
        const tail = source[index * span + overlap + frame]!
        const head = source[index * span + Math.max(0, frame - length + overlap)]!
        target[frame] = tail * (1 - blend) + head * blend
      }
    }
    return { id: `${name}-${index + 1}`, layers: [{ kind: 'buffer' as const, buffer: loop, loop: true, gain: 1 }] }
  })
}

const chirp = (from: number, to: number, duration: number, offset: number, gain = 0.2): SoundLayer => ({ kind: 'tone', frequency: from, endFrequency: to, duration, offset, gain, attack: 0.006, waveform: 'sine', send: 0.3 })

function songs(): CueDefinition['variants'] {
  const trill = Array.from({ length: 7 }, (_, index) => chirp(4300 - index * 90, 3600 - index * 80, 0.055, index * 0.075, 0.16))
  const whistle = [chirp(2900, 3400, 0.22, 0, 0.18), chirp(2700, 2150, 0.28, 0.32, 0.18)]
  const rising = Array.from({ length: 4 }, (_, index) => chirp(2600 + index * 260, 3500 + index * 300, 0.07, index * 0.13, 0.15))
  const warble = Array.from({ length: 8 }, (_, index) => chirp(index % 2 ? 4400 : 3700, index % 2 ? 3900 : 4200, 0.045, index * 0.06, 0.12))
  const call = [chirp(3600, 3000, 0.09, 0, 0.17), chirp(3600, 3000, 0.09, 0.16, 0.17), chirp(3900, 2600, 0.24, 0.34, 0.17)]
  return [trill, whistle, rising, warble, call].map((layers, index) => ({ id: `song-${index + 1}`, layers }))
}

export class ValleyAudio {
  private readonly mixer: ReturnType<typeof createSoundscape>
  private readonly voiceCap: number
  private preparation: Promise<void> | null = null
  private wind: VoiceHandle | null = null
  private leaves: VoiceHandle | null = null
  private level = { wind: -1, leaves: -1 }
  private disposed = false
  private started = false
  private ready = false

  constructor(tier: 'desktop' | 'phone') {
    this.voiceCap = tier === 'phone' ? 16 : 32
    this.mixer = createSoundscape({ tier, voiceCap: this.voiceCap })
  }

  get cap() {
    return this.voiceCap
  }

  prepare() {
    if (this.preparation) return this.preparation
    const mixer = this.mixer
    mixer.registerCue('valley.bird', { class: 'ambience', bus: 'sfx', gain: 0.55, pitchJitter: 0.06, volumeJitterDb: 3, reverbSend: 0.25, attenuation: { near: 6, far: 110, rolloff: 1.2 }, variants: songs() })
    mixer.registerCue('valley.leaves', { class: 'ambience', bus: 'ambience', loop: true, gain: 0.5, reverbSend: 0, variants: [{ id: 'leaves', layers: [{ kind: 'noise', loop: true, gain: 0.5, filter: { type: 'bandpass', frequency: 2600, q: 0.55 } }] }] })
    mixer.registerZone({ name: 'meadow', impulse: 'outdoor', wet: 0.16, beds: [], crossfade: 1.2, oneShots: [{ cue: 'valley.bird', interval: [2.2, 6.5], radius: [14, 70] }, { cue: 'valley.bird', interval: [5, 12], radius: [60, 140] }] })
    mixer.prepare()
    this.preparation = this.prepareRecordings()
    return this.preparation
  }

  private async prepareRecordings() {
    const decoder = new OfflineAudioContext(2, 1, rate)
    const opus = document.createElement('audio').canPlayType('audio/ogg; codecs="opus"') !== ''
    const load = async (path: string) => {
      let failure: unknown
      for (const extension of opus ? ['ogg', 'm4a'] : ['m4a', 'ogg']) {
        try {
          const response = await fetch(asset(`${path}.${extension}`))
          if (!response.ok) throw new Error(`Cannot load Valley audio ${path}.${extension}`)
          return await decoder.decodeAudioData(await response.arrayBuffer())
        } catch (error) { failure = error }
      }
      throw failure
    }
    const [wind, steps] = await Promise.all([
      load('bed-wind-alpine/clip'),
      Promise.all([1, 2, 3, 4, 5, 6, 7, 8, 9].map(take => load(`step-grass-oga/${String(take).padStart(2, '0')}`))),
    ])
    if (this.disposed) return
    this.mixer.registerCue('valley.wind', { class: 'ambience', bus: 'ambience', loop: true, gain: 0.9, pitchJitter: 0.015, volumeJitterDb: 1, reverbSend: 0, variants: loopVariants(wind, 'alpine-wind') })
    for (const landing of [false, true]) {
      this.mixer.registerCue(landing ? 'valley.land' : 'valley.step', {
        class: 'foley', bus: 'sfx', gain: landing ? 0.6 : 0.42, reverbSend: 0.08, pitchJitter: 0.06, volumeJitterDb: 1.5,
        variants: steps.map((buffer, index) => ({ id: `grass-${index + 1}`, layers: [{ kind: 'buffer', buffer, gain: 1 }, ...(landing ? [{ kind: 'tone' as const, frequency: 88, endFrequency: 42, waveform: 'sine' as const, gain: 0.2, duration: 0.16 }] : [])] })),
      })
    }
    this.mixer.setZone('meadow')
    this.ready = true
  }

  unlock() {
    const prepared = this.prepare()
    void Promise.all([prepared, this.mixer.start()]).then(() => {
      if (this.started || this.disposed) return
      this.started = true
      this.mixer.setZone('meadow')
      this.wind = this.mixer.play('valley.wind', { loop: true, volume: 0 }) ?? null
      this.leaves = this.mixer.play('valley.leaves', { loop: true, volume: 0 }) ?? null
    }).catch(() => {})
  }

  listen(position: { x: number; y: number; z: number }, forward: { x: number; y: number; z: number }, wind: Wind, canopy: number, delta: number) {
    this.mixer.setListener({ position: [position.x, position.y, position.z], forward: [forward.x, forward.y, forward.z] })
    if (this.ready) {
      const strength = wind.sample(position.x, position.z)
      const gust = wind.gust(position.x, position.z)
      const windLevel = Math.round(Math.min(1, 0.25 + strength * 0.7) * 50) / 50
      const leavesLevel = Math.round(Math.min(1, canopy * (0.2 + gust * 0.9)) * 50) / 50
      if (windLevel !== this.level.wind) { this.level.wind = windLevel; this.wind?.setVolume(windLevel, 0.35) }
      if (leavesLevel !== this.level.leaves) { this.level.leaves = leavesLevel; this.leaves?.setVolume(leavesLevel, 0.5) }
    }
    this.mixer.update(delta)
  }

  PlayFootstepSound(request: Footstep) {
    const { x, y, z } = request.Location
    this.mixer.play(request.SoundType === 'Land' ? 'valley.land' : 'valley.step', { position: [x, y, z], volume: request.VolumeMultiplier, pitch: request.PitchMultiplier })
  }

  SetListenerTransform() {}

  sample() {
    return this.mixer.sample()
  }

  dispose() {
    this.disposed = true
    this.mixer.dispose()
  }
}
