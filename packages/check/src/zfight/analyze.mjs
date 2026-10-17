const MIXED = 0xffffffff

export function analyzeFrames(frames, width, height, options = {}) {
  const radius = options.radius ?? 2
  const cells = (radius * 2 + 1) ** 2
  const densityMin = options.densityMin ?? Math.ceil(cells * 0.5)
  const total = width * height
  const first = frames[0]
  const unstable = new Uint8Array(total)
  let unstableCount = 0
  for (let p = 0; p < total; p++) {
    const base = first[p]
    let reference = base
    for (let f = 1; f < frames.length && reference === MIXED; f++) reference = frames[f][p]
    if (reference === MIXED) continue
    for (let f = 0; f < frames.length; f++) {
      const value = frames[f][p]
      if (value !== reference && value !== MIXED) { unstable[p] = 1; unstableCount++; break }
    }
  }
  const stride = width + 1
  const integral = new Int32Array(stride * (height + 1))
  for (let y = 0; y < height; y++) {
    let row = 0
    for (let x = 0; x < width; x++) {
      row += unstable[y * width + x]
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + row
    }
  }
  const dense = new Uint8Array(total)
  let denseCount = 0
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius)
    const y1 = Math.min(height, y + radius + 1)
    for (let x = 0; x < width; x++) {
      if (!unstable[y * width + x]) continue
      const x0 = Math.max(0, x - radius)
      const x1 = Math.min(width, x + radius + 1)
      const sum = integral[y1 * stride + x1] - integral[y0 * stride + x1] - integral[y1 * stride + x0] + integral[y0 * stride + x0]
      if (sum >= densityMin) { dense[y * width + x] = 1; denseCount++ }
    }
  }
  const labels = new Int32Array(total)
  const regions = []
  const pairs = new Map()
  const reach = options.link ?? 3
  const idsAt = p => {
    const counts = new Map()
    for (let f = 0; f < frames.length; f++) {
      const value = frames[f][p]
      if (value !== MIXED) counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(entry => entry[0])
  }
  for (let start = 0; start < total; start++) {
    if (!dense[start] || labels[start]) continue
    const label = regions.length + 1
    const stack = [start]
    labels[start] = label
    let minX = width, minY = height, maxX = 0, maxY = 0, pixels = 0
    const local = new Map()
    while (stack.length) {
      const p = stack.pop()
      const x = p % width
      const y = (p - x) / width
      pixels++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      const ids = idsAt(p)
      if (ids.length >= 2) {
        const key = ids[0] < ids[1] ? `${ids[0]},${ids[1]}` : `${ids[1]},${ids[0]}`
        local.set(key, (local.get(key) ?? 0) + 1)
        pairs.set(key, (pairs.get(key) ?? 0) + 1)
      }
      for (let dy = -reach; dy <= reach; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -reach; dx <= reach; dx++) {
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          const q = ny * width + nx
          if (dense[q] && !labels[q]) { labels[q] = label; stack.push(q) }
        }
      }
    }
    regions.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, pixels, ids: [...local.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([key, count]) => ({ pair: key.split(',').map(Number), pixels: count })) })
  }
  regions.sort((a, b) => b.pixels - a.pixels)
  return {
    width, height, frames: frames.length,
    unstable: unstableCount,
    pixels: denseCount,
    regions,
    pairs: [...pairs.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ pair: key.split(',').map(Number), pixels: count })),
  }
}

export function decodeIds(data, width, height, floats) {
  const ids = new Uint32Array(width * height)
  const scale = floats ? 255 : 1
  for (let row = 0; row < height; row++) {
    const source = (height - 1 - row) * width * 4
    const target = row * width
    for (let x = 0; x < width; x++) {
      const o = source + x * 4
      const r = data[o] * scale
      const g = data[o + 1] * scale
      const b = data[o + 2] * scale
      const rr = Math.round(r), gg = Math.round(g), bb = Math.round(b)
      if (floats && (Math.abs(r - rr) > 0.15 || Math.abs(g - gg) > 0.15 || Math.abs(b - bb) > 0.15)) ids[target + x] = MIXED
      else ids[target + x] = rr | (gg << 8) | (bb << 16)
    }
  }
  return ids
}
