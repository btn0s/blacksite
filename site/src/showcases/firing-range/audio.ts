import type { AudioSample } from '@blacksite/check'
import { RANGE_BUDGET } from './model'
import type { ClipEvent } from '@blacksite/subject-fpp/arms'
import type { Surface } from './hits'

type Weapon = 'rifle' | 'pistol'

export function createRangeAudio() {
  let context: AudioContext | null = null
  let master: GainNode
  let wet: GainNode
  let noise: AudioBuffer
  const voices: Array<{ source: AudioScheduledSourceNode; start: number; end: number; reload: boolean }> = []
  let schedulingReload = false
  let plays: NonNullable<AudioSample['plays']> = []
  const prune = () => { const now = context?.currentTime ?? 0; for (let index = voices.length - 1; index >= 0; index--) if (voices[index].end <= now) voices.splice(index, 1) }
  const track = (source: AudioScheduledSourceNode, at: number, end: number) => {
    prune()
    while (voices.length >= RANGE_BUDGET.voices) voices.shift()!.source.stop()
    voices.push({ source, start: at, end, reload: schedulingReload })
  }

  const start = () => {
    if (context) { if (context.state === 'suspended') void context.resume(); return }
    context = new AudioContext()
    const compressor = context.createDynamicsCompressor()
    compressor.threshold.value = -14
    compressor.ratio.value = 5
    compressor.attack.value = 0.002
    compressor.release.value = 0.18
    compressor.connect(context.destination)
    master = context.createGain()
    master.gain.value = 0.7
    master.connect(compressor)
    const length = Math.round(context.sampleRate * 2.2)
    const impulse = context.createBuffer(2, length, context.sampleRate)
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel)
      for (let index = 0; index < length; index++) {
        const t = index / context.sampleRate
        const slap = Math.abs(t - 0.16 - channel * 0.03) < 0.012 ? 2.6 : 1
        data[index] = (Math.random() * 2 - 1) * Math.exp(-t * 3.1) * slap * (t < 0.025 ? t / 0.025 : 1)
      }
    }
    const reverb = context.createConvolver()
    reverb.buffer = impulse
    wet = context.createGain()
    wet.gain.value = 0.42
    wet.connect(reverb)
    reverb.connect(master)
    noise = context.createBuffer(1, context.sampleRate, context.sampleRate)
    const data = noise.getChannelData(0)
    for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1
  }

  const burst = (at: number, duration: number, filter: BiquadFilterType, frequency: number, q: number, level: number, decay: number, send = 0.3, pan = 0) => {
    const audio = context!
    const source = audio.createBufferSource()
    source.buffer = noise
    source.playbackRate.value = 0.8 + Math.random() * 0.4
    const shape = audio.createBiquadFilter()
    shape.type = filter
    shape.frequency.value = frequency
    shape.Q.value = q
    const gain = audio.createGain()
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(level, at + 0.0015)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay)
    const panner = audio.createStereoPanner()
    panner.pan.value = pan
    source.connect(shape).connect(gain).connect(panner)
    panner.connect(master)
    if (send) { const sendGain = audio.createGain(); sendGain.gain.value = send; panner.connect(sendGain).connect(wet) }
    const offset = Math.random() * 0.5
    source.start(at, offset, duration)
    track(source, at, at + duration / source.playbackRate.value)
    plays.push({ cue: `${filter}:${frequency}`, sample: `${offset.toFixed(6)}:${source.playbackRate.value.toFixed(6)}` })
  }

  const tone = (at: number, frequency: number, end: number, level: number, decay: number, type: OscillatorType = 'sine', send = 0.2, pan = 0) => {
    const audio = context!
    const oscillator = audio.createOscillator()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, at)
    oscillator.frequency.exponentialRampToValueAtTime(end, at + decay)
    const gain = audio.createGain()
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(level, at + 0.002)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay)
    const panner = audio.createStereoPanner()
    panner.pan.value = pan
    oscillator.connect(gain).connect(panner)
    panner.connect(master)
    if (send) { const sendGain = audio.createGain(); sendGain.gain.value = send; panner.connect(sendGain).connect(wet) }
    oscillator.start(at)
    oscillator.stop(at + decay + 0.05)
    track(oscillator, at, at + decay + 0.05)
  }

  const click = (at: number, frequency: number, level: number) => burst(at, 0.03, 'bandpass', frequency, 3, level, 0.025, 0.1)

  return {
    start,
    cancelReload() {
      for (let index = voices.length - 1; index >= 0; index--) if (voices[index].reload) { voices[index].source.stop(); voices.splice(index, 1) }
    },
    sample(): AudioSample { prune(); const now = context?.currentTime ?? 0; const drained = plays; plays = []; return { voices: voices.filter(voice => voice.start <= now).length, plays: drained } },
    shot(weapon: Weapon) {
      if (!context) return
      const now = context.currentTime
      const rifle = weapon === 'rifle'
      burst(now, 0.06, 'highpass', rifle ? 2400 : 3000, 0.7, rifle ? 1.4 : 1.1, 0.05, 0.5)
      burst(now, 0.3, 'lowpass', rifle ? 1100 : 1700, 0.8, rifle ? 1.6 : 1.2, rifle ? 0.22 : 0.15, 0.9)
      tone(now, rifle ? 130 : 180, 42, rifle ? 1.1 : 0.8, rifle ? 0.16 : 0.11, 'sine', 0.4)
      click(now + 0.012, rifle ? 3400 : 4200, 0.25)
    },
    dry() {
      if (!context) return
      click(context.currentTime, 2600, 0.5)
    },
    steel(pitch: number, strength: number, distance: number, pan: number) {
      if (!context) return
      const at = context.currentTime + distance / 343
      const level = Math.min(1, 9 / Math.max(6, distance)) * (0.5 + strength * 0.5)
      const base = 520 * pitch
      burst(at, 0.04, 'bandpass', base * 6, 1.5, level * 0.9, 0.03, 0.3, pan)
      const partials: Array<[number, number, number]> = [[1, 1, 1.5], [2.76, 0.55, 1.0], [5.4, 0.32, 0.55], [8.93, 0.18, 0.32], [1.53, 0.3, 1.2]]
      for (const [ratio, gain, decay] of partials) tone(at, base * ratio * (1 + (Math.random() - 0.5) * 0.01), base * ratio * 0.997, level * gain * 0.35, decay * (0.7 + pitch * 0.2), 'sine', 0.35, pan)
    },
    impact(surface: Surface, distance: number, pan: number) {
      if (!context || distance > 70) return
      const at = context.currentTime + distance / 343
      const level = Math.min(0.8, 4 / Math.max(3, distance))
      if (surface === 'dirt') burst(at, 0.1, 'lowpass', 500, 0.7, level, 0.08, 0.2, pan)
      else if (surface === 'wood' || surface === 'paper') { burst(at, 0.06, 'bandpass', 900, 2, level, 0.06, 0.2, pan); tone(at, 260, 180, level * 0.3, 0.07, 'triangle', 0.1, pan) }
      else if (surface === 'canvas') burst(at, 0.08, 'lowpass', 700, 0.7, level * 0.8, 0.07, 0.1, pan)
      else if (surface === 'metal') { burst(at, 0.05, 'bandpass', 2400, 3, level, 0.04, 0.2, pan); tone(at, 900, 760, level * 0.25, 0.25, 'triangle', 0.2, pan) }
      else burst(at, 0.06, 'bandpass', 1400, 1.2, level, 0.05, 0.3, pan)
    },
    casing(distance: number) {
      if (!context) return
      const now = context.currentTime
      const level = Math.min(0.22, 0.5 / Math.max(1, distance))
      for (let index = 0; index < 3; index++) tone(now + index * (0.05 + Math.random() * 0.05), 4200 + Math.random() * 2600, 4000, level * (1 - index * 0.3), 0.06, 'sine', 0.05)
    },
    reload(weapon: Weapon, events: readonly (readonly [number, ClipEvent])[]) {
      if (!context) return
      schedulingReload = true
      const now = context.currentTime
      const pitch = weapon === 'rifle' ? 1 : 1.25
      burst(now, 0.2, 'bandpass', 1200, 0.8, 0.12, 0.18, 0.05)
      for (const [time, event] of events) {
        const at = now + time
        if (event === 'grab') burst(at, 0.1, 'bandpass', 900, 1.2, 0.14, 0.08, 0.04)
        if (event === 'magazineOut') { click(at, 1800 * pitch, 0.45); burst(at + 0.02, 0.12, 'bandpass', 900, 1.2, 0.18, 0.1, 0.05) }
        if (event === 'magazineIn') { click(at, 1500 * pitch, 0.6); click(at + 0.02, 2400 * pitch, 0.35) }
        if (event === 'rackBack') click(at, 1300 * pitch, 0.55)
        if (event === 'rackForward') { click(at, 2100 * pitch, 0.6); click(at + 0.012, 3200 * pitch, 0.25) }
      }
      schedulingReload = false
    },
    land(speed: number) {
      if (!context) return
      const now = context.currentTime
      const level = Math.min(1, speed / 6)
      burst(now, 0.12, 'lowpass', 260, 0.7, 0.5 * level, 0.1, 0.004)
      burst(now + 0.015, 0.09, 'bandpass', 1400, 1.4, 0.12 * level, 0.07, 0.004)
    },
    equip() {
      if (!context) return
      const now = context.currentTime
      burst(now, 0.18, 'bandpass', 1500, 0.8, 0.12, 0.16, 0.05)
      click(now + 0.12, 2200, 0.35)
    },
  }
}

export type RangeAudio = ReturnType<typeof createRangeAudio>
