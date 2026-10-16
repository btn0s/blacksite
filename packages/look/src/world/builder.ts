import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { contactShadow, surface, worldBoxGeometry, worldCylinderGeometry, worldPlaneGeometry, type GroundAO, type SurfaceName } from './surfaces'

export type BoxCollider = { kind: 'box'; half: [number, number, number]; position: [number, number, number]; rotation: [number, number, number] }
export type CylinderCollider = { kind: 'cylinder'; halfHeight: number; radius: number; position: [number, number, number]; rotation: [number, number, number] }
export type Collider = BoxCollider | CylinderCollider

type Material = { name: SurfaceName; color?: string; scale?: number; ao?: GroundAO | false }
type Place = { at: [number, number, number]; rotate?: number | [number, number, number]; collide?: boolean; shadow?: boolean | number; cast?: boolean }

const keyOf = (material: Material) => `${material.name}|${material.color ?? ''}|${material.scale ?? 1}|${material.ao === false ? 'noao' : JSON.stringify(material.ao ?? '')}`

export class LevelBuilder {
  private parts = new Map<string, { material: Material; geometries: THREE.BufferGeometry[]; cast: boolean }>()
  private contacts: THREE.BufferGeometry[] = []
  private meshes: THREE.Mesh[] = []
  readonly colliders: Collider[] = []
  private matrix = new THREE.Matrix4()
  private quaternion = new THREE.Quaternion()
  private euler = new THREE.Euler()

  private add(geometry: THREE.BufferGeometry, material: Material, place: Place) {
    const rotation = typeof place.rotate === 'number' ? [0, place.rotate, 0] as const : place.rotate ?? [0, 0, 0] as const
    this.quaternion.setFromEuler(this.euler.set(rotation[0], rotation[1], rotation[2]))
    this.matrix.compose(new THREE.Vector3(...place.at), this.quaternion, new THREE.Vector3(1, 1, 1))
    geometry.applyMatrix4(this.matrix)
    const cast = place.cast ?? true
    const key = `${keyOf(material)}|${cast}`
    let part = this.parts.get(key)
    if (!part) { part = { material, geometries: [], cast }; this.parts.set(key, part) }
    part.geometries.push(geometry)
    return rotation
  }

  box(size: [number, number, number], material: Material, place: Place) {
    const tile = surface(material.name, material).userData.tile as number
    const rotation = this.add(worldBoxGeometry(size[0], size[1], size[2], tile), material, place)
    if (place.collide !== false) this.colliders.push({ kind: 'box', half: [size[0] / 2, size[1] / 2, size[2] / 2], position: [...place.at], rotation: [...rotation] })
    if (place.shadow !== false && place.at[1] - size[1] / 2 < 0.2) {
      const contact = contactShadow(size[0], size[2]).geometry.clone()
      contact.rotateX(-Math.PI / 2)
      contact.rotateY(rotation[1])
      contact.translate(place.at[0], 0.015, place.at[2])
      this.contacts.push(contact)
    }
  }

  cylinder(radius: number, height: number, material: Material, place: Place, segments = 12) {
    const tile = surface(material.name, material).userData.tile as number
    const rotation = this.add(worldCylinderGeometry(radius, height, tile, segments), material, place)
    if (place.collide !== false) this.colliders.push({ kind: 'cylinder', halfHeight: height / 2, radius, position: [...place.at], rotation: [...rotation] })
    if (place.shadow !== false && place.at[1] - height / 2 < 0.2 && rotation[0] === 0 && rotation[2] === 0) {
      const contact = contactShadow(radius * 2, radius * 2, 0.55, radius * 1.4).geometry.clone()
      contact.rotateX(-Math.PI / 2)
      contact.translate(place.at[0], 0.015, place.at[2])
      this.contacts.push(contact)
    }
  }

  plane(width: number, depth: number, material: Material, place: Place) {
    const tile = surface(material.name, material).userData.tile as number
    this.add(worldPlaneGeometry(width, depth, tile), material, { ...place, cast: false })
  }

  contact(width: number, depth: number, at: [number, number], rotate = 0) {
    const contact = contactShadow(width, depth).geometry.clone()
    contact.rotateX(-Math.PI / 2)
    contact.rotateY(rotate)
    contact.translate(at[0], 0.015, at[1])
    this.contacts.push(contact)
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
    for (const part of this.parts.values()) {
      const geometry = mergeGeometries(part.geometries.map(item => item.index ? item.toNonIndexed() : item), false)
      for (const item of part.geometries) item.dispose()
      geometry.computeBoundingSphere()
      const mesh = new THREE.Mesh(geometry, surface(part.material.name, part.material))
      mesh.castShadow = part.cast
      mesh.receiveShadow = true
      mesh.matrixAutoUpdate = false
      group.add(mesh)
    }
    for (const mesh of this.meshes) group.add(mesh)
    if (this.contacts.length) {
      const template = contactShadow(1, 1)
      template.geometry.dispose()
      const contactMesh = new THREE.Mesh(mergeGeometries(this.contacts, false), template.material)
      contactMesh.renderOrder = 1
      contactMesh.matrixAutoUpdate = false
      group.add(contactMesh)
    }
    return group
  }
}
