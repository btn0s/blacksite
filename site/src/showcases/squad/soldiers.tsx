import { useEffect, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { AlsRemoteActor, type AlsRagdollHandle } from 'als-ue5-r3f/app/AlsRemoteActor'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import type { TeamId } from '@blacksite/warden'
import type { SquadFeed } from './feed'

type Paint = { color: string; roughness: number; emissive?: string; emissiveIntensity?: number }

const kit = (jacket: string, trousers: string, eyes: string): Record<string, Paint> => {
  const top = { color: jacket, roughness: 0.9 }
  const bottom = { color: trousers, roughness: 0.95 }
  return {
    Torso_MAT: top,
    Shoulder_L_MAT: top,
    Shoulder_R_MAT: top,
    UpperArm_L_MAT: top,
    UpperArm_R_MAT: top,
    LowerArm_L_MAT: top,
    LowerArm_R_MAT: top,
    Pelvis_MAT: bottom,
    UpperLeg_MAT: bottom,
    LowerLeg_MAT: bottom,
    Feet_MAT: { color: '#201d19', roughness: 0.75 },
    Hand_L_MAT: { color: '#2b2722', roughness: 0.8 },
    Hand_R_MAT: { color: '#2b2722', roughness: 0.8 },
    Head_MAT: { color: '#2e2f2a', roughness: 0.85 },
    Eyes_MAT: { color: '#141410', roughness: 0.3, emissive: eyes, emissiveIntensity: 2.4 },
    M4A1_MAT: { color: '#232322', roughness: 0.55 },
  }
}

const KITS: Record<TeamId, Record<string, Paint>> = {
  alpha: kit('#4b4631', '#35332a', '#e2a23b'),
  bravo: kit('#36403f', '#2b3233', '#8fc0cf'),
}

const painted = new Map<TeamId, Map<THREE.Material, THREE.Material>>([['alpha', new Map()], ['bravo', new Map()]])
const ours = new Set<THREE.Material>()

function paint(team: TeamId, source: THREE.Material) {
  if (ours.has(source)) return source
  const cache = painted.get(team)!
  let material = cache.get(source)
  if (material) return material
  const spec = KITS[team][source.name]
  if (!spec || !(source instanceof THREE.MeshStandardMaterial)) return source
  const clone = source.clone()
  clone.color.set(spec.color)
  clone.roughness = spec.roughness
  if (spec.emissive) { clone.emissive.set(spec.emissive); clone.emissiveIntensity = spec.emissiveIntensity ?? 1 }
  cache.set(source, clone)
  ours.add(clone)
  material = clone
  return material
}

function dress(root: THREE.Object3D, team: TeamId) {
  let meshes = 0
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    meshes++
    object.castShadow = true
    object.material = Array.isArray(object.material) ? object.material.map(material => paint(team, material)) : paint(team, object.material)
  })
  return meshes
}

const ignore = () => {}

export const lod = new Map<string, { distance: number; visible: boolean; focused: boolean; minInterval: number; maxInterval: number }>()

const wrappers = new Map<string, THREE.Group>()

export function corpseOf(id: string) {
  const wrap = wrappers.get(id)
  if (!wrap) return null
  wrap.updateMatrixWorld(true)
  const body = clone(wrap)
  body.traverse(object => { object.matrixAutoUpdate = false; if (object instanceof THREE.SkinnedMesh) object.frustumCulled = false })
  return body
}

function Soldier({ id, team, feed, handles }: { id: string; team: TeamId; feed: SquadFeed; handles: Map<string, RefObject<AlsRagdollHandle | null>> }) {
  const ragdoll = useRef<AlsRagdollHandle | null>(null)
  const wrap = useRef<THREE.Group>(null)
  const dressed = useRef({ meshes: 0, frames: 0 })
  useEffect(() => {
    handles.set(id, ragdoll)
    if (wrap.current) wrappers.set(id, wrap.current)
    return () => {
      if (handles.get(id) === ragdoll) handles.delete(id)
      if (wrappers.get(id) === wrap.current) wrappers.delete(id)
    }
  }, [handles, id])
  useFrame(() => {
    const state = dressed.current
    if (!wrap.current || state.frames > 120) return
    const meshes = dress(wrap.current, team)
    state.frames = meshes === state.meshes ? state.frames + 1 : 0
    state.meshes = meshes
  })
  return <group ref={wrap}>
    <AlsRemoteActor snapshots={feed.buffer(id)} now={feed.now} footIk={false} animationLod={() => lod.get(id) ?? {}} ragdollRef={ragdoll} onUnsupportedState={ignore} />
  </group>
}

export function Soldiers({ roster, frozen, feed, handles }: { roster: Array<{ id: string; team: TeamId }>; frozen: ReadonlySet<string>; feed: SquadFeed; handles: Map<string, RefObject<AlsRagdollHandle | null>> }) {
  return <>{roster.filter(soldier => !frozen.has(soldier.id)).map(soldier => <Soldier key={`${feed.round}:${soldier.id}`} id={soldier.id} team={soldier.team} feed={feed} handles={handles} />)}</>
}
