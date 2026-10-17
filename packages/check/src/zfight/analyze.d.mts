export type ZRegion = { x: number; y: number; w: number; h: number; pixels: number; ids: { pair: number[]; pixels: number }[] }
export type ZAnalysis = { width: number; height: number; frames: number; unstable: number; covered: number; pixels: number; regions: ZRegion[]; pairs: { pair: number[]; pixels: number }[] }
export type AnalyzeOptions = { radius?: number; densityMin?: number; link?: number }
export function analyzeFrames(frames: Uint32Array[], width: number, height: number, options?: AnalyzeOptions): ZAnalysis
export function decodeIds(data: ArrayLike<number>, width: number, height: number, floats: boolean): Uint32Array
