import { Matrix4, RepeatWrapping, SRGBColorSpace, TextureLoader, Vector2 } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { clamp, float, mix, texture, vec3 } from 'three/tsl'
import { loadMeshletAsset } from '@blacksite/geometry'

const root = '/owned/dark-ruins/'

export async function loadArchway() {
  const [manifestResponse, surfacesResponse, colliderResponse] = await Promise.all(['manifest.json', 'surfaces.json', 'collider.json'].map(file => fetch(root + file)))
  if (![manifestResponse, surfacesResponse, colliderResponse].every(response => response.ok)) throw new Error('Build the owned archway assets before opening this example')
  const [manifest, surfaceSet, collider] = await Promise.all([manifestResponse.json(), surfacesResponse.json(), colliderResponse.json()])
  if (manifest.geometries.length !== 1) throw new Error('The showcase requires one source mesh')
  const asset = await loadMeshletAsset(root + manifest.geometries[0].url)
  const loader = new TextureLoader()
  const materials = await Promise.all(surfaceSet.surfaces.map(async (surface: {
    path: string
    maps: Record<string, string>
    parameters: { scalar: Record<string, number>; vector: Record<string, number[]>; static_switch: Record<string, boolean> }
  }) => {
    const maps = await Promise.all(['Albedo', 'Normal', 'Packed'].map(name => loader.loadAsync(root + surface.maps[name])))
    for (const map of maps) { map.flipY = false; map.wrapS = map.wrapT = RepeatWrapping; map.anisotropy = 8 }
    const [albedo, normal, packed] = maps
    albedo.colorSpace = SRGBColorSpace
    const scalar = surface.parameters.scalar
    const vector = surface.parameters.vector
    const scale = scalar['UVs - Base  Scale']
    for (const map of maps) { map.repeat.setScalar(scale); map.center.set(scalar['UVs - Base  Pivot X'], scalar['UVs - Base  Pivot Y']); map.rotation = scalar['UVs - Base  Rotation'] * Math.PI / 180; map.offset.set(scalar['UVs - Base  Offset X'], scalar['UVs - Base  Offset  Y']) }
    const material = new MeshStandardNodeMaterial({ name: surface.path.split('/').at(-1), map: albedo, normalMap: normal, normalScale: new Vector2(scalar['Base - Normal Intensity'], -scalar['Base - Normal Intensity']), metalness: scalar['Base - Metallic Intensity'], roughness: 1 })
    const color = texture(albedo)
    const controls = vector['Base - Albedo Controls']
    const tint = vec3(...vector['Base - Albedo Tint'].slice(0, 3) as [number, number, number])
    material.colorNode = mix(vec3(color.rgb.dot(vec3(0.3, 0.59, 0.11))), color.rgb, controls[0]).sub(0.5).mul(controls[1]).add(0.5).mul(controls[2]).mul(tint).clamp(0, 1)
    const roughness = texture(packed).g.sub(0.5).mul(scalar['Base - Roughness Contrast']).add(0.5).clamp(0, 1).mul(scalar['Base - Roughness Mult'])
    material.roughnessNode = clamp(surface.parameters.static_switch['Use Roughness MinMax'] ? mix(float(scalar['Base - Roughness Min']), float(scalar['Base - Roughness Max']), roughness) : roughness, 0.04, 1)
    return material
  }))
  const bounds = asset.metadata.bounds
  const offset = [-(bounds.min[0] + bounds.max[0]) / 2, -bounds.min[1], -(bounds.min[2] + bounds.max[2]) / 2] as const
  const matrix = new Matrix4().makeTranslation(...offset)
  const vertices = Float32Array.from(collider.positions)
  for (let i = 0; i < vertices.length; i++) vertices[i] += offset[i % 3]
  return { asset, materials, matrix, collider: { vertices, indices: Uint32Array.from(collider.indices) } }
}

export type ArchwayAsset = Awaited<ReturnType<typeof loadArchway>>
