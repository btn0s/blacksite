export type Vec3 = [number, number, number]

export type CameraView = { x: number; y: number; scale: number }

export type CameraPose = { position: Vec3; target: Vec3; fov?: number; view?: CameraView }

export type Bookmark = CameraPose & { name: string; note?: string }

export type FeelModel = {
  moveSpeed?: number
  sprintSpeed?: number
  timeToTopSpeed?: number
  jumpApex?: number
  tolerance?: number
}

export type BudgetModel = {
  frameMs?: number
  phoneFrameMs?: number
  hitchMs?: number
  firstPlayableMs?: number
  voices?: number
}

export type QualityModel = { shimmerStill?: number; shimmerMotion?: number; popLimit?: number }

export type CheckModel = { feel?: FeelModel; budget?: BudgetModel; quality?: QualityModel }

export type PlayerSample = { position: Vec3; velocity?: Vec3; grounded?: boolean }

export type AudioPlay = { cue: string; sample: string }

export type AudioSample = { voices: number; plays?: AudioPlay[] }

export type CheckInput = { move?: string; sprint?: string; jump?: string }

export type BlacksiteCheck = {
  version: 1
  ready: boolean
  bookmarks: Bookmark[]
  flyover?: CameraPose[]
  camera(pose: CameraPose | null): void
  scripts?: Record<string, () => Promise<void>>
  player?(): PlayerSample | null
  audio?(): AudioSample
  input?: CheckInput
  model?: CheckModel
}

declare global {
  interface Window { __blacksite?: BlacksiteCheck }
}

export function exposeCheck(check: Omit<BlacksiteCheck, 'version' | 'ready'> & { ready?: boolean }) {
  const probe: BlacksiteCheck = { version: 1, ready: false, ...check }
  window.__blacksite = probe
  return {
    probe,
    ready() { probe.ready = true },
    dispose() { if (window.__blacksite === probe) delete window.__blacksite },
  }
}

type PoseCamera = {
  position: { set(x: number, y: number, z: number): unknown }
  lookAt(x: number, y: number, z: number): void
  updateProjectionMatrix(): void
  setViewOffset?(fullWidth: number, fullHeight: number, x: number, y: number, width: number, height: number): void
  clearViewOffset?(): void
  fov?: number
}

export function applyCameraPose(camera: PoseCamera, pose: CameraPose, size: { width: number; height: number }) {
  camera.position.set(...pose.position)
  camera.lookAt(...pose.target)
  if (pose.fov !== undefined && camera.fov !== undefined) camera.fov = pose.fov
  if (pose.view && camera.setViewOffset) {
    const { x, y, scale } = pose.view
    camera.setViewOffset(size.width * scale, size.height * scale, x * size.width * scale, y * size.height * scale, size.width, size.height)
  } else camera.clearViewOffset?.()
  camera.updateProjectionMatrix()
}

export function createAudioLog() {
  let voices = 0
  let plays: AudioPlay[] = []
  return {
    start(cue: string, sample: string) { voices++; plays.push({ cue, sample }) },
    end() { voices = Math.max(0, voices - 1) },
    sample(): AudioSample { const drained = plays; plays = []; return { voices, plays: drained } },
  }
}

export { formatProblem, lintTriangles, lintZFighting, summarizeLint } from './zfight/lint.mjs'
export type { LintCamera, LintOptions, LintReport, ZFightProblem } from './zfight/lint.mjs'
export { extractTriangles } from './zfight/triangles.mjs'
export { depthStep, gapNeeded } from './zfight/depth.mjs'
