import { Bone, BufferGeometry, SkinnedMesh, type Object3D } from 'three'
import { clone } from 'three/addons/utils/SkeletonUtils.js'

export function cropArmsGeometry(mesh: SkinnedMesh): BufferGeometry {
  const source = mesh.geometry
  const joints = source.getAttribute('skinIndex')
  const weights = source.getAttribute('skinWeight')
  if (!joints || !weights) throw new Error('Arms require skinned geometry')
  const armBones = new Set<number>()
  mesh.skeleton.bones.forEach((bone, index) => {
    let ancestor: Object3D | null = bone
    while (ancestor instanceof Bone) {
      if (/^lowerarm_[lr]$/.test(ancestor.name)) { armBones.add(index); break }
      ancestor = ancestor.parent
    }
  })
  const included = new Uint8Array(joints.count)
  for (let vertex = 0; vertex < joints.count; vertex++) {
    let influence = 0
    for (let slot = 0; slot < 4; slot++) {
      if (armBones.has(joints.getComponent(vertex, slot))) influence += weights.getComponent(vertex, slot)
    }
    included[vertex] = influence >= 0.5 ? 1 : 0
  }
  const geometry = source.clone()
  geometry.clearGroups()
  const indices: number[] = []
  const sourceIndex = source.getIndex()
  const count = sourceIndex?.count ?? joints.count
  const groups = source.groups.length ? source.groups : [{ start: 0, count, materialIndex: 0 }]
  for (const group of groups) {
    const start = indices.length
    for (let index = group.start; index < Math.min(group.start + group.count, count); index += 3) {
      const a = sourceIndex?.getX(index) ?? index
      const b = sourceIndex?.getX(index + 1) ?? index + 1
      const c = sourceIndex?.getX(index + 2) ?? index + 2
      if (included[a] && included[b] && included[c]) indices.push(a, b, c)
    }
    geometry.addGroup(start, indices.length - start, group.materialIndex)
  }
  geometry.setIndex(indices)
  return geometry
}

export function createArmsMesh(source: Object3D) {
  const scene = clone(source)
  const geometries: BufferGeometry[] = []
  let triangles = 0
  scene.traverse(object => {
    if (!(object instanceof SkinnedMesh)) return
    object.geometry = cropArmsGeometry(object)
    object.frustumCulled = false
    object.castShadow = false
    object.receiveShadow = false
    object.geometry.groups = object.geometry.groups.filter((group: { count: number }) => group.count > 0)
    const count = object.geometry.getIndex()?.count ?? 0
    object.visible = count > 0
    geometries.push(object.geometry)
    triangles += count / 3
  })
  if (!triangles) throw new Error('Character contains no weighted clavicle/arm skin')
  return { scene, triangles, dispose: () => geometries.forEach(geometry => geometry.dispose()) }
}
