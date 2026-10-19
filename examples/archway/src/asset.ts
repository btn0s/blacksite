import { Matrix4 } from 'three'
import { loadMeshletAsset } from '@blacksite/geometry'
import { loadScanMaterial, type ScanSurface } from '../../shared/scan-material'

const root = '/owned/dark-ruins/'

export async function loadArchway() {
  const [manifestResponse, surfacesResponse, colliderResponse] = await Promise.all(['manifest.json', 'surfaces.json', 'collider.json'].map(file => fetch(root + file)))
  if (![manifestResponse, surfacesResponse, colliderResponse].every(response => response.ok)) throw new Error('Build the owned archway assets before opening this example')
  const [manifest, surfaceSet, collider] = await Promise.all([manifestResponse.json(), surfacesResponse.json(), colliderResponse.json()])
  if (manifest.geometries.length !== 1) throw new Error('The showcase requires one source mesh')
  const asset = await loadMeshletAsset(root + manifest.geometries[0].url)
  const materials = await Promise.all(surfaceSet.surfaces.map((surface: ScanSurface) => loadScanMaterial(surface, root)))
  const bounds = asset.metadata.bounds
  const offset = [-(bounds.min[0] + bounds.max[0]) / 2, -bounds.min[1], -(bounds.min[2] + bounds.max[2]) / 2] as const
  const matrix = new Matrix4().makeTranslation(...offset)
  const vertices = Float32Array.from(collider.positions)
  for (let i = 0; i < vertices.length; i++) vertices[i] += offset[i % 3]
  return { asset, materials, matrix, collider: { vertices, indices: Uint32Array.from(collider.indices) } }
}

export type ArchwayAsset = Awaited<ReturnType<typeof loadArchway>>
