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
  | { kind: 'cylinder'; label: string; size: [number, number, number]; position: THREE.Vector3; quaternion: THREE.Quaternion; geometry: THREE.BufferGeometry }
  | { kind: 'plane'; label: string; width: number; depth: number; position: THREE.Vector3; quaternion: THREE.Quaternion; geometry: THREE.BufferGeometry }

type Face = { source: FaceSource; axis: number; sign: number; normal: THREE.Vector3; center: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3; hu: number; hv: number; area: number; box?: THREE.Box3; seen?: number }

const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)]

function facesOf(source: FaceSource): Face[] {
  const frame = AXES.map(axis => axis.clone().applyQuaternion(source.quaternion))
  if (source.kind === 'plane') {
    const [u, normal, v] = frame
    return [{ source, axis: 1, sign: 1, normal: normal!, center: source.position.clone(), u: u!, v: v!, hu: source.width / 2, hv: source.depth / 2, area: source.width * source.depth }]
  }
  const faces: Face[] = []
  const axes = source.kind === 'cylinder' ? [1] : [0, 1, 2]
  for (const axis of axes) for (const sign of [1, -1]) {
    const normal = frame[axis]!.clone().multiplyScalar(sign)
    const u = frame[(axis + 1) % 3]!
    const v = frame[(axis + 2) % 3]!
    const hu = source.size[(axis + 1) % 3]! / 2
    const hv = source.size[(axis + 2) % 3]! / 2
    faces.push({ source, axis, sign, normal, center: source.position.clone().addScaledVector(normal, source.size[axis]! / 2), u, v, hu, hv, area: source.kind === 'cylinder' ? Math.PI * hu * hv : hu * hv * 4 })
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

function apart(a: THREE.Box3, b: THREE.Box3, margin: number) {
  return a.max.x + margin < b.min.x || b.max.x + margin < a.min.x || a.max.y + margin < b.min.y || b.max.y + margin < a.min.y || a.max.z + margin < b.min.z || b.max.z + margin < a.min.z
}

function bounds(face: Face) {
  if (face.box) return face.box
  const box = face.box = new THREE.Box3()
  for (const [x, y] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) box.expandByPoint(face.center.clone().addScaledVector(face.u, x * face.hu).addScaledVector(face.v, y * face.hv))
  return box
}

function push(source: FaceSource, face: Face, lift: number) {
  const { x: nx, y: ny, z: nz } = face.normal
  const { x: cx, y: cy, z: cz } = face.center
  const ox = nx * lift, oy = ny * lift, oz = nz * lift
  const position = source.geometry.getAttribute('position') as THREE.BufferAttribute
  const all = source.kind === 'plane'
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i)
    if (all || Math.abs(nx * (x - cx) + ny * (y - cy) + nz * (z - cz)) < 1e-4) position.setXYZ(i, x + ox, y + oy, z + oz)
  }
  position.needsUpdate = true
  if (source.kind !== 'plane') {
    source.size[face.axis] += lift
    source.position.addScaledVector(face.normal, lift / 2)
  } else source.position.addScaledVector(face.normal, lift)
}

// Faces bucketed into 8 m cells, kept across passes. A moved face is re-placed under its new bounds;
// stale cells only add candidates, which the geometric tests reject.
function faceIndex(reach: number) {
  const cell = 8
  const grid = new Map<number, Face[]>()
  const wide = new Set<Face>()
  const placed = new Set<Face>()
  const keysOf = (box: THREE.Box3) => {
    const x0 = Math.floor((box.min.x - reach) / cell), x1 = Math.floor((box.max.x + reach) / cell)
    const y0 = Math.floor((box.min.y - reach) / cell), y1 = Math.floor((box.max.y + reach) / cell)
    const z0 = Math.floor((box.min.z - reach) / cell), z1 = Math.floor((box.max.z + reach) / cell)
    if ((x1 - x0 + 1) * (y1 - y0 + 1) * (z1 - z0 + 1) > 4096) return null
    const keys: number[] = []
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) keys.push(((x + 4096) * 8192 + (y + 4096)) * 8192 + (z + 4096))
    return keys
  }
  return {
    place(face: Face) {
      placed.add(face)
      const keys = keysOf(bounds(face))
      if (!keys) { wide.add(face); return }
      for (const key of keys) { const list = grid.get(key); if (!list) grid.set(key, [face]); else if (list[list.length - 1] !== face) list.push(face) }
    },
    // The buckets that can hold a face near `face`; a face may sit in several.
    near(face: Face) {
      const keys = keysOf(bounds(face))
      if (!keys) return [placed]
      const lists: Iterable<Face>[] = [wide]
      for (const key of keys) { const list = grid.get(key); if (list) lists.push(list) }
      return lists
    },
  }
}

export function resolveCoplanar(sources: FaceSource[], options: CoplanarOptions = {}) {
  const minGap = options.minGap ?? 0.004
  const separation = options.separation ?? 0.02
  const minArea = options.minArea ?? 0.0004
  const resolve = options.mode !== 'ignore' && options.mode !== 'throw'
  const index = faceIndex(minGap + separation * 2)
  const owned = new Map<FaceSource, Face[]>()
  const order = new Map(sources.map((source, position) => [source, position]))
  const all: CoplanarResolution[] = []
  const placedSources = new Set<FaceSource>()
  let stamp = 0
  const move = (mover: Face, lift: number) => {
    push(mover.source, mover, lift)
    const old = owned.get(mover.source)
    if (!old) return
    facesOf(mover.source).forEach((face, i) => Object.assign(old[i]!, face, { box: undefined }))
    if (placedSources.has(mover.source)) for (const face of old) index.place(face)
  }
  // The first pass checks each source against the ones placed before it; later passes only
  // re-check the sources the previous pass moved, against every face.
  let focus: Set<FaceSource> | undefined
  for (let pass = 0; pass < 6; pass++) {
    const moved = new Set<FaceSource>()
    const found = all.length
    for (const source of sources) {
      if (focus && !focus.has(source)) continue
      let faces = owned.get(source)
      if (!faces) { faces = facesOf(source); owned.set(source, faces) }
      for (const face of faces) {
        const seen = ++stamp
        for (const list of index.near(face)) for (const other of list) {
          if (other.seen === seen) continue
          other.seen = seen
          if (other.source === source) continue
          const n = face.normal
          if (n.dot(other.normal) < 0.9995) continue
          const a = face.center, b = other.center
          const gap = n.x * (a.x - b.x) + n.y * (a.y - b.y) + n.z * (a.z - b.z)
          if (Math.abs(gap) >= minGap) continue
          if (focus?.has(other.source) && order.get(other.source)! > order.get(source)!) continue
          if (apart(bounds(face), bounds(other), minGap)) continue
          const area = overlapArea(face, other)
          if (area < minArea) continue
          const mover = face.area <= other.area ? face : other
          const anchor = mover === face ? other : face
          const signed = mover === face ? gap : -gap
          const lift = separation - signed
          const at = mover.center
          all.push({ moved: mover.source.label, other: anchor.source.label, gap: Math.round(signed * 10000) / 10000, lift: Math.round(lift * 10000) / 10000, area: Math.round(area * 1000) / 1000, at: [Math.round(at.x * 100) / 100, Math.round(at.y * 100) / 100, Math.round(at.z * 100) / 100] })
          if (resolve) { move(mover, lift); moved.add(mover.source) }
        }
      }
      if (!placedSources.has(source)) { placedSources.add(source); for (const face of faces) index.place(face) }
    }
    if (!resolve || all.length === found) break
    focus = moved
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
