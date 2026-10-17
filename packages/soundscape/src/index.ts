import { createAudioLog } from '@blacksite/check'
import { attenuationAt, CLASS_ATTENUATION, distanceBetween, jitterGain, jitterPitch, selectVariant, SPEED_OF_SOUND, voiceScore } from './model'
import { STARTER_CUES, STARTER_ZONES } from './presets'
import type { AudioLogLike, CueDefinition, ListenerPose, PlayOptions, SoundBus, SoundClass, SoundLayer, SoundZone, Vec3, VoiceHandle, SoundscapeOptions } from './types'

export { CLASS_ATTENUATION, SPEED_OF_SOUND, attenuationAt, distanceBetween, selectVariant } from './model'
export { STARTER_CUES, STARTER_ZONES } from './presets'
export type { Attenuation, AmbientOneShot, AudioLogLike, BufferLayer, CueDefinition, CueVariant, ListenerPose, NoiseLayer, PlayOptions, SoundBus, SoundClass, SoundFilter, SoundLayer, SoundZone, SoundscapeOptions, Surface, ToneLayer, Vec3, VoiceHandle } from './types'

interface ZoneEffect {
  convolver: ConvolverNode
  wet: GainNode
}

interface Voice {
  id: number
  cue: string
  sample: string
  soundClass: SoundClass
  definition: CueDefinition
  position?: Vec3
  distance?: number
  pan?: number
  volume: number
  score: number
  loop: boolean
  startedAt: number
  root: GainNode
  volumeGain: GainNode
  attenuationGain: GainNode
  wetRoot: GainNode | null
  wetVolumeGain: GainNode | null
  wetAttenuationGain: GainNode | null
  lowpass: BiquadFilterNode
  spatial: PannerNode | StereoPannerNode
  spatialMode: 'hrtf' | 'stereo'
  sources: AudioScheduledSourceNode[]
  remaining: number
  finished: boolean
  logged: boolean
  pendingSteal: boolean
  handle: VoiceHandle
}

interface LoopRecord {
  name: string
  options: PlayOptions
  active: VoiceHandle | null
  fadeInSeconds?: number
  stopped: boolean
  handle: VoiceHandle
}

interface AudioTask {
  at: number
  callback: () => void
  timer?: ReturnType<typeof setTimeout>
  cancelled: boolean
}

const BUS_NAMES: readonly SoundBus[] = ['sfx', 'weapons', 'ambience', 'music', 'ui', 'voice']

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

function impulseResponse(context: AudioContext, name: 'small-room' | 'corridor' | 'hall' | 'outdoor', tier: 'desktop' | 'phone'): AudioBuffer {
  const settings = {
    'small-room': { seconds: 0.58, decay: 9, slap: 0.045, early: 0.3 },
    corridor: { seconds: 1.45, decay: 4.4, slap: 0.12, early: 0.85 },
    hall: { seconds: 2.35, decay: 2.8, slap: 0.19, early: 0.35 },
    outdoor: { seconds: 1.25, decay: 4.7, slap: 0.25, early: 0.3 },
  }[name]
  const sampleRate = context.sampleRate
  const length = Math.ceil(settings.seconds * (tier === 'phone' ? 0.7 : 1) * sampleRate)
  const buffer = context.createBuffer(2, length, sampleRate)
  let seed = name.length * 7919
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x100000000
  }
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel)
    const slapAt = settings.slap + channel * 0.017
    for (let index = 0; index < length; index++) {
      const seconds = index / sampleRate
      const onset = Math.min(1, seconds / 0.01)
      const slap = Math.abs(seconds - slapAt) < 0.012 ? 1 + settings.early * 2 : 1
      const air = name === 'outdoor' ? Math.exp(-seconds * 1.5) : 1
      data[index] = (random() * 2 - 1) * Math.exp(-seconds * settings.decay) * onset * slap * air * 0.48
    }
  }
  return buffer
}

function noiseBuffer(context: AudioContext): AudioBuffer {
  const length = context.sampleRate * 4
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const data = buffer.getChannelData(0)
  let seed = 44257
  let brown = 0
  for (let index = 0; index < length; index++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    const white = seed / 0x80000000 - 1
    brown = (brown + white * 0.08) * 0.992
    data[index] = white * 0.75 + brown * 0.25
  }
  const seam = Math.min(length - 1, Math.round(context.sampleRate * 0.08))
  const correction = data[0] - data[length - 1]
  for (let index = 0; index < seam; index++) {
    const t = (index + 1) / seam
    data[length - seam + index] += correction * t * t * (3 - 2 * t)
  }
  return buffer
}

export function createSoundscape(options: SoundscapeOptions = {}) {
  const random = options.random ?? Math.random
  const tier = options.tier ?? (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches ? 'phone' : 'desktop')
  const cap = Math.max(1, Math.floor(options.voiceCap ?? (tier === 'phone' ? 16 : 32)))
  const log: AudioLogLike = options.log ?? createAudioLog()
  const cues = new Map<string, CueDefinition>(Object.entries(STARTER_CUES))
  const zones = new Map<string, SoundZone>(STARTER_ZONES.map(zone => [zone.name, zone]))
  const effects = new Map<string, ZoneEffect>()
  const impulseCache = new Map<string, AudioBuffer>()
  const voices = new Map<number, Voice>()
  const voiceHandles = new WeakMap<VoiceHandle, Voice>()
  const loops = new Set<LoopRecord>()
  const cueSelection = new Map<string, number>()
  const cueStarts = new Map<string, Array<{ at: number; variant: number }>>()
  const lastPlayed = new Map<string, number>()
  const ambienceNext = new Map<string, number>()
  const busVolumes = new Map<SoundBus, number>(BUS_NAMES.map(name => [name, 1]))
  const busNodes = new Map<SoundBus, GainNode>()
  const duckNodes = new Map<SoundBus, GainNode>()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  const audioTasks = new Set<AudioTask>()
  let context: AudioContext | null = options.context ?? null
  let ownsContext = !options.context
  let master: GainNode | null = null
  let noise: AudioBuffer | null = null
  let initialized = false
  let started = false
  let disposed = false
  let gestureSeen = false
  let masterVolume = 0.7
  let currentZone = 'outdoor'
  let activeBeds: VoiceHandle[] = []
  let voiceId = 0
  let listener: ListenerPose = { position: [0, 0, 0], forward: [0, 0, -1], up: [0, 1, 0] }

  const later = (callback: () => void, milliseconds: number) => {
    const timer = setTimeout(() => { timers.delete(timer); callback() }, milliseconds)
    timers.add(timer)
  }

  const pauseAudioTasks = () => {
    for (const task of audioTasks) {
      if (!task.timer) continue
      clearTimeout(task.timer)
      timers.delete(task.timer)
      task.timer = undefined
    }
  }

  const armAudioTask = (task: AudioTask) => {
    if (!context || context.state !== 'running' || task.cancelled || task.timer) return
    const delay = Math.max(0, task.at - context.currentTime) * 1000
    const timer = setTimeout(() => {
      timers.delete(timer)
      task.timer = undefined
      if (!context || context.state !== 'running' || task.cancelled || disposed) return
      if (context.currentTime + 0.002 < task.at) { armAudioTask(task); return }
      audioTasks.delete(task)
      task.callback()
    }, delay)
    task.timer = timer
    timers.add(timer)
  }

  const scheduleAudioTask = (at: number, callback: () => void) => {
    const task: AudioTask = { at, callback, cancelled: false }
    audioTasks.add(task)
    armAudioTask(task)
    return () => {
      task.cancelled = true
      audioTasks.delete(task)
      if (task.timer) { clearTimeout(task.timer); timers.delete(task.timer) }
    }
  }

  const flushAudioTasks = () => {
    if (!context || context.state !== 'running') return
    for (const task of [...audioTasks]) {
      if (task.cancelled) { audioTasks.delete(task); continue }
      if (context.currentTime + 0.002 >= task.at) {
        audioTasks.delete(task)
        if (task.timer) { clearTimeout(task.timer); timers.delete(task.timer); task.timer = undefined }
        task.callback()
      } else armAudioTask(task)
    }
  }

  const logicalNow = () => typeof performance === 'undefined' ? Date.now() / 1000 : performance.now() / 1000

  const getZoneEffect = (name: string, bus: SoundBus): ZoneEffect | null => {
    if (!context || !initialized || !busNodes.has(bus)) return null
    const effectId = `${name}:${bus}`
    const existing = effects.get(effectId)
    if (existing) return existing
    const zone = zones.get(name)
    if (!zone) return null
    const convolver = context.createConvolver()
    const impulse = zone.impulse ?? 'outdoor'
    if (typeof impulse === 'string' && !impulseCache.has(name)) impulseCache.set(name, impulseResponse(context, impulse, tier))
    convolver.buffer = typeof impulse === 'string' ? impulseCache.get(name)! : impulse
    const wet = context.createGain()
    wet.gain.value = zone.wet ?? 0.3
    convolver.connect(wet).connect(busNodes.get(bus)!)
    const effect = { convolver, wet }
    effects.set(effectId, effect)
    return effect
  }

  const prepareZone = (name: string) => { for (const bus of BUS_NAMES) getZoneEffect(name, bus) }

  const updateDucking = () => {
    if (!context) return
    const now = context.currentTime
    const weapons = [...voices.values()].some(voice => voice.soundClass === 'weapons')
    const dialogue = [...voices.values()].some(voice => voice.soundClass === 'voice')
    for (const name of BUS_NAMES) {
      const node = duckNodes.get(name)
      if (!node) continue
      const target = dialogue && name !== 'voice' ? 0.38 : weapons && (name === 'ambience' || name === 'music') ? 0.53 : 1
      node.gain.setTargetAtTime(target, now, target < node.gain.value ? 0.018 : 0.18)
    }
  }

  const finishVoice = (voice: Voice) => {
    if (voice.finished) return
    voice.finished = true
    voices.delete(voice.id)
    if (voice.logged) log.end()
    updateDucking()
  }

  const stopVoice = (voice: Voice, fadeSeconds = 0.025) => {
    if (voice.finished || !context) return
    const now = context.currentTime
    const fade = Math.max(0, fadeSeconds)
    voice.root.gain.cancelScheduledValues(now)
    voice.root.gain.setValueAtTime(voice.root.gain.value, now)
    voice.root.gain.linearRampToValueAtTime(0, now + fade)
    if (voice.wetRoot) {
      voice.wetRoot.gain.cancelScheduledValues(now)
      voice.wetRoot.gain.setValueAtTime(voice.wetRoot.gain.value, now)
      voice.wetRoot.gain.linearRampToValueAtTime(0, now + fade)
    }
    for (const source of voice.sources) {
      try { source.stop(now + fade + 0.001) } catch { }
    }
    if (fade === 0 || context.state === 'suspended') finishVoice(voice)
    else scheduleAudioTask(now + fade + 0.003, () => finishVoice(voice))
  }

  const distanceOf = (play: PlayOptions): number => play.position ? distanceBetween(listener.position, play.position) : Math.max(0, play.distance ?? 0)

  const busFor = (definition: CueDefinition): SoundBus => definition.bus ?? (definition.class === 'foley' ? 'sfx' : definition.class ?? 'sfx')

  const spatialGainOf = (definition: CueDefinition, play: PlayOptions): number => {
    const soundClass = definition.class ?? 'sfx'
    const distanceGain = attenuationAt(distanceOf(play), definition.attenuation ?? CLASS_ATTENUATION[soundClass])
    const blockedValue = play.position && options.occlusion ? options.occlusion(listener.position, play.position) : 0
    const blocked = typeof blockedValue === 'boolean' ? Number(blockedValue) : clamp(blockedValue || 0, 0, 1)
    return distanceGain * (1 - blocked * 0.62)
  }

  const audibilityOf = (definition: CueDefinition, play: PlayOptions): number => spatialGainOf(definition, play) * (busVolumes.get(busFor(definition)) ?? 1) * masterVolume

  const panOf = (position: Vec3): number => {
    const forward = listener.forward ?? [0, 0, -1]
    const dx = position[0] - listener.position[0]
    const dz = position[2] - listener.position[2]
    const length = Math.hypot(dx, dz) || 1
    return clamp((dx * -forward[2] + dz * forward[0]) / length, -1, 1)
  }

  const updateVoiceSpatial = (voice: Voice) => {
    if (!context || voice.finished) return
    const now = context.currentTime
    const distance = voice.position ? distanceBetween(listener.position, voice.position) : Math.max(0, voice.distance ?? 0)
    const attenuation = attenuationAt(distance, voice.definition.attenuation ?? CLASS_ATTENUATION[voice.soundClass])
    const occlusion = voice.position && options.occlusion ? options.occlusion(listener.position, voice.position) : 0
    const blocked = typeof occlusion === 'boolean' ? Number(occlusion) : clamp(occlusion || 0, 0, 1)
    voice.lowpass.frequency.setTargetAtTime(20000 - blocked * 18500, now, 0.045)
    voice.attenuationGain.gain.setTargetAtTime(attenuation * (1 - blocked * 0.62), now, 0.035)
    voice.wetAttenuationGain?.gain.setTargetAtTime(attenuation * (1 - blocked * 0.62), now, 0.035)
    if (voice.position) {
      if (voice.spatialMode === 'hrtf') {
        const spatial = voice.spatial as PannerNode
        spatial.positionX.setTargetAtTime(voice.position[0], now, 0.025)
        spatial.positionY.setTargetAtTime(voice.position[1], now, 0.025)
        spatial.positionZ.setTargetAtTime(voice.position[2], now, 0.025)
      } else (voice.spatial as StereoPannerNode).pan.setTargetAtTime(panOf(voice.position), now, 0.04)
    } else if (voice.spatialMode === 'stereo') (voice.spatial as StereoPannerNode).pan.setTargetAtTime(clamp(voice.pan ?? 0, -1, 1), now, 0.04)
    const loudness = attenuation * (1 - blocked * 0.62) * voice.volume * (voice.definition.gain ?? 1) * (busVolumes.get(busFor(voice.definition)) ?? 1) * masterVolume
    voice.score = loudness < 0.003 ? -Infinity : voiceScore(voice.soundClass, loudness)
  }

  const makeLayerSource = (layer: SoundLayer, pitch: number, at: number, loop: boolean): AudioScheduledSourceNode => {
    const audio = context!
    let source: AudioScheduledSourceNode
    if (layer.kind === 'tone') {
      const oscillator = audio.createOscillator()
      oscillator.type = layer.waveform ?? 'sine'
      oscillator.frequency.setValueAtTime(Math.max(1, layer.frequency * pitch), at)
      if (layer.endFrequency) oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, layer.endFrequency * pitch), at + layer.duration)
      source = oscillator
    } else {
      const bufferSource = audio.createBufferSource()
      bufferSource.buffer = layer.kind === 'noise' ? noise : layer.buffer
      bufferSource.loop = loop || !!layer.loop
      bufferSource.playbackRate.value = pitch
      source = bufferSource
    }
    return source
  }

  const spawnVoice = (name: string, definition: CueDefinition, play: PlayOptions, looping = false, scheduledDelay = 0): VoiceHandle | null => {
    if (!context || !master || disposed || definition.variants.length === 0) return null
    const audibility = audibilityOf(definition, play)
    if (audibility < 0.003) return null
    if (!looping && (play.volume ?? 1) <= 0) return null
    const soundClass = definition.class ?? 'sfx'
    const now = logicalNow()
    if (!looping && now - (lastPlayed.get(name) ?? -Infinity) < (definition.cooldown ?? 0)) return null
    const volume = Math.max(0, (play.volume ?? 1) * jitterGain(random, definition.volumeJitterDb ?? 1.5))
    const score = voiceScore(soundClass, audibility * volume * (definition.gain ?? 1))
    let extraDelay = 0
    if (voices.size >= cap) {
      if ([...voices.values()].some(voice => voice.pendingSteal)) return null
      const victim = [...voices.values()].sort((a, b) => a.score - b.score || a.startedAt - b.startedAt)[0]
      if (!victim || victim.score > score) return null
      stopVoice(victim, 0.024)
      extraDelay = 0.028
    }
    const startAt = context.currentTime + scheduledDelay + extraDelay
    const timeline = (cueStarts.get(name) ?? []).filter((entry, index, list) => entry.at >= context!.currentTime || !list.some(other => other !== entry && other.at > entry.at && other.at <= context!.currentTime))
    const before = timeline.reduce<{ at: number; variant: number } | undefined>((best, entry) => entry.at <= startAt && (!best || entry.at >= best.at) ? entry : best, undefined)
    const after = timeline.reduce<{ at: number; variant: number } | undefined>((best, entry) => entry.at > startAt && (!best || entry.at < best.at) ? entry : best, undefined)
    const avoid = [before, after].flatMap(entry => entry ? [entry.variant] : [])
    const selected = selectVariant(definition.variants, cueSelection.get(name) ?? -1, definition.selection ?? 'random-no-repeat', random, avoid)
    cueSelection.set(name, selected)
    timeline.push({ at: startAt, variant: selected })
    cueStarts.set(name, timeline)
    lastPlayed.set(name, now)
    const variant = definition.variants[selected]
    const pitch = Math.max(0.05, (play.pitch ?? 1) * jitterPitch(random, definition.pitchJitter ?? 0.05))
    const root = context.createGain()
    root.gain.value = 1
    const volumeGain = context.createGain()
    volumeGain.gain.value = volume * (definition.gain ?? 1)
    const attenuationGain = context.createGain()
    attenuationGain.gain.value = spatialGainOf(definition, play)
    const lowpass = context.createBiquadFilter()
    lowpass.type = 'lowpass'
    lowpass.frequency.value = 20000
    root.connect(volumeGain).connect(attenuationGain).connect(lowpass)
    const positional = !!play.position
    const spatialMode = positional && tier === 'desktop' ? 'hrtf' : 'stereo'
    const spatial = spatialMode === 'hrtf' ? context.createPanner() : context.createStereoPanner()
    if (spatialMode === 'hrtf') {
      const panner = spatial as PannerNode
      panner.panningModel = 'HRTF'
      panner.distanceModel = 'linear'
      panner.rolloffFactor = 0
      panner.positionX.value = play.position![0]
      panner.positionY.value = play.position![1]
      panner.positionZ.value = play.position![2]
    } else (spatial as StereoPannerNode).pan.value = positional ? panOf(play.position!) : clamp(play.pan ?? 0, -1, 1)
    lowpass.connect(spatial)
    const bus = busNodes.get(busFor(definition)) ?? busNodes.get('sfx')!
    spatial.connect(bus)
    const zoneEffect = (definition.reverbSend ?? 0.3) > 0 ? getZoneEffect(currentZone, busFor(definition)) : null
    const useWet = !!zoneEffect
    const wetRoot = useWet ? context.createGain() : null
    const wetVolumeGain = useWet ? context.createGain() : null
    const wetAttenuationGain = useWet ? context.createGain() : null
    if (wetRoot && wetVolumeGain && wetAttenuationGain && zoneEffect) {
      wetRoot.gain.value = 1
      wetVolumeGain.gain.value = volume * (definition.gain ?? 1)
      wetAttenuationGain.gain.value = spatialGainOf(definition, play)
      wetRoot.connect(wetVolumeGain).connect(wetAttenuationGain).connect(zoneEffect.convolver)
    }
    const voice: Voice = {
      id: ++voiceId, cue: name, sample: variant.id, soundClass, definition,
      position: play.position, distance: play.distance, pan: play.pan, volume,
      score, loop: looping, startedAt: now, root, volumeGain, attenuationGain,
      wetRoot, wetVolumeGain, wetAttenuationGain, lowpass, spatial, spatialMode,
      sources: [], remaining: variant.layers.length, finished: false, logged: false, pendingSteal: extraDelay > 0, handle: null!,
    }
    const handle: VoiceHandle = {
      cue: name,
      sample: variant.id,
      setPosition(position) { voice.position = position; updateVoiceSpatial(voice) },
      setVolume(value, fadeSeconds = 0.04) {
        if (voice.finished || !context) return
        voice.volume = Math.max(0, value)
        const time = context.currentTime
        voice.volumeGain.gain.cancelScheduledValues(time)
        voice.volumeGain.gain.setValueAtTime(voice.volumeGain.gain.value, time)
        voice.volumeGain.gain.linearRampToValueAtTime(voice.volume * (definition.gain ?? 1), time + Math.max(0, fadeSeconds))
        if (voice.wetVolumeGain) {
          voice.wetVolumeGain.gain.cancelScheduledValues(time)
          voice.wetVolumeGain.gain.setValueAtTime(voice.wetVolumeGain.gain.value, time)
          voice.wetVolumeGain.gain.linearRampToValueAtTime(voice.volume * (definition.gain ?? 1), time + Math.max(0, fadeSeconds))
        }
      },
      stop(fadeSeconds) { stopVoice(voice, fadeSeconds) },
    }
    voice.handle = handle
    for (const layer of variant.layers) {
      const at = startAt + (layer.offset ?? 0)
      const source = makeLayerSource(layer, pitch, at, looping)
      const gain = context.createGain()
      const attack = Math.max(0.001, layer.attack ?? 0.002)
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, layer.gain), at + attack)
      const duration = layer.kind === 'tone' ? layer.duration : layer.kind === 'buffer' ? layer.duration ?? layer.buffer.duration / pitch : layer.duration ?? (looping || layer.loop ? 0 : 0.1)
      if (!looping && !('loop' in layer && layer.loop)) gain.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(attack + 0.001, duration))
      source.connect(gain)
      let output: AudioNode = gain
      if (layer.filter) {
        const filter = context.createBiquadFilter()
        filter.type = layer.filter.type
        filter.frequency.value = layer.filter.frequency * pitch
        filter.Q.value = layer.filter.q ?? 0.8
        gain.connect(filter)
        output = filter
      }
      output.connect(root)
      if (wetRoot && (layer.send ?? 0.3) > 0) {
        const send = context.createGain()
        send.gain.value = (definition.reverbSend ?? 0.3) * (layer.send ?? 0.3)
        output.connect(send).connect(wetRoot)
      }
      source.onended = () => { voice.remaining--; if (voice.remaining <= 0) finishVoice(voice) }
      if (layer.kind === 'noise' && !looping) (source as AudioBufferSourceNode).start(at, random() * 0.35)
      else source.start(at)
      if (!looping && !('loop' in layer && layer.loop)) source.stop(at + duration + 0.005)
      voice.sources.push(source)
    }
    if (voice.sources.length === 0) return null
    voices.set(voice.id, voice)
    voiceHandles.set(handle, voice)
    if (scheduledDelay + extraDelay > 0) scheduleAudioTask(startAt, () => {
      if (voice.finished) return
      voice.logged = true
      voice.pendingSteal = false
      log.start(name, variant.id)
    })
    else { voice.logged = true; log.start(name, variant.id) }
    updateDucking()
    updateVoiceSpatial(voice)
    if (!looping && context.state === 'suspended') {
      const longest = Math.max(...variant.layers.map(layer => (layer.offset ?? 0) + ('duration' in layer ? layer.duration ?? 0.1 : 0.1)))
      later(() => { if (context?.state === 'suspended') stopVoice(voice, 0) }, (scheduledDelay + longest + 0.05) * 1000)
    }
    return handle
  }

  const updateLoop = (record: LoopRecord) => {
    if (record.stopped) return
    const definition = cues.get(record.name)
    if (!definition) return
    const audible = audibilityOf(definition, record.options) >= 0.003
    if (record.active && voiceHandles.get(record.active)?.finished) record.active = null
    if (!audible && record.active) { record.active.stop(0.08); record.active = null }
    else if (audible && !record.active) {
      if (record.fadeInSeconds && (record.options.volume ?? 1) > 0) {
        const targetVolume = record.options.volume ?? 1
        record.active = spawnVoice(record.name, definition, { ...record.options, volume: 0 }, true)
        if (record.active) { record.active.setVolume(targetVolume, record.fadeInSeconds); record.fadeInSeconds = undefined }
      } else record.active = spawnVoice(record.name, definition, record.options, true)
    }
  }

  const transitionBeds = (initial = false) => {
    if (!initialized || !started) return
    const zone = zones.get(currentZone)
    if (!zone) return
    const crossfade = initial ? 0.05 : voices.size >= cap ? 0.18 : zone.crossfade ?? 1.3
    for (const bed of activeBeds) bed.stop(crossfade)
    activeBeds = []
    for (const cue of zone.beds ?? []) {
      const bed = play(cue, { volume: 0, loop: true })
      if (!bed) continue
      bed.setVolume(1, crossfade)
      activeBeds.push(bed)
    }
    ambienceNext.clear()
    for (const oneShot of zone.oneShots ?? []) ambienceNext.set(oneShot.cue, context!.currentTime + oneShot.interval[0] + random() * (oneShot.interval[1] - oneShot.interval[0]))
  }

  const ensureGraph = () => {
    if (initialized || disposed || typeof AudioContext === 'undefined' && !context) return
    context ??= new AudioContext()
    const compressor = context.createDynamicsCompressor()
    compressor.threshold.value = -3
    compressor.knee.value = 0
    compressor.ratio.value = 20
    compressor.attack.value = 0.002
    compressor.release.value = 0.14
    master = context.createGain()
    master.gain.value = 0.7
    compressor.connect(master).connect(context.destination)
    for (const name of BUS_NAMES) {
      const bus = context.createGain()
      const duck = context.createGain()
      bus.gain.value = busVolumes.get(name) ?? 1
      bus.connect(duck).connect(compressor)
      busNodes.set(name, bus)
      duckNodes.set(name, duck)
    }
    noise = noiseBuffer(context)
    initialized = true
    prepareZone(currentZone)
  }

  const prepare = () => {
    ensureGraph()
    if (!context || disposed) return
    for (const zone of STARTER_ZONES) {
      if (typeof zone.impulse !== 'string' || impulseCache.has(zone.name)) continue
      impulseCache.set(zone.name, impulseResponse(context, zone.impulse, tier))
    }
  }

  const start = async (): Promise<void> => {
    gestureSeen = true
    prepare()
    if (context?.state === 'suspended') await context.resume()
    if (!started && context?.state === 'running') {
      started = true
      transitionBeds(true)
    }
    flushAudioTasks()
  }

  const play = (name: string, playOptions: PlayOptions = {}): VoiceHandle | null => {
    ensureGraph()
    const definition = cues.get(name)
    if (!definition) throw new Error(`Unknown sound cue: ${name}`)
    if (definition.loop || playOptions.loop) {
      const record: LoopRecord = {
        name, options: { ...playOptions }, active: null, stopped: false,
        handle: null!,
      }
      const handle: VoiceHandle = {
        cue: name,
        get sample() { return record.active?.sample ?? 'virtual' },
        setPosition(position) { record.options.position = position; record.active?.setPosition(position); updateLoop(record) },
        setVolume(volume, fadeSeconds) {
          record.options.volume = volume
          if (!record.active && fadeSeconds && fadeSeconds > 0) record.fadeInSeconds = fadeSeconds
          record.active?.setVolume(volume, fadeSeconds)
        },
        stop(fadeSeconds) { record.stopped = true; record.active?.stop(fadeSeconds); loops.delete(record) },
      }
      record.handle = handle
      loops.add(record)
      updateLoop(record)
      return handle
    }
    const travel = (playOptions.delay ?? definition.delayByDistance ?? false) ? distanceOf(playOptions) / SPEED_OF_SOUND : 0
    if (travel > 0) {
      if (audibilityOf(definition, playOptions) < 0.003 || (playOptions.volume ?? 1) <= 0) return null
      let active: VoiceHandle | null = null
      let stopped = false
      const pendingOptions = { ...playOptions, delay: false }
      const cancel = scheduleAudioTask(context!.currentTime + travel, () => {
        if (!stopped && !disposed) active = spawnVoice(name, definition, pendingOptions)
      })
      return {
        cue: name,
        get sample() { return active?.sample ?? 'pending' },
        setPosition(position) { pendingOptions.position = position; active?.setPosition(position) },
        setVolume(volume, fadeSeconds) { pendingOptions.volume = volume; active?.setVolume(volume, fadeSeconds) },
        stop(fadeSeconds) {
          stopped = true
          cancel()
          active?.stop(fadeSeconds)
        },
      }
    }
    return spawnVoice(name, definition, playOptions, false, travel)
  }

  const setListener = (pose: ListenerPose) => {
    listener = pose
    if (!context) return
    const now = context.currentTime
    const audioListener = context.listener
    audioListener.positionX.setTargetAtTime(pose.position[0], now, 0.025)
    audioListener.positionY.setTargetAtTime(pose.position[1], now, 0.025)
    audioListener.positionZ.setTargetAtTime(pose.position[2], now, 0.025)
    const forward = pose.forward ?? [0, 0, -1]
    const up = pose.up ?? [0, 1, 0]
    audioListener.forwardX.setTargetAtTime(forward[0], now, 0.025)
    audioListener.forwardY.setTargetAtTime(forward[1], now, 0.025)
    audioListener.forwardZ.setTargetAtTime(forward[2], now, 0.025)
    audioListener.upX.setTargetAtTime(up[0], now, 0.025)
    audioListener.upY.setTargetAtTime(up[1], now, 0.025)
    audioListener.upZ.setTargetAtTime(up[2], now, 0.025)
    for (const voice of voices.values()) updateVoiceSpatial(voice)
    for (const loop of loops) updateLoop(loop)
  }

  const setZone = (name: string) => {
    if (!zones.has(name)) throw new Error(`Unknown sound zone: ${name}`)
    if (name === currentZone && activeBeds.length) return
    currentZone = name
    prepareZone(name)
    transitionBeds()
  }

  const registerCue = (name: string, definition: CueDefinition) => {
    if (!definition.variants.length || definition.variants.some(variant => !variant.layers.length)) throw new Error(`Sound cue ${name} needs nonempty variants and layers`)
    cues.set(name, definition)
    cueSelection.delete(name)
    cueStarts.delete(name)
  }

  const registerZone = (zone: SoundZone) => {
    zones.set(zone.name, zone)
    impulseCache.delete(zone.name)
    for (const [effectId, existing] of effects) {
      if (!effectId.startsWith(`${zone.name}:`)) continue
      effects.delete(effectId)
      later(() => { existing.convolver.disconnect(); existing.wet.disconnect() }, 3000)
    }
    if (currentZone === zone.name) { prepareZone(zone.name); transitionBeds() }
  }

  const setImpulseResponse = (zoneName: string, impulse: AudioBuffer) => {
    const zone = zones.get(zoneName)
    if (!zone) throw new Error(`Unknown sound zone: ${zoneName}`)
    registerZone({ ...zone, impulse })
  }

  const setBusVolume = (name: SoundBus | 'master', volume: number, fadeSeconds = 0.06) => {
    const gain = Math.max(0, volume)
    if (name === 'master') {
      masterVolume = gain
      if (master && context) master.gain.setTargetAtTime(gain, context.currentTime, fadeSeconds)
      for (const voice of voices.values()) updateVoiceSpatial(voice)
      for (const loop of loops) updateLoop(loop)
      return
    }
    busVolumes.set(name, gain)
    const node = busNodes.get(name)
    if (node && context) node.gain.setTargetAtTime(gain, context.currentTime, fadeSeconds)
    for (const voice of voices.values()) updateVoiceSpatial(voice)
    for (const loop of loops) updateLoop(loop)
  }

  const update = (_dt = 0) => {
    if (!context || disposed) return
    flushAudioTasks()
    for (const loop of loops) updateLoop(loop)
    const zone = zones.get(currentZone)
    if (!zone) return
    const now = context.currentTime
    for (const oneShot of zone.oneShots ?? []) {
      if (now < (ambienceNext.get(oneShot.cue) ?? Infinity)) continue
      const radius = oneShot.radius[0] + random() * (oneShot.radius[1] - oneShot.radius[0])
      const angle = random() * Math.PI * 2
      play(oneShot.cue, { position: [listener.position[0] + Math.cos(angle) * radius, listener.position[1], listener.position[2] + Math.sin(angle) * radius] })
      ambienceNext.set(oneShot.cue, now + oneShot.interval[0] + random() * (oneShot.interval[1] - oneShot.interval[0]))
    }
  }

  const gesture = () => { gestureSeen = true; void start().catch(() => {}); removeGestureListeners() }
  const visibility = () => {
    if (!context) return
    if (document.hidden) { pauseAudioTasks(); void context.suspend().catch(() => {}) }
    else if (gestureSeen) void context.resume().then(flushAudioTasks).catch(() => {})
  }
  const removeGestureListeners = () => {
    if (typeof window === 'undefined') return
    window.removeEventListener('pointerdown', gesture)
    window.removeEventListener('touchstart', gesture)
    window.removeEventListener('keydown', gesture)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', gesture, { once: true })
    window.addEventListener('touchstart', gesture, { once: true })
    window.addEventListener('keydown', gesture, { once: true })
    document.addEventListener('visibilitychange', visibility)
  }

  const dispose = () => {
    if (disposed) return
    disposed = true
    removeGestureListeners()
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibility)
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    audioTasks.clear()
    for (const loop of [...loops]) loop.handle.stop(0)
    for (const voice of [...voices.values()]) stopVoice(voice, 0)
    for (const effect of effects.values()) { effect.convolver.disconnect(); effect.wet.disconnect() }
    effects.clear()
    if (context && ownsContext) void context.close().catch(() => {})
    context = null
  }

  return {
    prepare, start, play, setListener, setZone, registerCue, registerZone, setImpulseResponse,
    setBusVolume, update, sample: () => log.sample(), dispose,
    get voiceCap() { return cap },
    get zone() { return currentZone },
    get state() { return context?.state ?? 'uninitialized' },
  }
}

export type Soundscape = ReturnType<typeof createSoundscape>
