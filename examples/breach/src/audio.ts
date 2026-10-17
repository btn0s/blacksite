import { createAudioLog, type AudioSample } from '@blacksite/check'
import { STARTER_CUES, createSoundscape, type AudioLogLike, type CueDefinition, type SoundLayer, type Soundscape, type Surface, type Vec3, type VoiceHandle } from '@blacksite/soundscape'
import { clearLine } from './geometry'
import { PRACTICALS, type Footing, type Hit } from './layout'
import { ACOUSTICS, AI, BUDGET, PHONE_TAIL_SCALE, WEAPONS, sabine, type RoomId } from './model'

export type Listener = { x: number; y: number; z: number; yaw: number }

type Point = { x: number; y: number; z: number }
type Weapon = 'rifle' | 'pistol'

export type BreachAudio = {
  prepare(): Promise<void>
  start(): void
  sample(): AudioSample
  setListener(listener: Listener, room: RoomId): void
  shot(weapon: Weapon): void
  dry(): void
  reload(weapon: Weapon, empty: boolean): void
  equip(): void
  casing(at: Point, footing: Footing): void
  impact(hit: Hit, at: Point): void
  hitMarker(kill: boolean, head: boolean): void
  enemyShot(at: Point, occluded: boolean): void
  crack(at: Point, near: number): void
  hurt(amount: number): void
  footstep(footing: Footing, loud: number, landing?: boolean): void
  enemyStep(footing: Footing, at: Point): void
  bark(text: string, at: Point, voice: number): number
  sting(kind: 'clear' | 'exfil' | 'death'): void
  update(dt: number): void
  setMuted(muted: boolean): void
  dispose(): void
}

type Build = (p: number, c: number, s: number, v: number) => SoundLayer[]

const ROOM_IDS = Object.keys(ACOUSTICS) as RoomId[]
const PITCH = [1, 0.94, 1.07, 0.89]
const COLOR = [1, 1.15, 0.86, 1.07]
const SPAN = [1, 1.1, 0.92, 1.17]
const TRANSPOSE = [1, 2 ** (-1 / 12), 2 ** (2 / 12), 2 ** (-2 / 12)]
const BARK_PITCH = [118, 96, 142, 108, 130, 88]
const BARK_CONTOUR = [1.08, 0.97]
const FORMANTS: Array<[number, number]> = [[730, 1090], [530, 1840], [270, 2290], [570, 840], [300, 870], [640, 1190], [440, 1020]]
const SYLLABLE = 0.13
const HOLD = 40
const SLAP = 0.28
const MASTER = 0.7
const SURFACE: Record<Footing, Surface> = { concrete: 'concrete', rubble: 'dirt', metal: 'metal', wood: 'wood', dirt: 'dirt', water: 'water' }
const IMPACT: Record<Hit, string> = { concrete: 'impact.concrete', brick: 'impact.concrete', metal: 'impact.metal', wood: 'impact.wood', dirt: 'impact.dirt', flesh: 'impact.flesh' }
const CASING: Record<Footing, string> = { concrete: 'foley.casing', rubble: 'foley.casing', metal: 'casing.metal', wood: 'casing.wood', dirt: 'casing.dirt', water: 'casing.water' }
const SPOT = { tube: 'spot.hum', fire: 'spot.fire', emergency: 'spot.radio' } as const
const RADIO: Vec3 = [-5.2, 1.1, -23.4]
const WARM = ['weapon.rifle', 'impact.concrete', 'ambience.metal-creak', 'bark.0.3']
const RECORDINGS = { rifle: 'gunfire-ak47', pistol: 'gunfire-pistol-9mm', concrete: 'step-boots-concrete', metal: 'step-metal-ladder', wood: 'step-wood-oga', rubble: 'step-gravel-oga', water: 'step-water-oga' } as const
const RECORDING_URLS = import.meta.glob<string>('../public/assets/library/*/*.{ogg,m4a}', { eager: true, query: '?url', import: 'default' })
type Recordings = Record<keyof typeof RECORDINGS, AudioBuffer[]>
const outdoor = (room: RoomId) => !ACOUSTICS[room].volume
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const wetFor = (room: RoomId) => outdoor(room) ? 0.12 : 0.22 + 0.22 * Math.min(3, sabine(ACOUSTICS[room]))
const tuple = (at: Point): Vec3 => [at.x, at.y, at.z]

const burst = (offset: number, type: BiquadFilterType, frequency: number, q: number, gain: number, decay: number, attack = 0.0015, send = 1): SoundLayer =>
  ({ kind: 'noise', offset, gain, attack, duration: attack + decay, send, filter: { type, frequency, q } })
const tone = (offset: number, frequency: number, endFrequency: number, gain: number, decay: number, waveform: OscillatorType = 'sine', attack = 0.002): SoundLayer =>
  ({ kind: 'tone', offset, frequency, endFrequency, gain, attack, duration: attack + decay, waveform, send: 1 })
const pad = (offset: number, frequency: number, gain: number, attack: number, hold: number, release: number, waveform: OscillatorType = 'sawtooth', cutoff = 900): SoundLayer =>
  ({ kind: 'tone', offset, frequency, gain, attack, duration: attack + hold + release, waveform, send: 1, filter: { type: 'lowpass', frequency: cutoff, q: 0.7 } })
const click = (offset: number, frequency: number, gain: number) => burst(offset, 'bandpass', frequency, 3, gain, 0.025)
const held = (buffer: AudioBuffer, offset: number, gain: number): SoundLayer => ({ kind: 'buffer', buffer, offset, gain, attack: 0.001, duration: buffer.duration * HOLD, send: 1 })

const cue = (base: Omit<CueDefinition, 'variants'>, build: Build): CueDefinition =>
  ({ ...base, variants: PITCH.map((p, v) => ({ id: String(v + 1), layers: build(p, COLOR[v]!, SPAN[v]!, v) })) })

function shifted(layer: SoundLayer, shift: number): SoundLayer {
  const filter = layer.filter && { ...layer.filter, frequency: layer.filter.frequency * shift }
  if (layer.kind === 'tone') return { ...layer, filter, frequency: layer.frequency * shift, endFrequency: layer.endFrequency && layer.endFrequency * shift }
  return { ...layer, filter }
}

function widen(definition: CueDefinition): CueDefinition {
  const count = definition.variants.length
  return { ...definition, variants: Array.from({ length: Math.max(PITCH.length, count) }, (_, index) => ({ id: String(index + 1), layers: definition.variants[index % count]!.layers.map(layer => shifted(layer, index < count ? 1 : COLOR[index % COLOR.length]!)) })) }
}

function normalization(buffer: AudioBuffer) {
  let power = 0
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) for (const sample of buffer.getChannelData(channel)) power += sample * sample
  return 0.00125 / Math.max(0.000125, Math.sqrt(power / (buffer.numberOfChannels * buffer.length))) * 44100 / buffer.sampleRate
}

function impulse(audio: BaseAudioContext, room: RoomId, tailScale: number) {
  const acoustics = ACOUSTICS[room]
  const tail = Math.min(3.2, sabine(acoustics)) * tailScale
  const rate = audio.sampleRate
  const pre = Math.round(acoustics.predelay * rate)
  const slap = Math.round(SLAP * rate)
  const ring = Math.round(0.05 * rate)
  const length = Math.max(pre + Math.round(tail * rate), outdoor(room) ? slap + ring : 0)
  const buffer = audio.createBuffer(2, length, rate)
  const k = 6.91 / tail
  const size = Math.cbrt(acoustics.volume || 1)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    let smooth = 0
    let envelope = 1
    const fall = Math.exp(-k / rate)
    for (let index = pre; index < Math.min(length, pre + Math.round(tail * rate)); index++, envelope *= fall) {
      const t = (index - pre) / rate
      const damp = 0.85 * (t / tail)
      smooth += (Math.random() * 2 - 1 - smooth) * (1 - damp)
      data[index] = smooth * envelope * (t < 0.004 ? t / 0.004 : 1)
    }
    if (acoustics.volume) for (let tap = 1; tap <= 6; tap++) {
      const at = pre + Math.round(tap * size * 0.0029 * (1 + channel * 0.13 + Math.random() * 0.3) * rate)
      if (at < length) data[at]! += (Math.random() < 0.5 ? -1 : 1) * 0.9 / tap
    }
  }
  const scale = normalization(buffer)
  const a = 1 - Math.exp(-2 * Math.PI * 2200 / rate)
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    for (let index = 0; index < length; index++) data[index] = data[index]! * scale
    if (!outdoor(room)) continue
    let echo = 0.9 * a
    for (let index = 0; index < ring; index++, echo *= 1 - a) data[slap + index]! += echo
  }
  return { buffer, wet: wetFor(room) / normalization(buffer) }
}

function brown(audio: BaseAudioContext, seconds = 3, gust = false) {
  const buffer = audio.createBuffer(1, audio.sampleRate * seconds, audio.sampleRate)
  const data = buffer.getChannelData(0)
  let walk = 0
  let swell = 1
  for (let index = 0; index < data.length; index++) {
    walk = (walk + 0.02 * (Math.random() * 2 - 1)) / 1.02
    if (gust && (index & 255) === 0) {
      const t = index / audio.sampleRate
      swell = 0.7 + 0.16 * Math.sin(t * 0.11 * Math.PI * 2) + 0.14 * Math.sin(t * 0.173 * Math.PI * 2 + 0.7)
    }
    data[index] = walk * 3.5 * swell
  }
  const fade = Math.round(audio.sampleRate * 0.05)
  for (let index = 0; index < fade; index++) data[data.length - fade + index] = data[data.length - fade + index]! * (1 - index / fade) + data[index]! * (index / fade)
  return buffer
}

function biquad(type: 'bandpass' | 'highpass' | 'lowpass', frequency: number, q: number, rate: number) {
  const w = 2 * Math.PI * frequency / rate, alpha = Math.sin(w) / (2 * q), cos = Math.cos(w)
  const [b0, b1, b2] = type === 'bandpass' ? [alpha, 0, -alpha] : type === 'highpass' ? [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2] : [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]
  const a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0
  return (x: number) => {
    const y = (b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
    x2 = x1; x1 = x; y2 = y1; y1 = y
    return y
  }
}

function syllable(audio: BaseAudioContext, pitch: number, [f1, f2]: [number, number]) {
  const rate = audio.sampleRate
  const buffer = audio.createBuffer(1, Math.round(SYLLABLE * rate), rate)
  const data = buffer.getChannelData(0)
  const first = biquad('bandpass', f1, 6, rate), second = biquad('bandpass', f2, 8, rate), high = biquad('highpass', 420, 0.707, rate), low = biquad('lowpass', 2900, 0.707, rate)
  let phase = 0
  for (let index = 0; index < data.length; index++) {
    const t = index / data.length
    const envelope = t < 0.25 ? 0.55 * t / 0.25 : t < 0.7 ? 0.55 - 0.4 * (t - 0.25) / 0.45 : t < 0.95 ? 0.15 * (0.95 - t) / 0.25 : 0
    phase = (phase + pitch / rate) % 1
    const source = (phase * 2 - 1) * envelope
    data[index] = low(high(first(source) + 0.6 * second(source) + 0.05 * (Math.random() * 2 - 1)))
  }
  return buffer
}

const rubbleStep: Build = (_, c, s) => [
  burst(0, 'lowpass', 260 * c, 0.8, 0.7, 0.06 * s, 0.003),
  ...[0, 1, 2, 3].map(grain => burst(grain * (0.012 + 0.01 * grain) * s, 'bandpass', (2200 + grain * 600) * c, 1.6, 0.35 - grain * 0.06, 0.02)),
  burst(0.02, 'lowpass', 900 * c, 0.6, 0.25, 0.09 * s, 0.006),
]

function enemyShot(far: number, occluded: boolean): CueDefinition {
  return cue({ class: 'weapons', bus: 'weapons', gain: 1.2, reverbSend: occluded ? 0.8 : 0.65, delayByDistance: true, attenuation: { near: 3, far: 160, rolloff: 1 } }, (p, c, s) => [
    ...(occluded ? [] : [burst(0, 'highpass', 2600 * c, 0.7, 1.2 * (1 - far * 0.8), 0.04 * s)]),
    burst(0, 'lowpass', (occluded ? 650 : 1000) * c, 0.8, 1.4, 0.2 * s),
    tone(0, 120 * p, 40, 0.9, 0.14 * s),
    burst(0.004, 'bandpass', 380 * p, 1, 0.6 + far, (0.35 + far * 0.4) * s, 0.006),
  ])
}

function reloadCue(weapon: Weapon, seconds: number): CueDefinition {
  return cue({ class: 'weapons', bus: 'weapons', reverbSend: 0.08 }, (_, c) => [
    burst(0, 'bandpass', 1200 * c, 0.8, 0.12, 0.18, 0.01),
    click(seconds * 0.22, 1800 * c, 0.45),
    burst(seconds * 0.24, 'bandpass', 900 * c, 1.2, 0.18, 0.1),
    click(seconds * 0.58, 1500 * c, 0.6),
    click(seconds * 0.6, 2400 * c, 0.35),
    ...(weapon === 'rifle' ? [click(seconds * 0.8, 1300 * c, 0.55), click(seconds * 0.86, 2100 * c, 0.5)] : [click(seconds * 0.82, 2000 * c, 0.55)]),
  ])
}

function shotCue(weapon: Weapon): CueDefinition {
  const rifle = weapon === 'rifle'
  const starter = STARTER_CUES[`weapon.${weapon}`]!
  return { ...starter, variants: starter.variants.map((variant, v) => ({ ...variant, layers: [...variant.layers, burst(0.003, 'bandpass', (rifle ? 420 : 560) * PITCH[v % 4]!, 1.1, rifle ? 0.6 : 0.45, (rifle ? 0.36 : 0.24) * SPAN[v % 4]!, 0.004, 0.9)] })) }
}

function stingCue(kind: 'clear' | 'exfil' | 'death'): CueDefinition {
  return cue({ class: 'ui', bus: 'music', gain: 0.5, reverbSend: 0, pitchJitter: 0 }, (_, __, ___, v) => {
    const m = TRANSPOSE[v]!
    if (kind === 'clear') return [
      pad(0, 164.8 * m, 0.3, 0.02, 0.3, 0.4), pad(0, 82.4 * m, 0.25, 0.02, 0.3, 0.4),
      pad(0.42, 110 * m, 0.35, 0.03, 0.7, 1.4), pad(0.42, 55 * m, 0.3, 0.03, 0.7, 1.4, 'triangle'), pad(0.42, 277.2 * m, 0.1, 0.08, 0.6, 1.2, 'triangle', 1400),
    ]
    if (kind === 'exfil') {
      const notes = [110, 164.8, 220, 277.2, 329.6]
      return [
        ...notes.map((note, beat) => pad(beat * 0.12, note * m, 0.22, 0.02, beat === notes.length - 1 ? 0.9 : 0.12, beat === notes.length - 1 ? 1.6 : 0.3, 'sawtooth', 1200 + beat * 300)),
        pad(0, 55 * m, 0.25, 0.4, 0.6, 1.6, 'triangle'), burst(0, 'lowpass', 1200, 0.7, 0.2, 0.4, 0.6),
      ]
    }
    return [tone(0, 55 * m, 36 * m, 0.9, 1.8), pad(0, 55 * m, 0.35, 0.01, 0.4, 2.2, 'sawtooth', 300), pad(0, 58.3 * m, 0.25, 0.01, 0.4, 2.2, 'sawtooth', 300), burst(0, 'lowpass', 180, 0.8, 0.9, 0.4)]
  })
}

function cues(audio: BaseAudioContext): Record<string, CueDefinition> {
  const rumble = brown(audio)
  const wind = brown(audio, 18, true)
  const loop = (type: BiquadFilterType, frequency: number, q: number, gain: number): SoundLayer => ({ kind: 'noise', loop: true, gain, attack: 0.2, filter: { type, frequency, q } })
  const bed = (buffer: AudioBuffer, type: BiquadFilterType, frequency: number, q: number, gain: number): SoundLayer => ({ kind: 'buffer', buffer, loop: true, gain, attack: 0.2, filter: { type, frequency, q } })
  const hum = (frequency: number, waveform: OscillatorType, gain: number): SoundLayer => ({ kind: 'tone', frequency, waveform, gain, attack: 0.2, duration: 1 })
  const marker = (head: boolean): Build => p => [
    tone(0, 1900 * p, 1700 * p, 0.18, 0.035), burst(0, 'bandpass', 3200 * p, 2, 0.12, 0.015),
    ...(head ? [tone(0.01, 3100 * p, 3050 * p, 0.18, 0.16), tone(0.01, 4650 * p, 4600 * p, 0.06, 0.1)] : []),
  ]
  const casing = { class: 'foley', bus: 'sfx', gain: 0.22, reverbSend: 0.05 } as const
  const ambience = { class: 'ambience', bus: 'ambience', loop: true, reverbSend: 0 } as const
  const spot = { ...ambience, attenuation: { near: 3, far: 30, rolloff: 1 } }
  const rubble = cue({ class: 'foley', bus: 'sfx', gain: 0.48, reverbSend: 0.15 }, rubbleStep)
  const result: Record<string, CueDefinition> = {
    'weapon.rifle': shotCue('rifle'),
    'weapon.pistol': shotCue('pistol'),
    'weapon.dry': widen(STARTER_CUES['weapon.dry']!),
    'weapon.equip': widen(STARTER_CUES['weapon.equip']!),
    'weapon.reload.rifle': reloadCue('rifle', WEAPONS.rifle.reloadSeconds),
    'weapon.reload.pistol': reloadCue('pistol', WEAPONS.pistol.reloadSeconds),
    'weapon.reload.rifle.empty': reloadCue('rifle', WEAPONS.rifle.emptyReloadSeconds),
    'weapon.reload.pistol.empty': reloadCue('pistol', WEAPONS.pistol.emptyReloadSeconds),
    'impact.flesh': cue({ class: 'sfx', bus: 'sfx', gain: 0.9, reverbSend: 0.35, delayByDistance: true, attenuation: { near: 4, far: 85, rolloff: 0.9 } }, (p, c, s) => [
      burst(0, 'lowpass', 320 * c, 0.8, 1, 0.07 * s), burst(0, 'bandpass', 700 * c, 1.5, 0.4, 0.09 * s, 0.004), tone(0, 90 * p, 50 * p, 0.5, 0.08 * s),
    ]),
    'casing.metal': cue(casing, (p, _, s) => [0, 1, 2].map(bounce => tone(bounce * (0.05 + 0.02 * bounce) * s, (4200 + bounce * 900) * p, 4000 * p, 1 - bounce * 0.3, 0.14))),
    'casing.wood': cue(casing, p => [burst(0, 'bandpass', 1800 * p, 2, 0.6, 0.03), ...[0, 1].map(bounce => tone(bounce * 0.07, 2400 * p, 2300 * p, 0.6 - bounce * 0.25, 0.035))]),
    'casing.dirt': cue(casing, p => [burst(0, 'bandpass', 1200 * p, 1.5, 0.6, 0.03), tone(0, 3200 * p, 3000 * p, 0.3, 0.03)]),
    'casing.water': cue(casing, p => [tone(0, 1400 * p, 600 * p, 0.6, 0.05), burst(0, 'highpass', 3000, 0.7, 0.3, 0.08, 0.01)]),
    'marker.hit': cue({ class: 'ui', bus: 'ui', reverbSend: 0 }, marker(false)),
    'marker.head': cue({ class: 'ui', bus: 'ui', reverbSend: 0 }, marker(true)),
    'marker.kill': cue({ class: 'ui', bus: 'ui', reverbSend: 0 }, p => [tone(0, 1100 * p, 900 * p, 0.25, 0.06), tone(0.075, 1100 * p, 900 * p, 0.25, 0.06), tone(0, 420 * p, 300 * p, 0.15, 0.12, 'triangle')]),
    'bullet.crack': cue({ class: 'weapons', bus: 'weapons', reverbSend: 0.1 }, (p, c, s) => [
      burst(0, 'highpass', 4500 * c, 0.9, 1, 0.006, 0.0005), tone(0, 2600 * p, 1800 * p, 0.3, 0.012, 'square', 0.0005), burst(0.004, 'bandpass', 1600 * c, 0.9, 0.25, 0.05 * s, 0.008),
    ]),
    'enemy.shot': enemyShot(0.25, false),
    'enemy.shot.far': enemyShot(0.6, false),
    'enemy.shot.occluded': enemyShot(0.45, true),
    'player.hurt': cue({ class: 'ui', bus: 'sfx', reverbSend: 0.05 }, (p, c, s) => [
      tone(0, 75 * p, 38 * p, 1, 0.18), burst(0, 'lowpass', 220 * c, 0.8, 0.8, 0.12), burst(0.05, 'bandpass', 750 * c, 1.2, 0.18, 0.35 * s, 0.06),
    ]),
    'footstep.rubble': rubble,
    'enemy.step.rubble': { ...rubble, gain: 0.7, delayByDistance: true, attenuation: { near: 3, far: AI.hearingRange, rolloff: 1 } },
    'sting.clear': stingCue('clear'),
    'sting.exfil': stingCue('exfil'),
    'sting.death': stingCue('death'),
    'breach.wind': cue({ ...ambience, gain: 0.22 }, (_, c) => [bed(wind, 'bandpass', 420 * c, 0.6, 0.7)]),
    'breach.room': cue({ ...ambience, gain: 0.3 }, (_, c) => [bed(rumble, 'lowpass', 160 * c, 0.7, 1)]),
    'spot.hum': cue({ ...spot, gain: 0.05, pitchJitter: 0 }, (_, c) => [hum(100, 'sawtooth', 0.5), hum(200, 'square', 0.12), loop('bandpass', 4200 * c, 6, 1)]),
    'spot.fire': cue({ ...spot, gain: 0.16 }, (_, c) => [loop('bandpass', 1500 * c, 0.7, 1), bed(rumble, 'lowpass', 240 * c, 0.7, 1)]),
    'spot.radio': cue({ ...spot, gain: 0.06 }, (_, c) => [loop('bandpass', 1900 * c, 3, 1), hum(330, 'square', 0.08)]),
  }
  for (const surface of ['concrete', 'metal', 'wood', 'dirt', 'water'] as const) result[`enemy.step.${surface}`] = { ...STARTER_CUES[`footstep.${surface}`]!, gain: 0.7, delayByDistance: true, attenuation: { near: 3, far: AI.hearingRange, rolloff: 1 } }
  return result
}

async function recordings(audio: AudioContext, signal: AbortSignal): Promise<Recordings> {
  const decode = async (path: string) => {
    for (const extension of ['ogg', 'm4a']) {
      const url = RECORDING_URLS[`${path}.${extension}`]
      if (!url) throw new Error(`Missing Breach recording: ${path}.${extension}`)
      try {
        const response = await fetch(url, { signal })
        if (!response.ok) throw new Error(`Breach recording returned ${response.status}: ${url}`)
        return await audio.decodeAudioData(await response.arrayBuffer())
      } catch (error) {
        if (signal.aborted || extension === 'm4a') throw error
      }
    }
    throw new Error(`Could not decode Breach recording: ${path}`)
  }
  const entries = await Promise.all(Object.entries(RECORDINGS).map(async ([name, id]) => {
    const prefix = `../public/assets/library/${id}/`
    const paths = Object.keys(RECORDING_URLS).filter(path => path.startsWith(prefix) && path.endsWith('.ogg')).sort()
    const buffers = await Promise.all(paths.map(path => decode(path.slice(0, -4))))
    if (buffers.length < 3) throw new Error(`Breach ${name} needs at least three recorded takes`)
    if (name === 'rifle' || name === 'pistol') for (let take = 0; take < buffers.length; take++) {
      const source = buffers[take]!
      const onset = source.getChannelData(0).findIndex(sample => Math.abs(sample) > 0.01)
      const start = Math.max(0, onset - Math.round(audio.sampleRate * 0.001))
      const length = Math.min(source.length - start, Math.round(audio.sampleRate * (name === 'rifle' ? 0.55 : 0.45)))
      const buffer = audio.createBuffer(source.numberOfChannels, length, audio.sampleRate)
      const fade = Math.round(audio.sampleRate * 0.05)
      for (let channel = 0; channel < source.numberOfChannels; channel++) {
        const data = buffer.getChannelData(channel)
        data.set(source.getChannelData(channel).subarray(start, start + length))
        for (let index = Math.max(0, length - fade); index < length; index++) data[index]! *= (length - index) / fade
      }
      buffers[take] = buffer
    }
    return [name, buffers] as const
  }))
  return Object.fromEntries(entries) as Recordings
}

function registerRecordings(sound: Soundscape, buffers: Recordings) {
  const variants = (takes: AudioBuffer[], filter?: SoundLayer['filter']) => takes.map((buffer, index) => ({ id: `recorded-${index + 1}`, layers: [{ ...held(buffer, 0, 1), filter }] }))
  for (const weapon of ['rifle', 'pistol'] as const) sound.registerCue(`weapon.${weapon}`, { ...shotCue(weapon), gain: 1.2, reverbSend: 0.6, variants: variants(buffers[weapon]) })
  for (const [name, cutoff, send] of [['enemy.shot', 9000, 0.65], ['enemy.shot.far', 2800, 0.75], ['enemy.shot.occluded', 1000, 0.8]] as const) {
    sound.registerCue(name, { class: 'weapons', bus: 'weapons', gain: 1.1, reverbSend: send, delayByDistance: true, attenuation: { near: 3, far: 160, rolloff: 1 }, variants: variants(buffers.rifle, { type: 'lowpass', frequency: cutoff, q: 0.7 }) })
  }
  for (const surface of ['concrete', 'metal', 'wood', 'rubble', 'water'] as const) {
    const definition: CueDefinition = { class: 'foley', bus: 'sfx', gain: 0.32, reverbSend: 0.15, variants: variants(buffers[surface]) }
    sound.registerCue(`footstep.${surface}`, definition)
    sound.registerCue(`enemy.step.${surface}`, { ...definition, gain: 0.46, delayByDistance: true, attenuation: { near: 3, far: AI.hearingRange, rolloff: 1 } })
  }
}

export function createBreachAudio(): BreachAudio {
  const shared = createAudioLog()
  let warming = false
  const log: AudioLogLike = {
    start(cue, sample) { if (!warming) shared.start(cue, sample) },
    end() { if (!warming) shared.end() },
    sample: () => shared.sample(),
  }
  const listener: Listener = { x: 0, y: 0, z: 0, yaw: 0 }
  const blocked = new WeakMap<Vec3, { frame: number; value: boolean }>()
  const registered = new Set<string>()
  let context: AudioContext | null = null
  let sound: Soundscape | null = null
  let preparing: Promise<void> | null = null
  let loading: AbortController | null = null
  let syllables: AudioBuffer[][][] = []
  let spots: Array<{ handle: VoiceHandle; flutter: number }> = []
  let room: RoomId = 'yard'
  let muted = false
  let frame = 0

  const occlusion = (from: Vec3, to: Vec3) => {
    const cached = blocked.get(to)
    if (cached && cached.frame === frame) return cached.value
    const value = !clearLine({ x: from[0], y: from[1], z: from[2] }, { x: to[0], y: to[1], z: to[2] })
    blocked.set(to, { frame, value })
    return value
  }

  const distanceTo = (at: Point) => Math.hypot(at.x - listener.x, at.y - listener.y, at.z - listener.z)

  const barkCue = (voice: number, count: number, body: number): CueDefinition => cue({ class: 'voice', bus: 'voice', gain: 1.6, reverbSend: 0.25 }, p => {
    const span = body / count
    const close = 0.07 + body
    const layers: SoundLayer[] = [burst(0, 'highpass', 1800, 0.7, 0.35, 0.03), tone(0, 1500 * p, 1480 * p, 0.08, 0.025, 'square')]
    for (let beat = 0; beat < count; beat++) {
      const at = 0.07 + beat * span
      if (Math.random() < 0.15 && beat > 0 && beat < count - 1) continue
      layers.push(held(syllables[voice]![Math.floor(Math.random() * FORMANTS.length)]![beat < count / 2 ? 0 : 1]!, at, 1))
      if (beat % 2 === 0) layers.push(burst(at, 'highpass', 3000, 0.7, 0.1, 0.03))
    }
    layers.push(burst(close + 0.01, 'bandpass', 2400, 0.8, 0.4, 0.12, 0.003), tone(close + 0.01, 1200 * p, 1100 * p, 0.06, 0.02, 'square'))
    return layers
  })

  const barkName = (voice: number, count: number, body: number) => {
    const name = `bark.${voice}.${count}`
    if (sound && !registered.has(name)) { sound.registerCue(name, barkCue(voice, count, body)); registered.add(name) }
    return name
  }

  const pose = () => sound?.setListener({ position: [listener.x, listener.y, listener.z], forward: [-Math.sin(listener.yaw), 0, -Math.cos(listener.yaw)] })

  const setup = () => {
    if (sound || typeof AudioContext === 'undefined') return
    const audio = new AudioContext({ latencyHint: 'interactive' })
    const phone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
    context = audio
    sound = createSoundscape({ context: audio, tier: phone ? 'phone' : 'desktop', voiceCap: phone ? undefined : BUDGET.voices, log, occlusion })
    syllables = BARK_PITCH.map(base => FORMANTS.map(formant => BARK_CONTOUR.map(contour => syllable(audio, base * contour, formant))))
    for (const [name, definition] of Object.entries(cues(audio))) sound.registerCue(name, definition)
    barkName(0, 3, 0.39)
    for (const id of ROOM_IDS) {
      const { buffer, wet } = impulse(audio, id, phone ? PHONE_TAIL_SCALE : 1)
      sound.registerZone({
        name: id, impulse: buffer, wet, crossfade: 0.8,
        beds: [outdoor(id) ? 'breach.wind' : 'breach.room'],
        oneShots: outdoor(id) ? [] : [{ cue: 'ambience.metal-creak', interval: [9, 23], radius: [6, 12] }],
      })
    }
    sound.setZone(room)
    sound.prepare()
    warming = true
    for (const id of ROOM_IDS) {
      sound.setZone(id)
      for (const name of WARM) sound.play(name, { loop: true, volume: 0 })?.stop(0)
    }
    sound.setZone(room)
    warming = false
    sound.setBusVolume('master', muted ? 0 : MASTER, 0)
    pose()
  }

  const prepare = () => {
    setup()
    if (preparing) return preparing
    if (!sound || !context) return Promise.resolve()
    const mixer = sound
    const controller = new AbortController()
    loading = controller
    preparing = recordings(context, controller.signal).then(buffers => {
      if (sound === mixer) registerRecordings(mixer, buffers)
    }).catch(error => {
      if (!controller.signal.aborted) throw error
    })
    return preparing
  }

  return {
    prepare,
    start() {
      setup()
      if (!sound) return
      void sound.start().catch(() => {})
      if (spots.length) return
      for (const practical of PRACTICALS) {
        if (practical.kind !== 'tube' && practical.kind !== 'fire' && practical.kind !== 'emergency') continue
        const handle = sound.play(SPOT[practical.kind], { position: practical.kind === 'emergency' ? RADIO : [...practical.at], loop: true })
        if (handle) spots.push({ handle, flutter: practical.kind === 'fire' ? 1 : practical.kind === 'emergency' ? 0.4 : 0 })
      }
    },
    sample: () => shared.sample(),
    setListener(next, id) {
      listener.x = next.x
      listener.y = next.y
      listener.z = next.z
      listener.yaw = next.yaw
      frame++
      if (id !== room) { room = id; sound?.setZone(id) }
      pose()
    },
    shot(weapon) { sound?.play(`weapon.${weapon}`) },
    dry() { sound?.play('weapon.dry') },
    reload(weapon, empty) { sound?.play(empty ? `weapon.reload.${weapon}.empty` : `weapon.reload.${weapon}`) },
    equip() { sound?.play('weapon.equip') },
    casing(at, footing) { sound?.play(CASING[footing], { position: tuple(at) }) },
    impact(hit, at) { sound?.play(IMPACT[hit], { position: tuple(at) }) },
    hitMarker(kill, head) { sound?.play(kill ? 'marker.kill' : head ? 'marker.head' : 'marker.hit') },
    enemyShot(at, occluded) { sound?.play(occluded ? 'enemy.shot.occluded' : distanceTo(at) > 18 ? 'enemy.shot.far' : 'enemy.shot', { position: tuple(at) }) },
    crack(at, near) {
      if (near > 2.5) return
      sound?.play('bullet.crack', { position: tuple(at), volume: 0.3 + 0.9 * (1 - near / 2.5) })
    },
    hurt(amount) { sound?.play('player.hurt', { volume: clamp(amount / 25, 0.3, 1) }) },
    footstep(footing, loud, landing = false) {
      const name = landing ? `landing.${SURFACE[footing]}` : footing === 'rubble' ? 'footstep.rubble' : `footstep.${SURFACE[footing]}`
      sound?.play(name, { volume: (0.1 + 0.4 * clamp(loud, 0, 1)) / 0.38 })
    },
    enemyStep(footing, at) { sound?.play(footing === 'rubble' ? 'enemy.step.rubble' : `enemy.step.${SURFACE[footing]}`, { position: tuple(at) }) },
    bark(text, at, index) {
      const body = clamp(text.length * 0.055, 0.35, 4)
      const count = Math.max(2, Math.round(body / SYLLABLE))
      if (sound) sound.play(barkName(Math.abs(Math.floor(index)) % BARK_PITCH.length, count, body), { position: tuple(at) })
      return 0.07 + body + 0.16
    },
    sting(kind) { sound?.play(`sting.${kind}`) },
    update(dt) {
      if (!sound) return
      sound.update(dt)
      for (const spot of spots) if (spot.flutter) spot.handle.setVolume(1 - spot.flutter * 0.6 * Math.random(), 0.05)
    },
    setMuted(next) {
      muted = next
      sound?.setBusVolume('master', muted ? 0 : MASTER, 0.03)
    },
    dispose() {
      loading?.abort()
      sound?.dispose()
      void context?.close().catch(() => {})
      sound = null
      context = null
      spots = []
      syllables = []
      preparing = null
      loading = null
      registered.clear()
      shared.sample()
    },
  }
}
