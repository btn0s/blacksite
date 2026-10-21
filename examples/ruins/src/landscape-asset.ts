import { createHeightfield, edgeTextureFromData, loadLayerImages, surfaceTextureFromData, terrainUniforms, type TerrainLayerSpec, type TerrainSources, type WaterLayout } from '@blacksite/landscape'

const root = '/owned/dark-ruins/build-landscape-20261020-07/'
const kit = import.meta.glob<string>('../../../packages/look/assets/world/grass_{c,n}.webp', { eager: true, query: '?url&no-inline', import: 'default' })
const kitUrl = (name: string) => {
  const url = kit[`../../../packages/look/assets/world/${name}.webp`]
  if (!url) throw new Error(`Missing world kit surface ${name}`)
  return url
}

type FieldRecord = { file: string; size: number; extent: number; origin: [number, number]; min: number; max: number; bytes: number }
type Manifest = { version: number; band: number; seaLevel: number; near: FieldRecord; far: FieldRecord; edge: { file: string; range: number }; water: string; averages: [number, number, number][]; layers: { name: string }[] }

export const landscapeLayerSpecs: [TerrainLayerSpec, TerrainLayerSpec, TerrainLayerSpec, TerrainLayerSpec] = [
  { tile: 3.2, tint: [0.58, 0.64, 0.5], roughness: 0.95, normalScale: 0.8 },
  { tile: 2.8, tint: [0.95, 0.9, 0.85], roughness: 0.92, normalScale: 1 },
  { tile: 3.6, tint: [1.1, 1.05, 0.95], roughness: 0.88, normalScale: 0.9 },
  { tile: 6, tint: [0.85, 0.85, 0.85], roughness: 0.85, normalScale: 1.1 },
]

export const landscapeFootprint = { tint: [0.62, 0.64, 0.68] as [number, number, number], reach: 45 }

async function fetchBytes(file: string) {
  const response = await fetch(root + file)
  if (!response.ok) throw new Error(`Landscape asset unavailable: ${file} (${response.status})`)
  return response
}

async function loadField(record: FieldRecord) {
  const response = await fetchBytes(record.file)
  const packed = new Uint8Array(await new Response(response.body!.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer())
  const cells = record.size * record.size
  if (packed.length !== cells * 6) throw new Error(`Landscape field ${record.file} has the wrong size`)
  const quantized = new Uint16Array(packed.buffer, packed.byteOffset, cells)
  const heights = new Float32Array(cells)
  const scale = (record.max - record.min) / 65535
  for (let index = 0; index < cells; index++) heights[index] = record.min + quantized[index]! * scale
  return { field: createHeightfield({ size: record.size, extent: record.extent, origin: record.origin, heights }), surface: surfaceTextureFromData(packed.slice(cells * 2), record.size) }
}

async function loadEdge(manifest: Manifest) {
  const response = await fetchBytes(manifest.edge.file)
  const packed = new Uint8Array(await new Response(response.body!.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer())
  if (packed.length !== manifest.near.size * manifest.near.size) throw new Error('Landscape edge map has the wrong size')
  return edgeTextureFromData(packed, manifest.near.size)
}

export async function loadLandscape() {
  const manifest: Manifest = await (await fetchBytes('landscape.json')).json()
  if (manifest.version !== 3) throw new Error('Landscape manifest is incompatible')
  const [near, far, edge, water, images] = await Promise.all([loadField(manifest.near), loadField(manifest.far), loadEdge(manifest), fetchBytes(manifest.water).then(response => response.json() as Promise<WaterLayout>), loadLayerImages([
    { color: kitUrl('grass_c'), normal: kitUrl('grass_n') },
    ...manifest.layers.map(layer => ({ color: `${root}layers/${layer.name}_c.webp`, normal: `${root}layers/${layer.name}_n.webp` })),
  ], 1024)])
  const sources: TerrainSources = { near: near.field, far: far.field, nearSurface: near.surface, farSurface: far.surface, band: manifest.band, nearEdge: edge, edgeRange: manifest.edge.range }
  return { manifest, sources, water, uniforms: terrainUniforms(sources), averages: manifest.averages, layers: { ...images, averages: manifest.averages } }
}

export type LandscapeAsset = Awaited<ReturnType<typeof loadLandscape>>
