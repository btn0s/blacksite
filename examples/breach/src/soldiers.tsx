import { useEffect, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import { AlsRemoteActor, type AlsRagdollHandle } from 'als-ue5-r3f/app/AlsRemoteActor'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
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
const uniform = new THREE.MeshStandardMaterial({ color: 'white', roughness: 0.9, vertexColors: true })
const uniforms = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>()
const combined = new WeakSet<THREE.Object3D>()

function combineUniform(root: THREE.Object3D) {
  if (combined.has(root)) return
  const parts: THREE.SkinnedMesh[] = []
  root.traverse(object => {
    if (object instanceof THREE.SkinnedMesh && object.material instanceof THREE.MeshStandardMaterial && KIT[object.material.name] && object.material.name !== 'Eyes_MAT' && object.material.name !== 'M4A1_MAT') parts.push(object)
  })
  if (parts.length < 2) return
  const first = parts[0]!
  if (parts.some(part => part.parent !== first.parent || !part.matrix.equals(first.matrix) || part.skeleton.bones[0] !== first.skeleton.bones[0])) return
  let geometry = uniforms.get(first.geometry)
  if (!geometry) {
    const geometries = parts.map(part => {
      const geometry = part.geometry.clone()
      const material = part.material as THREE.MeshStandardMaterial
      const color = new THREE.Color(KIT[material.name]!.color)
      const colors = new Float32Array(geometry.getAttribute('position').count * 3)
      for (let i = 0; i < colors.length; i += 3) { colors[i] = color.r; colors[i + 1] = color.g; colors[i + 2] = color.b }
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
      return geometry
    })
    geometry = mergeGeometries(geometries, false) ?? undefined
    for (const part of geometries) part.dispose()
    if (!geometry) return
    uniforms.set(first.geometry, geometry)
  }
  const mesh = new THREE.SkinnedMesh().copy(first, false)
  mesh.name = 'breach-uniform'
  mesh.geometry = geometry
  mesh.material = uniform
  first.parent!.add(mesh)
  for (const part of parts) part.removeFromParent()
  combined.add(root)
}

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
  combineUniform(root)
  let meshes = 0
  root.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    meshes++
    object.castShadow = true
    if (object instanceof THREE.SkinnedMesh) {
      object.frustumCulled = false
      if (!object.boundingSphere) {
        if (!object.geometry.boundingSphere) object.geometry.computeBoundingSphere()
        object.boundingSphere = object.geometry.boundingSphere!.clone()
      }
    }
    object.material = Array.isArray(object.material) ? object.material.map(paint) : paint(object.material)
  })
  return meshes
}

const ignore = () => {}

export type Lod = { distance: number; visible: boolean; focused: boolean; minInterval: number; maxInterval: number }
export const lod = new Map<string, Lod>()
const wrappers = new Map<string, THREE.Group>()

export function soldierRoot(id: string) { return wrappers.get(id) ?? null }

export function releaseWeaponAim(id: string) {
  const root = wrappers.get(id)
  const attachment = root?.getObjectByName('VB hand_r_to_ik_hand_gun')
  if (!attachment?.parent) return
  root!.updateMatrixWorld(true)
  for (const object of [...attachment.children]) if (!(object instanceof THREE.Bone)) attachment.parent.attach(object)
}

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
  const lifetime = useRef({ round: client.round, versions: new Map<string, number>() })
  if (lifetime.current.round !== client.round) {
    lifetime.current.round = client.round
    for (const [id, handle] of handles) if (handle.current?.active) lifetime.current.versions.set(id, (lifetime.current.versions.get(id) ?? 0) + 1)
  }
  return <>{roster.filter(id => !frozen.has(id)).map(id => <Soldier key={`${lifetime.current.versions.get(id) ?? 0}:${id}`} id={id} client={client} handles={handles} />)}</>
}
