import { Box3, BufferGeometry, Mesh, MeshStandardMaterial, Sphere, Texture } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

export interface FoliagePrimitive {
  readonly name: string
  readonly geometry: BufferGeometry
  readonly material: MeshStandardMaterial
  readonly triangles: number
}

export interface FoliageModel {
  readonly name: string
  readonly primitives: readonly FoliagePrimitive[]
  readonly bounds: Sphere
  readonly box: Box3
  readonly height: number
  readonly triangles: number
  dispose(): void
}

export async function loadFoliageModel(url: string, options: { materialsFrom?: FoliageModel } = {}): Promise<FoliageModel> {
  const gltf = await new GLTFLoader().loadAsync(url)
  gltf.scene.updateMatrixWorld(true)
  const primitives: FoliagePrimitive[] = []
  const originals = new Set<BufferGeometry>()
  const ownedMaterials = new Set<MeshStandardMaterial>()
  const textures = new Set<Texture>()
  const materialLibrary = new Map(options.materialsFrom?.primitives.map(primitive => [primitive.material.name, primitive.material]))
  const box = new Box3()
  gltf.scene.traverse(object => {
    if (!(object instanceof Mesh)) return
    if (object.isSkinnedMesh) throw new Error(`Foliage models must be static: ${url}`)
    if (Array.isArray(object.material)) throw new Error(`Foliage primitives must each have one material: ${url}`)
    if (!(object.material instanceof MeshStandardMaterial)) throw new Error(`Foliage requires standard physical materials: ${url}`)
    const original = object.material
    ownedMaterials.add(original)
    for (const value of Object.values(original)) if (value instanceof Texture) textures.add(value)
    const material = options.materialsFrom ? materialLibrary.get(original.name) : original
    if (!material) throw new Error(`Foliage LOD references an unknown source material: ${original.name}`)
    if (material.transparent) throw new Error(`Foliage requires opaque or alpha-tested materials: ${material.name}`)
    const geometry = object.geometry.clone().applyMatrix4(object.matrixWorld)
    if (!geometry.index) geometry.setIndex(Array.from({ length: geometry.getAttribute('position').count }, (_, index) => index))
    for (const value of Object.values(material)) {
      if (value instanceof Texture && !geometry.hasAttribute(value.channel === 0 ? 'uv' : `uv${value.channel}`)) throw new Error(`Foliage geometry is missing UV channel ${value.channel}: ${original.name}`)
    }
    geometry.computeBoundingBox()
    geometry.computeBoundingSphere()
    box.union(geometry.boundingBox!)
    originals.add(object.geometry)
    primitives.push({ name: object.name, geometry, material, triangles: geometry.index!.count / 3 })
  })
  if (!primitives.length) throw new Error(`Foliage model contains no static meshes: ${url}`)
  for (const geometry of originals) geometry.dispose()
  const bounds = box.getBoundingSphere(new Sphere())
  return {
    name: gltf.scene.name || url.split('/').at(-1) || 'foliage',
    primitives, bounds, box, height: box.max.y - box.min.y,
    triangles: primitives.reduce((sum, primitive) => sum + primitive.triangles, 0),
    dispose() {
      for (const primitive of primitives) primitive.geometry.dispose()
      for (const material of ownedMaterials) material.dispose()
      for (const texture of textures) texture.dispose()
    },
  }
}
