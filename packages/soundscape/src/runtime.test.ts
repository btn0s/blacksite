import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSoundscape } from './index'

class Param {
  value = 0
  ramps: number[] = []
  setValueAtTime(value: number) { this.value = value }
  setTargetAtTime(value: number) { this.value = value }
  linearRampToValueAtTime(value: number) { this.value = value; this.ramps.push(value) }
  exponentialRampToValueAtTime(value: number) { this.value = value }
  cancelScheduledValues() { }
}

class Node {
  outputs: Node[] = []
  connect<T extends Node>(node: T): T { this.outputs.push(node); return node }
  disconnect() { this.outputs = [] }
}

class Gain extends Node { gain = new Param() }
class Filter extends Node { type: BiquadFilterType = 'lowpass'; frequency = new Param(); Q = new Param() }
class Source extends Node {
  onended: (() => void) | null = null
  buffer: unknown
  loop = false
  type: OscillatorType = 'sine'
  playbackRate = new Param()
  frequency = new Param()
  startedAt = 0
  start(at = 0) { this.startedAt = at }
  stop() { }
}

class Context {
  state: AudioContextState = 'running'
  private clockStart = Date.now()
  private clockOffset = 0
  get currentTime() { return this.clockOffset + (this.state === 'running' ? (Date.now() - this.clockStart) / 1000 : 0) }
  sampleRate = 1000
  destination = new Node()
  listener = {
    positionX: new Param(), positionY: new Param(), positionZ: new Param(),
    forwardX: new Param(), forwardY: new Param(), forwardZ: new Param(),
    upX: new Param(), upY: new Param(), upZ: new Param(),
  }
  gains: Gain[] = []
  convolvers: Node[] = []
  sources: Source[] = []
  buffers = 0
  createGain() { const gain = new Gain(); this.gains.push(gain); return gain }
  createDynamicsCompressor() { return Object.assign(new Node(), { threshold: new Param(), knee: new Param(), ratio: new Param(), attack: new Param(), release: new Param() }) }
  createConvolver() {
    const convolver = Object.assign(new Node(), { buffer: null as unknown })
    this.convolvers.push(convolver)
    return convolver
  }
  createBiquadFilter() { return new Filter() }
  createStereoPanner() { return Object.assign(new Node(), { pan: new Param() }) }
  createPanner() { return Object.assign(new Node(), { panningModel: 'HRTF', distanceModel: 'linear', rolloffFactor: 0, positionX: new Param(), positionY: new Param(), positionZ: new Param() }) }
  createBufferSource() { const source = new Source(); this.sources.push(source); return source }
  createOscillator() { const source = new Source(); this.sources.push(source); return source }
  createBuffer(channels: number, length: number, sampleRate: number) {
    this.buffers++
    const data = Array.from({ length: channels }, () => new Float32Array(length))
    return { duration: length / sampleRate, getChannelData: (channel: number) => data[channel] }
  }
  async resume() { this.clockStart = Date.now(); this.state = 'running' }
  async suspend() { this.clockOffset = this.currentTime; this.state = 'suspended' }
}

afterEach(() => vi.useRealTimers())

describe('soundscape voice lifecycle', () => {
  it('prepares the graph and all built-in impulse responses without playing', async () => {
    const context = new Context()
    const audio = createSoundscape({ context: context as unknown as AudioContext, tier: 'phone' })
    audio.prepare()
    expect(context.buffers).toBe(5)
    expect(audio.sample()).toEqual({ voices: 0, plays: [] })
    await audio.start()
    expect(context.buffers).toBe(5)
    expect(audio.sample().plays?.[0]?.cue).toBe('ambience.wind')
    audio.dispose()
  })

  it('logs far events at arrival and keeps muted cues virtual', async () => {
    vi.useFakeTimers()
    const context = new Context()
    const audio = createSoundscape({ context: context as unknown as AudioContext, tier: 'phone', voiceCap: 1 })
    audio.registerZone({ name: 'empty', impulse: 'outdoor', beds: [] })
    audio.setZone('empty')
    await audio.start()
    audio.play('impact.steel', { distance: 100, delay: true })
    expect(audio.sample()).toEqual({ voices: 0, plays: [] })
    await vi.advanceTimersByTimeAsync(300)
    expect(audio.sample().plays).toEqual([{ cue: 'impact.steel', sample: expect.any(String) }])
    audio.setBusVolume('weapons', 0)
    expect(audio.play('weapon.rifle')).toBeNull()
    expect(audio.sample().voices).toBe(1)
    audio.dispose()
  })

  it('fades the next bed in when a one-voice cap prevents overlap', async () => {
    vi.useFakeTimers()
    const context = new Context()
    const audio = createSoundscape({ context: context as unknown as AudioContext, tier: 'phone', voiceCap: 1 })
    await audio.start()
    expect(audio.sample().plays?.[0]?.cue).toBe('ambience.wind')
    audio.setZone('small-room')
    expect(audio.sample().voices).toBe(1)
    await vi.advanceTimersByTimeAsync(230)
    audio.update()
    const sample = audio.sample()
    expect(sample.voices).toBe(1)
    expect(sample.plays?.[0]?.cue).toBe('ambience.room')
    expect(context.gains.some(gain => gain.gain.ramps.some(value => value > 0.01 && value < 0.1))).toBe(true)
    audio.dispose()
  })

  it('does not advance a distant arrival while the audio clock is suspended', async () => {
    vi.useFakeTimers()
    const context = new Context()
    const audio = createSoundscape({ context: context as unknown as AudioContext, tier: 'phone', voiceCap: 1 })
    audio.registerZone({ name: 'empty', impulse: 'outdoor', beds: [] })
    audio.setZone('empty')
    await audio.start()
    await context.suspend()
    audio.play('impact.steel', { distance: 100, delay: true })
    await vi.advanceTimersByTimeAsync(1000)
    expect(audio.sample()).toEqual({ voices: 0, plays: [] })
    await context.resume()
    audio.update()
    await vi.advanceTimersByTimeAsync(300)
    expect(audio.sample().plays?.[0]?.cue).toBe('impact.steel')
    audio.dispose()
  })

  it('selects nonrepeating variants in arrival order when nearby sounds overtake one another', async () => {
    vi.useFakeTimers()
    const context = new Context()
    const audio = createSoundscape({ context: context as unknown as AudioContext, tier: 'phone', random: () => 0.5 })
    audio.registerZone({ name: 'empty', impulse: 'outdoor', beds: [] })
    audio.registerCue('arrival', { delayByDistance: true, selection: 'round-robin', variants: ['a', 'b'].map((id, index) => ({ id, layers: [{ kind: 'tone', frequency: 440 + index * 220, gain: 0.2, duration: 0.1 }] })) })
    audio.setZone('empty')
    await audio.start()
    audio.play('arrival', { distance: 27.44 })
    audio.play('arrival', { distance: 0 })
    audio.play('arrival', { distance: 6.86 })
    const plays = [...audio.sample().plays ?? []]
    await vi.advanceTimersByTimeAsync(25)
    plays.push(...audio.sample().plays ?? [])
    await vi.advanceTimersByTimeAsync(60)
    plays.push(...audio.sample().plays ?? [])
    expect(plays.map(play => play.sample)).toEqual(['a', 'b', 'a'])
    expect(context.sources.sort((a, b) => a.startedAt - b.startedAt).map(source => source.frequency.value)).toEqual([440, 660, 440])
    audio.dispose()
  })

  it('routes weapon reverb through the weapons bus fader', async () => {
    const context = new Context()
    const audio = createSoundscape({ context: context as unknown as AudioContext, tier: 'phone' })
    await audio.start()
    audio.play('weapon.rifle')
    const weaponWet = context.convolvers.at(-1)?.outputs[0]
    expect(weaponWet?.outputs[0]).toBe(context.gains[3])
    audio.setBusVolume('weapons', 0)
    expect(context.gains[3].gain.value).toBe(0)
    audio.dispose()
  })

  it('does not allocate room reverbs for dry interface or music cues', () => {
    const context = new Context()
    const audio = createSoundscape({ context: context as unknown as AudioContext, tier: 'phone' })
    audio.prepare()
    const prepared = context.convolvers.length
    for (const bus of ['ui', 'music'] as const) {
      audio.registerCue(`dry.${bus}`, { class: 'ui', bus, reverbSend: 0, variants: [{ id: 'a', layers: [{ kind: 'tone', frequency: 440, gain: 0.1, duration: 0.1 }] }] })
      audio.play(`dry.${bus}`)
    }
    expect(context.convolvers).toHaveLength(prepared)
    expect(audio.sample().plays?.map(play => play.cue)).toEqual(['dry.ui', 'dry.music'])
    audio.dispose()
  })

  it.each([16, 28])('holds a %i-voice firefight cap without repeating variants', async voiceCap => {
    vi.useFakeTimers()
    const context = new Context()
    const audio = createSoundscape({ context: context as unknown as AudioContext, tier: 'phone', voiceCap, random: () => 0.999999 })
    audio.registerCue('firefight', { class: 'weapons', bus: 'weapons', variants: ['a', 'b', 'c', 'd'].map(id => ({ id, layers: [{ kind: 'noise', gain: 0.8, duration: 0.3 }] })) })
    await audio.start()
    audio.sample()
    let previous = ''
    let plays = 0
    for (let shot = 0; shot < 90; shot++) {
      audio.play('firefight')
      await vi.advanceTimersByTimeAsync(35)
      audio.update()
      const sample = audio.sample()
      expect(sample.voices).toBeLessThanOrEqual(voiceCap)
      for (const play of sample.plays ?? []) {
        if (play.cue !== 'firefight') continue
        expect(play.sample).not.toBe(previous)
        previous = play.sample
        plays++
      }
    }
    expect(plays).toBe(90)
    audio.dispose()
    expect(audio.sample().voices).toBe(0)
  })
})
