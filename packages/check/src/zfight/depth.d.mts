export type DepthFormatName = 'depth16' | 'depth24' | 'depth32f'

export type DepthSetup = {
  near?: number
  far?: number
  bits?: number
  float?: boolean
  reversed?: boolean
  logarithmic?: boolean
  orthographic?: boolean
  format?: DepthFormatName
}

export type ResolvedDepth = { near: number; far: number; bits: number; float: boolean; reversed: boolean; logarithmic: boolean; orthographic: boolean }

export const DEPTH_FORMATS: Record<DepthFormatName, { bits: number; float: boolean }>
export function normaliseDepth(setup?: DepthSetup): ResolvedDepth
export function depthStep(setup: DepthSetup, z: number): number
export function gapNeeded(setup: DepthSetup, z: number, safety?: number): number
export function describeDepth(setup: DepthSetup): string
export function farthestResolvable(setup: DepthSetup, gap: number, safety?: number): number
