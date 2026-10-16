import { afterEach, expect, it, vi } from 'vitest'
import { createRangeAudio } from './audio'

const parameter = () => ({ value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() })
const source = () => {
  const node = {
    gain: parameter(), frequency: parameter(), Q: parameter(), pan: parameter(), playbackRate: parameter(),
    threshold: parameter(), ratio: parameter(), attack: parameter(), release: parameter(),
    connect: vi.fn(() => node), start: vi.fn(), stop: vi.fn(),
  }
  return node
}

function mockAudio() {
  const sources: ReturnType<typeof source>[] = []
  vi.stubGlobal('AudioContext', class {
    state = 'running'
    currentTime = 1
    sampleRate = 1000
    destination = source()
    resume = vi.fn()
    createDynamicsCompressor = source
    createGain = source
    createConvolver = source
    createBiquadFilter = source
    createStereoPanner = source
    createBuffer = (_channels: number, length: number) => ({ getChannelData: () => new Float32Array(length) })
    createBufferSource() { const node = source(); sources.push(node); return node }
    createOscillator() { const node = source(); sources.push(node); return node }
  })
  return sources
}

afterEach(() => vi.unstubAllGlobals())

it('stops the old magazine and rack sounds when a reload is cancelled without muting the new equip', () => {
  const sources = mockAudio()
  const audio = createRangeAudio()
  audio.start()
  audio.reload('rifle', [[0.5, 'magazineOut'], [1.28, 'magazineIn'], [1.68, 'rackBack'], [1.78, 'rackForward']])
  const reload = [...sources]
  audio.equip()
  const equip = sources.slice(reload.length)
  audio.cancelReload()
  expect(reload.length).toBeGreaterThan(4)
  expect(reload.every(node => node.stop.mock.calls.length === 1)).toBe(true)
  expect(equip.every(node => node.stop.mock.calls.length === 0)).toBe(true)
})

it('caps synthesized voices during sustained fire and overlapping steel tails', () => {
  const sources = mockAudio()
  const audio = createRangeAudio()
  audio.start()
  for (let index = 0; index < 20; index++) { audio.shot('rifle'); audio.steel(1, 1, 10, 0) }
  expect(audio.sample().voices).toBeLessThanOrEqual(32)
  expect(sources.filter(node => node.stop.mock.calls.some(call => call.length === 0)).length).toBeGreaterThan(0)
})
