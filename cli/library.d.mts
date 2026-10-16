export type Licence = { name: string; url: string; attribution: boolean }
export type LibraryFile = { url: string; name: string; sha256?: string; size?: number; extract?: boolean }
export type LibraryAsset = { id: string; title: string; category: string; tags: string[]; source: { site?: string; id?: string; url: string }; author: string; licence: string; attribution?: string; use: string; files?: LibraryFile[]; scale?: { tile?: number }; process?: Record<string, unknown>; acquire?: 'manual'; licenceEvidence?: { page?: string; file?: string }; dimensions?: number[] }
export type LibraryCatalog = { version?: number; packs?: Record<string, { description: string; assets: string[] }>; assets: LibraryAsset[] }
export type CreditEntry = { id: string; title: string; category: string; author: string; licence: string; attribution?: string; source: { url: string } }
export const LICENCES: Record<string, Licence>
export function loadCatalog(): Promise<LibraryCatalog>
export function validate(catalog: { assets: Partial<LibraryAsset>[]; packs?: LibraryCatalog['packs'] }): string[]
export function creditsMarkdown(assets: CreditEntry[], heading?: string): string
export function isLibraryId(id: string): Promise<boolean>
export function runLibrary(verb: string, args: string[]): Promise<void>
