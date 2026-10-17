import type { AlsFootstepAudioRuntime } from 'als-ue5-r3f/engine/alsAudioBridge'
import { createSoundscape, STARTER_ZONES, type CueDefinition, type SoundLayer, type Surface, type Vec3 } from '@blacksite/soundscape'
import type { Route, Zone } from './route'

export type Cue = 'start' | 'checkpoint' | 'record' | 'finish' | 'land' | 'mantle' | 'roll' | 'ragdoll'
export type Occlusion = (listener: Vec3, source: Vec3) => boolean

type Footstep = Parameters<AlsFootstepAudioRuntime['PlayFootstepSound']>[0]
type EmitterKind = Route['emitters'][number]['kind']

const rate = 24000
const outdoorZone = STARTER_ZONES.find(zone => zone.name === 'outdoor')!
const zoneFor: Record<Zone['kind'] | 'open', string> = { open: 'outdoor', arch: 'corridor', stairwell: 'hall' }
const recordings = import.meta.glob<string>('../assets/audio/*/*.{ogg,m4a}', { eager: true, query: '?url&no-inline', import: 'default' })
const surfaceRecordings = [
  ['concrete', 'step-boots-concrete'],
  ['metal', 'step-metal-ladder'],
  ['dirt', 'step-gravel-oga'],
  ['water', 'step-water-oga'],
] as const

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

function pcm(seconds: number, shape: (t: number, white: number) => number, start = 1234567) {
  const length = Math.floor(rate * seconds)
  const buffer = new AudioBuffer({ length, sampleRate: rate, numberOfChannels: 1 })
  const data = buffer.getChannelData(0)
  let seed = start
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    data[i] = shape(i / rate, seed / 0x3fffffff - 1)
  }
  return buffer
}

function crackle(index: number) {
  let random = 991 + index * 7919
  const next = () => (random = (random * 16807) % 2147483647) / 2147483647
  const pops: number[] = []
  for (let t = 0; t < 4; t += 0.02 + next() * 0.16) pops.push(t)
  let low = 0
  return pcm(4, (t, white) => {
    while (pops.length > 1 && pops[1]! <= t) pops.shift()
    const since = t - pops[0]!
    const pop = since >= 0 ? Math.exp(-since * 260) * (0.5 + 0.5 * Math.sin(pops[0]! * 999)) : 0
    low += (white - low) * 0.02
    return white * pop * 0.9 + low * 0.5
  }, 1234567 + index * 104729)
}

function tarp(index: number) {
  let low = 0
  return pcm(6, (t, white) => {
    low += (white - low) * 0.12
    const gust = Math.max(0, Math.sin(t * 1.3 + index * 2.1) * Math.sin(t * 0.47 + 1 + index) * 1.4)
    const flap = Math.pow(Math.max(0, Math.sin(t * 2 * Math.PI * (5 + 3 * Math.sin(t)))), 6)
    return low * (0.15 + gust * flap * 1.6)
  }, 7654321 + index * 15485863)
}

function buzz(index: number) {
  const saw = (t: number, f: number) => 2 * ((t * f) % 1) - 1
  const weights = [[1, 0.5, 0.6], [0.8, 0.7, 0.4], [1, 0.35, 0.8]][index % 3]!
  return pcm(1, (t, white) => (saw(t, 100) * weights[0]! + Math.sign(Math.sin(2 * Math.PI * 200 * t)) * weights[1]! + saw(t, 300) * weights[2]!) * 0.25 + white * 0.02)
}

const noise = (frequency: number, gain: number, duration: number, type: BiquadFilterType, q = 0.8, offset = 0): SoundLayer => ({ kind: 'noise', gain, duration, offset, filter: { type, frequency, q } })
const note = (frequency: number, gain: number, duration: number, offset: number): SoundLayer => ({ kind: 'tone', frequency, gain, duration, offset, attack: 0.008, waveform: 'triangle', send: 0.35 })

function chime(notes: readonly number[], gap: number): CueDefinition {
  return {
    class: 'ui', bus: 'ui', pitchJitter: 0, volumeJitterDb: 1.5, gain: 0.5,
    variants: [
      { id: 'plain', interval: 0 },
      { id: 'upper-octave', interval: 12 },
      { id: 'lower-octave', interval: -12 },
      { id: 'fifth', interval: 7 },
    ].map(({ id, interval }) => ({
      id,
      layers: notes.flatMap((frequency, index) => [
        note(frequency, interval === 0 ? 0.26 : 0.22, 0.9, index * gap),
        ...(interval === 0 ? [] : [note(frequency * Math.pow(2, interval / 12), 0.07, 0.72, index * gap)]),
      ]),
    })),
  }
}

function body(build: (spread: number) => SoundLayer[], gain: number): CueDefinition {
  return {
    class: 'foley', bus: 'sfx', gain, reverbSend: 0.2,
    variants: [0, 1, 2, 3].map(variant => ({ id: String(variant), layers: build(1 + (variant - 1.5) * 0.08) })),
  }
}

function emitter(kind: Exclude<EmitterKind, 'drip'>, gain: number, near: number, far: number): CueDefinition {
  if (kind === 'steam') return {
    class: 'ambience', bus: 'sfx', loop: true, gain, pitchJitter: 0.02, reverbSend: 0.2,
    attenuation: { near, far, rolloff: 1.4 },
    variants: [0, 1, 2].map(index => ({
      id: `steam-${index}`,
      layers: [{ kind: 'noise', loop: true, gain: 0.6, filter: { type: 'bandpass', frequency: 1700 + index * 300, q: 0.45 } }],
    })),
  }
  const build = kind === 'fire' ? crackle : kind === 'tarp' ? tarp : buzz
  const filter = kind === 'buzz' ? { type: 'bandpass' as const, frequency: 600, q: 1.4 } : undefined
  return {
    class: 'ambience', bus: 'sfx', loop: true, gain, pitchJitter: 0.02, reverbSend: 0.3,
    attenuation: { near, far, rolloff: 1.4 },
    variants: [0, 1, 2].map(index => ({ id: `${kind}-${index}`, layers: [{ kind: 'buffer', buffer: build(index), loop: true, gain: 1, filter }] })),
  }
}

export class TraverseAudio {
  private readonly mixer: ReturnType<typeof createSoundscape>
  private readonly voiceCap: number
  private readonly zones: Zone[]
  private readonly emitters: Route['emitters']
  private readonly surfaceAt: Route['surfaceAt']
  private occlusion: Occlusion | null = null
  private readonly blocked = new WeakMap<Vec3, { at: number; value: boolean }>()
  private zone: Zone['kind'] | 'open' = 'open'
  private exposure = -1
  private preparation: Promise<void> | null = null
  private started = false
  private disposed = false

  constructor(route: Route, tier: 'desktop' | 'phone') {
    this.zones = route.zones
    this.emitters = route.emitters
    this.surfaceAt = route.surfaceAt
    this.voiceCap = tier === 'phone' ? 16 : 32
    this.mixer = createSoundscape({ tier, voiceCap: this.voiceCap, occlusion: (listener, source) => this.occluded(listener, source) })
    this.mixer.registerZone({ ...outdoorZone, beds: [], oneShots: [] })
  }

  get cap() {
    return this.voiceCap
  }

  setOcclusion(occlusion: Occlusion | null) {
    this.occlusion = occlusion
  }

  private occluded(listener: Vec3, source: Vec3) {
    if (!this.occlusion) return false
    const now = performance.now()
    const cached = this.blocked.get(source)
    if (cached && now - cached.at < 120) return cached.value
    const value = this.occlusion(listener, source)
    this.blocked.set(source, { at: now, value })
    return value
  }

  prepare() {
    if (this.preparation) return this.preparation
    const mixer = this.mixer
    mixer.registerCue('traverse.start', chime([660, 880], 0.12))
    mixer.registerCue('traverse.checkpoint', chime([988, 1318], 0.09))
    mixer.registerCue('traverse.finish', chime([784, 659, 523], 0.09))
    mixer.registerCue('traverse.record', chime([523, 659, 784, 1046], 0.09))
    mixer.registerCue('traverse.land', body(spread => [noise(260 * spread, 0.7, 0.22, 'lowpass'), { kind: 'tone', frequency: 95 * spread, endFrequency: 40, gain: 0.35, duration: 0.22, waveform: 'sine' }], 0.9))
    mixer.registerCue('traverse.mantle', body(spread => [noise(1500 * spread, 0.25, 0.35, 'bandpass'), noise(700 * spread, 0.18, 0.12, 'lowpass', 0.8, 0.16)], 1))
    mixer.registerCue('traverse.roll', body(spread => [noise(900 * spread, 0.3, 0.5, 'bandpass'), noise(260 * spread, 0.3, 0.14, 'lowpass', 0.8, 0.05)], 1))
    mixer.registerCue('traverse.ragdoll', body(spread => [noise(180 * spread, 0.9, 0.22, 'lowpass'), { kind: 'tone', frequency: 70 * spread, endFrequency: 40, gain: 0.35, duration: 0.25, waveform: 'sine' }], 1))
    mixer.registerCue('traverse.fire', emitter('fire', 0.55, 1.2, 40))
    mixer.registerCue('traverse.tarp', emitter('tarp', 0.4, 3, 45))
    mixer.registerCue('traverse.buzz', emitter('buzz', 0.12, 1.2, 25))
    mixer.registerCue('traverse.steam', emitter('steam', 0.15, 1.2, 24))
    mixer.setZone('outdoor')
    mixer.prepare()
    this.preparation = this.prepareRecordings()
    return this.preparation
  }

  private async prepareRecordings() {
    const decoder = new OfflineAudioContext(2, 1, rate)
    const opus = document.createElement('audio').canPlayType('audio/ogg; codecs="opus"') !== ''
    const load = async (asset: string, take: string) => {
      const extensions = opus ? ['ogg', 'm4a'] : ['m4a', 'ogg']
      let failure: unknown
      for (const extension of extensions) {
        try {
          const url = recordings[`../assets/audio/${asset}/${take}.${extension}`]
          if (!url) throw new Error(`Missing Traverse audio: ${asset}/${take}.${extension}`)
          const response = await fetch(url)
          if (!response.ok) throw new Error(`Cannot load Traverse audio: ${asset}/${take}.${extension}`)
          return await decoder.decodeAudioData(await response.arrayBuffer())
        } catch (error) { failure = error }
      }
      throw failure
    }
    const [surfaces, wind, drips] = await Promise.all([
      Promise.all(surfaceRecordings.map(async ([surface, asset]) => ({
        surface,
        asset,
        buffers: await Promise.all([1, 2, 3, 4, 5].map(take => load(asset, String(take).padStart(2, '0')))),
      }))),
      load('bed-wind-alpine', 'clip'),
      load('bed-drip-basement', 'clip'),
    ])
    if (this.disposed) return
    for (const { surface, asset, buffers } of surfaces) {
      for (const landing of [false, true]) {
        this.mixer.registerCue(`${landing ? 'landing' : 'footstep'}.${surface}`, {
          class: 'foley', bus: 'sfx', gain: landing ? 0.58 : 0.38, reverbSend: landing ? 0.22 : 0.16,
          pitchJitter: 0.05, volumeJitterDb: 1.5,
          variants: buffers.map((buffer, index) => ({
            id: `${asset}-${index + 1}`,
            layers: [
              { kind: 'buffer', buffer, gain: 1 },
              ...(landing ? [{ kind: 'tone' as const, frequency: 90 + index * 4, endFrequency: 42, waveform: 'sine' as const, gain: 0.24, duration: 0.18 }] : []),
            ],
          })),
        })
      }
    }
    this.mixer.registerCue('traverse.wind', {
      class: 'ambience', bus: 'ambience', loop: true, gain: 0.85, pitchJitter: 0.015, volumeJitterDb: 1, reverbSend: 0,
      variants: loopVariants(wind, 'gem-lake-wind'),
    })
    this.mixer.registerCue('traverse.drip', {
      class: 'ambience', bus: 'sfx', loop: true, gain: 0.9, pitchJitter: 0.02, volumeJitterDb: 1, reverbSend: 0.3,
      attenuation: { near: 1.2, far: 30, rolloff: 1.4 },
      variants: loopVariants(drips, 'basement-drips'),
    })
    this.mixer.registerZone({ ...outdoorZone, beds: ['traverse.wind'] })
  }

  unlock() {
    const prepared = this.prepare()
    void Promise.all([prepared, this.mixer.start()]).then(() => {
      if (this.started || this.disposed) return
      this.started = true
      for (const { kind, at } of this.emitters) this.mixer.play(`traverse.${kind}`, { position: at })
    }).catch(() => {})
  }

  listen(position: { x: number; y: number; z: number }, forward: { x: number; y: number; z: number }, height: number, delta: number) {
    this.mixer.setListener({ position: [position.x, position.y, position.z], forward: [forward.x, forward.y, forward.z] })
    let zone: Zone['kind'] | 'open' = 'open'
    for (const candidate of this.zones) {
      if (position.x >= candidate.min[0] && position.x <= candidate.max[0] && position.y >= candidate.min[1] && position.y <= candidate.max[1] && position.z >= candidate.min[2] && position.z <= candidate.max[2]) { zone = candidate.kind; break }
    }
    if (zone !== this.zone) {
      this.zone = zone
      this.mixer.setZone(zoneFor[zone])
    }
    const exposure = Math.round((zone === 'open' ? Math.min(1, Math.max(0, height / 6)) : 0) * 10) / 10
    if (exposure !== this.exposure) {
      this.exposure = exposure
      this.mixer.setBusVolume('ambience', 0.6 + exposure * 0.9, 0.8)
    }
    this.mixer.update(delta)
  }

  PlayFootstepSound(request: Footstep) {
    const { x, y, z } = request.Location
    const surface: Surface = this.surfaceAt(x, y, z)
    this.mixer.play(`${request.SoundType === 'Land' ? 'landing' : 'footstep'}.${surface}`, { position: [x, y, z], volume: request.VolumeMultiplier, pitch: request.PitchMultiplier })
  }

  SetListenerTransform() {}

  play(cue: Cue, strength = 1, index = 0) {
    if (cue === 'checkpoint') { this.mixer.play('traverse.checkpoint', { pitch: Math.pow(2, index * 2 / 12) }); return }
    this.mixer.play(`traverse.${cue}`, { volume: Math.min(1, strength) })
  }

  sample() {
    return this.mixer.sample()
  }

  dispose() {
    this.disposed = true
    this.mixer.dispose()
  }
}
