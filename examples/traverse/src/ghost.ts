import * as THREE from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { route } from './model'

export type GhostTake = { hz: number; bones: number; moving: number; frames: number; root: Float32Array; rotations: Int16Array; positions: Float32Array; time: number }

const scale = 32767
const movingBone = /^(root|pelvis)$/i

export function modelOf(rootBone: THREE.Object3D) {
  let node: THREE.Object3D = rootBone
  while (node.parent) {
    node = node.parent
    let skinned = false
    node.traverse(child => { if ((child as THREE.SkinnedMesh).isSkinnedMesh) skinned = true })
    if (skinned) return node
  }
  return null
}

const bonesOf = (model: THREE.Object3D) => {
  const bones: THREE.Bone[] = []
  model.traverse(child => { if ((child as THREE.Bone).isBone) bones.push(child as THREE.Bone) })
  return bones
}

export class GhostRecorder {
  private root: number[] = []
  private rotations: number[] = []
  private positions: number[] = []
  private frames = 0
  private next = 0
  private bones: THREE.Bone[]
  private moving: THREE.Bone[]
  private readonly matrix = new THREE.Matrix4()
  private readonly position = new THREE.Vector3()
  private readonly quaternion = new THREE.Quaternion()
  private readonly scale = new THREE.Vector3()

  constructor(private model: THREE.Object3D, private readonly hz = route.ghostHz) {
    this.bones = bonesOf(model)
    this.moving = this.bones.filter(bone => movingBone.test(bone.name))
  }

  bind(model: THREE.Object3D) {
    if (model === this.model) return
    const bones = bonesOf(model)
    const moving = bones.filter(bone => movingBone.test(bone.name))
    if (bones.length !== this.bones.length || moving.length !== this.moving.length) this.reset()
    this.model = model
    this.bones = bones
    this.moving = moving
  }

  reset() { this.root = []; this.rotations = []; this.positions = []; this.frames = 0; this.next = 0 }

  sample(t: number) {
    if (this.frames > 0 && t < this.next) return
    this.next = t + 1 / this.hz - (this.frames > 0 ? Math.max(0, t - this.next) : 0)
    this.model.updateWorldMatrix(true, false)
    this.matrix.copy(this.model.matrixWorld).decompose(this.position, this.quaternion, this.scale)
    this.root.push(this.position.x, this.position.y, this.position.z, this.quaternion.x, this.quaternion.y, this.quaternion.z, this.quaternion.w)
    for (const bone of this.bones) {
      const q = bone.quaternion
      const sign = q.w < 0 ? -1 : 1
      this.rotations.push(Math.round(q.x * sign * scale), Math.round(q.y * sign * scale), Math.round(q.z * sign * scale), Math.round(q.w * sign * scale))
    }
    for (const bone of this.moving) this.positions.push(bone.position.x, bone.position.y, bone.position.z)
    this.frames++
  }

  take(time: number): GhostTake {
    return { hz: this.hz, bones: this.bones.length, moving: this.moving.length, frames: this.frames, root: new Float32Array(this.root), rotations: new Int16Array(this.rotations), positions: new Float32Array(this.positions), time }
  }
}

export const ghostBytes = (take: GhostTake) => take.root.byteLength + take.rotations.byteLength + take.positions.byteLength

export class GhostPlayer {
  readonly object: THREE.Object3D
  private readonly bones: THREE.Bone[]
  private readonly moving: THREE.Bone[]
  private take: GhostTake | null = null
  private readonly a = new THREE.Quaternion()
  private readonly b = new THREE.Quaternion()
  private readonly p = new THREE.Vector3()
  private readonly q = new THREE.Vector3()

  constructor(source: THREE.Object3D) {
    this.object = clone(source)
    const material = new THREE.MeshStandardMaterial({ color: '#9fc4b0', emissive: '#4d7a64', emissiveIntensity: 0.35, roughness: 0.6, transparent: true, opacity: 0.32, depthWrite: false })
    this.object.traverse(child => {
      const mesh = child as THREE.Mesh
      if (mesh.isMesh) { mesh.material = material; mesh.castShadow = false; mesh.receiveShadow = false; mesh.frustumCulled = false; mesh.renderOrder = 3 }
    })
    this.object.matrixAutoUpdate = true
    this.object.position.set(0, 0, 0)
    this.object.quaternion.identity()
    this.bones = bonesOf(this.object)
    this.moving = this.bones.filter(bone => movingBone.test(bone.name))
    this.object.visible = false
  }

  load(take: GhostTake | null) { this.take = take && take.bones === this.bones.length ? take : null }

  get duration() { return this.take ? (this.take.frames - 1) / this.take.hz : 0 }

  dispose() {
    const materials = new Set<THREE.Material>()
    const skeletons = new Set<THREE.Skeleton>()
    this.object.traverse(child => {
      const mesh = child as THREE.SkinnedMesh
      if (mesh.isMesh) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) materials.add(material)
      if (mesh.isSkinnedMesh) skeletons.add(mesh.skeleton)
    })
    for (const material of materials) material.dispose()
    for (const skeleton of skeletons) skeleton.dispose()
    this.object.removeFromParent()
  }

  pose(t: number | null) {
    const take = this.take
    if (!take || take.frames < 2 || t === null) { this.object.visible = false; return }
    this.object.visible = true
    const f = Math.max(0, Math.min(take.frames - 1.0001, t * take.hz))
    const i = Math.floor(f)
    const k = f - i
    const r = take.root
    this.p.set(r[i * 7]!, r[i * 7 + 1]!, r[i * 7 + 2]!)
    this.q.set(r[i * 7 + 7]!, r[i * 7 + 8]!, r[i * 7 + 9]!)
    this.object.position.copy(this.p.lerp(this.q, k))
    this.a.set(r[i * 7 + 3]!, r[i * 7 + 4]!, r[i * 7 + 5]!, r[i * 7 + 6]!)
    this.b.set(r[i * 7 + 10]!, r[i * 7 + 11]!, r[i * 7 + 12]!, r[i * 7 + 13]!)
    this.object.quaternion.copy(this.a.slerp(this.b, k))
    const rot = take.rotations
    const stride = take.bones * 4
    for (let bone = 0; bone < take.bones; bone++) {
      const o = i * stride + bone * 4
      this.a.set(rot[o]! / scale, rot[o + 1]! / scale, rot[o + 2]! / scale, rot[o + 3]! / scale).normalize()
      this.b.set(rot[o + stride]! / scale, rot[o + stride + 1]! / scale, rot[o + stride + 2]! / scale, rot[o + stride + 3]! / scale).normalize()
      this.bones[bone]!.quaternion.copy(this.a).slerp(this.b, k)
    }
    const pos = take.positions
    const pstride = take.moving * 3
    for (let bone = 0; bone < take.moving && bone < this.moving.length; bone++) {
      const o = i * pstride + bone * 3
      this.p.set(pos[o]!, pos[o + 1]!, pos[o + 2]!)
      this.q.set(pos[o + pstride]!, pos[o + pstride + 1]!, pos[o + pstride + 2]!)
      this.moving[bone]!.position.copy(this.p.lerp(this.q, k))
    }
  }
}

export function encodeTake(take: GhostTake) {
  const header = new Float64Array([take.hz, take.bones, take.moving, take.frames, take.time])
  const parts = [new Uint8Array(header.buffer), new Uint8Array(take.root.buffer.slice(0)), new Uint8Array(take.positions.buffer.slice(0)), new Uint8Array(take.rotations.buffer.slice(0))]
  const blob = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0))
  let offset = 0
  for (const part of parts) { blob.set(part, offset); offset += part.byteLength }
  return blob
}

export function decodeTake(blob: Uint8Array): GhostTake {
  const buffer = blob.slice().buffer
  const [hz, bones, moving, frames, time] = Array.from(new Float64Array(buffer, 0, 5)) as [number, number, number, number, number]
  let offset = 40
  const root = new Float32Array(buffer.slice(offset, offset += frames * 7 * 4))
  const positions = new Float32Array(buffer.slice(offset, offset += frames * moving * 3 * 4))
  const rotations = new Int16Array(buffer.slice(offset, offset + frames * bones * 4 * 2))
  return { hz, bones, moving, frames, root, rotations, positions, time }
}

const database = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open('blacksite-traverse', 1)
  request.onupgradeneeded = () => request.result.createObjectStore('ghosts')
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})

export async function saveTake(take: GhostTake) {
  try {
    const db = await database()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('ghosts', 'readwrite')
      tx.objectStore('ghosts').put(encodeTake(take), 'best')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    db.close()
  } catch {}
}

export async function loadTake(): Promise<GhostTake | null> {
  try {
    const db = await database()
    const blob = await new Promise<Uint8Array | undefined>((resolve, reject) => {
      const request = db.transaction('ghosts').objectStore('ghosts').get('best')
      request.onsuccess = () => resolve(request.result as Uint8Array | undefined)
      request.onerror = () => reject(request.error)
    })
    db.close()
    return blob ? decodeTake(blob) : null
  } catch {
    return null
  }
}
