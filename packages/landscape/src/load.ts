import { createHeightfield, surfaceTextureFromData } from './heightfield'
import type { FieldRecord, LandscapeManifest } from './bake'
import type { WaterLayout } from './river'
import type { TerrainSources } from './terrain'

export interface LoadedLandscape {
  readonly manifest: LandscapeManifest
  readonly sources: TerrainSources
  readonly water: WaterLayout
}

async function fetchResponse(base: string, file: string) {
  const response = await fetch(`${base}${file}`)
  if (!response.ok) throw new Error(`Landscape file unavailable: ${file} (${response.status})`)
  return response
}

async function loadField(base: string, record: FieldRecord) {
  const response = await fetchResponse(base, record.file)
  const packed = new Uint8Array(await new Response(response.body!.pipeThrough(new DecompressionStream('deflate'))).arrayBuffer())
  const cells = record.size * record.size
  if (packed.length !== cells * 6) throw new Error(`Landscape field ${record.file} has the wrong size`)
  const quantized = new Uint16Array(packed.buffer, packed.byteOffset, cells)
  const heights = new Float32Array(cells)
  const scale = (record.max - record.min) / 65535
  for (let index = 0; index < cells; index++) heights[index] = record.min + quantized[index]! * scale
  return { field: createHeightfield({ size: record.size, extent: record.extent, origin: record.origin, heights }), surface: surfaceTextureFromData(packed.slice(cells * 2), record.size) }
}

export async function loadLandscape(url: string): Promise<LoadedLandscape> {
  const base = url.endsWith('/') ? url : `${url}/`
  const manifest = await (await fetchResponse(base, 'landscape.json')).json() as LandscapeManifest
  if (manifest.version !== 1) throw new Error('Landscape manifest is incompatible')
  const [near, far, water] = await Promise.all([
    loadField(base, manifest.near),
    loadField(base, manifest.far),
    fetchResponse(base, manifest.water).then(response => response.json() as Promise<WaterLayout>),
  ])
  const sources: TerrainSources = { near: near.field, far: far.field, nearSurface: near.surface, farSurface: far.surface, band: manifest.band }
  return { manifest, sources, water }
}
