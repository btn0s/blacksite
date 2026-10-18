import data from '../../assets/props/props.json'

type Vec2 = [number, number]
type Vec3 = [number, number, number]

export type PropName = keyof typeof data
export type PropRect = { min: Vec2; max: Vec2 }
export type PropPick = { name: PropName; count: number; on?: readonly PropName[] }
export type ArrangeOptions = { area: PropRect; picks: readonly PropPick[]; blocked?: readonly PropRect[]; clear?: readonly PropRect[]; seed?: number; floor?: number }
export type ArrangedProp = { name: PropName; at: Vec3; yaw: number; footprint: PropRect; height: number; on?: number }

export const PROP_BOUNDS = Object.fromEntries(Object.entries(data).map(([name, info]) => [name, { min: info.min as Vec3, max: info.max as Vec3 }])) as Record<PropName, { min: Vec3; max: Vec3 }>

const overlaps = (a: PropRect, b: PropRect, margin: number) => a.min[0] < b.max[0] + margin && a.max[0] > b.min[0] - margin && a.min[1] < b.max[1] + margin && a.max[1] > b.min[1] - margin

export function arrangeProps({ area, picks, blocked = [], clear = [], seed = 1, floor = 0 }: ArrangeOptions): ArrangedProp[] {
  let state = seed * 4801 + 7907
  const random = () => {
    state = (state * 16807) % 2147483647
    return (state - 1) / 2147483646
  }
  const [x0, z0] = area.min
  const [x1, z1] = area.max
  const walls = [
    { along: 'x' as const, plane: z0, inward: 1, from: x0, to: x1 },
    { along: 'x' as const, plane: z1, inward: -1, from: x0, to: x1 },
    { along: 'z' as const, plane: x0, inward: 1, from: z0, to: z1 },
    { along: 'z' as const, plane: x1, inward: -1, from: z0, to: z1 },
  ]
  const perimeter = walls.reduce((sum, wall) => sum + wall.to - wall.from, 0)
  const placed: ArrangedProp[] = []
  for (const pick of picks) {
    const { min, max } = PROP_BOUNDS[pick.name]
    const width = max[0] - min[0]
    const depth = max[2] - min[2]
    const height = max[1] - min[1]
    const small = height < 0.7 && Math.max(width, depth) < 0.8
    const hosts = pick.on ? placed.map((item, index) => ({ item, index })).filter(({ item }) => item.on === undefined && pick.on!.includes(item.name)) : []
    for (let copy = 0; copy < pick.count; copy++) {
      if (pick.on) {
        for (let attempt = 0; attempt < 30 && hosts.length; attempt++) {
          const { item: host, index } = hosts[Math.floor(random() * hosts.length)]!
          const yaw = host.yaw + (random() - 0.5) * 0.8 + (random() < 0.5 ? Math.PI / 2 : 0)
          const cos = Math.abs(Math.cos(yaw))
          const sin = Math.abs(Math.sin(yaw))
          const halfX = (cos * width + sin * depth) / 2
          const halfZ = (sin * width + cos * depth) / 2
          const roomX = host.footprint.max[0] - host.footprint.min[0] - halfX * 2
          const roomZ = host.footprint.max[1] - host.footprint.min[1] - halfZ * 2
          if (roomX < 0 || roomZ < 0) continue
          const x = host.footprint.min[0] + halfX + random() * roomX
          const z = host.footprint.min[1] + halfZ + random() * roomZ
          const footprint: PropRect = { min: [x - halfX, z - halfZ], max: [x + halfX, z + halfZ] }
          if (placed.some(item => item.on === index && overlaps(footprint, item.footprint, 0.02))) continue
          placed.push({ name: pick.name, at: [x, host.at[1] + host.height, z], yaw, footprint, height, on: index })
          break
        }
        continue
      }
      for (let attempt = 0; attempt < 80; attempt++) {
        let pickAt = random() * perimeter
        const wall = walls.find(item => (pickAt -= item.to - item.from) < 0) ?? walls[3]!
        const parallel = wall.along === 'x' ? width >= depth : depth >= width
        const yaw = (parallel ? 0 : Math.PI / 2) + (random() < 0.5 ? Math.PI : 0) + (small ? (random() - 0.5) * 0.7 : (random() - 0.5) * 0.06)
        const cos = Math.abs(Math.cos(yaw))
        const sin = Math.abs(Math.sin(yaw))
        const halfX = (cos * width + sin * depth) / 2
        const halfZ = (sin * width + cos * depth) / 2
        const reach = wall.along === 'x' ? halfZ : halfX
        const span = wall.along === 'x' ? halfX : halfZ
        if (wall.to - wall.from < span * 2) continue
        const along = wall.from + span + random() * (wall.to - wall.from - span * 2)
        const across = wall.plane + wall.inward * (reach + 0.02 + (small ? random() * 0.5 : random() * 0.04))
        const [x, z] = wall.along === 'x' ? [along, across] : [across, along]
        const footprint: PropRect = { min: [x - halfX, z - halfZ], max: [x + halfX, z + halfZ] }
        if (footprint.min[0] < x0 || footprint.max[0] > x1 || footprint.min[1] < z0 || footprint.max[1] > z1) continue
        if (blocked.some(rect => overlaps(footprint, rect, 0.04)) || clear.some(rect => overlaps(footprint, rect, 0)) || placed.some(item => overlaps(footprint, item.footprint, 0.05))) continue
        placed.push({ name: pick.name, at: [x, floor, z], yaw, footprint, height })
        break
      }
    }
  }
  return placed
}
