import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { describeCoplanar, resolveCoplanar, type CoplanarMode, type CoplanarResolution, type FaceSource } from './coplanar'
import { contactShadow, surface, worldBoxGeometry, worldCylinderGeometry, worldPlaneGeometry, type GroundAO, type SurfaceName } from './surfaces'

export type BoxCollider = { kind: 'box'; half: [number, number, number]; position: [number, number, number]; rotation: [number, number, number] }
export type CylinderCollider = { kind: 'cylinder'; halfHeight: number; radius: number; position: [number, number, number]; rotation: [number, number, number] }
export type Collider = BoxCollider | CylinderCollider

type Material = { name: SurfaceName; color?: string; scale?: number; ao?: GroundAO | false; decal?: number }
type Place = { at: [number, number, number]; rotate?: number | [number, number, number]; collide?: boolean; shadow?: boolean | number; cast?: boolean; name?: string }

export type LevelBuilderOptions = { coplanar?: CoplanarMode; separation?: number }

export type LevelPart = { start: number; count: number; label: string; box: THREE.Box3 }

const partRay = new THREE.Ray()
const partInverse = new THREE.Matrix4()

function raycastParts(this: THREE.Mesh, raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) {
  const parts = this.userData.parts as LevelPart[]
  const range = this.geometry.drawRange
  const [start, count] = [range.start, range.count]
  partRay.copy(raycaster.ray).applyMatrix4(partInverse.copy(this.matrixWorld).invert())
  for (const part of parts) {
    if (!partRay.intersectsBox(part.box)) continue
    this.geometry.setDrawRange(part.start * 3, part.count * 3)
    THREE.Mesh.prototype.raycast.call(this, raycaster, intersects)
  }
  this.geometry.setDrawRange(start, count)
}

const keyOf = (material: Material) => `${material.name}|${material.color ?? ''}|${material.scale ?? 1}|${material.ao === false ? 'noao' : JSON.stringify(material.ao ?? '')}|${material.decal ?? ''}`

const extent = (plane: { width: number; depth: number; quaternion: THREE.Quaternion }) => {
  const size = new THREE.Vector3(plane.width, 0, plane.depth).applyQuaternion(plane.quaternion)
  return new THREE.Vector3(Math.abs(size.x), 0, Math.abs(size.z))
}

export class LevelBuilder {
  private parts = new Map<string, { material: Material; geometries: THREE.BufferGeometry[]; labels: string[]; cast: boolean }>()
  private contacts: Array<{ geometry: THREE.BufferGeometry; x: number; z: number }> = []
  private planes: Array<{ geometry: THREE.BufferGeometry; material: Material; label: string; source: Extract<FaceSource, { kind: 'plane' }> }> = []
  private meshes: THREE.Mesh[] = []
  readonly colliders: Collider[] = []
  private sources: FaceSource[] = []
  private resolved: CoplanarResolution[] = []
  private options: Required<LevelBuilderOptions>
  private matrix = new THREE.Matrix4()
  private quaternion = new THREE.Quaternion()
  private euler = new THREE.Euler()

  constructor(options: LevelBuilderOptions = {}) {
    this.options = { coplanar: options.coplanar ?? 'resolve', separation: options.separation ?? 0.02 }
  }

  get coplanar() { return this.resolved }

  private label(kind: string, material: Material, place: Place) {
    return place.name ?? `${material.name} ${kind} at (${place.at.map(value => Math.round(value * 100) / 100).join(', ')})`
  }

  private transform(geometry: THREE.BufferGeometry, place: Place) {
    const rotation = typeof place.rotate === 'number' ? [0, place.rotate, 0] as const : place.rotate ?? [0, 0, 0] as const
    this.quaternion.setFromEuler(this.euler.set(rotation[0], rotation[1], rotation[2]))
    this.matrix.compose(new THREE.Vector3(...place.at), this.quaternion, new THREE.Vector3(1, 1, 1))
    geometry.applyMatrix4(this.matrix)
    return { rotation, quaternion: this.quaternion.clone() }
  }

  private register(geometry: THREE.BufferGeometry, material: Material, cast: boolean, label: string) {
    const key = `${keyOf(material)}|${cast}`
    let part = this.parts.get(key)
    if (!part) { part = { material, geometries: [], labels: [], cast }; this.parts.set(key, part) }
    part.geometries.push(geometry)
    part.labels.push(label)
  }

  private add(geometry: THREE.BufferGeometry, material: Material, place: Place, label: string) {
    const placed = this.transform(geometry, place)
    this.register(geometry, material, place.cast ?? true, label)
    return placed
  }

  private pushContact(geometry: THREE.BufferGeometry, x: number, z: number) {
    geometry.translate(x, 0.015, z)
    this.contacts.push({ geometry, x, z })
  }

  box(size: [number, number, number], material: Material, place: Place) {
    const tile = surface(material.name, material).userData.tile as number
    const label = this.label('box', material, place)
    const geometry = worldBoxGeometry(size[0], size[1], size[2], tile)
    const { rotation, quaternion } = this.add(geometry, material, place, label)
    this.sources.push({ kind: 'box', label, size: [...size], position: new THREE.Vector3(...place.at), quaternion, geometry })
    if (place.collide !== false) this.colliders.push({ kind: 'box', half: [size[0] / 2, size[1] / 2, size[2] / 2], position: [...place.at], rotation: [...rotation] })
    if (place.shadow !== false && place.at[1] - size[1] / 2 < 0.2) {
      const contact = contactShadow(size[0], size[2]).geometry.clone()
      contact.rotateX(-Math.PI / 2)
      contact.rotateY(rotation[1])
      this.pushContact(contact, place.at[0], place.at[2])
    }
  }

  cylinder(radius: number, height: number, material: Material, place: Place, segments = 12) {
    const tile = surface(material.name, material).userData.tile as number
    const label = this.label('cylinder', material, place)
    const geometry = worldCylinderGeometry(radius, height, tile, segments)
    const { rotation, quaternion } = this.add(geometry, material, place, label)
    this.sources.push({ kind: 'cylinder', label, size: [radius * 2, height, radius * 2], position: new THREE.Vector3(...place.at), quaternion, geometry })
    if (place.collide !== false) this.colliders.push({ kind: 'cylinder', halfHeight: height / 2, radius, position: [...place.at], rotation: [...rotation] })
    if (place.shadow !== false && place.at[1] - height / 2 < 0.2 && rotation[0] === 0 && rotation[2] === 0) {
      const contact = contactShadow(radius * 2, radius * 2, 0.55, radius * 1.4).geometry.clone()
      contact.rotateX(-Math.PI / 2)
      this.pushContact(contact, place.at[0], place.at[2])
    }
  }

  plane(width: number, depth: number, material: Material, place: Place) {
    const tile = surface(material.name, material).userData.tile as number
    const label = this.label('plane', material, place)
    const geometry = worldPlaneGeometry(width, depth, tile)
    const { quaternion } = this.transform(geometry, place)
    const source = { kind: 'plane' as const, label, width, depth, position: new THREE.Vector3(...place.at), quaternion, geometry }
    this.sources.push(source)
    this.planes.push({ geometry, material, label, source })
  }

  contact(width: number, depth: number, at: [number, number], rotate = 0) {
    const contact = contactShadow(width, depth).geometry.clone()
    contact.rotateX(-Math.PI / 2)
    contact.rotateY(rotate)
    this.pushContact(contact, at[0], at[1])
  }

  private layerPlanes() {
    const gap = 0.012
    const ordered = [...this.planes].sort((p, q) => p.source.position.y - q.source.position.y)
    const bounds = (item: (typeof ordered)[number]) => new THREE.Box3().setFromCenterAndSize(item.source.position, extent(item.source))
    const boxes = new Map(ordered.map(item => [item, bounds(item)] as const))
    ordered.forEach((item, index) => {
      let y = Math.max(item.source.position.y, gap)
      for (let below = 0; below < index; below++) {
        const other = ordered[below]!
        const a = boxes.get(item)!
        const b = boxes.get(other)!
        if (a.min.x < b.max.x && a.max.x > b.min.x && a.min.z < b.max.z && a.max.z > b.min.z) y = Math.max(y, other.source.position.y + gap)
      }
      const lift = y - item.source.position.y
      if (lift > 1e-6) {
        item.geometry.translate(0, lift, 0)
        item.source.position.y = y
        boxes.get(item)!.translate(new THREE.Vector3(0, lift, 0))
      }
    })
  }

  collider(collider: Collider) { this.colliders.push(collider) }

  mesh(mesh: THREE.Mesh) {
    mesh.updateMatrix()
    mesh.matrixAutoUpdate = false
    this.meshes.push(mesh)
  }

  build() {
    const group = new THREE.Group()
    group.name = 'level'
    if (this.options.coplanar !== 'ignore') {
      this.resolved = resolveCoplanar(this.sources, { mode: this.options.coplanar, separation: this.options.separation })
      if (this.resolved.length) {
        const message = describeCoplanar(this.resolved, this.options.coplanar, this.options.separation)
        if (this.options.coplanar === 'throw') throw new Error(message)
        console.warn(message)
      }
    }
    this.layerPlanes()
    for (const item of this.planes) this.register(item.geometry, { ...item.material, decal: item.material.decal ?? 1 / 3 }, false, item.label)
    const local = new THREE.Vector3()
    const inverse = new THREE.Quaternion()
    for (const contact of this.contacts) {
      let top = 0
      for (const item of this.planes) {
        const plane = item.source
        local.set(contact.x - plane.position.x, 0, contact.z - plane.position.z).applyQuaternion(inverse.copy(plane.quaternion).invert())
        if (Math.abs(local.x) <= plane.width / 2 && Math.abs(local.z) <= plane.depth / 2) top = Math.max(top, plane.position.y)
      }
      if (top + 0.006 > 0.015) contact.geometry.translate(0, top + 0.006 - 0.015, 0)
    }
    for (const part of this.parts.values()) {
      const pieces = part.geometries.map(item => item.index ? item.toNonIndexed() : item)
      const geometry = mergeGeometries(pieces, false)
      let start = 0
      const labelled = pieces.map((item, index): LevelPart => {
        const count = item.getAttribute('position').count / 3
        item.computeBoundingBox()
        const entry = { start, count, label: part.labels[index]!, box: item.boundingBox!.clone().expandByScalar(1e-3) }
        start += count
        return entry
      })
      for (const item of part.geometries) item.dispose()
      geometry.computeBoundingSphere()
      const mesh = new THREE.Mesh(geometry, surface(part.material.name, part.material))
      mesh.name = `level ${part.material.name}`
      mesh.userData.parts = labelled
      mesh.raycast = raycastParts
      mesh.castShadow = part.cast
      mesh.receiveShadow = true
      mesh.matrixAutoUpdate = false
      group.add(mesh)
    }
    for (const mesh of this.meshes) group.add(mesh)
    if (this.contacts.length) {
      const template = contactShadow(1, 1)
      template.geometry.dispose()
      const contactMesh = new THREE.Mesh(mergeGeometries(this.contacts.map(item => item.geometry), false), template.material)
      contactMesh.renderOrder = 1
      contactMesh.matrixAutoUpdate = false
      group.add(contactMesh)
    }
    return group
  }
}
