import { expect, it, vi } from 'vitest'
import type { CueDefinition } from '@blacksite/soundscape'
import { createRangeAudio, reloadCue } from './audio'

function fakeSoundscape() {
  const cues = new Map<string, CueDefinition>()
  const voices: { cue: string; stop: ReturnType<typeof vi.fn> }[] = []
  return {
    cues, voices,
    prepare: vi.fn(), start: vi.fn(async () => {}), setZone: vi.fn(), setListener: vi.fn(), update: vi.fn(), dispose: vi.fn(),
    registerCue: vi.fn((name: string, definition: CueDefinition) => { cues.set(name, definition) }),
    play: vi.fn((cue: string) => { const voice = { cue, sample: '1', stop: vi.fn(), setPosition: vi.fn(), setVolume: vi.fn() }; voices.push(voice); return voice }),
    sample: () => ({ voices: voices.filter(voice => voice.stop.mock.calls.length === 0).length }),
  }
}

it('stops the old magazine and rack sounds when a reload is cancelled without muting the new equip', () => {
  const soundscape = fakeSoundscape()
  const audio = createRangeAudio(soundscape)
  audio.start()
  audio.reload('rifle', [[0.5, 'magazineOut'], [1.28, 'magazineIn'], [1.68, 'rackBack'], [1.78, 'rackForward']])
  audio.equip()
  audio.cancelReload()
  const [reload, equip] = soundscape.voices
  expect(reload.cue).toMatch(/^range\.reload\.rifle\./)
  expect(reload.stop).toHaveBeenCalledTimes(1)
  expect(equip.stop).not.toHaveBeenCalled()
})

it('times reload layers to the clip events', () => {
  const layers = reloadCue('pistol', [[0.4, 'magazineOut'], [1.2, 'magazineIn']]).variants[0].layers
  expect(layers.map(layer => Math.round((layer.offset ?? 0) * 1000) / 1000)).toEqual([0, 0.4, 0.42, 1.2, 1.22])
})

it('registers each reload timing once', () => {
  const soundscape = fakeSoundscape()
  const audio = createRangeAudio(soundscape)
  for (let index = 0; index < 3; index++) audio.reload('pistol', [[0.4, 'magazineOut']])
  expect(soundscape.registerCue).toHaveBeenCalledTimes(1)
})
