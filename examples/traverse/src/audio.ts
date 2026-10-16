import type { AlsFootstepAudioRuntime } from 'als-ue5-r3f/engine/alsAudioBridge'
import { createSoundscape, type CueDefinition, type SoundLayer, type Surface, type Vec3 } from '@blacksite/soundscape'
import type { Route, Zone } from './route'

export type Cue = 'start' | 'checkpoint' | 'record' | 'finish' | 'land' | 'mantle' | 'roll' | 'ragdoll'
export type Occlusion = (listener: Vec3, source: Vec3) => boolean

type Footstep = Parameters<AlsFootstepAudioRuntime['PlayFootstepSound']>[0]
type EmitterKind = Route['emitters'][number]['kind']

const rate = 24000
const zoneFor: Record<Zone['kind'] | 'open', string> = { open: 'outdoor', arch: 'corridor', stairwell: 'hall' }

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

function drip(index: number) {
  const drops = [0.3, 1.45, 2.2, 3.6].map((at, drop) => at + ((index * 7 + drop * 3) % 5) * 0.11)
  return pcm(4.4, t => {
    let value = 0
    for (const at of drops) {
      const since = t - at
      if (since < 0 || since > 0.2) continue
      value += Math.sin(2 * Math.PI * (900 + index * 140 + since * 4200) * since) * Math.exp(-since * 40) * 0.6
    }
    return value
  })
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
    class: 'ui', bus: 'ui', pitchJitter: 0, volumeJitterDb: 2, gain: 0.5,
    variants: [0, 1].map(step => ({ id: String(step), layers: notes.map((frequency, index) => note(frequency * Math.pow(2, step / 12), 0.26, 0.9, index * gap)) })),
  }
}

function body(build: (spread: number) => SoundLayer[], gain: number): CueDefinition {
  return {
    class: 'foley', bus: 'sfx', gain, reverbSend: 0.2,
    variants: [0, 1, 2, 3].map(variant => ({ id: String(variant), layers: build(1 + (variant - 1.5) * 0.08) })),
  }
}

function emitter(kind: EmitterKind, gain: number, near: number, far: number): CueDefinition {
  const build = kind === 'fire' ? crackle : kind === 'drip' ? drip : kind === 'tarp' ? tarp : buzz
  const filter = kind === 'buzz' ? { type: 'bandpass' as const, frequency: 600, q: 1.4 } : undefined
  return {
    class: 'ambience', bus: 'sfx', loop: true, gain, pitchJitter: 0.02, reverbSend: 0.3,
    attenuation: { near, far, rolloff: 1.4 },
    variants: [0, 1, 2].map(index => ({ id: `${kind}-${index}`, layers: [{ kind: 'buffer', buffer: build(index), loop: true, gain: 1, filter }] })),
  }
}

export class TraverseAudio {
  private readonly mixer: ReturnType<typeof createSoundscape>
  private readonly zones: Zone[]
  private readonly emitters: Route['emitters']
  private readonly surfaceAt: Route['surfaceAt']
  private occlusion: Occlusion | null = null
  private readonly blocked = new WeakMap<Vec3, { at: number; value: boolean }>()
  private zone: Zone['kind'] | 'open' = 'open'
  private exposure = -1
  private prepared = false
  private started = false

  constructor(route: Route, tier: 'desktop' | 'phone') {
    this.zones = route.zones
    this.emitters = route.emitters
    this.surfaceAt = route.surfaceAt
    this.mixer = createSoundscape({ tier, voiceCap: tier === 'phone' ? 16 : 32, occlusion: (listener, source) => this.occluded(listener, source) })
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
    if (this.prepared) return
    this.prepared = true
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
    mixer.registerCue('traverse.drip', emitter('drip', 0.5, 1.2, 30))
    mixer.registerCue('traverse.tarp', emitter('tarp', 0.4, 3, 45))
    mixer.registerCue('traverse.buzz', emitter('buzz', 0.12, 1.2, 25))
    mixer.setZone('outdoor')
    mixer.prepare()
  }

  unlock() {
    this.prepare()
    void this.mixer.start().then(() => {
      if (this.started) return
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
    this.mixer.dispose()
  }
}
