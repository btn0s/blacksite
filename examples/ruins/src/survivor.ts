import { Bone, Box3, BufferGeometry, Float32BufferAttribute, Matrix4, Quaternion, SkinnedMesh, Uint16BufferAttribute, Vector3, type Object3D } from 'three'
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js'
import { MeshStandardNodeMaterial, type Material } from 'three/webgpu'
import { Fn, float, materialEmissive, normalView, normalWorld, positionView, uniform, vec3 } from 'three/tsl'

export const SURVIVOR_URL = '/owned/last-light-characters/drifters-light-jacketed-tripo-rigged.glb'

const worn = new WeakMap<GLTF, Promise<GLTF>>()

export const survivorRim = uniform(0)

function rimLit(source: Material) {
  const material = new MeshStandardNodeMaterial().copy(source as never)
  const rim = Fn(builder => {
    const facing = normalView.dot(positionView.negate().normalize()).clamp(0, 1)
    const edge = float(1).sub(facing).pow(3)
    const sky = normalWorld.y.mul(0.4).add(0.6)
    return materialEmissive.add(vec3(0.55, 0.68, 0.85).mul(edge).mul(sky).mul(survivorRim).mul((builder.context as { radianceScale?: number }).radianceScale ?? 1))
  })()
  material.emissiveNode = rim
  return material
}

export function wearSurvivor(host: GLTF, url = SURVIVOR_URL) {
  let result = worn.get(host)
  if (!result) { result = dress(host, url); worn.set(host, result) }
  return result
}

function skinnedMeshes(root: Object3D) {
  const meshes: SkinnedMesh[] = []
  root.traverse(object => { if (object instanceof SkinnedMesh) meshes.push(object) })
  return meshes
}

function restPositions(mesh: SkinnedMesh) {
  const world = new Matrix4()
  return mesh.skeleton.boneInverses.map(inverse => new Vector3().setFromMatrixPosition(world.copy(inverse).invert()))
}

function fitSkeleton(host: SkinnedMesh, guest: SkinnedMesh) {
  const hostBones = host.skeleton.bones, guestBones = guest.skeleton.bones
  const hostIndex = new Map(hostBones.map((bone, index) => [bone.name, index] as const))
  const guestIndex = new Map(guestBones.map((bone, index) => [bone.name, index] as const))
  const missing = guestBones.filter(bone => !hostIndex.has(bone.name)).map(bone => bone.name)
  if (missing.length) throw new Error(`Survivor skeleton has bones the animation skeleton lacks: ${missing.join(', ')}`)
  const hostRest = restPositions(host), guestRest = restPositions(guest)
  const at = (rest: Vector3[], index: Map<string, number>, name: string) => {
    const found = index.get(name)
    if (found === undefined) throw new Error(`Survivor skeleton is missing ${name}`)
    return rest[found]!
  }
  const span = (rest: Vector3[], index: Map<string, number>) => at(rest, index, 'head').distanceTo(at(rest, index, 'foot_l').clone().add(at(rest, index, 'foot_r')).multiplyScalar(0.5))
  const scale = span(hostRest, hostIndex) / span(guestRest, guestIndex)

  const aims = new Map<Bone, Quaternion>()
  const aimOf = (bone: Bone): Quaternion => {
    const known = aims.get(bone)
    if (known) return known
    const children = bone.children.filter((child): child is Bone => child instanceof Bone && guestIndex.has(child.name))
    const from = new Vector3(), to = new Vector3()
    for (const child of children) {
      from.add(guestRest[guestIndex.get(child.name)!]!).sub(guestRest[guestIndex.get(bone.name)!]!)
      to.add(hostRest[hostIndex.get(child.name)!]!).sub(hostRest[hostIndex.get(bone.name)!]!)
    }
    const aim = from.lengthSq() > 1e-8 && to.lengthSq() > 1e-8
      ? new Quaternion().setFromUnitVectors(from.normalize(), to.normalize())
      : bone.parent instanceof Bone && guestIndex.has(bone.parent.name) ? aimOf(bone.parent) : new Quaternion()
    aims.set(bone, aim)
    return aim
  }

  const rotations: Quaternion[] = []
  const fits: Matrix4[] = []
  guestBones.forEach((bone, joint) => {
    const rotation = aimOf(hostBones[hostIndex.get(bone.name)!]!)
    rotations.push(rotation)
    fits.push(new Matrix4().makeTranslation(hostRest[hostIndex.get(bone.name)!]!)
      .multiply(new Matrix4().makeRotationFromQuaternion(rotation))
      .multiply(new Matrix4().makeScale(scale, scale, scale))
      .multiply(new Matrix4().makeTranslation(guestRest[joint]!.clone().negate())))
  })
  return { fits, rotations, hostJoint: guestBones.map(bone => hostIndex.get(bone.name)!) }
}

function poseGeometry(host: SkinnedMesh, guest: SkinnedMesh, groundY: number) {
  const { fits, rotations, hostJoint } = fitSkeleton(host, guest)
  const source = guest.geometry
  const position = source.getAttribute('position'), normal = source.getAttribute('normal'), tangent = source.getAttribute('tangent')
  const skinIndex = source.getAttribute('skinIndex'), skinWeight = source.getAttribute('skinWeight')
  const count = position.count
  const fitted = new Float32Array(count * 3), normals = new Float32Array(count * 3), tangents = tangent ? new Float32Array(count * 4) : null
  const joints = new Uint16Array(count * 4)
  const point = new Vector3(), moved = new Vector3(), sum = new Vector3(), direction = new Vector3(), turned = new Vector3(), facing = new Vector3(), side = new Vector3()
  let lowest = Infinity
  for (let vertex = 0; vertex < count; vertex++) {
    point.fromBufferAttribute(position, vertex).applyMatrix4(guest.bindMatrix)
    direction.fromBufferAttribute(normal, vertex).transformDirection(guest.bindMatrix)
    if (tangent) side.fromBufferAttribute(tangent, vertex).transformDirection(guest.bindMatrix)
    sum.set(0, 0, 0); facing.set(0, 0, 0); turned.set(0, 0, 0)
    let total = 0
    for (let slot = 0; slot < 4; slot++) {
      const weight = skinWeight.getComponent(vertex, slot)
      const joint = skinIndex.getComponent(vertex, slot)
      joints[vertex * 4 + slot] = hostJoint[joint]!
      if (!weight) continue
      total += weight
      sum.addScaledVector(moved.copy(point).applyMatrix4(fits[joint]!), weight)
      facing.addScaledVector(moved.copy(direction).applyQuaternion(rotations[joint]!), weight)
      if (tangent) turned.addScaledVector(moved.copy(side).applyQuaternion(rotations[joint]!), weight)
    }
    if (total === 0) throw new Error('Survivor mesh has an unweighted vertex')
    sum.divideScalar(total).toArray(fitted, vertex * 3)
    lowest = Math.min(lowest, sum.y)
    facing.transformDirection(host.bindMatrixInverse).toArray(normals, vertex * 3)
    if (tangents) {
      turned.transformDirection(host.bindMatrixInverse).toArray(tangents, vertex * 4)
      tangents[vertex * 4 + 3] = tangent.getW(vertex)
    }
  }
  const positions = new Float32Array(count * 3)
  for (let vertex = 0; vertex < count; vertex++) {
    point.fromArray(fitted, vertex * 3)
    point.y += groundY - lowest
    point.applyMatrix4(host.bindMatrixInverse).toArray(positions, vertex * 3)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  if (tangents) geometry.setAttribute('tangent', new Float32BufferAttribute(tangents, 4))
  geometry.setAttribute('uv', source.getAttribute('uv'))
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(joints, 4))
  geometry.setAttribute('skinWeight', skinWeight)
  geometry.setIndex(source.index)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

async function dress(host: GLTF, url: string) {
  const guest = await new GLTFLoader().loadAsync(url)
  const [hostMesh, ...rest] = skinnedMeshes(host.scene)
  const guestMeshes = skinnedMeshes(guest.scene)
  if (!hostMesh) throw new Error('The animation character has no skinned mesh')
  if (guestMeshes.length !== 1) throw new Error(`The survivor needs exactly one skinned mesh, found ${guestMeshes.length}`)
  const guestMesh = guestMeshes[0]!
  host.scene.updateMatrixWorld(true)
  const groundY = new Box3().setFromObject(host.scene, true).min.y
  const mesh = new SkinnedMesh(poseGeometry(hostMesh, guestMesh, groundY), rimLit(guestMesh.material as Material))
  mesh.name = 'Survivor'
  mesh.castShadow = true
  mesh.receiveShadow = true
  const parent = hostMesh.parent ?? host.scene
  for (const old of [hostMesh, ...rest]) old.removeFromParent()
  parent.add(mesh)
  mesh.bind(hostMesh.skeleton, hostMesh.bindMatrix)
  return host
}
