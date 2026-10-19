import { useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { RigidBody, TrimeshCollider } from '@react-three/rapier'
import { Box3, Vector3 } from 'three'
import type { CharacterHandle } from '@blacksite/subject'
import type { RuinsAsset } from './asset'

export function RuinsCollision({ owned, walker }: { owned: RuinsAsset; walker: CharacterHandle }) {
  const index = useMemo(() => {
    const cells = new Map<string, Set<number>>()
    for (const placement of owned.placements) {
      const box = placement.bounds
      for (let x = Math.floor(box.min.x / 32); x <= Math.floor(box.max.x / 32); x++) {
        for (let z = Math.floor(box.min.z / 32); z <= Math.floor(box.max.z / 32); z++) {
          const key = `${x},${z}`
          if (!cells.has(key)) cells.set(key, new Set())
          cells.get(key)!.add(placement.id)
        }
      }
    }
    return cells
  }, [owned])
  const last = useRef('')
  const [nearby, setNearby] = useState<number[]>([])
  useFrame(() => {
    const position = walker.position
    const x = Math.floor(position.x / 16), z = Math.floor(position.z / 16)
    const key = `${x},${z}`
    if (last.current === key) return
    last.current = key
    const area = new Box3(new Vector3(x * 16 - 32, position.y - 15, z * 16 - 32), new Vector3(x * 16 + 48, position.y + 15, z * 16 + 48))
    const ids = new Set<number>()
    for (let cx = Math.floor(area.min.x / 32); cx <= Math.floor(area.max.x / 32); cx++) {
      for (let cz = Math.floor(area.min.z / 32); cz <= Math.floor(area.max.z / 32); cz++) {
        for (const id of index.get(`${cx},${cz}`) ?? []) if (owned.placements[id]!.bounds.intersectsBox(area)) ids.add(id)
      }
    }
    setNearby([...ids])
  }, -5)
  return <RigidBody type="fixed" colliders={false}>{nearby.map(id => <PlacementCollision key={id} owned={owned} id={id} />)}</RigidBody>
}

function PlacementCollision({ owned, id }: { owned: RuinsAsset; id: number }) {
  const collision = useMemo(() => {
    const placement = owned.placements[id]!
    const source = owned.collisions.get(placement.geometry)!
    const vertices = source.vertices.slice()
    const point = new Vector3()
    for (let i = 0; i < vertices.length; i += 3) point.fromArray(vertices, i).applyMatrix4(placement.matrix).toArray(vertices, i)
    const indices = source.indices.slice()
    if (placement.matrix.determinant() < 0) for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2]!, indices[i + 1]!]
    return { vertices, indices }
  }, [id, owned])
  return <TrimeshCollider args={[collision.vertices, collision.indices]} />
}
