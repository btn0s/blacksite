export type SurfaceInfo = { material: string; doubleSided: boolean; offsetFactor: number; offsetUnits: number; blended: boolean; depthWrite: boolean }
export type TrianglePart = { label: string; start: number; count: number }
export type MeshInfo = SurfaceInfo & { index: number; name: string; path: string; uuid: string; first: number; count: number; perInstance: number; parts: TrianglePart[] | null }
export type TriangleSoup = {
  positions: Float32Array
  owner: Uint32Array
  count: number
  meshes: MeshInfo[]
  truncated: boolean
  sampledInstances: number
  skipped: { invisible: number; unsupported: number }
}
export type ExtractOptions = { maxTriangles?: number; maxInstances?: number; filter?: (object: unknown) => boolean }
export function extractTriangles(root: unknown, options?: ExtractOptions): TriangleSoup
export function labelOf(soup: TriangleSoup, mesh: MeshInfo, triangle: number): string | null
