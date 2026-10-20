import type { ExposureSettings } from './film'

const BUCKETS = 64
const TRANSITION = 1.5
const FRAME = 1 / 60
const MIDDLE_GREY = Math.log2(0.18)

export class EyeAdaptation {
  private logWhite: number
  private initialised = false

  constructor(private readonly settings: ExposureSettings, initial: number) {
    this.logWhite = Math.log2(initial)
  }

  get scale() { return 2 ** (this.settings.bias - this.logWhite) }

  update(logLuminance: Float32Array, stride: number, seconds: number) {
    const [histogramMin, histogramMax] = this.settings.histogram
    const histogram = new Float64Array(BUCKETS)
    for (let index = 0; index < logLuminance.length; index += stride) {
      const bucket = Math.min(Math.max((logLuminance[index]! - histogramMin) / (histogramMax - histogramMin), 0), 1) * (BUCKETS - 1)
      const first = Math.min(Math.floor(bucket), BUCKETS - 1)
      const weight = bucket - Math.floor(bucket)
      if (first !== 0) histogram[first]! += 1 - weight
      histogram[Math.min(first + 1, BUCKETS - 1)]! += weight
    }
    let total = 0
    for (const value of histogram) total += value
    let lower = total * Math.min(this.settings.low, this.settings.high) / 100
    let upper = total * this.settings.high / 100
    let sum = 0
    let count = 0
    for (let bucket = 0; bucket < BUCKETS; bucket++) {
      let value = histogram[bucket]!
      const removed = Math.min(value, lower)
      value -= removed
      lower -= removed
      upper -= removed
      value = Math.min(value, upper)
      upper -= value
      sum += (histogramMin + bucket / (BUCKETS - 1) * (histogramMax - histogramMin)) * value
      count += value
    }
    const logTarget = count === 0 ? this.settings.min : Math.min(Math.max(sum / count - MIDDLE_GREY, this.settings.min), this.settings.max)
    if (!this.initialised) {
      this.initialised = true
      this.logWhite = logTarget
      return
    }
    const difference = logTarget - this.logWhite
    const speed = difference > 0 ? this.settings.speedUp : this.settings.speedDown
    const modifier = FRAME / ((1 - 2 ** (-FRAME * speed)) * (TRANSITION / Math.max(speed, 0.001)))
    const linear = difference > 0 ? Math.min(logTarget, this.logWhite + seconds * speed) : Math.max(logTarget, this.logWhite - seconds * speed)
    const exponential = this.logWhite + difference * (1 - 2 ** (-seconds * speed)) * modifier
    this.logWhite = Math.min(Math.max(Math.abs(difference) > TRANSITION ? linear : exponential, this.settings.min), this.settings.max)
  }
}
