import * as THREE from 'three'

export type CoplanarMode = 'resolve' | 'throw' | 'ignore'

export type CoplanarOptions = {
  mode?: CoplanarMode
  minGap?: number
  separation?: number
  minArea?: number
}

export type CoplanarResolution = {
  moved: string
  other: string
  gap: number
  lift: number
  area: number
  at: [number, number, number]
}

export type FaceSource =
  | { kind: 'box'; label: string; size: [number, number, number]; position: THREE.Vector3; quaternion: THREE.Quaternion; geometry: THREE.BufferGeometry }
  | { kind: 'plane'; label: string; width: number; depth: number; position: THREE.Vector3; quaternion: THREE.Quaternion; geometry: THREE.BufferGeometry }

type Face = { source: FaceSource; axis: number; sign: number; normal: THREE.Vector3; center: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3; hu: number; hv: number; area: number }

const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]

function facesOf(source: FaceSource): Face[] {
  const frame = AXES.map(axis => axis.clone().applyQuaternion(source.quaternion))
  if (source.kind === 'plane') {
    const [u, normal, v] = frame
    return [{ source, axis: 1, sign: 1, normal: normal!, center: source.position.clone(), u: u!, v: v!, hu: source.width / 2, hv: source.depth / 2, area: source.width * source.depth }]
  }
  const faces: Face[] = []
  for (let axis = 0; axis < 3; axis++) for (const sign of [1, -1]) {
    const normal = frame[axis]!.clone().multiplyScalar(sign)
    const u = frame[(axis + 1) % 3]!
    const v = frame[(axis + 2) % 3]!
    const hu = source.size[(axis + 1) % 3]! / 2
    const hv = source.size[(axis + 2) % 3]! / 2
    faces.push({ source, axis, sign, normal, center: source.position.clone().addScaledVector(normal, source.size[axis]! / 2), u, v, hu, hv, area: hu * hv * 4 })
  }
  return faces
}

function overlapArea(a: Face, b: Face) {
  const project = (point: THREE.Vector3): [number, number] => {
    const offset = point.clone().sub(a.center)
    return [offset.dot(a.u), offset.dot(a.v)]
  }
  let polygon: [number, number][] = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([x, y]) => project(b.center.clone().addScaledVector(b.u, x * b.hu).addScaledVector(b.v, y * b.hv)))
  const clips: Array<(p: [number, number]) => number> = [p => a.hu - p[0], p => a.hu + p[0], p => a.hv - p[1], p => a.hv + p[1]]
  for (const inside of clips) {
    const input = polygon
    polygon = []
    for (let i = 0; i < input.length; i++) {
      const p = input[i]!
      const q = input[(i + 1) % input.length]!
      const vp = inside(p)
      const vq = inside(q)
      if (vp >= 0) polygon.push(p)
      if ((vp >= 0) !== (vq >= 0)) {
        const t = vp / (vp - vq)
        polygon.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t])
      }
    }
    if (!polygon.length) return 0
  }
  let sum = 0
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i]!
    const q = polygon[(i + 1) % polygon.length]!
    sum += p[0] * q[1] - q[0] * p[1]
  }
  return Math.abs(sum) / 2
}

function bounds(face: Face) {
  const box = new THREE.Box3()
  for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) box.expandByPoint(face.center.clone().addScaledVector(face.u, x * face.hu).addScaledVector(face.v, y * face.hv))
  return box
}

function push(source: FaceSource, face: Face, lift: number) {
  const offset = face.normal.clone().multiplyScalar(lift)
  const position = source.geometry.getAttribute('position') as THREE.BufferAttribute
  const point = new THREE.Vector3()
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i)
    if (source.kind === 'plane' || Math.abs(face.normal.dot(point.clone().sub(face.center))) < 1e-4) position.setXYZ(i, point.x + offset.x, point.y + offset.y, point.z + offset.z)
  }
  position.needsUpdate = true
  if (source.kind === 'box') {
    source.size[face.axis] += lift
    source.position.addScaledVector(face.normal, lift / 2)
  } else source.position.addScaledVector(face.normal, lift)
}

function sweep(sources: FaceSource[], options: CoplanarOptions) {
  const minGap = options.minGap ?? 0.01
  const separation = options.separation ?? 0.02
  const minArea = options.minArea ?? 0.0004
  const resolve = options.mode !== 'ignore' && options.mode !== 'throw'
  const reach = minGap + separation * 2
  const resolutions: CoplanarResolution[] = []
  const cell = 8
  const grid = new Map<string, Face[]>()
  const wide: Face[] = []
  const placed: Face[] = []
  const keysOf = (box: THREE.Box3) => {
    const x0 = Math.floor((box.min.x - reach) / cell), x1 = Math.floor((box.max.x + reach) / cell)
    const y0 = Math.floor((box.min.y - reach) / cell), y1 = Math.floor((box.max.y + reach) / cell)
    const z0 = Math.floor((box.min.z - reach) / cell), z1 = Math.floor((box.max.z + reach) / cell)
    if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 4096) return null
    const keys: string[] = []
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) keys.push(`${x}|${y}|${z}`)
    return keys
  }
  const place = (face: Face) => {
    placed.push(face)
    const keys = keysOf(bounds(face))
    if (!keys) { wide.push(face); return }
    for (const key of keys) { const list = grid.get(key); if (list) list.push(face); else grid.set(key, [face]) }
  }
  const owned = new Map<FaceSource, Face[]>()
  const refresh = (source: FaceSource) => {
    const fresh = facesOf(source)
    const old = owned.get(source)!
    fresh.forEach((face, index) => Object.assign(old[index]!, face))
  }
  for (const source of sources) {
    const faces = facesOf(source)
    owned.set(source, faces)
    const candidates = new Set<Face>(wide)
    for (const face of faces) {
      const keys = keysOf(bounds(face))
      if (!keys) { for (const other of placed) candidates.add(other); continue }
      for (const key of keys) for (const other of grid.get(key) ?? []) candidates.add(other)
    }
    for (const other of candidates) {
      if (other.source === source) continue
      for (const face of faces) {
        if (face.normal.dot(other.normal) < 0.9995) continue
        const gap = face.normal.dot(face.center.clone().sub(other.center))
        if (Math.abs(gap) >= minGap) continue
        const area = overlapArea(face, other)
        if (area < minArea) continue
        const mover = face.area <= other.area ? face : other
        const anchor = mover === face ? other : face
        const signed = mover === face ? gap : -gap
        const lift = separation - signed
        if (resolve) {
          push(mover.source, mover, lift)
          refresh(mover.source)
        }
        const at = mover.center
        resolutions.push({ moved: mover.source.label, other: anchor.source.label, gap: Math.round(signed * 10000) / 10000, lift: Math.round(lift * 10000) / 10000, area: Math.round(area * 1000) / 1000, at: [Math.round(at.x * 100) / 100, Math.round(at.y * 100) / 100, Math.round(at.z * 100) / 100] })
      }
    }
    for (const face of faces) place(face)
  }
  return resolutions
}

export function resolveCoplanar(sources: FaceSource[], options: CoplanarOptions = {}) {
  const resolve = options.mode !== 'ignore' && options.mode !== 'throw'
  const all: CoplanarResolution[] = []
  for (let pass = 0; pass < 6; pass++) {
    const found = sweep(sources, options)
    all.push(...found)
    if (!resolve || !found.length) break
  }
  return all
}

export function describeCoplanar(resolutions: CoplanarResolution[], mode: CoplanarMode, separation: number) {
  const mm = (value: number) => `${Math.round(value * 1000)} mm`
  const lines = resolutions.slice(0, 8).map(item => `  ${item.moved} shares a face with ${item.other} over ${item.area} m² at (${item.at.join(', ')}), ${mm(Math.abs(item.gap))} apart${mode === 'resolve' ? `, pushed out ${mm(item.lift)}` : ''}`)
  if (resolutions.length > 8) lines.push(`  and ${resolutions.length - 8} more`)
  const head = `LevelBuilder found ${resolutions.length} coplanar overlapping ${resolutions.length === 1 ? 'face' : 'faces'} that z-fight`
  const advice = mode === 'resolve'
    ? `The newer or smaller face was pushed ${mm(separation)} clear. Place it proud of the surface on purpose, or trim one of the two, to silence this.`
    : 'Move one face at least 2 cm clear of the other, trim the overlap, or build with { coplanar: \'resolve\' }.'
  return `${head}:\n${lines.join('\n')}\n${advice}`
}
