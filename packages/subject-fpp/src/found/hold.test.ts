import { describe, expect, it } from 'vitest'
import { AnimationClip, PerspectiveCamera, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three'
import { framePresentation } from '../arms/presentation'
import { holdPose } from './runtime'

describe('found idle', () => {
  it('holds the idle clip at its mean pose', () => {
    const half = Math.SQRT1_2
    const clip = new AnimationClip('idle', 1, [
      new VectorKeyframeTrack('bone.position', [0, 0.5, 1], [0, 0, 0, 0, 0.02, 0, 0, 0, 0]),
      new QuaternionKeyframeTrack('bone.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, -half, -half]),
    ])
    const held = holdPose(clip)
    const position = held.tracks[0].values
    expect(position[1]).toBeCloseTo(0.02 / 3, 6)
    expect(position[4]).toBeCloseTo(position[1], 9)
    const rotation = held.tracks[1].values
    expect(Math.hypot(rotation[0], rotation[1], rotation[2], rotation[3])).toBeCloseTo(1, 6)
    expect(rotation[2]).toBeCloseTo(Math.sin(Math.PI / 8), 6)
  })
})

describe('viewmodel framing', () => {
  it('holds the viewmodel field of view across the shorter side', () => {
    const view = new PerspectiveCamera()
    const world = new PerspectiveCamera()
    framePresentation(view, world, 56, 1440, 900)
    expect(view.fov).toBe(56)
    framePresentation(view, world, 56, 390, 844)
    const horizontal = 2 * Math.atan(Math.tan(view.fov * Math.PI / 360) * view.aspect) * 180 / Math.PI
    expect(horizontal).toBeCloseTo(56, 6)
  })
})
