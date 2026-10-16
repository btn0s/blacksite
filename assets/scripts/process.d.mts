export type Budget = { bytes: number; triangles?: number; note: string }
export type Take = { file: string; fallback: string; seconds: number; source: string; at?: number; peakDb?: number }
export type AssetManifest = { id: string; category: string; ship: string[]; files: Record<string, number>; bytes: number; ktx2Bytes?: number; budget: number; withinBudget: boolean; over: string[]; triangles?: number; size?: number[]; animations?: string[]; skinned?: boolean; variations?: Take[]; [key: string]: unknown }
export const BUDGETS: Record<string, Budget>
export function processAsset(entry: { id: string; category: string; process?: Record<string, unknown> }, source: string, out: string, options?: { ktx2?: boolean; sizes?: number[] }): Promise<AssetManifest>
export type Ktx2Mode = 'etc1s' | 'etc1s-160' | 'uastc-rdo' | 'uastc-rdo-1' | 'uastc-rdo-0' | 'uastc'
export const KTX2_MODES: Record<Ktx2Mode, Record<string, unknown>>
export function encodeKtx2(buffer: Buffer, options: { srgb: boolean; normal: boolean; mode: Ktx2Mode }): Promise<Buffer>
