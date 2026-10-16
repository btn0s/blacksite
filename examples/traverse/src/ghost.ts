import * as THREE from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'
import { route } from './model'

export type GhostTake = { hz: number; bones: number; frames: number; root: Float32Array; rotations: Int16Array; time: number }

const scale = 32767

export class GhostRecorder {
  private root: number[] = []
  private rotations: number[] = []
  private frames = 0
  private next = 0
  constructor(private readonly bones: readonly THREE.Bone[], private readonly hz = route.ghostHz) {}

  reset() { this.root = []; this.rotations = []; this.frames = 0; this.next = 0 }

  sample(t: number, object: THREE.Object3D) {
    if (t < this.next) return
    this.next = this.frames === 0 ? t + 1 / this.hz : this.next + 1 / this.hz
    object.updateWorldMatrix(true, false)
    const position = new THREE.Vector3().setFromMatrixPosition(object.matrixWorld)
    const quaternion = new THREE.Quaternion().setFromRotationMatrix(object.matrixWorld)
    this.root.push(position.x, position.y, position.z, quaternion.x, quaternion.y, quaternion.z, quaternion.w)
    for (const bone of this.bones) {
      const q = bone.quaternion
      const sign = q.w < 0 ? -1 : 1
      this.rotations.push(Math.round(q.x * sign * scale), Math.round(q.y * sign * scale), Math.round(q.z * sign * scale), Math.round(q.w * sign * scale))
    }
    this.frames++
  }

  take(time: number): GhostTake {
    return { hz: this.hz, bones: this.bones.length, frames: this.frames, root: new Float32Array(this.root), rotations: new Int16Array(this.rotations), time }
  }
}

export function ghostBytes(take: GhostTake) { return take.root.byteLength + take.rotations.byteLength }

const ghostMaterial = () => new THREE.MeshBasicMaterial({ color: '#b9d6c4', transparent: true, opacity: 0.22, depthWrite: false, fog: true })

export class GhostPlayer {
  readonly object: THREE.Object3D
  private readonly bones: THREE.Bone[]
  private take: GhostTake | null = null
  private readonly a = new THREE.Quaternion()
  private readonly b = new THREE.Quaternion()
  private readonly p = new THREE.Vector3()
  private readonly q = new THREE.Vector3()

  constructor(source: THREE.Object3D, boneNames: readonly string[]) {
    this.object = clone(source)
    this.object.matrixAutoUpdate = true
    const material = ghostMaterial()
    this.object.traverse(child => {
      if (child instanceof THREE.Mesh) { child.material = material; child.castShadow = false; child.receiveShadow = false; child.frustumCulled = false }
    })
    const byName = new Map<string, THREE.Bone>()
    this.object.traverse(child => { if (child instanceof THREE.Bone) byName.set(child.name, child) })
    this.bones = boneNames.map(name => byName.get(name)!).filter(Boolean)
    this.object.visible = false
  }

  load(take: GhostTake | null) { this.take = take; this.object.visible = take !== null && take.frames > 1 }

  pose(t: number) {
    const take = this.take
    if (!take || take.frames < 2) return
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
    const count = Math.min(take.bones, this.bones.length)
    for (let bone = 0; bone < count; bone++) {
      const o = i * stride + bone * 4
      this.a.set(rot[o]! / scale, rot[o + 1]! / scale, rot[o + 2]! / scale, rot[o + 3]! / scale).normalize()
      this.b.set(rot[o + stride]! / scale, rot[o + stride + 1]! / scale, rot[o + stride + 2]! / scale, rot[o + stride + 3]! / scale).normalize()
      this.bones[bone]!.quaternion.copy(this.a).slerp(this.b, k)
    }
  }
}

export function encodeTake(take: GhostTake) {
  const header = new Float64Array([take.hz, take.bones, take.frames, take.time])
  const blob = new Uint8Array(header.byteLength + take.root.byteLength + take.rotations.byteLength)
  blob.set(new Uint8Array(header.buffer), 0)
  blob.set(new Uint8Array(take.root.buffer, take.root.byteOffset, take.root.byteLength), header.byteLength)
  blob.set(new Uint8Array(take.rotations.buffer, take.rotations.byteOffset, take.rotations.byteLength), header.byteLength + take.root.byteLength)
  return blob
}

export function decodeTake(blob: Uint8Array): GhostTake {
  const buffer = blob.slice().buffer
  const [hz, bones, frames, time] = new Float64Array(buffer, 0, 4) as unknown as [number, number, number, number]
  const root = new Float32Array(buffer, 32, frames * 7)
  const rotations = new Int16Array(buffer.slice(32 + frames * 7 * 4))
  return { hz, bones, frames, root, rotations, time }
}
