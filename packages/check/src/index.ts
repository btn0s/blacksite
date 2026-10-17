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

export type CheckModel = { feel?: FeelModel; budget?: BudgetModel; quality?: QualityModel; scripts?: Record<string, number> }

export type PlayerSample = { position: Vec3; velocity?: Vec3; grounded?: boolean }

export type ViewSample = { position: Vec3; quaternion: [number, number, number, number]; fov: number; viewmodel?: readonly number[] }

export type AudioPlay = { cue: string; sample: string }

export type AudioSample = { voices: number; plays?: AudioPlay[] }

export type CheckInput = { move?: string; sprint?: string; jump?: string }

export type CheckMove = { forward?: number; right?: number; sprint?: boolean; jump?: boolean }

export type CheckCharacter = {
  respawn(at?: { x: number; z: number; yaw?: number }): void
  move(input: CheckMove | null): void
  face(point: { x: number; y: number; z: number }): void
  bounds(): { min: readonly [number, number, number]; max: readonly [number, number, number] } | null
}

export type BlacksiteCheck = {
  version: 1
  ready: boolean
  bookmarks: Bookmark[]
  flyover?: CameraPose[]
  camera(pose: CameraPose | null): void
  scripts?: Record<string, () => Promise<void>>
  player?(): PlayerSample | null
  view?(): ViewSample | null
  audio?(): AudioSample
  input?: CheckInput
  character?: CheckCharacter
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

type SampledCamera = {
  updateWorldMatrix(parents: boolean, children: boolean): void
  matrixWorld: { elements: ArrayLike<number> }
  fov?: number
}

export function sampleView(camera: SampledCamera, viewmodel?: readonly number[]): ViewSample {
  camera.updateWorldMatrix(true, false)
  const m = camera.matrixWorld.elements
  const sx = Math.hypot(m[0], m[1], m[2]), sy = Math.hypot(m[4], m[5], m[6]), sz = Math.hypot(m[8], m[9], m[10])
  const a = m[0] / sx, b = m[4] / sy, c = m[8] / sz, d = m[1] / sx, e = m[5] / sy, f = m[9] / sz, g = m[2] / sx, h = m[6] / sy, i = m[10] / sz
  const trace = a + e + i
  let q: [number, number, number, number]
  if (trace > 0) { const s = 0.5 / Math.sqrt(trace + 1); q = [(h - f) * s, (c - g) * s, (d - b) * s, 0.25 / s] }
  else if (a > e && a > i) { const s = 2 * Math.sqrt(1 + a - e - i); q = [0.25 * s, (b + d) / s, (c + g) / s, (h - f) / s] }
  else if (e > i) { const s = 2 * Math.sqrt(1 + e - a - i); q = [(b + d) / s, 0.25 * s, (f + h) / s, (c - g) / s] }
  else { const s = 2 * Math.sqrt(1 + i - a - e); q = [(c + g) / s, (f + h) / s, 0.25 * s, (d - b) / s] }
  return { position: [m[12], m[13], m[14]], quaternion: q, fov: camera.fov ?? 0, ...(viewmodel ? { viewmodel: [...viewmodel] } : {}) }
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
