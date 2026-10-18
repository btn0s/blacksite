import type { Program, Step } from './graph'

export type Img = { readonly w: number; readonly h: number; readonly data: Float32Array }

export const image = (w: number, h: number): Img => ({ w, h, data: new Float32Array(w * h * 4) })

export function hash3(x: number, y: number, s: number) {
  let h = Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(s | 0, 0xcb1ab31f)
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d)
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b)
  h ^= h >>> 16
  return (h >>> 8) / 16777216
}

const TAU = 6.283185307179586
const mod = (a: number, n: number) => ((a % n) + n) % n
const clamp = (v: number, lo = 0, hi = 1) => v < lo ? lo : v > hi ? hi : v
const fract = (v: number) => v - Math.floor(v)
const smooth = (e0: number, e1: number, x: number) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t) }
const quintic = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)

function fetch(img: Img, x: number, y: number, c: number) {
  const xi = mod(x, img.w)
  const yi = mod(y, img.h)
  return img.data[(yi * img.w + xi) * 4 + c]!
}

function bilinear(img: Img, fx: number, fy: number, c: number) {
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const a = fetch(img, x0, y0, c)
  const b = fetch(img, x0 + 1, y0, c)
  const d = fetch(img, x0, y0 + 1, c)
  const e = fetch(img, x0 + 1, y0 + 1, c)
  return (a + (b - a) * tx) + ((d + (e - d) * tx) - (a + (b - a) * tx)) * ty
}

const sampleUV = (img: Img, u: number, v: number, c: number) => bilinear(img, u * img.w - 0.5, v * img.h - 0.5, c)

function valueNoise(x: number, y: number, px: number, py: number, seed: number) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const ux = quintic(x - ix)
  const uy = quintic(y - iy)
  const i0 = mod(ix, px), i1 = mod(ix + 1, px), j0 = mod(iy, py), j1 = mod(iy + 1, py)
  const a = hash3(i0, j0, seed), b = hash3(i1, j0, seed), c = hash3(i0, j1, seed), d = hash3(i1, j1, seed)
  return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy
}

function gradientDot(i: number, j: number, seed: number, dx: number, dy: number) {
  const angle = hash3(i, j, seed) * TAU
  return Math.cos(angle) * dx + Math.sin(angle) * dy
}

function perlinNoise(x: number, y: number, px: number, py: number, seed: number) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const i0 = mod(ix, px), i1 = mod(ix + 1, px), j0 = mod(iy, py), j1 = mod(iy + 1, py)
  const a = gradientDot(i0, j0, seed, fx, fy)
  const b = gradientDot(i1, j0, seed, fx - 1, fy)
  const c = gradientDot(i0, j1, seed, fx, fy - 1)
  const d = gradientDot(i1, j1, seed, fx - 1, fy - 1)
  const ux = quintic(fx)
  const uy = quintic(fy)
  const n = (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uy
  return clamp(0.5 + n * 0.70710678)
}

function cellularNoise(x: number, y: number, px: number, py: number, seed: number, jitter: number, mode: number) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  let f1 = 8, f2 = 8, id = 0
  for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
    const cx = ix + di
    const cy = iy + dj
    const wx = mod(cx, px)
    const wy = mod(cy, py)
    const fx = cx + 0.5 + jitter * (hash3(wx, wy, seed) - 0.5)
    const fy = cy + 0.5 + jitter * (hash3(wx, wy, seed + 1) - 0.5)
    const d = Math.hypot(x - fx, y - fy)
    if (d < f1) { f2 = f1; f1 = d; id = hash3(wx, wy, seed + 2) }
    else if (d < f2) f2 = d
  }
  if (mode === 0) return clamp(f1)
  if (mode === 1) return clamp(f2 * 0.8)
  if (mode === 2) return clamp((f2 - f1) * 1.6)
  return id
}

type Kernel = (out: Img, p: Float32Array, inputs: Img[], step: Step, extra: Extra) => void
type Extra = { images: ReadonlyMap<string, Img> }

function perPixel(out: Img, fn: (u: number, v: number, x: number, y: number) => [number, number, number, number] | number) {
  const { w, h, data } = out
  for (let y = 0; y < h; y++) {
    const v = (y + 0.5) / h
    for (let x = 0; x < w; x++) {
      const r = fn((x + 0.5) / w, v, x, y)
      const i = (y * w + x) * 4
      if (typeof r === 'number') { data[i] = r; data[i + 1] = r; data[i + 2] = r; data[i + 3] = 1 }
      else { data[i] = r[0]; data[i + 1] = r[1]; data[i + 2] = r[2]; data[i + 3] = r[3] }
    }
  }
}

function gridMean(img: Img, c: number) {
  let sum = 0
  for (let j = 0; j < 16; j++) for (let i = 0; i < 16; i++) sum += fetch(img, Math.floor((i + 0.5) * img.w / 16), Math.floor((j + 0.5) * img.h / 16), c)
  return sum / 256
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d > 1e-6) {
    if (max === r) h = ((g - b) / d) / 6
    else if (max === g) h = ((b - r) / d + 2) / 6
    else h = ((r - g) / d + 4) / 6
  }
  return [fract(h), max > 1e-6 ? d / max : 0, max]
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const f = (n: number) => { const k = mod(n + h * 6, 6); return v - v * s * clamp(Math.min(k, 4 - k)) }
  return [f(5), f(3), f(1)]
}

function blendOne(mode: number, a: number, b: number) {
  switch (mode) {
    case 0: return b
    case 1: return a + b
    case 2: return a - b
    case 3: return a * b
    case 4: return 1 - (1 - a) * (1 - b)
    case 5: return a < 0.5 ? 2 * a * b : 1 - 2 * (1 - a) * (1 - b)
    case 6: return Math.max(a, b)
    case 7: return Math.min(a, b)
    case 8: return Math.abs(a - b)
    default: return a - b + 0.5
  }
}

function lobe(theta: number, h5: number, h6: number) {
  return 1 + 0.22 * Math.sin(2 * theta + TAU * h5) + 0.12 * Math.sin(3 * theta + TAU * h6) + 0.08 * Math.sin(5 * theta + TAU * (h5 + h6)) + 0.05 * Math.sin(7 * theta + TAU * h6 * 2.3)
}

export const KERNELS: Record<Step['kernel'], Kernel> = {
  const(out, p) { perPixel(out, () => [p[0]!, p[1]!, p[2]!, p[3]!]) },

  noise(out, p) {
    const [basis, px, py, seed, octaves, gain, ridged, sharpness, mode, jitter] = p as unknown as number[] as [number, number, number, number, number, number, number, number, number, number]
    perPixel(out, (u, v) => {
      let sum = 0, norm = 0, amp = 1
      for (let o = 0; o < octaves; o++) {
        const f = 2 ** o
        const s = (seed + o * 1013) & 0xffffff
        const x = u * px * f, y = v * py * f
        let n = basis === 0 ? valueNoise(x, y, px * f, py * f, s) : basis === 1 ? perlinNoise(x, y, px * f, py * f, s) : cellularNoise(x, y, px * f, py * f, s, jitter, mode)
        if (ridged > 0) n = (1 - Math.abs(2 * n - 1)) ** sharpness
        sum += n * amp
        norm += amp
        amp *= gain
      }
      return sum / norm
    })
  },

  wave(out, p) {
    const [axis, cycles, shape, phase] = p as unknown as [number, number, number, number]
    perPixel(out, (u, v) => {
      const t = (axis === 0 ? u : v) * cycles + phase
      if (shape === 0) return 0.5 + 0.5 * Math.sin(TAU * t)
      if (shape === 1) return 1 - Math.abs(2 * fract(t) - 1)
      return fract(t)
    })
  },

  tiles(out, p) {
    const [cols, rows, gap, bevel, offset, offsetJitter, lengthJitter, jitter, seed, output, size, pixel] = p as unknown as number[] as [number, number, number, number, number, number, number, number, number, number, number, number]
    const boundary = (k: number, row: number) => lengthJitter > 0 ? k + lengthJitter * (hash3(mod(k, cols), row, seed + 7) - 0.5) : k
    perPixel(out, (u, v) => {
      const gy = v * rows
      const row = Math.floor(gy)
      const fy = gy - row
      const rowW = mod(row, rows)
      const gx = u * cols + offset * rowW + offsetJitter * hash3(rowW, 0, seed)
      let col = Math.floor(gx)
      if (gx < boundary(col, rowW)) col -= 1
      else if (gx >= boundary(col + 1, rowW)) col += 1
      const left = boundary(col, rowW)
      const right = boundary(col + 1, rowW)
      const cellW = size / cols
      const cellH = size / rows
      const dx = Math.min(gx - left, right - gx) * cellW
      const dy = Math.min(fy, 1 - fy) * cellH
      const d = Math.min(dx, dy) - gap / 2
      const r = hash3(mod(col, cols), rowW, seed + 3)
      if (output === 1) return r
      if (output === 2) return clamp(d / pixel + 0.5)
      if (output === 3) return clamp(d / (0.5 * Math.min((right - left) * cellW, cellH)))
      const b = clamp(d / bevel)
      return b * (2 - b) * (1 - jitter * r)
    })
  },

  rivets(out, p) {
    const [cols, rows, radius, offsetU, offsetV, size, pixel, output] = p as unknown as number[] as [number, number, number, number, number, number, number, number]
    perPixel(out, (u, v) => {
      const gx = u * cols - offsetU
      const gy = v * rows - offsetV
      const dx = (fract(gx) - 0.5) * size / cols
      const dy = (fract(gy) - 0.5) * size / rows
      const dist = Math.hypot(dx, dy)
      const d = dist / radius
      const aa = clamp((radius - dist) / pixel + 0.5)
      if (output === 1) return hash3(mod(Math.floor(gx), cols), mod(Math.floor(gy), rows), 11)
      if (output === 2) return aa
      if (output === 3) return Math.min(1, d)
      return Math.sqrt(Math.max(0, 1 - d * d)) * aa
    })
  },

  scatter(out, p) {
    const [cols, rows, radius, sizeJitter, density, shape, rotate, seed, output, size, pixel, stretch] = p as unknown as number[] as [number, number, number, number, number, number, number, number, number, number, number, number]
    const reachX = p[12]!, reachY = p[13]!
    perPixel(out, (u, v) => {
      const gx = u * cols
      const gy = v * rows
      const ix = Math.floor(gx)
      const iy = Math.floor(gy)
      let height = 0, dist = 1, rand = 0, mask = 0
      for (let dj = -reachY; dj <= reachY; dj++) for (let di = -reachX; di <= reachX; di++) {
        const cx = ix + di
        const cy = iy + dj
        const wx = mod(cx, cols)
        const wy = mod(cy, rows)
        if (hash3(wx, wy, seed) >= density) continue
        const r = radius * (1 - sizeJitter * hash3(wx, wy, seed + 3))
        let qx = (gx - cx - hash3(wx, wy, seed + 1)) * size / cols
        let qy = (gy - cy - hash3(wx, wy, seed + 2)) * size / rows
        if (rotate > 0) {
          const a = hash3(wx, wy, seed + 4) * TAU
          const ca = Math.cos(a), sa = Math.sin(a)
          const rx = qx * ca - qy * sa
          qy = qx * sa + qy * ca
          qx = rx
        }
        qy /= shape === 4 ? 4 * stretch : stretch
        let d = Math.hypot(qx, qy) / r
        if (shape === 2 || shape === 3) d /= lobe(Math.atan2(qy, qx), hash3(wx, wy, seed + 5), hash3(wx, wy, seed + 6))
        const edge = clamp((1 - d) * r / pixel + 0.5)
        mask = Math.max(mask, edge)
        const value = shape === 0 ? edge : shape === 1 ? clamp(1 - d) : shape === 2 ? edge * (0.6 + 0.4 * clamp(1 - d)) : smooth(1, 0, d)
        if (value > height) height = value
        if (d < dist) { dist = d; rand = hash3(wx, wy, seed + 9) }
      }
      if (output === 1) return rand
      if (output === 2) return mask
      if (output === 3) return Math.min(1, dist)
      return height
    })
  },

  image(out, p, _inputs, step, extra) {
    const [ru, rv] = p as unknown as [number, number]
    let src = extra.images.get(step.image!)
    if (!src) throw new Error(`image "${step.image}" was not provided`)
    while (src.w * ru >= out.w * 2 && src.h * rv >= out.h * 2) src = downsample(src)
    const s = src
    perPixel(out, (u, v) => [sampleUV(s, u * ru, v * rv, 0), sampleUV(s, u * ru, v * rv, 1), sampleUV(s, u * ru, v * rv, 2), 1])
  },

  warp(out, p, [input, by, byY]) {
    const [amount, size, vector] = p as unknown as [number, number, number]
    const pixel = size / out.w
    perPixel(out, (u, v, x, y) => {
      let ox: number, oy: number
      if (vector > 0) {
        ox = amount * (2 * fetch(by!, x, y, 0) - 1)
        oy = amount * (2 * fetch(byY!, x, y, 0) - 1)
      } else {
        const gx = (fetch(by!, x + 1, y, 0) - fetch(by!, x - 1, y, 0)) / (2 * pixel)
        const gy = (fetch(by!, x, y + 1, 0) - fetch(by!, x, y - 1, 0)) / (2 * pixel)
        const len = Math.hypot(gx, gy)
        const scale = len > 1e-9 ? amount * Math.min(1, len * amount) / len : 0
        ox = gx * scale
        oy = gy * scale
      }
      const su = u + ox / size, sv = v + oy / size
      return [sampleUV(input!, su, sv, 0), sampleUV(input!, su, sv, 1), sampleUV(input!, su, sv, 2), sampleUV(input!, su, sv, 3)]
    })
  },

  blurPass(out, p, [input]) {
    const [axis, sigma, taps] = p as unknown as [number, number, number]
    const weights: number[] = []
    let total = 0
    for (let i = -taps; i <= taps; i++) { const wgt = Math.exp(-(i * i) / (2 * sigma * sigma)); weights.push(wgt); total += wgt }
    const { w, h, data } = out
    const src = input!.data
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let i = -taps; i <= taps; i++) {
        const sx = axis === 0 ? mod(x + i, w) : x
        const sy = axis === 0 ? y : mod(y + i, h)
        const j = (sy * w + sx) * 4
        const wgt = weights[i + taps]!
        r += src[j]! * wgt; g += src[j + 1]! * wgt; b += src[j + 2]! * wgt; a += src[j + 3]! * wgt
      }
      const o = (y * w + x) * 4
      data[o] = r / total; data[o + 1] = g / total; data[o + 2] = b / total; data[o + 3] = a / total
    }
  },

  slopeBlur(out, p, [input, slope]) {
    const [step, samples, mode] = p as unknown as [number, number, number]
    perPixel(out, (_u, _v, x, y) => {
      let fx = x, fy = y
      const acc = [0, 1, 2, 3].map(c => bilinear(input!, fx, fy, c))
      for (let s = 1; s <= samples; s++) {
        const gx = bilinear(slope!, fx + 1, fy, 0) - bilinear(slope!, fx - 1, fy, 0)
        const gy = bilinear(slope!, fx, fy + 1, 0) - bilinear(slope!, fx, fy - 1, 0)
        const len = Math.hypot(gx, gy)
        if (len > 1e-6) { fx -= gx / len * step; fy -= gy / len * step }
        for (let c = 0; c < 4; c++) {
          const value = bilinear(input!, fx, fy, c)
          acc[c] = mode === 0 ? acc[c]! + value : mode === 1 ? Math.min(acc[c]!, value) : Math.max(acc[c]!, value)
        }
      }
      return mode === 0 ? acc.map(value => value / (samples + 1)) as [number, number, number, number] : acc as [number, number, number, number]
    })
  },

  levels(out, p, [input]) {
    const [lo, hi, gamma, outLow, outHigh] = p as unknown as [number, number, number, number, number]
    const range = Math.abs(hi - lo) < 1e-6 ? (hi >= lo ? 1e-6 : -1e-6) : hi - lo
    const f = (x: number) => outLow + Math.pow(clamp((x - lo) / range), 1 / gamma) * (outHigh - outLow)
    perPixel(out, (_u, _v, x, y) => [f(fetch(input!, x, y, 0)), f(fetch(input!, x, y, 1)), f(fetch(input!, x, y, 2)), fetch(input!, x, y, 3)])
  },

  curvature(out, p, [input]) {
    const [radius, scale] = p as unknown as [number, number]
    perPixel(out, (_u, _v, x, y) => {
      let sum = 0
      for (let k = 0; k < 8; k++) {
        const a = (k + 0.5) * TAU / 8
        const ca = Math.cos(a), sa = Math.sin(a)
        sum += bilinear(input!, x + ca * radius, y + sa * radius, 0) + bilinear(input!, x + ca * radius * 0.5, y + sa * radius * 0.5, 0)
      }
      return 0.5 + 0.5 * clamp((fetch(input!, x, y, 0) - sum / 16) * scale, -1, 1)
    })
  },

  normal(out, p, [input, base]) {
    const [scale, based] = p as unknown as [number, number]
    perPixel(out, (_u, _v, x, y) => {
      let dx = (fetch(input!, x + 1, y, 0) - fetch(input!, x - 1, y, 0)) * scale
      let dy = (fetch(input!, x, y + 1, 0) - fetch(input!, x, y - 1, 0)) * scale
      if (based > 0) {
        const bz = Math.max(2 * fetch(base!, x, y, 2) - 1, 0.05)
        dx -= (2 * fetch(base!, x, y, 0) - 1) / bz
        dy -= (2 * fetch(base!, x, y, 1) - 1) / bz
      }
      const len = Math.hypot(dx, dy, 1)
      return [0.5 - 0.5 * dx / len, 0.5 - 0.5 * dy / len, 0.5 + 0.5 / len, 1]
    })
  },

  ao(out, p, [input]) {
    const [radius, depth, strength] = p as unknown as [number, number, number]
    const steps = 6
    perPixel(out, (_u, _v, x, y) => {
      const h0 = fetch(input!, x, y, 0)
      let occlusion = 0
      for (let k = 0; k < 8; k++) {
        const a = (k + 0.5) * TAU / 8
        const ca = Math.cos(a), sa = Math.sin(a)
        let best = 0
        for (let s = 1; s <= steps; s++) {
          const t = radius * s / steps
          const tan = (bilinear(input!, x + ca * t, y + sa * t, 0) - h0) * depth / t
          if (tan > best) best = tan
        }
        occlusion += best / Math.sqrt(1 + best * best)
      }
      return clamp(1 - strength * occlusion / 8)
    })
  },

  blend(out, p, [a, b, mask]) {
    const [mode, opacity, masked] = p as unknown as [number, number, number]
    perPixel(out, (_u, _v, x, y) => {
      const t = opacity * (masked > 0 ? fetch(mask!, x, y, 0) : 1)
      const r: [number, number, number, number] = [0, 0, 0, fetch(a!, x, y, 3)]
      for (let c = 0; c < 3; c++) { const va = fetch(a!, x, y, c); r[c] = va + (blendOne(mode, va, fetch(b!, x, y, c)) - va) * t }
      return r
    })
  },

  ramp(out, p, [input], step) {
    const count = p[0]!
    const stops = step.stops!
    perPixel(out, (_u, _v, x, y) => {
      const t = clamp(fetch(input!, x, y, 0))
      if (t <= stops[0]!) return [stops[1]!, stops[2]!, stops[3]!, 1]
      for (let i = 1; i < count; i++) {
        const p1 = stops[i * 4]!
        if (t <= p1) {
          const p0 = stops[(i - 1) * 4]!
          const f = p1 > p0 ? (t - p0) / (p1 - p0) : 1
          return [0, 1, 2].map(c => stops[(i - 1) * 4 + 1 + c]! + (stops[i * 4 + 1 + c]! - stops[(i - 1) * 4 + 1 + c]!) * f).concat(1) as [number, number, number, number]
        }
      }
      const last = (count - 1) * 4
      return [stops[last + 1]!, stops[last + 2]!, stops[last + 3]!, 1]
    })
  },

  hsv(out, p, [input]) {
    const [hue, saturation, value] = p as unknown as [number, number, number]
    perPixel(out, (_u, _v, x, y) => {
      const [h, s, v] = rgbToHsv(fetch(input!, x, y, 0), fetch(input!, x, y, 1), fetch(input!, x, y, 2))
      const [r, g, b] = hsvToRgb(fract(h + hue), clamp(s * saturation), Math.max(0, v * value))
      return [r, g, b, fetch(input!, x, y, 3)]
    })
  },

  channel(out, p, [input]) {
    const channel = p[0]!
    perPixel(out, (_u, _v, x, y) => channel < 4 ? fetch(input!, x, y, channel) : 0.2126 * fetch(input!, x, y, 0) + 0.7152 * fetch(input!, x, y, 1) + 0.0722 * fetch(input!, x, y, 2))
  },

  transform(out, p, [input]) {
    const [repeat, offsetU, offsetV, rotate, flip] = p as unknown as [number, number, number, number, number]
    perPixel(out, (u, v) => {
      let su = flip > 0 ? 1 - u : u, sv = v
      for (let k = 0; k < rotate; k++) { const t = su; su = 1 - sv; sv = t }
      su = su * repeat + offsetU
      sv = sv * repeat + offsetV
      return [sampleUV(input!, su, sv, 0), sampleUV(input!, su, sv, 1), sampleUV(input!, su, sv, 2), sampleUV(input!, su, sv, 3)]
    })
  },

  seamlessPass(out, p, [input]) {
    const [axis, width] = p as unknown as [number, number]
    const means = [0, 1, 2].map(c => gridMean(input!, c))
    perPixel(out, (u, v, x, y) => {
      const t = axis === 0 ? u : v
      const wgt = smooth(1 - 2 * width, 1, Math.abs(2 * t - 1))
      const norm = Math.sqrt((1 - wgt) ** 2 + wgt ** 2)
      const bx = axis === 0 ? x + (input!.w >> 1) : x
      const by = axis === 0 ? y : y + (input!.h >> 1)
      const r: [number, number, number, number] = [0, 0, 0, 1]
      for (let c = 0; c < 3; c++) {
        const m = means[c]!
        r[c] = m + ((1 - wgt) * (fetch(input!, x, y, c) - m) + wgt * (fetch(input!, bx, by, c) - m)) / norm
      }
      return r
    })
  },

  delight(out, p, [input, low]) {
    const strength = p[0]!
    const mean = gridMean(low!, 0)
    perPixel(out, (_u, _v, x, y) => {
      const f = mean / Math.max(fetch(low!, x, y, 0), 0.02)
      const r: [number, number, number, number] = [0, 0, 0, 1]
      for (let c = 0; c < 3; c++) { const a = fetch(input!, x, y, c); r[c] = a + (a * f - a) * strength }
      return r
    })
  },

  pack(out, p, inputs) {
    const read = (i: number, x: number, y: number) => {
      const c = p[i]!
      if (c > 4) return 1
      const img = inputs[i]!
      return clamp(c === 4 ? 0.2126 * fetch(img, x, y, 0) + 0.7152 * fetch(img, x, y, 1) + 0.0722 * fetch(img, x, y, 2) : fetch(img, x, y, c))
    }
    perPixel(out, (_u, _v, x, y) => [read(0, x, y), read(1, x, y), read(2, x, y), read(3, x, y)])
  },
}

export function downsample(src: Img): Img {
  const w = src.w >> 1, h = src.h >> 1
  const out = image(w, h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 4; c++) {
    out.data[(y * w + x) * 4 + c] = (fetch(src, 2 * x, 2 * y, c) + fetch(src, 2 * x + 1, 2 * y, c) + fetch(src, 2 * x, 2 * y + 1, c) + fetch(src, 2 * x + 1, 2 * y + 1, c)) / 4
  }
  return out
}

export type CpuResult = { readonly color: Img; readonly normal: Img; readonly orm: Img; readonly masks: Img; readonly timings: ReadonlyMap<string, number> }

export function evaluate(program: Program, images: ReadonlyMap<string, Img> = new Map(), keep: readonly string[] = []): CpuResult & { readonly kept: ReadonlyMap<string, Img> } {
  const results = new Map<string, Img>()
  const lastUse = new Map<string, number>()
  program.steps.forEach((step, index) => step.inputs.forEach(id => lastUse.set(id, index)))
  const roots = new Set([...Object.values(program.outputs), ...keep])
  const timings = new Map<string, number>()
  const kept = new Map<string, Img>()
  program.steps.forEach((step, index) => {
    const start = performance.now()
    const out = image(program.res, program.res)
    KERNELS[step.kernel](out, step.params, step.inputs.map(id => results.get(id)!), step, { images })
    results.set(step.id, out)
    timings.set(step.kernel, (timings.get(step.kernel) ?? 0) + performance.now() - start)
    if (keep.includes(step.id)) kept.set(step.id, out)
    for (const id of step.inputs) if (lastUse.get(id) === index && !roots.has(id)) results.delete(id)
  })
  const o = program.outputs
  return { color: results.get(o.color)!, normal: results.get(o.normal)!, orm: results.get(o.orm)!, masks: results.get(o.masks)!, timings, kept }
}
