export const DEPTH_FORMATS = {
  depth16: { bits: 16, float: false },
  depth24: { bits: 24, float: false },
  depth32f: { bits: 32, float: true },
}

const FLOAT_MANTISSA = 2 ** -23

export function normaliseDepth(setup = {}) {
  const format = setup.format ? DEPTH_FORMATS[setup.format] : null
  if (setup.format && !format) throw new Error(`Unknown depth format: ${setup.format}`)
  const near = setup.near ?? 0.1
  const far = setup.far ?? 1000
  if (!(near > 0) || !(far > near)) throw new Error(`Depth range must satisfy 0 < near < far, got near ${near} far ${far}`)
  return {
    near,
    far,
    bits: setup.bits ?? format?.bits ?? 24,
    float: setup.float ?? format?.float ?? false,
    reversed: setup.reversed ?? false,
    logarithmic: setup.logarithmic ?? false,
    orthographic: setup.orthographic ?? false,
  }
}

function ulpAt(value) {
  if (!(value > 0)) return FLOAT_MANTISSA
  return 2 ** (Math.floor(Math.log2(value)) - 23)
}

export function depthStep(input, z) {
  const setup = normaliseDepth(input)
  const { near, far } = setup
  const distance = Math.min(Math.max(z, near), far)
  const transform = Math.max(1, distance) * 2 ** -22
  let step
  if (setup.orthographic) {
    step = (far - near) * 2 ** -(setup.float ? 23 : setup.bits)
  } else if (setup.logarithmic) {
    step = (1 + distance) * Math.log(1 + far) * 2 ** -(setup.float ? 23 : setup.bits)
  } else if (setup.float) {
    const ratio = far / (far - near)
    const slope = (far * near) / ((far - near) * distance * distance)
    const value = setup.reversed ? Math.max(1e-30, near * (far - distance) / (distance * (far - near))) : ratio * (1 - near / distance)
    step = ulpAt(value) / slope
  } else {
    step = (2 ** -setup.bits) * ((far - near) / (far * near)) * distance * distance
  }
  return Math.max(step, transform)
}

export function gapNeeded(setup, z, safety = 2) {
  return depthStep(setup, z) * safety
}

export function describeDepth(input) {
  const setup = normaliseDepth(input)
  const kind = setup.orthographic ? 'orthographic' : setup.logarithmic ? 'logarithmic' : setup.reversed ? 'reversed' : 'standard'
  const format = setup.float ? `${setup.bits}-bit float` : `${setup.bits}-bit`
  return `${format} ${kind} depth, near ${roundMetres(setup.near)} m, far ${roundMetres(setup.far)} m`
}

export function farthestResolvable(setup, gap, safety = 2) {
  const normal = normaliseDepth(setup)
  let low = normal.near
  let high = normal.far
  if (gapNeeded(normal, high, safety) <= gap) return high
  if (gapNeeded(normal, low, safety) > gap) return 0
  for (let iteration = 0; iteration < 60; iteration++) {
    const mid = (low + high) / 2
    if (gapNeeded(normal, mid, safety) <= gap) low = mid
    else high = mid
  }
  return low
}

function roundMetres(value) {
  return Math.round(value * 1000) / 1000
}
