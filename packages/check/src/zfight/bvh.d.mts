export type BVH = { order: Uint32Array; bounds: Float32Array; left: Int32Array; right: Int32Array; first: Int32Array; size: Int32Array; nodes: number; count: number }
export function triangleBoxes(positions: Float32Array, count: number, inflate?: number): Float32Array
export function buildBVH(boxes: Float32Array, count: number, leafSize?: number): BVH
export function queryBVH(bvh: BVH, minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number, visit: (index: number) => void): void
