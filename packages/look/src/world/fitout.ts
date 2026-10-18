import type { LevelBuilder } from './builder'
import type { SurfaceName } from './surfaces'

export type FitOutWall = 'west' | 'east' | 'south' | 'north'
export type FitOutOpening = { wall: FitOutWall; from: number; to: number; bottom: number; top: number }
export type FitOutRect = { min: [number, number]; max: [number, number] }
export type FitOutOptions = {
  room: FitOutRect & { ceiling: number; floor?: number }
  openings?: FitOutOpening[]
  holes?: FitOutRect[]
  seed?: number
  joists?: boolean
  pilasters?: boolean
  frames?: boolean
  conduit?: boolean
  pipes?: number
}

type Paint = { name: SurfaceName; color?: string; ao?: false }

const CONCRETE: Paint = { name: 'cast', color: '#8d8d8c' }
const FRAME: Paint = { name: 'metal', color: '#3b3e3c', ao: false }
const STEEL: Paint = { name: 'metal', color: '#2a2b2b', ao: false }
const CONDUIT: Paint = { name: 'metal', color: '#7d807e', ao: false }
const BOX: Paint = { name: 'metal', color: '#9a9c97', ao: false }
const PIPES: Paint[] = [{ name: 'metal', color: '#4d5a52' }, { name: 'rust', color: '#6b5444' }, { name: 'metal', color: '#6f7270' }]

export function fitOut(builder: LevelBuilder, options: FitOutOptions) {
  const { room, openings = [], holes = [], seed = 1 } = options
  const floor = room.floor ?? 0
  const ceiling = floor + room.ceiling
  let state = seed * 7919 + 104729
  const random = () => {
    state = (state * 16807) % 2147483647
    return (state - 1) / 2147483646
  }
  const [x0, z0] = room.min
  const [x1, z1] = room.max
  const width = x1 - x0
  const depth = z1 - z0
  const place = (at: [number, number, number], rotate?: [number, number, number], cast = false) => ({ at, rotate, collide: false, cast, shadow: false })
  const box = (size: [number, number, number], paint: Paint, at: [number, number, number], cast = false) => builder.box(size, paint, place(at, undefined, cast))
  const rod = (axis: 'x' | 'y' | 'z', radius: number, length: number, paint: Paint, at: [number, number, number], segments = 8, cast = false) =>
    builder.cylinder(radius, length, paint, place(at, axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : undefined, cast), segments)
  const walls: Array<{ wall: FitOutWall; along: 'x' | 'z'; plane: number; inward: number; from: number; to: number }> = [
    { wall: 'west', along: 'z', plane: x0, inward: 1, from: z0, to: z1 },
    { wall: 'east', along: 'z', plane: x1, inward: -1, from: z0, to: z1 },
    { wall: 'south', along: 'x', plane: z0, inward: 1, from: x0, to: x1 },
    { wall: 'north', along: 'x', plane: z1, inward: -1, from: x0, to: x1 },
  ]
  const point = (wall: (typeof walls)[number], along: number, y: number, out: number): [number, number, number] =>
    wall.along === 'z' ? [wall.plane + wall.inward * out, y, along] : [along, y, wall.plane + wall.inward * out]
  const size = (wall: (typeof walls)[number], run: number, height: number, thick: number): [number, number, number] =>
    wall.along === 'z' ? [thick, height, run] : [run, height, thick]
  const blocked = (wall: FitOutWall, along: number, margin: number, below = 99) => openings.some(opening => opening.wall === wall && opening.bottom < below && along > opening.from - margin && along < opening.to + margin)
  const overHole = (x: number, z: number, pad: number) => holes.some(hole => x > hole.min[0] - pad && x < hole.max[0] + pad && z > hole.min[1] - pad && z < hole.max[1] + pad)

  if (options.joists ?? room.ceiling <= 3.6) {
    const across: 'x' | 'z' = width < depth ? 'x' : 'z'
    const span = across === 'x' ? width : depth
    const length = across === 'x' ? depth : width
    const count = Math.max(1, Math.round(length / 1.4))
    const step = length / count
    for (let index = 0; index <= count; index++) {
      const along = (across === 'x' ? z0 : x0) + index * step
      if (index === 0 || index === count) continue
      const center: [number, number, number] = across === 'x' ? [(x0 + x1) / 2, ceiling - 0.14, along] : [along, ceiling - 0.14, (z0 + z1) / 2]
      if (overHole(center[0], center[2], 0.3)) continue
      box(across === 'x' ? [span, 0.28, 0.2] : [0.2, 0.28, span], CONCRETE, center, true)
    }
  }

  for (const wall of walls) {
    const run = wall.to - wall.from
    if ((options.pilasters ?? true) && run > 5) {
      const count = Math.round(run / 3)
      for (let index = 1; index < count; index++) {
        const along = wall.from + (index * run) / count
        if (blocked(wall.wall, along, 0.4)) continue
        box(size(wall, 0.34, room.ceiling, 0.12), CONCRETE, point(wall, along, floor + room.ceiling / 2, 0.06), true)
      }
    }
    for (const opening of openings.filter(item => item.wall === wall.wall)) {
      if (!(options.frames ?? true)) break
      const mid = (opening.from + opening.to) / 2
      const span = opening.to - opening.from
      const tall = opening.top - opening.bottom
      for (const along of [opening.from - 0.04, opening.to + 0.04]) box(size(wall, 0.08, tall + 0.04, 0.16), FRAME, point(wall, along, floor + opening.bottom + tall / 2, 0.02))
      box(size(wall, span + 0.16, 0.08, 0.16), FRAME, point(wall, mid, floor + opening.top + 0.04, 0.02))
      if (opening.bottom > 0.1) box(size(wall, span + 0.2, 0.05, 0.22), CONCRETE, point(wall, mid, floor + opening.bottom - 0.025, 0.05))
      if (opening.bottom < 0.1 && options.conduit !== false) {
        const side = opening.to + 0.32
        if (side < wall.to - 0.2 && !blocked(wall.wall, side, 0.1)) {
          box(size(wall, 0.08, 0.12, 0.04), BOX, point(wall, side, floor + 1.3, 0.02))
          rod('y', 0.01, ceiling - 0.25 - (floor + 1.36), CONDUIT, point(wall, side, (ceiling - 0.25 + floor + 1.36) / 2, 0.03), 5)
        }
      }
    }
    if (options.conduit ?? true) {
      const y = ceiling - 0.25
      rod(wall.along, 0.012, run - 0.1, CONDUIT, point(wall, (wall.from + wall.to) / 2, y, 0.03), 5)
      for (let along = wall.from + 0.6; along < wall.to - 0.3; along += 0.9) box(size(wall, 0.03, 0.035, 0.04), STEEL, point(wall, along, y, 0.02))
      for (let along = wall.from + 1.2 + random() * 2; along < wall.to - 0.6; along += 2.5 + random() * 3) {
        if (blocked(wall.wall, along, 0.3)) continue
        box(size(wall, 0.12, 0.08, 0.035), BOX, point(wall, along, floor + 0.3, 0.017))
        if (random() > 0.5) box(size(wall, 0.16, 0.2, 0.07), BOX, point(wall, along, y - 0.2, 0.035))
      }
    }
  }

  const pipes = options.pipes ?? 0
  const along: 'x' | 'z' = width > depth ? 'x' : 'z'
  const length = along === 'x' ? width : depth
  for (let index = 0; index < pipes; index++) {
    const radius = 0.035 + random() * 0.035
    const offset = 0.35 + index * 0.22
    const y = ceiling - 0.18 - index * 0.06
    const at: [number, number, number] = along === 'x' ? [(x0 + x1) / 2, y, z0 + offset] : [x0 + offset, y, (z0 + z1) / 2]
    const paint = PIPES[index % PIPES.length]!
    rod(along, radius, length, paint, at, 10, true)
    for (let step = 0.7; step < length - 0.3; step += 1.5) {
      const hang: [number, number, number] = along === 'x' ? [x0 + step, (y + ceiling) / 2, at[2]] : [at[0], (y + ceiling) / 2, z0 + step]
      rod('y', 0.008, ceiling - y, STEEL, hang, 4)
      box([radius * 2.6, 0.02, radius * 2.6], STEEL, [hang[0], y + radius + 0.01, hang[2]])
    }
  }
}
