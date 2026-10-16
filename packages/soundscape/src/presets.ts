import type { CueDefinition, CueVariant, SoundLayer, SoundZone, Surface } from './types'

const burst = (frequency: number, gain: number, duration: number, type: BiquadFilterType = 'bandpass', offset = 0, send = 0.25, q = 0.9): SoundLayer => ({
  kind: 'noise', gain, duration, offset, send, filter: { type, frequency, q },
})

const tone = (frequency: number, endFrequency: number, gain: number, duration: number, offset = 0, send = 0.2, waveform: OscillatorType = 'sine'): SoundLayer => ({
  kind: 'tone', frequency, endFrequency, gain, duration, offset, send, waveform,
})

function variants(count: number, build: (index: number) => readonly SoundLayer[]): CueVariant[] {
  return Array.from({ length: count }, (_, index) => ({ id: String(index + 1), layers: build(index) }))
}

function shot(rifle: boolean): CueDefinition {
  return {
    class: 'weapons', bus: 'weapons', selection: 'round-robin', cooldown: rifle ? 0.085 : 0.1,
    gain: rifle ? 0.86 : 0.82, reverbSend: 0.8,
    variants: variants(4, index => {
      const variation = [0.94, 1.02, 0.98, 1.06][index]
      return [
        burst((rifle ? 2400 : 3000) * variation, rifle ? 1.4 : 1.1, 0.056, 'highpass', 0, 0.5, 0.7),
        burst((rifle ? 1100 : 1700) * variation, rifle ? 1.6 : 1.2, rifle ? 0.23 : 0.16, 'lowpass', 0, 0.9, 0.8),
        tone((rifle ? 130 : 180) * variation, 42, rifle ? 1.1 : 0.8, rifle ? 0.17 : 0.12, 0, 0.4),
        burst((rifle ? 3400 : 4200) * variation, 0.25, 0.026, 'bandpass', 0.012, 0.1, 3),
      ]
    }),
  }
}

function reload(rifle: boolean): CueDefinition {
  const seconds = rifle ? 2.1 : 1.35
  return {
    class: 'weapons', bus: 'weapons', selection: 'round-robin', reverbSend: 0.12,
    variants: variants(3, index => {
      const variation = [0.93, 1, 1.07][index]
      const parts: SoundLayer[] = [
        burst(1200 * variation, 0.18, 0.18, 'bandpass', 0, 0.04),
        burst(1800 * variation, 0.42, 0.035, 'bandpass', seconds * 0.22, 0.04, 3),
        burst(900 * variation, 0.24, 0.11, 'bandpass', seconds * 0.24, 0.04),
        burst(1500 * variation, 0.52, 0.038, 'bandpass', seconds * 0.58, 0.04, 3),
        burst(2400 * variation, 0.34, 0.03, 'bandpass', seconds * 0.6, 0.04, 3),
      ]
      if (rifle) {
        parts.push(burst(1300 * variation, 0.5, 0.04, 'bandpass', seconds * 0.8, 0.05, 3))
        parts.push(burst(2100 * variation, 0.45, 0.035, 'bandpass', seconds * 0.86, 0.05, 3))
      } else parts.push(burst(2000 * variation, 0.5, 0.036, 'bandpass', seconds * 0.82, 0.05, 3))
      return parts
    }),
  }
}

function steel(): CueDefinition {
  const partials: readonly [number, number, number][] = [[1, 1, 1.5], [2.76, 0.55, 1], [5.4, 0.32, 0.55], [8.93, 0.18, 0.32], [1.53, 0.3, 1.2]]
  return {
    class: 'sfx', bus: 'sfx', delayByDistance: true, selection: 'random-no-repeat', gain: 0.75, reverbSend: 0.5,
    attenuation: { near: 9, far: 180, rolloff: 0.8 },
    variants: variants(5, index => {
      const base = 520 * [0.81, 0.91, 1, 1.09, 1.19][index]
      return [
        burst(base * 6, 0.92, 0.036, 'bandpass', 0, 0.3, 1.5),
        ...partials.map(([ratio, gain, decay]) => tone(base * ratio, base * ratio * 0.997, gain * 0.35, decay, 0, 0.35)),
      ]
    }),
  }
}

function impact(surface: Surface): CueDefinition {
  const toneBySurface: Partial<Record<Surface, readonly [number, number, number, number]>> = {
    metal: [900, 760, 0.25, 0.24], wood: [260, 180, 0.3, 0.08], concrete: [170, 95, 0.22, 0.1],
  }
  const noiseBySurface: Record<Surface, readonly [number, number, number, BiquadFilterType, number]> = {
    concrete: [1400, 0.78, 0.065, 'bandpass', 1.2],
    metal: [2400, 0.8, 0.045, 'bandpass', 3],
    wood: [900, 0.76, 0.065, 'bandpass', 2],
    dirt: [500, 0.8, 0.1, 'lowpass', 0.7],
    water: [1800, 0.55, 0.16, 'bandpass', 0.8],
    paper: [1700, 0.45, 0.07, 'highpass', 0.8],
    canvas: [700, 0.68, 0.08, 'lowpass', 0.7],
  }
  return {
    class: 'sfx', bus: 'sfx', delayByDistance: true, reverbSend: surface === 'metal' ? 0.25 : 0.15,
    attenuation: { near: 4, far: 85, rolloff: 0.9 },
    variants: variants(4, index => {
      const [frequency, gain, duration, filter, q] = noiseBySurface[surface]
      const variation = [0.83, 0.94, 1.06, 1.18][index]
      const layers: SoundLayer[] = [burst(frequency * variation, gain, duration * (1 + index * 0.035), filter, 0, 0.2, q)]
      const struck = toneBySurface[surface]
      if (struck) layers.push(tone(struck[0] * variation, struck[1] * variation, struck[2], struck[3], 0, 0.15, 'triangle'))
      return layers
    }),
  }
}

function step(surface: Surface, landing: boolean): CueDefinition {
  const frequencies: Record<Surface, readonly [number, BiquadFilterType]> = {
    concrete: [670, 'bandpass'], metal: [1400, 'bandpass'], wood: [440, 'bandpass'],
    dirt: [350, 'lowpass'], water: [1900, 'bandpass'], paper: [1200, 'highpass'], canvas: [520, 'lowpass'],
  }
  return {
    class: 'foley', bus: 'sfx', gain: landing ? 0.7 : 0.48, reverbSend: landing ? 0.22 : 0.16,
    variants: variants(5, index => {
      const [frequency, filter] = frequencies[surface]
      const variation = [0.82, 0.91, 1, 1.09, 1.2][index]
      const duration = landing ? 0.17 : 0.1 + (index % 2) * 0.025
      const layers: SoundLayer[] = [burst(frequency * variation, landing ? 0.7 : 0.55, duration, filter, 0, 0.12)]
      if (landing) layers.push(tone(110 * variation, 72, 0.25, 0.16, 0, 0.1, 'triangle'))
      if (surface === 'metal' || surface === 'water') layers.push(burst(frequency * variation * 2, 0.18, duration * 0.65, 'highpass', 0.018, 0.12))
      return layers
    }),
  }
}

export const STARTER_CUES: Record<string, CueDefinition> = {
  'weapon.rifle': shot(true),
  'weapon.pistol': shot(false),
  'weapon.reload.rifle': reload(true),
  'weapon.reload.pistol': reload(false),
  'weapon.dry': { class: 'weapons', bus: 'weapons', gain: 0.45, cooldown: 0.08, variants: variants(3, index => [burst(2600 * [0.9, 1, 1.12][index], 0.55, 0.027, 'bandpass', 0, 0.08, 3)]) },
  'weapon.equip': { class: 'weapons', bus: 'weapons', gain: 0.4, variants: variants(3, index => [burst(1500 * (0.9 + index * 0.1), 0.2, 0.16), burst(2200 * (0.9 + index * 0.1), 0.37, 0.035, 'bandpass', 0.12, 0.08, 3)]) },
  'impact.steel': steel(),
  'foley.casing': {
    class: 'foley', bus: 'sfx', gain: 0.26, variants: variants(4, index => [
      tone(4200 + index * 430, 4000, 0.35, 0.05, 0, 0.05),
      tone(4900 + index * 370, 4500, 0.23, 0.05, 0.075, 0.05),
      tone(5500 + index * 300, 4800, 0.16, 0.05, 0.14, 0.05),
    ]),
  },
  'ambience.wind': {
    class: 'ambience', bus: 'ambience', loop: true, gain: 0.19, reverbSend: 0,
    variants: variants(3, index => [
      { kind: 'noise', loop: true, gain: 0.65, filter: { type: 'lowpass', frequency: 250 + index * 70, q: 0.6 } },
      { kind: 'noise', loop: true, gain: 0.25, filter: { type: 'bandpass', frequency: 420 + index * 60, q: 0.3 } },
    ]),
  },
  'ambience.room': {
    class: 'ambience', bus: 'ambience', loop: true, gain: 0.06, reverbSend: 0,
    variants: variants(3, index => [{ kind: 'noise', loop: true, gain: 0.4, filter: { type: 'lowpass', frequency: 90 + index * 20, q: 0.5 } }]),
  },
  'ambience.dog': {
    class: 'ambience', bus: 'ambience', gain: 0.16, attenuation: { near: 12, far: 180, rolloff: 0.6 },
    variants: variants(4, index => [tone(360 + index * 18, 290 + index * 14, 0.27, 0.21, 0, 0.4, 'sawtooth'), tone(340 + index * 20, 260 + index * 16, 0.2, 0.16, 0.31, 0.4, 'sawtooth')]),
  },
  'ambience.metal-creak': {
    class: 'ambience', bus: 'ambience', gain: 0.18, attenuation: { near: 4, far: 80, rolloff: 0.8 },
    variants: variants(4, index => [tone(430 + index * 60, 180 + index * 25, 0.25, 0.75, 0, 0.55, 'sawtooth'), burst(1800 + index * 230, 0.15, 0.46, 'bandpass', 0.1, 0.4, 4)]),
  },
}

for (const surface of ['concrete', 'metal', 'wood', 'dirt', 'water', 'paper', 'canvas'] as const) {
  STARTER_CUES[`impact.${surface}`] = impact(surface)
  STARTER_CUES[`footstep.${surface}`] = step(surface, false)
  STARTER_CUES[`landing.${surface}`] = step(surface, true)
}

export const STARTER_ZONES: readonly SoundZone[] = [
  {
    name: 'outdoor', impulse: 'outdoor', wet: 0.22, beds: ['ambience.wind'], crossfade: 1.4,
    oneShots: [
      { cue: 'ambience.dog', interval: [18, 38], radius: [55, 110] },
      { cue: 'ambience.metal-creak', interval: [12, 28], radius: [18, 50] },
    ],
  },
  { name: 'small-room', impulse: 'small-room', wet: 0.35, beds: ['ambience.room'], crossfade: 1.2, oneShots: [{ cue: 'ambience.metal-creak', interval: [15, 35], radius: [5, 18] }] },
  { name: 'corridor', impulse: 'corridor', wet: 0.42, beds: ['ambience.room'], crossfade: 1.2, oneShots: [{ cue: 'ambience.metal-creak', interval: [14, 30], radius: [9, 30] }] },
  { name: 'hall', impulse: 'hall', wet: 0.48, beds: ['ambience.room'], crossfade: 1.4, oneShots: [{ cue: 'ambience.metal-creak', interval: [14, 30], radius: [15, 42] }] },
]
