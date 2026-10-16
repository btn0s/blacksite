import { useEffect, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { AlsRemoteActor, type AlsRagdollHandle } from 'als-ue5-r3f/app/AlsRemoteActor'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import type { SquadClient } from './squad'

type Paint = { color: string; roughness: number; emissive?: string; emissiveIntensity?: number }

const top = { color: '#4a4636', roughness: 0.92 }
const bottom = { color: '#37382e', roughness: 0.95 }
const KIT: Record<string, Paint> = {
  Torso_MAT: { color: '#3d4233', roughness: 0.9 },
  Shoulder_L_MAT: top, Shoulder_R_MAT: top, UpperArm_L_MAT: top, UpperArm_R_MAT: top, LowerArm_L_MAT: top, LowerArm_R_MAT: top,
  Pelvis_MAT: bottom, UpperLeg_MAT: bottom, LowerLeg_MAT: bottom,
  Feet_MAT: { color: '#1d1b17', roughness: 0.75 },
  Hand_L_MAT: { color: '#2b2722', roughness: 0.8 },
  Hand_R_MAT: { color: '#2b2722', roughness: 0.8 },
  Head_MAT: { color: '#262822', roughness: 0.85 },
  Eyes_MAT: { color: '#141410', roughness: 0.3, emissive: '#c9a46a', emissiveIntensity: 1.6 },
  M4A1_MAT: { color: '#201f1d', roughness: 0.55 },
}

const painted = new Map<THREE.Material, THREE.Material>()
const ours = new Set<THREE.Material>()

function paint(source: THREE.Material) {
  if (ours.has(source)) return source
  const cached = painted.get(source)
  if (cached) return cached
  const spec = KIT[source.name]
  if (!spec || !(source instanceof THREE.MeshStandardMaterial)) return source
  const material = source.clone()
  material.color.set(spec.color)
  material.roughness = spec.roughness
  if (spec.emissive) { material.emissive.set(spec.emissive); material.emissiveIntensity = spec.emissiveIntensity ?? 1 }
  painted.set(source, material)
  ours.add(material)
  return material
}

function dress(root: THREE.Object3D) {
  let meshes = 0
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    meshes++
    object.castShadow = true
    object.material = Array.isArray(object.material) ? object.material.map(paint) : paint(object.material)
  })
  return meshes
}

const ignore = () => {}

export type Lod = { distance: number; visible: boolean; focused: boolean; minInterval: number; maxInterval: number }
export const lod = new Map<string, Lod>()
const wrappers = new Map<string, THREE.Group>()

export function soldierRoot(id: string) { return wrappers.get(id) ?? null }

export function corpseOf(id: string) {
  const wrap = wrappers.get(id)
  if (!wrap) return null
  wrap.updateMatrixWorld(true)
  const body = clone(wrap)
  body.traverse(object => { object.matrixAutoUpdate = false; if (object instanceof THREE.SkinnedMesh) object.frustumCulled = false })
  return body
}

function Soldier({ id, client, handles }: { id: string; client: SquadClient; handles: Map<string, RefObject<AlsRagdollHandle | null>> }) {
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
    if (!wrap.current) return
    const view = lod.get(id)
    wrap.current.visible = view?.visible !== false || ragdoll.current?.active === true
    if (state.frames > 120) return
    const meshes = dress(wrap.current)
    state.frames = meshes === state.meshes ? state.frames + 1 : 0
    state.meshes = meshes
  })
  return <group ref={wrap}>
    <AlsRemoteActor snapshots={client.buffer(id)} now={client.now} footIk={false} animationLod={() => lod.get(id) ?? {}} ragdollRef={ragdoll} onUnsupportedState={ignore} />
  </group>
}

export function Soldiers({ roster, frozen, client, handles }: { roster: string[]; frozen: ReadonlySet<string>; client: SquadClient; handles: Map<string, RefObject<AlsRagdollHandle | null>> }) {
  return <>{roster.filter(id => !frozen.has(id)).map(id => <Soldier key={`${client.round}:${id}`} id={id} client={client} handles={handles} />)}</>
}
