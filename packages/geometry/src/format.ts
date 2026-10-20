export const MESHLET_MAGIC = 0x4c4d5342
export const MESHLET_VERSION = 3
export const CLUSTER_STRIDE = 8
export const CLUSTER_LOD_STRIDE = 12
export const GROUP_STRIDE = 4
export const NO_REFINED_GROUP = 0xffffffff

export const MESHLET_SECTIONS = [
  'vertices',
  'vertexReferences',
  'indices',
  'clusterData',
  'clusterBounds',
  'clusterLod',
  'clusterQuantization',
  'groupData',
  'groupBounds',
  'groupChildren',
  'nodeData',
  'nodeBounds',
] as const

export interface GeometryMaterial {
  name: string
  baseColor: [number, number, number, number]
  metalness: number
  roughness: number
  doubleSided: boolean
  alphaMode?: 'OPAQUE' | 'MASK' | 'BLEND'
  alphaCutoff?: number
  normalScale?: number
}

export interface MeshletGeometryManifest {
  source: { sha256: string; bytes: number }
  materialUrl: string
  materials: GeometryMaterial[]
  geometries: {
    meshIndex: number
    name: string
    url: string
    primitives: { indexOffset: number; indexCount: number; materialIndex: number }[]
    sourceTriangles: number
    bounds: { min: [number, number, number]; max: [number, number, number] }
  }[]
  instances: { name: string; geometry: number; matrix: number[] }[]
}

export interface MeshletMetadata {
  name: string
  sourceTriangles: number
  sourceVertices: number
  residentVertices: number
  meshletVertices: number
  residentTriangles: number
  minimumError: number
  nodeCount: number
  rootCount: number
  vertexStride: number
  colorBits?: number
  vertexAttributes?: { color?: number; uv1?: number }
  secondaryUvBounds?: [number, number, number, number]
  positionBits: number
  normalBits: number
  tangentBits: number
  uvBits: number
  indexBits: number
  clusterCount: number
  groupCount: number
  levelCount: number
  maxClusterTriangles: number
  bounds: { min: [number, number, number]; max: [number, number, number] }
  primitives: { indexOffset: number; indexCount: number; materialIndex: number }[]
  materials: GeometryMaterial[]
  builder: { project: string; revision: string; archiveSha256: string; configuration: Record<string, number | boolean> }
  source: { sha256: string; bytes: number }
}

export interface MeshletAsset {
  metadata: MeshletMetadata
  vertices: Uint32Array
  vertexReferences: Uint32Array
  indices: Uint32Array
  clusterData: Uint32Array
  clusterBounds: Float32Array
  clusterLod: Float32Array
  clusterQuantization: Float32Array
  groupData: Uint32Array
  groupBounds: Float32Array
  groupChildren: Uint32Array
  nodeData: Uint32Array
  nodeBounds: Float32Array
}
