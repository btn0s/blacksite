import { createAudioLog } from '@blacksite/check'
import type { Route, Zone } from './route'

export type Cue = 'start' | 'checkpoint' | 'record' | 'finish' | 'land' | 'mantle' | 'roll' | 'ragdoll'

type Vec3 = [number, number, number]

const reverbFor: Record<Zone['kind'] | 'open', number> = { open: 0.08, arch: 0.3, stairwell: 0.55 }

const jitterGain = () => Math.pow(10, (Math.random() * 2 - 1) * 2 / 20)

function noiseBuffer(context: BaseAudioContext, seconds: number, shape: (t: number, white: number) => number, start = 1234567) {
  const length = Math.floor(context.sampleRate * seconds)
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const data = buffer.getChannelData(0)
  let seed = start
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    data[i] = shape(i / context.sampleRate, seed / 0x3fffffff - 1)
  }
  return buffer
}

function impulse(context: BaseAudioContext, seconds: number) {
  const length = Math.floor(context.sampleRate * seconds)
  const buffer = context.createBuffer(2, length, context.sampleRate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3.2)
  }
  return buffer
}

function crackle(context: BaseAudioContext) {
  const pops: number[] = []
  for (let t = 0; t < 4; t += 0.02 + Math.random() * 0.16) pops.push(t)
  let last = 0
  let low = 0
  return noiseBuffer(context, 4, (t, white) => {
    while (pops.length > 1 && pops[1]! <= t) pops.shift()
    const since = t - pops[0]!
    const pop = since >= 0 ? Math.exp(-since * 260) * (0.5 + 0.5 * Math.sin(pops[0]! * 999)) : 0
    low += (white - low) * 0.02
    last = white * pop * 0.9 + low * 0.5
    return last
  })
}

function drip(context: BaseAudioContext, index = 0) {
  const drops = [0.3, 1.45, 2.2, 3.6].map((at, drop) => at + ((index * 7 + drop * 3) % 5) * 0.11)
  return noiseBuffer(context, 4.4, t => {
    let value = 0
    for (const at of drops) {
      const since = t - at
      if (since < 0 || since > 0.2) continue
      value += Math.sin(2 * Math.PI * (900 + index * 140 + since * 4200) * since) * Math.exp(-since * 40) * 0.6
    }
    return value
  })
}

function tarp(context: BaseAudioContext, index = 0) {
  let low = 0
  return noiseBuffer(context, 6, (t, white) => {
    low += (white - low) * 0.12
    const gust = Math.max(0, Math.sin(t * 1.3 + index * 2.1) * Math.sin(t * 0.47 + 1 + index) * 1.4)
    const flap = Math.pow(Math.max(0, Math.sin(t * 2 * Math.PI * (5 + 3 * Math.sin(t)))), 6)
    return low * (0.15 + gust * flap * 1.6)
  })
}

export class Soundscape {
  private context: AudioContext | null = null
  private buffers = new Map<string, AudioBuffer>()
  private master: GainNode | null = null
  private wind: GainNode | null = null
  private windFilter: BiquadFilterNode | null = null
  private wet: GainNode | null = null
  private bus: GainNode | null = null
  private readonly zones: Zone[]
  private readonly emitters: Route['emitters']
  private zone: Zone['kind'] | 'open' = 'open'
  private readonly log = createAudioLog()
  private readonly last = new Map<string, number>()

  constructor(route: Route) {
    this.zones = route.zones
    this.emitters = route.emitters
  }

  unlock() {
    if (this.context) { if (this.context.state === 'suspended') void this.context.resume(); return }
    const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) return
    const context = new AudioContextClass()
    this.context = context
    const master = context.createGain()
    master.gain.value = 0.9
    const limiter = context.createDynamicsCompressor()
    limiter.threshold.value = -10
    limiter.ratio.value = 6
    master.connect(limiter).connect(context.destination)
    this.master = master
    const bus = context.createGain()
    bus.connect(master)
    this.bus = bus
    const reverb = context.createConvolver()
    reverb.buffer = impulse(context, 1.7)
    const wet = context.createGain()
    wet.gain.value = reverbFor.open
    bus.connect(wet).connect(reverb).connect(master)
    this.wet = wet

    const windSource = context.createBufferSource()
    let pink = 0
    windSource.buffer = noiseBuffer(context, 6, (_, white) => (pink = pink * 0.97 + white * 0.03) * 6)
    windSource.loop = true
    const windFilter = context.createBiquadFilter()
    windFilter.type = 'bandpass'
    windFilter.frequency.value = 420
    windFilter.Q.value = 0.7
    const wind = context.createGain()
    wind.gain.value = 0.05
    const lfo = context.createOscillator()
    lfo.frequency.value = 0.09
    const lfoDepth = context.createGain()
    lfoDepth.gain.value = 180
    lfo.connect(lfoDepth).connect(windFilter.frequency)
    windSource.connect(windFilter).connect(wind).connect(master)
    windSource.start()
    lfo.start()
    this.log.start('wind', 'wind-bed')
    this.wind = wind
    this.windFilter = windFilter

    const drone = context.createGain()
    drone.gain.value = 0.018
    const droneFilter = context.createBiquadFilter()
    droneFilter.type = 'lowpass'
    droneFilter.frequency.value = 160
    for (const frequency of [49, 49.6, 73.5]) {
      const oscillator = context.createOscillator()
      oscillator.type = 'sawtooth'
      oscillator.frequency.value = frequency
      oscillator.connect(droneFilter)
      oscillator.start()
    }
    droneFilter.connect(drone).connect(master)
    this.log.start('drone', 'drone-bed')

    const seen = new Map<string, number>()
    for (const emitter of this.emitters) {
      const index = seen.get(emitter.kind) ?? 0
      seen.set(emitter.kind, index + 1)
      this.emit(emitter.kind, emitter.at, index)
    }
  }

  private emit(kind: Route['emitters'][number]['kind'], at: Vec3, index: number) {
    const context = this.context!
    const panner = context.createPanner()
    panner.panningModel = 'HRTF'
    panner.distanceModel = 'inverse'
    panner.refDistance = kind === 'tarp' ? 3 : 1.2
    panner.rolloffFactor = 1.4
    panner.maxDistance = 60
    panner.positionX.value = at[0]
    panner.positionY.value = at[1]
    panner.positionZ.value = at[2]
    const gain = context.createGain()
    if (kind === 'buzz') {
      gain.gain.value = 0.035
      const filter = context.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.value = 600
      filter.Q.value = 1.4
      for (const [frequency, type] of [[100, 'sawtooth'], [200, 'square'], [300.4, 'sawtooth']] as const) {
        const oscillator = context.createOscillator()
        oscillator.type = type
        oscillator.frequency.value = frequency
        oscillator.connect(filter)
        oscillator.start(context.currentTime + Math.random())
      }
      filter.connect(gain)
    } else {
      gain.gain.value = kind === 'fire' ? 0.55 : kind === 'drip' ? 0.5 : 0.4
      const buffer = (kind === 'fire' ? crackle : kind === 'drip' ? drip : tarp)(context, index)
      const source = context.createBufferSource()
      source.buffer = buffer
      source.loop = true
      source.connect(gain)
      source.start(context.currentTime, Math.random() * buffer.duration)
    }
    gain.connect(panner).connect(this.bus!)
    this.log.start(kind, `${kind}-${index}`)
  }

  listen(position: { x: number; y: number; z: number }, forward: { x: number; y: number; z: number }, height: number) {
    const context = this.context
    if (!context || context.state !== 'running') return
    const listener = context.listener
    const now = context.currentTime
    if (listener.positionX) {
      listener.positionX.setTargetAtTime(position.x, now, 0.03)
      listener.positionY.setTargetAtTime(position.y, now, 0.03)
      listener.positionZ.setTargetAtTime(position.z, now, 0.03)
      listener.forwardX.setTargetAtTime(forward.x, now, 0.03)
      listener.forwardY.setTargetAtTime(forward.y, now, 0.03)
      listener.forwardZ.setTargetAtTime(forward.z, now, 0.03)
    } else {
      listener.setPosition(position.x, position.y, position.z)
      listener.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0)
    }
    let zone: Zone['kind'] | 'open' = 'open'
    for (const candidate of this.zones) {
      if (position.x >= candidate.min[0] && position.x <= candidate.max[0] && position.y >= candidate.min[1] && position.y <= candidate.max[1] && position.z >= candidate.min[2] && position.z <= candidate.max[2]) { zone = candidate.kind; break }
    }
    if (zone !== this.zone) {
      this.zone = zone
      this.wet!.gain.setTargetAtTime(reverbFor[zone], now, 0.25)
    }
    const exposed = zone === 'stairwell' ? 0.2 : Math.min(1, Math.max(0, height / 6))
    this.wind!.gain.setTargetAtTime(0.035 + exposed * 0.11, now, 0.6)
    this.windFilter!.Q.setTargetAtTime(0.7 + exposed * 1.6, now, 0.6)
  }

  private variant(cue: string, count: number) {
    const previous = this.last.get(cue) ?? -1
    let next = Math.floor(Math.random() * count)
    if (next === previous) next = (next + 1) % count
    this.last.set(cue, next)
    return next
  }

  private voice(cue: string, sample: string, seconds: number) {
    this.log.start(cue, sample)
    setTimeout(() => this.log.end(), seconds * 1000)
  }

  footstep(type: string, wave: string) {
    if (this.context?.state === 'running') this.voice(`footstep-${type}`, wave, 0.6)
  }

  sample() {
    return this.log.sample()
  }

  play(cue: Cue, strength = 1, index = 0) {
    const context = this.context
    if (!context || context.state !== 'running') return
    const now = context.currentTime
    if (cue === 'start' || cue === 'checkpoint' || cue === 'finish' || cue === 'record') {
      const base = cue === 'start' ? [660, 880] : cue === 'checkpoint' ? [988, 1318] : cue === 'finish' ? [784, 659, 523] : [523, 659, 784, 1046]
      const step = cue === 'checkpoint' ? index : this.variant(cue, 2)
      const transpose = Math.pow(2, (cue === 'checkpoint' ? step * 2 : step) / 12)
      this.voice(cue, `${cue}-${step}`, 1)
      const level = jitterGain()
      base.forEach((frequency, note) => {
        const at = now + note * (cue === 'start' ? 0.12 : 0.09)
        const oscillator = context.createOscillator()
        oscillator.type = 'triangle'
        oscillator.frequency.value = frequency * transpose
        const gain = context.createGain()
        gain.gain.setValueAtTime(0, at)
        gain.gain.linearRampToValueAtTime(0.13 * level, at + 0.008)
        gain.gain.exponentialRampToValueAtTime(0.0008, at + 0.9)
        oscillator.connect(gain).connect(this.bus!)
        oscillator.start(at)
        oscillator.stop(at + 1)
      })
      return
    }
    const variant = this.variant(cue, 4)
    const spread = 1 + (variant - 1.5) * 0.08
    const length = cue === 'roll' ? 0.5 : cue === 'mantle' ? 0.35 : 0.22
    const decay = (cue === 'roll' ? 8 : cue === 'mantle' ? 12 : 26) * spread
    this.voice(cue, `${cue}-${variant}`, length)
    const key = `${cue}-${variant}`
    const buffer = this.buffers.get(key) ?? noiseBuffer(context, length, (t, white) => white * Math.exp(-t * decay), 1234567 + variant * 7919)
    this.buffers.set(key, buffer)
    const source = context.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = 1 + (Math.random() * 2 - 1) * 0.05
    const filter = context.createBiquadFilter()
    filter.type = cue === 'land' || cue === 'ragdoll' ? 'lowpass' : 'bandpass'
    filter.frequency.value = (cue === 'land' ? 260 : cue === 'ragdoll' ? 180 : cue === 'roll' ? 900 : 1500) * spread
    filter.Q.value = 0.8
    const gain = context.createGain()
    gain.gain.value = Math.min(1, strength) * (cue === 'ragdoll' ? 0.9 : cue === 'land' ? 0.7 : 0.25) * jitterGain()
    source.connect(filter).connect(gain).connect(this.bus!)
    source.start(now)
    if (cue === 'land' || cue === 'ragdoll') {
      const thump = context.createOscillator()
      thump.frequency.setValueAtTime((cue === 'ragdoll' ? 70 : 95) * spread, now)
      thump.frequency.exponentialRampToValueAtTime(40, now + 0.18)
      const body = context.createGain()
      body.gain.setValueAtTime(Math.min(1, strength) * 0.35, now)
      body.gain.exponentialRampToValueAtTime(0.001, now + 0.22)
      thump.connect(body).connect(this.bus!)
      thump.start(now)
      thump.stop(now + 0.25)
    }
  }

  dispose() {
    void this.context?.close()
    this.context = null
    this.master = null
    this.buffers.clear()
  }
}
