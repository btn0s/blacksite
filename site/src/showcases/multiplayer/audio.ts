let context: AudioContext | null = null
let noise: AudioBuffer | null = null

function audio() {
  if (context) return context
  if (typeof AudioContext === 'undefined') return null
  context = new AudioContext()
  noise = context.createBuffer(1, Math.floor(context.sampleRate * 0.4), context.sampleRate)
  const data = noise.getChannelData(0)
  for (let index = 0; index < data.length; index++) data[index] = (Math.random() * 2 - 1) * Math.pow(1 - index / data.length, 2.2)
  return context
}

export function unlockAudio() {
  const ctx = audio()
  if (ctx?.state === 'suspended') void ctx.resume()
}

export function playShot(distance: number, pistol: boolean) {
  const ctx = context
  if (!ctx || ctx.state !== 'running' || !noise) return
  const gain = Math.min(0.5, 0.5 / Math.max(1, distance / 4))
  if (gain < 0.01) return
  const source = ctx.createBufferSource()
  source.buffer = noise
  source.playbackRate.value = (pistol ? 1.25 : 0.95) + Math.random() * 0.1
  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = Math.max(700, 5200 - distance * 120)
  const volume = ctx.createGain()
  volume.gain.setValueAtTime(gain, ctx.currentTime)
  volume.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.32)
  source.connect(filter).connect(volume).connect(ctx.destination)
  source.start()
}

export function playTick(kill: boolean) {
  const ctx = context
  if (!ctx || ctx.state !== 'running') return
  const oscillator = ctx.createOscillator()
  oscillator.type = 'square'
  oscillator.frequency.value = kill ? 520 : 1750
  const volume = ctx.createGain()
  volume.gain.setValueAtTime(kill ? 0.12 : 0.07, ctx.currentTime)
  volume.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (kill ? 0.22 : 0.06))
  oscillator.connect(volume).connect(ctx.destination)
  oscillator.start()
  oscillator.stop(ctx.currentTime + 0.25)
}
