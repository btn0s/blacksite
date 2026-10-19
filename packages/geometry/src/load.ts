import { CLUSTER_LOD_STRIDE, CLUSTER_STRIDE, GROUP_STRIDE, MESHLET_MAGIC, MESHLET_SECTIONS, MESHLET_VERSION } from './format'
import type { MeshletAsset, MeshletMetadata } from './format'

export function parseMeshletAsset(buffer: ArrayBuffer): MeshletAsset {
  if (buffer.byteLength < 32) throw new Error('Geometry file is truncated')
  const header = new DataView(buffer)
  if (header.getUint32(0, true) !== MESHLET_MAGIC) throw new Error('Geometry file signature is invalid')
  if (header.getUint32(4, true) !== MESHLET_VERSION) throw new Error('Geometry file version is unsupported')
  const sectionCount = header.getUint32(8, true)
  const metadataLength = header.getUint32(12, true)
  const byteLength = header.getUint32(16, true)
  if (sectionCount !== MESHLET_SECTIONS.length || byteLength !== buffer.byteLength) throw new Error('Geometry file layout is invalid')
  const metadataOffset = 32 + sectionCount * 16
  if (metadataOffset + metadataLength > byteLength) throw new Error('Geometry metadata is truncated')
  const metadata: MeshletMetadata = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, metadataOffset, metadataLength)))
  const arrays: Record<string, Float32Array | Uint32Array> = {}
  for (let i = 0; i < sectionCount; i++) {
    const entry = 32 + i * 16
    const id = header.getUint32(entry, true)
    const offset = header.getUint32(entry + 4, true)
    const count = header.getUint32(entry + 8, true)
    const type = header.getUint32(entry + 12, true)
    const name = MESHLET_SECTIONS[id]
    if (!name || arrays[name] || offset % 4 || offset < metadataOffset + metadataLength || offset + count * 4 > byteLength || (type !== 0 && type !== 1)) throw new Error('Geometry section is invalid')
    arrays[name] = type === 0 ? new Float32Array(buffer, offset, count) : new Uint32Array(buffer, offset, count)
  }
  const asset = { metadata, ...arrays } as MeshletAsset
  const vertices = metadata.sourceVertices
  const clusters = metadata.clusterCount
  const groups = metadata.groupCount
  if (asset.positions.length !== vertices * 3 || asset.normals.length !== vertices * 3 || asset.uvs.length !== vertices * 2 || asset.sourceIndices.length !== metadata.sourceTriangles * 3 || asset.clusterData.length !== clusters * CLUSTER_STRIDE || asset.clusterBounds.length !== clusters * 4 || asset.clusterLod.length !== clusters * CLUSTER_LOD_STRIDE || asset.groupData.length !== groups * GROUP_STRIDE || asset.groupBounds.length !== groups * 8) throw new Error('Geometry section counts do not match metadata')
  return asset
}

export async function loadMeshletAsset(url: string | URL, signal?: AbortSignal): Promise<MeshletAsset> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Geometry request failed: ${response.status} ${response.statusText}`)
  return parseMeshletAsset(await response.arrayBuffer())
}
