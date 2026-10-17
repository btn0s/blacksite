#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LUMA = [0.2126, 0.7152, 0.0722]

export const LUT_PRESETS = {
  zone: {
    title: 'Zone grade',
    shadow: [0.9, 0.99, 0.97],
    mid: [1.02, 1.01, 0.88],
    high: [1.05, 1.02, 0.86],
    saturation: [0.62, 0.14, 0.12],
    toe: 0.028,
    warmGreen: 0.06,
    contrast: 0.12,
  },
  haze: {
    title: 'Haze grade',
    shadow: [0.8, 0.96, 0.92],
    mid: [1.05, 1.02, 0.86],
    high: [1.1, 1.02, 0.8],
    saturation: [0.74, 0.14, 0.2],
    toe: 0.012,
    warmGreen: 0.08,
    contrast: 0.3,
  },
  nature: {
    title: 'Nature grade',
    shadow: [1.08, 1.02, 0.82],
    mid: [1.08, 1.03, 0.82],
    high: [1.08, 1.04, 0.86],
    saturation: [0.62, 0.06, 0.06],
    toe: 0.06,
    warmGreen: 0,
    olive: 0.5,
    contrast: -0.04,
  },
}

const smoothstep = (edge0, edge1, x) => {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

const clamp01 = value => Math.min(1, Math.max(0, value))

export function grade(preset, rgb) {
  const luma = rgb[0] * LUMA[0] + rgb[1] * LUMA[1] + rgb[2] * LUMA[2]
  const shadow = 1 - smoothstep(0, 0.42, luma)
  const high = smoothstep(0.5, 1, luma)
  const mid = clamp01(1 - shadow - high)
  const warmth = clamp01((rgb[0] - rgb[2]) * 3)
  const [base, midBoost, warmBoost] = preset.saturation
  const saturation = base + midBoost * mid + warmBoost * warmth
  const out = rgb.map((channel, i) => (luma + (channel - luma) * saturation) * (shadow * preset.shadow[i] + mid * preset.mid[i] + high * preset.high[i]))
  out[1] += Math.max(0, out[0] - out[2]) * preset.warmGreen
  out[0] += Math.max(0, out[1] - Math.max(out[0], out[2])) * (preset.olive ?? 0)
  const shoulder = 0.96
  return out.map(channel => {
    let value = preset.toe + (1 - preset.toe) * channel
    value += preset.contrast * (value - 0.5) * (1 - Math.abs(value - 0.5) * 2)
    if (value > 0.8) value = 0.8 + (shoulder - 0.8) * Math.tanh((value - 0.8) / (shoulder - 0.8))
    return clamp01(value)
  })
}

export function cube(name, size = 33) {
  const preset = LUT_PRESETS[name]
  if (!preset) throw new Error(`Unknown LUT preset "${name}". Choose ${Object.keys(LUT_PRESETS).join(', ')}.`)
  const lines = [`TITLE "Blacksite - ${preset.title}"`, `LUT_3D_SIZE ${size}`, 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0']
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const [or, og, ob] = grade(preset, [r / (size - 1), g / (size - 1), b / (size - 1)])
        lines.push(`${or.toFixed(5)} ${og.toFixed(5)} ${ob.toFixed(5)}`)
      }
    }
  }
  return `${lines.join('\n')}\n`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const names = process.argv[2] && process.argv[2] !== 'all' ? [process.argv[2]] : Object.keys(LUT_PRESETS)
  const size = process.argv[3] ? Number(process.argv[3]) : 33
  for (const name of names) {
    const out = resolve(ROOT, 'luts', `${name}.cube`)
    mkdirSync(dirname(out), { recursive: true })
    writeFileSync(out, cube(name, size))
    console.log(`wrote ${out} (${size}^3)`)
  }
}
