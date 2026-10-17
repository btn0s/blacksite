import { buildBVH, queryBVH, triangleBoxes } from './bvh.mjs'
import { depthStep, describeDepth, normaliseDepth } from './depth.mjs'
import { extractTriangles, labelOf } from './triangles.mjs'

const DEFAULTS = {
  safety: 2,
  maxAngle: 1,
  minPixels: 1,
  minArea: 0.0025,
  distance: undefined,
  viewport: { width: 1440, height: 900 },
  fov: 70,
}

function normal(positions, o, out, at) {
  const ax = positions[o], ay = positions[o + 1], az = positions[o + 2]
  const ux = positions[o + 3] - ax, uy = positions[o + 4] - ay, uz = positions[o + 5] - az
  const vx = positions[o + 6] - ax, vy = positions[o + 7] - ay, vz = positions[o + 8] - az
  let nx = uy * vz - uz * vy
  let ny = uz * vx - ux * vz
  let nz = ux * vy - uy * vx
  const length = Math.hypot(nx, ny, nz)
  if (length < 1e-12) { out[at] = 0; out[at + 1] = 0; out[at + 2] = 0; out[at + 3] = 0; return 0 }
  nx /= length; ny /= length; nz /= length
  out[at] = nx; out[at + 1] = ny; out[at + 2] = nz
  out[at + 3] = nx * ax + ny * ay + nz * az
  return length / 2
}

function area2(polygon) {
  let sum = 0
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    sum += a[0] * b[1] - b[0] * a[1]
  }
  return sum / 2
}

function clipTriangle(subject, clip) {
  const orientation = area2(clip) >= 0 ? 1 : -1
  let output = subject
  for (let i = 0; i < 3 && output.length; i++) {
    const a = clip[i]
    const b = clip[(i + 1) % 3]
    const input = output
    output = []
    const side = p => orientation * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]))
    for (let j = 0; j < input.length; j++) {
      const p = input[j]
      const q = input[(j + 1) % input.length]
      const sp = side(p)
      const sq = side(q)
      if (sp >= 0) output.push(p)
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq)
        output.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])
      }
    }
  }
  return output
}

function clipByValue(polygon, valueIndex) {
  if (!polygon.length) return polygon
  const output = []
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]
    const q = polygon[(i + 1) % polygon.length]
    const vp = p[valueIndex]
    const vq = q[valueIndex]
    if (vp >= 0) output.push(p)
    if ((vp >= 0) !== (vq >= 0)) {
      const t = vp / (vp - vq)
      output.push(p.map((value, k) => value + (q[k] - value) * t))
    }
  }
  return output
}

function polygonArea3(polygon) {
  let x = 0, y = 0, z = 0
  for (let i = 1; i + 1 < polygon.length; i++) {
    const a = polygon[0], b = polygon[i], c = polygon[i + 1]
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
    x += uy * vz - uz * vy
    y += uz * vx - ux * vz
    z += ux * vy - uy * vx
  }
  return Math.hypot(x, y, z) / 2
}

function centroid(polygon) {
  const c = [0, 0, 0]
  for (const p of polygon) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2] }
  return c.map(value => value / polygon.length)
}

function cameraFrame(camera, options) {
  const position = camera.position
  const target = camera.target
  let fx = target[0] - position[0], fy = target[1] - position[1], fz = target[2] - position[2]
  const fl = Math.hypot(fx, fy, fz) || 1
  fx /= fl; fy /= fl; fz /= fl
  let rx = fz, ry = 0, rz = -fx
  let rl = Math.hypot(rx, ry, rz)
  if (rl < 1e-6) { rx = 1; ry = 0; rz = 0; rl = 1 }
  rx /= rl; ry /= rl; rz /= rl
  const ux = ry * fz - rz * fy
  const uy = rz * fx - rx * fz
  const uz = rx * fy - ry * fx
  const fov = camera.fov ?? options.fov
  const aspect = camera.aspect ?? options.viewport.width / options.viewport.height
  const tanV = Math.tan((fov * Math.PI) / 360)
  return { name: camera.name ?? 'camera', position, f: [fx, fy, fz], r: [rx, ry, rz], u: [ux, uy, uz], tanV, tanH: tanV * aspect, near: camera.near, far: camera.far }
}

function toCamera(frame, p) {
  const dx = p[0] - frame.position[0], dy = p[1] - frame.position[1], dz = p[2] - frame.position[2]
  return [
    dx * frame.r[0] + dy * frame.r[1] + dz * frame.r[2],
    dx * frame.u[0] + dy * frame.u[1] + dz * frame.u[2],
    dx * frame.f[0] + dy * frame.f[1] + dz * frame.f[2],
  ]
}

function clipFrustum(polygon, frame, near, far) {
  const planes = [
    c => c[2] - near,
    c => far - c[2],
    c => frame.tanH * c[2] - c[0],
    c => frame.tanH * c[2] + c[0],
    c => frame.tanV * c[2] - c[1],
    c => frame.tanV * c[2] + c[1],
  ]
  let output = polygon.map(p => [p[0], p[1], p[2], p[3], ...toCamera(frame, p)])
  for (const plane of planes) {
    if (!output.length) break
    const input = output
    output = []
    for (let i = 0; i < input.length; i++) {
      const p = input[i]
      const q = input[(i + 1) % input.length]
      const vp = plane(p.slice(4))
      const vq = plane(q.slice(4))
      if (vp >= 0) output.push(p)
      if ((vp >= 0) !== (vq >= 0)) {
        const t = vp / (vp - vq)
        output.push(p.map((value, k) => value + (q[k] - value) * t))
      }
    }
  }
  return output
}

function screenArea(polygon, height, tanV) {
  const scale = height / (2 * tanV)
  const points = polygon.map(p => [p[4] / p[6] * scale, p[5] / p[6] * scale])
  return Math.abs(area2(points))
}

function evaluate(polygon, context) {
  const { setup, safety, frames, options, bias, distance } = context
  if (!frames.length) {
    const step = depthStep(setup, distance)
    const tolerance = safety * step
    const work = polygon.map(p => {
      const g = p[3] + bias * step
      return [p[0], p[1], p[2], g, tolerance - g, tolerance + g]
    })
    const fight = clipByValue(clipByValue(work, 4), 5)
    if (fight.length < 3) return { area: 0, pixels: 0, z: distance, step, polygon: [], camera: null, passes: false }
    const area = polygonArea3(fight)
    return { area, pixels: 0, z: distance, step, polygon: fight, camera: null, passes: area >= options.minArea }
  }
  let best = null
  for (const frame of frames) {
    const near = Math.max(frame.near ?? setup.near, setup.near)
    const far = Math.min(frame.far ?? setup.far, setup.far)
    const visible = clipFrustum(polygon, frame, near, far)
    if (visible.length < 3) continue
    const work = visible.map(p => {
      const step = depthStep(setup, p[6])
      const tolerance = safety * step
      const g = p[3] + bias * step
      return [p[0], p[1], p[2], g, p[4], p[5], p[6], tolerance - g, tolerance + g]
    })
    const fight = clipByValue(clipByValue(work, 7), 8)
    if (fight.length < 3) continue
    const pixels = screenArea(fight, options.viewport.height, frame.tanV)
    const z = Math.max(...fight.map(p => p[6]))
    if (!best || pixels > best.pixels) best = { area: polygonArea3(fight), pixels, z, step: depthStep(setup, z), polygon: fight, camera: frame.name, passes: pixels >= options.minPixels }
  }
  return best
}

export function lintTriangles(soup, input = {}) {
  const started = Date.now()
  const options = { ...DEFAULTS, ...input, viewport: { ...DEFAULTS.viewport, ...(input.viewport ?? {}) } }
  const setup = normaliseDepth(input.depth ?? input)
  const frames = (options.cameras ?? []).map(camera => cameraFrame(camera, options))
  const distance = options.distance ?? Math.min(setup.far, 100)
  const cosMax = Math.cos((options.maxAngle * Math.PI) / 180)
  const count = soup.count
  const positions = soup.positions
  const planes = new Float64Array(count * 4)
  const areas = new Float64Array(count)
  for (let t = 0; t < count; t++) areas[t] = normal(positions, t * 9, planes, t * 4)
  const reaches = new Float32Array(count)
  const boxes = triangleBoxes(positions, count, 0)
  const meshes = soup.meshes
  const groups = new Map()
  const stats = { triangles: count, meshes: meshes.length, candidates: 0, coplanar: 0, overlapping: 0, unseen: 0, pruned: 0, truncated: soup.truncated, sampledInstances: soup.sampledInstances, skipped: soup.skipped }
  for (let t = 0; t < count; t++) {
    if (areas[t] === 0) continue
    const o = t * 9
    const cx = (positions[o] + positions[o + 3] + positions[o + 6]) / 3
    const cy = (positions[o + 1] + positions[o + 4] + positions[o + 7]) / 3
    const cz = (positions[o + 2] + positions[o + 5] + positions[o + 8]) / 3
    const radius = Math.max(Math.hypot(positions[o] - cx, positions[o + 1] - cy, positions[o + 2] - cz), Math.hypot(positions[o + 3] - cx, positions[o + 4] - cy, positions[o + 5] - cz), Math.hypot(positions[o + 6] - cx, positions[o + 7] - cy, positions[o + 8] - cz))
    let z = distance
    if (frames.length) {
      let nearest = Infinity
      let farthest = 0
      for (const frame of frames) {
        const d = Math.hypot(cx - frame.position[0], cy - frame.position[1], cz - frame.position[2])
        nearest = Math.min(nearest, d - radius)
        farthest = Math.max(farthest, d + radius)
      }
      if (nearest > setup.far) { areas[t] = 0; stats.pruned++; continue }
      z = Math.min(setup.far, farthest)
    }
    reaches[t] = options.safety * depthStep(setup, z) * 1.01 + 1e-4
  }
  const bvh = buildBVH(boxes, count)
  for (let i = 0; i < count; i++) {
    if (areas[i] === 0) continue
    const mi = meshes[soup.owner[i]]
    const ni = i * 4
    const reach = reaches[i]
    queryBVH(bvh, boxes[i * 6] - reach, boxes[i * 6 + 1] - reach, boxes[i * 6 + 2] - reach, boxes[i * 6 + 3] + reach, boxes[i * 6 + 4] + reach, boxes[i * 6 + 5] + reach, j => {
      if (j <= i || areas[j] === 0) return
      stats.candidates++
      const mj = meshes[soup.owner[j]]
      if (options.ignore && options.ignore(mi, mj)) return
      const nj = j * 4
      const dot = planes[ni] * planes[nj] + planes[ni + 1] * planes[nj + 1] + planes[ni + 2] * planes[nj + 2]
      if (dot < 0 ? !(mi.doubleSided || mj.doubleSided) || -dot < cosMax : dot < cosMax) return
      const oi = i * 9
      const oj = j * 9
      let below = 0
      let above = 0
      let nearest = Infinity
      for (let k = 0; k < 3; k++) {
        const d = planes[ni] * positions[oj + k * 3] + planes[ni + 1] * positions[oj + k * 3 + 1] + planes[ni + 2] * positions[oj + k * 3 + 2] - planes[ni + 3]
        if (d < 0) below++
        else above++
        nearest = Math.min(nearest, Math.abs(d))
      }
      if ((below === 0 || above === 0) && nearest > Math.max(reach, reaches[j])) return
      stats.coplanar++
      const ax = Math.abs(planes[ni]) >= Math.abs(planes[ni + 1]) && Math.abs(planes[ni]) >= Math.abs(planes[ni + 2]) ? 0 : Math.abs(planes[ni + 1]) >= Math.abs(planes[ni + 2]) ? 1 : 2
      const u = (ax + 1) % 3
      const v = (ax + 2) % 3
      const project = (source, offset) => [[source[offset + u], source[offset + v]], [source[offset + 3 + u], source[offset + 3 + v]], [source[offset + 6 + u], source[offset + 6 + v]]]
      const shape = clipTriangle(project(positions, oj), project(positions, oi))
      if (shape.length < 3) return
      const flat = area2(shape)
      if (Math.abs(flat) < 1e-9) return
      const nk = planes[ni + ax]
      const nu = planes[ni + u]
      const nv = planes[ni + v]
      const di = planes[ni + 3]
      const njk = planes[nj + ax]
      if (Math.abs(njk) < 1e-6 || Math.abs(nk) < 1e-6) return
      const polygon = shape.map(point => {
        const zi = (di - nu * point[0] - nv * point[1]) / nk
        const zj = (planes[nj + 3] - planes[nj + u] * point[0] - planes[nj + v] * point[1]) / njk
        const world = [0, 0, 0]
        world[u] = point[0]; world[v] = point[1]; world[ax] = zi
        return [world[0], world[1], world[2], (zj - zi) * nk]
      })
      stats.overlapping++
      const biasI = -(mi.offsetUnits + mi.offsetFactor)
      const biasJ = -(mj.offsetUnits + mj.offsetFactor)
      const bias = biasJ - biasI
      const result = evaluate(polygon, { setup, safety: options.safety, frames, options, distance, bias })
      if (!result) { stats.unseen++; return }
      const overlap = polygonArea3(polygon)
      const fight = result.area
      const first = mi.index <= mj.index ? { mesh: mi, triangle: i } : { mesh: mj, triangle: j }
      const second = first.mesh === mi ? { mesh: mj, triangle: j } : { mesh: mi, triangle: i }
      const labelA = labelOf(soup, first.mesh, first.triangle)
      const labelB = labelOf(soup, second.mesh, second.triangle)
      const key = `${first.mesh.index}|${second.mesh.index}`
      let group = groups.get(key)
      if (!group) {
        group = { a: describeMesh(first.mesh), b: describeMesh(second.mesh), pairs: 0, fightPairs: 0, overlapArea: 0, fightArea: 0, pixels: 0, worst: null }
        groups.set(key, group)
      }
      group.pairs++
      group.overlapArea += overlap
      if (result.passes) {
        group.fightPairs++
        group.fightArea += fight
        group.pixels += result.pixels
        if (!group.worst || fight > group.worst.fightArea) {
          const gaps = polygon.map(p => Math.abs(p[3]))
          group.worst = {
            position: centroid(result.polygon).slice(0, 3).map(round),
            distance: round(result.z),
            camera: result.camera,
            gap: round(Math.min(...gaps)),
            fightArea: fight,
            needed: round(options.safety * result.step),
            labels: [labelA, labelB],
          }
        }
      }
    })
  }
  const problems = []
  for (const group of groups.values()) {
    if (!group.worst) continue
    problems.push({
      a: group.a, b: group.b,
      labels: group.worst.labels,
      position: group.worst.position,
      overlapArea: round(group.overlapArea),
      fightArea: round(group.fightArea),
      pixels: Math.round(group.pixels * 10) / 10,
      gap: group.worst.gap,
      gapNeeded: group.worst.needed,
      distance: group.worst.distance,
      camera: group.worst.camera,
      trianglePairs: group.fightPairs,
    })
  }
  problems.sort((x, y) => y.pixels - x.pixels || y.fightArea - x.fightArea)
  stats.ms = Date.now() - started
  return { pass: problems.length === 0, problems, stats, depth: describeDepth(setup), setup, safety: options.safety }
}

function describeMesh(mesh) {
  return { name: mesh.name, path: mesh.path, material: mesh.material, uuid: mesh.uuid }
}

function round(value) {
  return Math.round(value * 10000) / 10000
}

export function lintZFighting(root, options = {}) {
  const soup = extractTriangles(root, options)
  return lintTriangles(soup, options)
}

export function formatProblem(problem) {
  const name = (side, label) => `${side.name || side.path || side.uuid}${label ? `[${label}]` : ''}`
  const mm = value => value < 0.1 ? `${Math.round(value * 10000) / 10} mm` : `${Math.round(value * 100) / 100} m`
  const [x, y, z] = problem.position
  return `${name(problem.a, problem.labels?.[0])} and ${name(problem.b, problem.labels?.[1])} overlap ${problem.fightArea} m² at (${x}, ${y}, ${z}), ${mm(problem.gap)} apart; ${mm(problem.gapNeeded)} needed at ${problem.distance} m${problem.camera ? ` from ${problem.camera}` : ''}`
}

export function summarizeLint(report) {
  const lines = report.problems.map(problem => `zfight  ${formatProblem(problem)}`)
  lines.push(`${report.problems.length} z-fighting ${report.problems.length === 1 ? 'pair' : 'pairs'} in ${report.stats.triangles} triangles / ${report.stats.meshes} meshes (${report.depth}); ${report.stats.ms} ms`)
  return lines.join('\n')
}
