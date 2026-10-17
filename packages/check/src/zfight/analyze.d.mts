export type ZRegion = { x: number; y: number; w: number; h: number; pixels: number; distance: number | null; ids: { pair: number[]; pixels: number }[] }
export type ZAnalysis = { width: number; height: number; frames: number; unstable: number; edges: number; covered: number; pixels: number; regions: ZRegion[]; pairs: { pair: number[]; pixels: number }[] }
export type AnalyzeOptions = { radius?: number; densityMin?: number; link?: number; depths?: (Float32Array | null)[] | null; depth?: { near: number; far: number; reversed?: boolean; logarithmic?: boolean; orthographic?: boolean }; separation?: number; separationFloor?: number }
export function analyzeFrames(frames: Uint32Array[], width: number, height: number, options?: AnalyzeOptions): ZAnalysis
export function decodeIds(data: ArrayLike<number>, width: number, height: number, floats: boolean): Uint32Array
export function decodeDepth(data: ArrayLike<number>, width: number, height: number): Float32Array
