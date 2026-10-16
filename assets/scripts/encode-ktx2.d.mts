export type Ktx2Row = { file: string; source: string; width: number; height: number; mode: string; bytes: number; sourceBytes: number; psnr?: number }
export function encodeDirectory(source: string, out: string, options?: { threshold?: number; normal?: RegExp; verify?: boolean; log?: (line: string) => void }): Promise<{ threshold: number; verified: boolean; files: Ktx2Row[] }>
