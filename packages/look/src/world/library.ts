import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js'
import { ktx2Loader } from '@blacksite/materials/three'
import { CATALOG } from './catalog'
import { worldRenderer } from './surfaces'

type Vec3 = readonly [number, number, number]

export type PropName = keyof typeof CATALOG
export type PropInfo = { readonly title: string; readonly min: Vec3; readonly max: Vec3; readonly size: Vec3; readonly footprint: readonly [number, number]; readonly triangles: number }
export type PropPlacement = { readonly at: Vec3; readonly yaw?: number; readonly scale?: number | Vec3; readonly tint?: THREE.ColorRepresentation }
export type PropInstance = PropPlacement & { readonly name: PropName }

export const PROP_NAMES = Object.keys(CATALOG) as PropName[]

export const PROPS = Object.fromEntries(PROP_NAMES.map(name => {
  const { title, min, max, size, footprint, triangles } = CATALOG[name]
  return [name, { title, min, max, size, footprint, triangles }]
})) as Record<PropName, PropInfo>

type Part = { readonly geometry: THREE.BufferGeometry; readonly material: THREE.MeshStandardMaterial; readonly matrix: THREE.Matrix4 }

const templates = new Map<PropName, THREE.Group>()
const parts = new Map<PropName, Part[]>()
const tints = new Map<THREE.Material, Map<number, THREE.MeshStandardMaterial>>()
let loading: Promise<void> | undefined

const MAPS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'] as const

function standard(source: THREE.Material, anisotropy: number) {
  const material = source instanceof THREE.MeshStandardMaterial && !(source instanceof THREE.MeshPhysicalMaterial) ? source : new THREE.MeshStandardMaterial().copy(source as THREE.MeshStandardMaterial)
  for (const key of MAPS) {
    const texture = material[key]
    if (texture) texture.anisotropy = anisotropy
  }
  return material
}

function template(name: PropName, scene: THREE.Object3D, anisotropy: number) {
  scene.updateMatrixWorld(true)
  const group = new THREE.Group()
  group.name = name
  const list: Part[] = []
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    const material = standard(object.material as THREE.Material, anisotropy)
    const mesh = new THREE.Mesh(object.geometry as THREE.BufferGeometry, material)
    mesh.name = object.name
    object.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
    list.push({ geometry: mesh.geometry, material, matrix: object.matrixWorld.clone() })
  })
  parts.set(name, list)
  return group
}

async function load(given?: THREE.WebGLRenderer) {
  const renderer = given ?? await worldRenderer()
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2Loader(renderer))
  await Promise.all(PROP_NAMES.map(async name => {
    const gltf = await loader.loadAsync(CATALOG[name].url)
    templates.set(name, template(name, gltf.scene, anisotropy))
  }))
}

export function propsReady(renderer?: THREE.WebGLRenderer) {
  loading ??= load(renderer)
  return loading
}

function tinted(material: THREE.MeshStandardMaterial, tint: THREE.ColorRepresentation) {
  const color = new THREE.Color(tint)
  const key = color.getHex()
  let cache = tints.get(material)
  if (!cache) { cache = new Map(); tints.set(material, cache) }
  let found = cache.get(key)
  if (!found) {
    found = material.clone()
    found.color.multiply(color)
    cache.set(key, found)
  }
  return found
}

function placement({ at, yaw = 0, scale = 1 }: PropPlacement, target = new THREE.Matrix4()) {
  const size = typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : new THREE.Vector3(scale[0], scale[1], scale[2])
  return target.compose(new THREE.Vector3(at[0], at[1], at[2]), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), size)
}

function ready(name: PropName) {
  const found = templates.get(name)
  if (!found) throw new Error(`${name}: await propsReady() before placing props`)
  return found
}

export function prop(name: PropName, options: PropPlacement) {
  const object = ready(name).clone()
  placement(options).decompose(object.position, object.quaternion, object.scale)
  if (options.tint !== undefined) for (const child of object.children) if (child instanceof THREE.Mesh) child.material = tinted(child.material as THREE.MeshStandardMaterial, options.tint)
  object.userData.prop = name
  return object
}

export function scatterProps(instances: readonly PropInstance[]) {
  const group = new THREE.Group()
  group.name = 'props'
  const byName = new Map<PropName, PropInstance[]>()
  for (const instance of instances) {
    ready(instance.name)
    const list = byName.get(instance.name)
    if (list) list.push(instance)
    else byName.set(instance.name, [instance])
  }
  const matrix = new THREE.Matrix4()
  const color = new THREE.Color()
  for (const [name, list] of byName) {
    const placed = list.map(instance => placement(instance))
    const colored = list.some(instance => instance.tint !== undefined)
    for (const part of parts.get(name)!) {
      const mesh = new THREE.InstancedMesh(part.geometry, part.material, list.length)
      list.forEach((instance, index) => {
        mesh.setMatrixAt(index, matrix.multiplyMatrices(placed[index]!, part.matrix))
        if (colored) mesh.setColorAt(index, color.set(instance.tint ?? 0xffffff))
      })
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
      mesh.computeBoundingBox()
      mesh.computeBoundingSphere()
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.name = name
      mesh.userData.prop = name
      group.add(mesh)
    }
  }
  return group
}
