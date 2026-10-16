import { createAudioLog } from '@blacksite/check'
import { PRACTICALS, type Footing, type Hit } from './layout'
import { ACOUSTICS, AI, BUDGET, SPEED_OF_SOUND, sabine, type RoomId } from './model'

export type Listener = { x: number; y: number; z: number; yaw: number }

type Point = { x: number; y: number; z: number }

export type BreachAudio = {
  start(): void
  log: ReturnType<typeof createAudioLog>
  setListener(listener: Listener, room: RoomId): void
  shot(weapon: 'rifle' | 'pistol'): void
  dry(): void
  reload(weapon: 'rifle' | 'pistol', seconds: number): void
  equip(): void
  casing(distance: number, footing: Footing): void
  impact(hit: Hit, at: Point): void
  hitMarker(kill: boolean, head: boolean): void
  enemyShot(at: Point, occluded: boolean): void
  crack(at: Point, near: number): void
  hurt(amount: number): void
  footstep(footing: Footing, loud: number): void
  enemyStep(footing: Footing, at: Point): void
  bark(text: string, at: Point, voice: number): number
  sting(kind: 'clear' | 'exfil' | 'death'): void
  update(dt: number): void
  setMuted(muted: boolean): void
}

type Priority = 0 | 1 | 2
type Voice = { bus: GainNode; nodes: AudioNode[]; pending: number; done: boolean; deadline: number; v: number; distance: number; delay: number }
type Send = { input: GainNode; linked: boolean; idle: number }
type Cue = { at?: Point; send?: number; gain?: number; cutoff?: number; priority?: Priority }
type Bed = { gain: GainNode; level: number }
type Spot = { at: Point; room: RoomId; gain: GainNode; panner: StereoPannerNode; level: number; flutter: number }

const ROOM_IDS = Object.keys(ACOUSTICS) as RoomId[]
const VARIANTS = 4
const PITCH = [1, 0.94, 1.07, 0.89]
const COLOR = [1, 1.15, 0.86, 1.07]
const SPAN = [1, 1.1, 0.92, 1.17]
const TRANSPOSE = [1, 2 ** (-1 / 12), 2 ** (2 / 12), 2 ** (-2 / 12)]
const BARK_PITCH = [118, 96, 142, 108, 130, 88]
const FORMANTS: Array<[number, number]> = [[730, 1090], [530, 1840], [270, 2290], [570, 840], [300, 870], [640, 1190], [440, 1020]]
const LIMIT = [BUDGET.voices - 6, BUDGET.voices - 2, BUDGET.voices] as const
const MASTER = 0.75
const outdoor = (room: RoomId) => !ACOUSTICS[room].volume
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const wetFor = (room: RoomId) => outdoor(room) ? 0.12 : 0.22 + 0.22 * Math.min(3, sabine(ACOUSTICS[room]))

function impulse(audio: BaseAudioContext, room: RoomId) {
  const acoustics = ACOUSTICS[room]
  const tail = Math.min(3.2, sabine(acoustics))
  const rate = audio.sampleRate
  const pre = Math.round(acoustics.predelay * rate)
  const length = pre + Math.round(tail * rate)
  const buffer = audio.createBuffer(2, length, rate)
  const k = 6.91 / tail
  const size = Math.cbrt(acoustics.volume || 1)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    let smooth = 0
    for (let index = pre; index < length; index++) {
      const t = (index - pre) / rate
      const damp = 0.85 * (t / tail)
      smooth += (Math.random() * 2 - 1 - smooth) * (1 - damp)
      data[index] = smooth * Math.exp(-k * t) * (t < 0.004 ? t / 0.004 : 1)
    }
    if (acoustics.volume) for (let tap = 1; tap <= 6; tap++) {
      const at = pre + Math.round(tap * size * 0.0029 * (1 + channel * 0.13 + Math.random() * 0.3) * rate)
      if (at < length) data[at]! += (Math.random() < 0.5 ? -1 : 1) * 0.9 / tap
    }
  }
  return buffer
}

export function createBreachAudio(): BreachAudio {
  const log = createAudioLog()
  let context: AudioContext | null = null
  let master: GainNode
  let wetBus: GainNode
  let noises: AudioBuffer[] = []
  let beds: { indoor: Bed; outdoor: Bed } | null = null
  const spots: Spot[] = []
  const sends = {} as Record<RoomId, Send>
  const voices = new Set<Voice>()
  const last = new Map<string, number>()
  const listener: Listener = { x: 0, y: 0, z: 0, yaw: 0 }
  let room: RoomId = 'yard'
  let muted = false
  let bedFade = 0
  let creakIn = 8

  const now = () => context!.currentTime
  const bedVoices = () => (beds ? (bedFade > 0 ? 2 : 1) : 0) + spots.length

  const place = (at: Point) => {
    const dx = at.x - listener.x, dy = at.y - listener.y, dz = at.z - listener.z
    const flat = Math.hypot(dx, dz)
    const distance = Math.hypot(flat, dy)
    const sin = Math.sin(listener.yaw), cos = Math.cos(listener.yaw)
    const right = flat > 0.3 ? (dx * cos - dz * sin) / flat : 0
    const ahead = flat > 0.3 ? (-dx * sin - dz * cos) / flat : 1
    const behind = ahead < 0 ? 0.65 + 0.35 * (1 + ahead) : 1
    return { distance, pan: right * 0.85, gain: Math.min(1, 3 / Math.max(3, distance)), cutoff: Math.max(900, 16000 * Math.exp(-distance / 28)) * behind }
  }

  const distanceTo = (at: Point) => Math.hypot(at.x - listener.x, at.y - listener.y, at.z - listener.z)

  const finish = (voice: Voice) => {
    if (voice.done) return
    voice.done = true
    voices.delete(voice)
    log.end()
    for (const node of voice.nodes) node.disconnect()
  }

  const begin = (cue: string, options: Cue = {}): Voice | null => {
    const audio = context
    if (!audio) return null
    if (voices.size + bedVoices() >= LIMIT[options.priority ?? 2]) return null
    const previous = last.get(cue)
    let v = Math.floor(Math.random() * (previous === undefined ? VARIANTS : VARIANTS - 1))
    if (previous !== undefined && v >= previous) v++
    last.set(cue, v)
    log.start(cue, `${cue}-${v + 1}`)
    const bus = audio.createGain()
    bus.gain.value = options.gain ?? 1
    const nodes: AudioNode[] = [bus]
    let tail: AudioNode = bus
    let distance = 0
    let cutoff = options.cutoff ?? 0
    let pan = 0
    if (options.at) {
      const spot = place(options.at)
      distance = spot.distance
      bus.gain.value *= spot.gain
      cutoff = cutoff ? Math.min(cutoff, spot.cutoff) : spot.cutoff
      pan = spot.pan
    }
    if (cutoff) {
      const filter = audio.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = cutoff
      tail.connect(filter)
      nodes.push(filter)
      tail = filter
    }
    if (pan) {
      const panner = audio.createStereoPanner()
      panner.pan.value = pan
      tail.connect(panner)
      nodes.push(panner)
      tail = panner
    }
    tail.connect(master)
    if (options.send) {
      const send = audio.createGain()
      send.gain.value = options.send
      tail.connect(send).connect(wetBus)
      nodes.push(send)
    }
    const voice: Voice = { bus, nodes, pending: 0, done: false, deadline: performance.now() + 400, v, distance, delay: distance / SPEED_OF_SOUND }
    voices.add(voice)
    return voice
  }

  const track = (voice: Voice, source: AudioScheduledSourceNode, stop: number, chain: AudioNode[]) => {
    voice.pending++
    voice.deadline = Math.max(voice.deadline, performance.now() + (stop - now()) * 1000 + 400)
    source.onended = () => {
      for (const node of chain) node.disconnect()
      if (--voice.pending <= 0) finish(voice)
    }
  }

  const envelope = (gain: GainNode, at: number, level: number, attack: number, decay: number) => {
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), at + attack)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay)
  }

  const burst = (voice: Voice, at: number, filter: BiquadFilterType, frequency: number, q: number, level: number, decay: number, attack = 0.0015, rate = 1) => {
    const audio = context!
    const source = audio.createBufferSource()
    source.buffer = noises[(voice.v + voice.pending) % noises.length]!
    source.loop = true
    source.playbackRate.value = rate * (0.92 + Math.random() * 0.16)
    const shape = audio.createBiquadFilter()
    shape.type = filter
    shape.frequency.value = frequency
    shape.Q.value = q
    const gain = audio.createGain()
    envelope(gain, at, level, attack, decay)
    source.connect(shape).connect(gain).connect(voice.bus)
    const stop = at + attack + decay + 0.02
    source.start(at, Math.random() * 0.9)
    source.stop(stop)
    track(voice, source, stop, [source, shape, gain])
  }

  const tone = (voice: Voice, at: number, frequency: number, end: number, level: number, decay: number, type: OscillatorType = 'sine', attack = 0.002) => {
    const audio = context!
    const oscillator = audio.createOscillator()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(frequency, at)
    oscillator.frequency.exponentialRampToValueAtTime(end, at + attack + decay)
    const gain = audio.createGain()
    envelope(gain, at, level, attack, decay)
    oscillator.connect(gain).connect(voice.bus)
    const stop = at + attack + decay + 0.03
    oscillator.start(at)
    oscillator.stop(stop)
    track(voice, oscillator, stop, [oscillator, gain])
  }

  const pad = (voice: Voice, at: number, frequency: number, level: number, attack: number, hold: number, release: number, type: OscillatorType = 'sawtooth', cutoff = 900) => {
    const audio = context!
    const oscillator = audio.createOscillator()
    oscillator.type = type
    oscillator.frequency.value = frequency
    const filter = audio.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = cutoff
    const gain = audio.createGain()
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.linearRampToValueAtTime(level, at + attack)
    gain.gain.setValueAtTime(level, at + attack + hold)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + hold + release)
    oscillator.connect(filter).connect(gain).connect(voice.bus)
    const stop = at + attack + hold + release + 0.03
    oscillator.start(at)
    oscillator.stop(stop)
    track(voice, oscillator, stop, [oscillator, filter, gain])
  }

  const click = (voice: Voice, at: number, frequency: number, level: number) => burst(voice, at, 'bandpass', frequency, 3, level, 0.025)

  const step = (voice: Voice, footing: Footing, at: number) => {
    const p = PITCH[voice.v]!, c = COLOR[voice.v]!, s = SPAN[voice.v]!
    if (footing !== 'water') burst(voice, at, 'lowpass', 260 * c, 0.8, 0.7, 0.06 * s, 0.003)
    if (footing === 'concrete') {
      burst(voice, at + 0.004, 'bandpass', 1900 * c, 1.4, 0.35, 0.035 * s)
      burst(voice, at + 0.05 * s, 'highpass', 3200 * c, 0.7, 0.08, 0.03, 0.004)
    } else if (footing === 'rubble') {
      for (let grain = 0; grain < 4; grain++) burst(voice, at + grain * (0.012 + 0.01 * grain) * s, 'bandpass', (2200 + grain * 600) * c, 1.6, 0.35 - grain * 0.06, 0.02)
      burst(voice, at + 0.02, 'lowpass', 900 * c, 0.6, 0.25, 0.09 * s, 0.006)
    } else if (footing === 'metal') {
      tone(voice, at, 380 * p, 372 * p, 0.18, 0.22 * s, 'triangle')
      tone(voice, at, 1047 * p, 1040 * p, 0.08, 0.16 * s)
      burst(voice, at, 'bandpass', 2600 * c, 2, 0.3, 0.02)
    } else if (footing === 'wood') {
      tone(voice, at, 180 * p, 140 * p, 0.4, 0.07 * s, 'triangle')
      burst(voice, at, 'bandpass', 700 * c, 2, 0.35, 0.05 * s)
    } else if (footing === 'dirt') {
      burst(voice, at, 'lowpass', 600 * c, 0.7, 0.5, 0.08 * s, 0.005)
      burst(voice, at + 0.01, 'highpass', 2500 * c, 0.7, 0.12, 0.06, 0.01)
    } else {
      burst(voice, at, 'bandpass', 1100 * c, 0.8, 0.45, 0.16 * s, 0.02)
      burst(voice, at + 0.02, 'highpass', 3500 * c, 0.7, 0.2, 0.22 * s, 0.04)
      tone(voice, at + 0.03, 900 * p, 420 * p, 0.06, 0.05)
    }
  }

  const creak = () => {
    const angle = Math.random() * Math.PI * 2
    const range = 6 + Math.random() * 6
    const voice = begin('creak', { at: { x: listener.x + Math.cos(angle) * range, y: listener.y + 2, z: listener.z + Math.sin(angle) * range }, send: 0.8, gain: 0.5, priority: 0 })
    if (!voice) return
    const audio = context!, t = now(), p = PITCH[voice.v]!, s = SPAN[voice.v]!
    const length = 1.4 * s
    const oscillator = audio.createOscillator()
    oscillator.type = 'sawtooth'
    oscillator.frequency.setValueAtTime(68 * p, t)
    for (let wobble = 1; wobble <= 6; wobble++) oscillator.frequency.linearRampToValueAtTime(68 * p * (0.9 + Math.random() * 0.3), t + length * wobble / 6)
    const filter = audio.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.value = 520 * COLOR[voice.v]!
    filter.Q.value = 9
    const gain = audio.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.linearRampToValueAtTime(0.6, t + length * 0.4)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length)
    oscillator.connect(filter).connect(gain).connect(voice.bus)
    oscillator.start(t)
    oscillator.stop(t + length + 0.03)
    track(voice, oscillator, t + length + 0.03, [oscillator, filter, gain])
    tone(voice, t + length * 0.7, 160 * p, 158 * p, 0.1, 1.2, 'triangle')
  }

  const setBeds = () => {
    if (!beds || !context) return
    const open = outdoor(room)
    beds.indoor.gain.gain.setTargetAtTime(open ? 0 : beds.indoor.level, now(), 0.12)
    beds.outdoor.gain.gain.setTargetAtTime(open ? beds.outdoor.level : 0, now(), 0.12)
  }

  const start = () => {
    if (context) {
      if (context.state === 'suspended') void context.resume().catch(() => {})
      return
    }
    if (typeof AudioContext === 'undefined') return
    const audio = new AudioContext({ latencyHint: 'interactive' })
    context = audio
    void audio.resume().catch(() => {})
    const compressor = audio.createDynamicsCompressor()
    compressor.threshold.value = -14
    compressor.ratio.value = 5
    compressor.attack.value = 0.002
    compressor.release.value = 0.18
    compressor.connect(audio.destination)
    master = audio.createGain()
    master.gain.value = muted ? 0 : MASTER
    master.connect(compressor)
    wetBus = audio.createGain()
    noises = [0, 1, 2].map(() => {
      const buffer = audio.createBuffer(1, audio.sampleRate, audio.sampleRate)
      const data = buffer.getChannelData(0)
      for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1
      return buffer
    })
    const brown = audio.createBuffer(1, audio.sampleRate * 3, audio.sampleRate)
    const data = brown.getChannelData(0)
    let walk = 0
    for (let index = 0; index < data.length; index++) {
      walk = (walk + 0.02 * (Math.random() * 2 - 1)) / 1.02
      data[index] = walk * 3.5
    }
    const fade = Math.round(audio.sampleRate * 0.05)
    for (let index = 0; index < fade; index++) data[data.length - fade + index] = data[data.length - fade + index]! * (1 - index / fade) + data[index]! * (index / fade)
    for (const id of ROOM_IDS) {
      const input = audio.createGain()
      input.gain.value = id === room ? wetFor(id) : 0
      const convolver = audio.createConvolver()
      convolver.buffer = impulse(audio, id)
      input.connect(convolver).connect(master)
      if (outdoor(id)) {
        const delay = audio.createDelay(1)
        delay.delayTime.value = 0.28
        const shade = audio.createBiquadFilter()
        shade.type = 'lowpass'
        shade.frequency.value = 2200
        const echo = audio.createGain()
        echo.gain.value = 0.9
        input.connect(delay).connect(shade).connect(echo).connect(master)
      }
      const linked = id === room
      if (linked) wetBus.connect(input)
      sends[id] = { input, linked, idle: 0 }
    }
    const bed = (filter: BiquadFilterType, frequency: number, q: number, level: number, gust: boolean): Bed => {
      const source = audio.createBufferSource()
      source.buffer = brown
      source.loop = true
      const shape = audio.createBiquadFilter()
      shape.type = filter
      shape.frequency.value = frequency
      shape.Q.value = q
      const gain = audio.createGain()
      gain.gain.value = 0
      if (gust) {
        const swell = audio.createGain()
        swell.gain.value = 0.7
        const lfo = audio.createOscillator()
        lfo.frequency.value = 0.11
        const depth = audio.createGain()
        depth.gain.value = 0.3
        lfo.connect(depth).connect(swell.gain)
        lfo.start()
        source.connect(shape).connect(swell).connect(gain)
      } else source.connect(shape).connect(gain)
      gain.connect(master)
      source.start(0, Math.random() * 2)
      return { gain, level }
    }
    beds = { indoor: bed('lowpass', 160, 0.7, 0.3, false), outdoor: bed('bandpass', 420, 0.6, 0.22, true) }
    setBeds()
    const spot = (at: Point, id: RoomId, level: number, flutter: number, sources: AudioNode[]) => {
      const gain = audio.createGain()
      gain.gain.value = 0
      const panner = audio.createStereoPanner()
      for (const source of sources) source.connect(gain)
      gain.connect(panner).connect(master)
      spots.push({ at, room: id, gain, panner, level, flutter })
    }
    const loop = (buffer: AudioBuffer, type: BiquadFilterType, frequency: number, q: number) => {
      const source = audio.createBufferSource()
      source.buffer = buffer
      source.loop = true
      source.start(0, Math.random())
      const shape = audio.createBiquadFilter()
      shape.type = type
      shape.frequency.value = frequency
      shape.Q.value = q
      source.connect(shape)
      return shape
    }
    const hum = (frequency: number, type: OscillatorType, level: number) => {
      const oscillator = audio.createOscillator()
      oscillator.type = type
      oscillator.frequency.value = frequency
      oscillator.start()
      const gain = audio.createGain()
      gain.gain.value = level
      oscillator.connect(gain)
      return gain
    }
    for (const practical of PRACTICALS) {
      const at = { x: practical.at[0], y: practical.at[1], z: practical.at[2] }
      if (practical.kind === 'tube') spot(at, practical.room, 0.05, 0, [hum(100, 'sawtooth', 0.5), hum(200, 'square', 0.12), loop(noises[1]!, 'bandpass', 4200, 6)])
      if (practical.kind === 'fire') spot(at, practical.room, 0.16, 1, [loop(noises[0]!, 'bandpass', 1500, 0.7), loop(brown, 'lowpass', 240, 0.7)])
      if (practical.kind === 'emergency') spot({ x: -5.2, y: 1.1, z: -23.4 }, practical.room, 0.06, 0.4, [loop(noises[2]!, 'bandpass', 1900, 3), hum(330, 'square', 0.08)])
    }
  }

  return {
    start,
    log,
    setListener(next, id) {
      listener.x = next.x
      listener.y = next.y
      listener.z = next.z
      listener.yaw = next.yaw
      if (id === room) return
      const previous = room
      room = id
      if (!context) return
      const t = now()
      for (const other of ROOM_IDS) {
        const send = sends[other]
        if (other !== id && !send.linked) continue
        send.input.gain.cancelScheduledValues(t)
        send.input.gain.setValueAtTime(send.input.gain.value, t)
        send.input.gain.linearRampToValueAtTime(other === id ? wetFor(other) : 0, t + 0.35)
        if (other === id) {
          send.idle = 0
          if (!send.linked) { wetBus.connect(send.input); send.linked = true }
        }
      }
      if (outdoor(previous) !== outdoor(id)) { bedFade = 0.8; setBeds() }
    },
    shot(weapon) {
      const rifle = weapon === 'rifle'
      const voice = begin(rifle ? 'shot-rifle' : 'shot-pistol', { send: 1 })
      if (!voice) return
      const t = now(), p = PITCH[voice.v]!, c = COLOR[voice.v]!, s = SPAN[voice.v]!
      burst(voice, t, 'highpass', (rifle ? 2400 : 3000) * c, 0.7, rifle ? 1.4 : 1.1, 0.05 * s)
      burst(voice, t, 'lowpass', (rifle ? 1100 : 1700) * c, 0.8, rifle ? 1.6 : 1.2, (rifle ? 0.22 : 0.15) * s)
      tone(voice, t, (rifle ? 130 : 180) * p, 42, rifle ? 1.1 : 0.8, (rifle ? 0.16 : 0.11) * s)
      burst(voice, t + 0.003, 'bandpass', (rifle ? 420 : 560) * p, 1.1, rifle ? 0.6 : 0.45, (rifle ? 0.36 : 0.24) * s, 0.004)
      click(voice, t + 0.012, (rifle ? 3400 : 4200) * c, 0.25)
    },
    dry() {
      const voice = begin('dry')
      if (!voice) return
      const t = now(), c = COLOR[voice.v]!
      click(voice, t, 2600 * c, 0.5)
      click(voice, t + 0.018 * SPAN[voice.v]!, 1700 * c, 0.2)
    },
    reload(weapon, seconds) {
      const voice = begin(weapon === 'rifle' ? 'reload-rifle' : 'reload-pistol', { send: 0.08 })
      if (!voice) return
      const t = now(), c = COLOR[voice.v]!
      burst(voice, t, 'bandpass', 1200 * c, 0.8, 0.12, 0.18, 0.01)
      click(voice, t + seconds * 0.22, 1800 * c, 0.45)
      burst(voice, t + seconds * 0.24, 'bandpass', 900 * c, 1.2, 0.18, 0.1)
      click(voice, t + seconds * 0.58, 1500 * c, 0.6)
      click(voice, t + seconds * 0.6, 2400 * c, 0.35)
      if (weapon === 'rifle') { click(voice, t + seconds * 0.8, 1300 * c, 0.55); click(voice, t + seconds * 0.86, 2100 * c, 0.5) }
      else click(voice, t + seconds * 0.82, 2000 * c, 0.55)
    },
    equip() {
      const voice = begin('equip', { send: 0.05 })
      if (!voice) return
      const t = now(), c = COLOR[voice.v]!
      burst(voice, t, 'bandpass', 1500 * c, 0.8, 0.12, 0.16 * SPAN[voice.v]!, 0.01)
      click(voice, t + 0.12, 2200 * c, 0.35)
    },
    casing(distance, footing) {
      const voice = begin(`casing-${footing}`, { gain: Math.min(0.22, 0.5 / Math.max(1, distance)), send: 0.05, priority: 0 })
      if (!voice) return
      const t = now() + 0.28 * SPAN[voice.v]!, p = PITCH[voice.v]!
      if (footing === 'water') {
        tone(voice, t, 1400 * p, 600 * p, 0.6, 0.05)
        burst(voice, t, 'highpass', 3000, 0.7, 0.3, 0.08, 0.01)
      } else if (footing === 'dirt') {
        burst(voice, t, 'bandpass', 1200 * p, 1.5, 0.6, 0.03)
        tone(voice, t, 3200 * p, 3000 * p, 0.3, 0.03)
      } else if (footing === 'wood') {
        burst(voice, t, 'bandpass', 1800 * p, 2, 0.6, 0.03)
        for (let bounce = 0; bounce < 2; bounce++) tone(voice, t + bounce * 0.07, 2400 * p, 2300 * p, 0.6 - bounce * 0.25, 0.035)
      } else {
        const ring = footing === 'metal' ? 0.14 : 0.06
        for (let bounce = 0; bounce < 3; bounce++) tone(voice, t + bounce * (0.05 + 0.02 * bounce) * SPAN[voice.v]!, (4200 + bounce * 900) * p, 4000 * p, 1 - bounce * 0.3, ring)
      }
    },
    impact(hit, at) {
      if (!context || distanceTo(at) > 70) return
      const voice = begin(`impact-${hit}`, { at, send: 0.35, gain: 0.9, priority: 1 })
      if (!voice) return
      const t = now() + voice.delay, p = PITCH[voice.v]!, c = COLOR[voice.v]!, s = SPAN[voice.v]!
      if (hit === 'concrete') {
        burst(voice, t, 'bandpass', 1400 * c, 1.2, 0.9, 0.05 * s)
        burst(voice, t + 0.03 * s, 'highpass', 3500 * c, 0.7, 0.15, 0.03)
        burst(voice, t + 0.07 * s, 'highpass', 4200 * c, 0.7, 0.1, 0.03)
      } else if (hit === 'brick') {
        burst(voice, t, 'bandpass', 1000 * c, 1, 0.9, 0.06 * s)
        burst(voice, t + 0.01, 'lowpass', 600 * c, 0.7, 0.25, 0.18 * s, 0.01)
      } else if (hit === 'metal') {
        burst(voice, t, 'bandpass', 2400 * c, 3, 0.9, 0.04)
        tone(voice, t, 900 * p, 760 * p, 0.25, 0.25 * s, 'triangle')
        tone(voice, t, 2480 * p, 2470 * p, 0.1, 0.15 * s)
      } else if (hit === 'wood') {
        burst(voice, t, 'bandpass', 900 * c, 2, 0.9, 0.06 * s)
        tone(voice, t, 260 * p, 180 * p, 0.3, 0.07 * s, 'triangle')
        burst(voice, t + 0.005, 'highpass', 3000 * c, 0.7, 0.15, 0.04)
      } else if (hit === 'dirt') {
        burst(voice, t, 'lowpass', 500 * c, 0.7, 0.9, 0.08 * s)
        burst(voice, t + 0.01, 'highpass', 2000 * c, 0.7, 0.12, 0.05, 0.004)
      } else {
        burst(voice, t, 'lowpass', 320 * c, 0.8, 1, 0.07 * s)
        burst(voice, t, 'bandpass', 700 * c, 1.5, 0.4, 0.09 * s, 0.004)
        tone(voice, t, 90 * p, 50 * p, 0.5, 0.08 * s)
      }
    },
    hitMarker(kill, head) {
      const voice = begin(kill ? 'hitmarker-kill' : head ? 'hitmarker-head' : 'hitmarker')
      if (!voice) return
      const t = now(), p = PITCH[voice.v]!
      if (kill) {
        tone(voice, t, 1100 * p, 900 * p, 0.25, 0.06)
        tone(voice, t + 0.075, 1100 * p, 900 * p, 0.25, 0.06)
        tone(voice, t, 420 * p, 300 * p, 0.15, 0.12, 'triangle')
      } else {
        tone(voice, t, 1900 * p, 1700 * p, 0.18, 0.035)
        burst(voice, t, 'bandpass', 3200 * p, 2, 0.12, 0.015)
      }
      if (head) {
        tone(voice, t + 0.01, 3100 * p, 3050 * p, 0.18, 0.16)
        tone(voice, t + 0.01, 4650 * p, 4600 * p, 0.06, 0.1)
      }
    },
    enemyShot(at, occluded) {
      if (!context || distanceTo(at) > 160) return
      const voice = begin('enemy-shot', { at, send: occluded ? 0.8 : 0.65, gain: occluded ? 0.4 * 1.4 : 1.4, ...(occluded ? { cutoff: 650 } : {}) })
      if (!voice) return
      const t = now() + voice.delay, p = PITCH[voice.v]!, c = COLOR[voice.v]!, s = SPAN[voice.v]!
      const far = Math.min(0.6, voice.distance / 40)
      burst(voice, t, 'highpass', 2600 * c, 0.7, 1.2 * (1 - far * 0.8), 0.04 * s)
      burst(voice, t, 'lowpass', 1000 * c, 0.8, 1.4, 0.2 * s)
      tone(voice, t, 120 * p, 40, 0.9, 0.14 * s)
      burst(voice, t + 0.004, 'bandpass', 380 * p, 1, 0.6 + far, (0.35 + far * 0.4) * s, 0.006)
    },
    crack(at, near) {
      if (near > 2.5) return
      const voice = begin('crack', { at, send: 0.1, gain: 0.3 + 0.9 * (1 - near / 2.5) })
      if (!voice) return
      const t = now(), p = PITCH[voice.v]!, c = COLOR[voice.v]!
      burst(voice, t, 'highpass', 4500 * c, 0.9, 1, 0.006, 0.0005)
      tone(voice, t, 2600 * p, 1800 * p, 0.3, 0.012, 'square', 0.0005)
      burst(voice, t + 0.004, 'bandpass', 1600 * c, 0.9, 0.25, 0.05 * SPAN[voice.v]!, 0.008)
    },
    hurt(amount) {
      const voice = begin('hurt', { send: 0.05 })
      if (!voice) return
      const t = now(), p = PITCH[voice.v]!, c = COLOR[voice.v]!, level = clamp(amount / 25, 0.3, 1)
      tone(voice, t, 75 * p, 38 * p, level, 0.18)
      burst(voice, t, 'lowpass', 220 * c, 0.8, level * 0.8, 0.12)
      burst(voice, t + 0.05, 'bandpass', 750 * c, 1.2, level * 0.18, 0.35 * SPAN[voice.v]!, 0.06)
    },
    footstep(footing, loud) {
      const voice = begin(`step-${footing}`, { gain: 0.1 + 0.4 * clamp(loud, 0, 1), send: 0.15, priority: 1 })
      if (!voice) return
      step(voice, footing, now())
    },
    enemyStep(footing, at) {
      if (!context) return
      const distance = distanceTo(at)
      if (distance > AI.hearingRange) return
      const voice = begin(`enemy-step-${footing}`, { at, gain: 0.7, send: 0.12, priority: distance > 12 ? 0 : 1 })
      if (!voice) return
      step(voice, footing, now() + voice.delay)
    },
    bark(text, at, index) {
      const body = clamp(text.length * 0.055, 0.35, 4)
      const total = 0.07 + body + 0.16
      const voice = begin('bark', { at, send: 0.25, gain: 1.6 })
      if (!voice) return total
      const audio = context!, t = now(), p = PITCH[voice.v]!
      burst(voice, t, 'highpass', 1800, 0.7, 0.35, 0.03)
      tone(voice, t, 1500 * p, 1480 * p, 0.08, 0.025, 'square')
      const open = t + 0.07, close = open + body
      const base = BARK_PITCH[Math.abs(Math.floor(index)) % BARK_PITCH.length]! * (1 + (p - 1) * 0.3)
      const oscillator = audio.createOscillator()
      oscillator.type = 'sawtooth'
      oscillator.frequency.value = base
      const syllable = audio.createGain()
      syllable.gain.setValueAtTime(0.0001, t)
      const first = audio.createBiquadFilter()
      first.type = 'bandpass'
      first.Q.value = 6
      const second = audio.createBiquadFilter()
      second.type = 'bandpass'
      second.Q.value = 8
      const secondLevel = audio.createGain()
      secondLevel.gain.value = 0.6
      const high = audio.createBiquadFilter()
      high.type = 'highpass'
      high.frequency.value = 420
      const low = audio.createBiquadFilter()
      low.type = 'lowpass'
      low.frequency.value = 2900
      oscillator.connect(syllable)
      syllable.connect(first).connect(high)
      syllable.connect(second).connect(secondLevel).connect(high)
      high.connect(low).connect(voice.bus)
      const hiss = audio.createBufferSource()
      hiss.buffer = noises[voice.v % noises.length]!
      hiss.loop = true
      const hissLevel = audio.createGain()
      hissLevel.gain.setValueAtTime(0.0001, t)
      hissLevel.gain.linearRampToValueAtTime(0.05, open)
      hissLevel.gain.setValueAtTime(0.05, close)
      hissLevel.gain.linearRampToValueAtTime(0.0001, close + 0.02)
      hiss.connect(hissLevel).connect(high)
      const count = Math.max(2, Math.round(body / 0.13))
      const span = body / count
      for (let beat = 0; beat < count; beat++) {
        const at0 = open + beat * span
        const [f1, f2] = FORMANTS[Math.floor(Math.random() * FORMANTS.length)]!
        first.frequency.setTargetAtTime(f1, at0, 0.02)
        second.frequency.setTargetAtTime(f2, at0, 0.02)
        oscillator.frequency.setTargetAtTime(base * (1.12 - 0.18 * beat / count) * (0.95 + Math.random() * 0.1), at0, 0.03)
        if (Math.random() < 0.15 && beat > 0 && beat < count - 1) continue
        syllable.gain.setValueAtTime(0.0001, at0)
        syllable.gain.linearRampToValueAtTime(0.55, at0 + span * 0.25)
        syllable.gain.linearRampToValueAtTime(0.15, at0 + span * 0.7)
        syllable.gain.linearRampToValueAtTime(0.0001, at0 + span * 0.95)
        if (beat % 2 === 0) burst(voice, at0, 'highpass', 3000, 0.7, 0.1, 0.03)
      }
      const stop = close + 0.03
      oscillator.start(t)
      oscillator.stop(stop)
      hiss.start(t, Math.random() * 0.5)
      hiss.stop(stop)
      track(voice, oscillator, stop, [oscillator, syllable, first, second, secondLevel, high, low])
      track(voice, hiss, stop, [hiss, hissLevel])
      burst(voice, close + 0.01, 'bandpass', 2400, 0.8, 0.4, 0.12, 0.003)
      tone(voice, close + 0.01, 1200 * p, 1100 * p, 0.06, 0.02, 'square')
      return total
    },
    sting(kind) {
      const voice = begin(`sting-${kind}`, { send: 0.45, gain: 0.5 })
      if (!voice) return
      const t = now(), m = TRANSPOSE[voice.v]!
      if (kind === 'clear') {
        pad(voice, t, 164.8 * m, 0.3, 0.02, 0.3, 0.4)
        pad(voice, t, 82.4 * m, 0.25, 0.02, 0.3, 0.4)
        pad(voice, t + 0.42, 110 * m, 0.35, 0.03, 0.7, 1.4)
        pad(voice, t + 0.42, 55 * m, 0.3, 0.03, 0.7, 1.4, 'triangle')
        pad(voice, t + 0.42, 277.2 * m, 0.1, 0.08, 0.6, 1.2, 'triangle', 1400)
      } else if (kind === 'exfil') {
        const notes = [110, 164.8, 220, 277.2, 329.6]
        notes.forEach((note, beat) => pad(voice, t + beat * 0.12, note * m, 0.22, 0.02, beat === notes.length - 1 ? 0.9 : 0.12, beat === notes.length - 1 ? 1.6 : 0.3, 'sawtooth', 1200 + beat * 300))
        pad(voice, t, 55 * m, 0.25, 0.4, 0.6, 1.6, 'triangle')
        burst(voice, t, 'lowpass', 1200, 0.7, 0.2, 0.4, 0.6)
      } else {
        tone(voice, t, 55 * m, 36 * m, 0.9, 1.8)
        pad(voice, t, 55 * m, 0.35, 0.01, 0.4, 2.2, 'sawtooth', 300)
        pad(voice, t, 58.3 * m, 0.25, 0.01, 0.4, 2.2, 'sawtooth', 300)
        burst(voice, t, 'lowpass', 180, 0.8, 0.9, 0.4)
      }
    },
    update(dt) {
      if (!context) return
      const clock = performance.now()
      for (const voice of voices) if (clock > voice.deadline) finish(voice)
      for (const id of ROOM_IDS) {
        const send = sends[id]
        if (!send.linked || id === room) continue
        send.idle += dt
        if (send.idle > 0.6) { wetBus.disconnect(send.input); send.linked = false }
      }
      if (bedFade > 0) bedFade -= dt
      for (const spot of spots) {
        const at = place(spot.at)
        const through = spot.room === room ? 1 : 0.2
        const flicker = spot.flutter ? 1 - spot.flutter * 0.6 * Math.random() : 1
        spot.gain.gain.setTargetAtTime(spot.level * at.gain * through * flicker, now(), 0.05)
        spot.panner.pan.setTargetAtTime(at.pan, now(), 0.05)
      }
      if (!outdoor(room)) {
        creakIn -= dt
        if (creakIn <= 0) { creakIn = 9 + Math.random() * 14; creak() }
      }
    },
    setMuted(next) {
      muted = next
      if (context) master.gain.setTargetAtTime(muted ? 0 : MASTER, now(), 0.03)
    },
  }
}
