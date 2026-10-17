import type { DepthSetup } from './depth.mjs'
import type { ExtractOptions, MeshInfo, TriangleSoup } from './triangles.mjs'

export type LintCamera = { name?: string; position: [number, number, number]; target: [number, number, number]; fov?: number; aspect?: number; near?: number; far?: number }

export type LintOptions = ExtractOptions & DepthSetup & {
  depth?: DepthSetup
  cameras?: LintCamera[]
  safety?: number
  maxAngle?: number
  minPixels?: number
  minArea?: number
  distance?: number
  viewport?: { width?: number; height?: number }
  fov?: number
  ignore?: (a: MeshInfo, b: MeshInfo) => boolean
}

export type LintMesh = { name: string; path: string; material: string; uuid: string }

export type ZFightProblem = {
  a: LintMesh
  b: LintMesh
  labels: [string | null, string | null]
  position: [number, number, number]
  overlapArea: number
  fightArea: number
  pixels: number
  gap: number
  gapNeeded: number
  distance: number
  camera: string | null
  trianglePairs: number
}

export type LintStats = { triangles: number; meshes: number; candidates: number; coplanar: number; overlapping: number; unseen: number; pruned: number; truncated: boolean; sampledInstances: number; skipped: { invisible: number; unsupported: number }; ms: number }

export type LintReport = { pass: boolean; problems: ZFightProblem[]; stats: LintStats; depth: string; setup: Required<Pick<DepthSetup, 'near' | 'far' | 'bits' | 'float' | 'reversed' | 'logarithmic'>>; safety: number }

export function lintTriangles(soup: TriangleSoup, options?: LintOptions): LintReport
export function lintZFighting(root: unknown, options?: LintOptions): LintReport
export function formatProblem(problem: ZFightProblem): string
export function summarizeLint(report: LintReport): string
