export const RANGE_MOVEMENT = {
  eye: 1.63,
  walk: 3.1,
  sprint: 5.2,
  aim: 1.8,
  gravity: 9.8,
  jump: 4.2,
  worldFov: 72,
} as const

export const RANGE_FEEL = {
  moveSpeed: RANGE_MOVEMENT.walk,
  sprintSpeed: RANGE_MOVEMENT.sprint,
  jumpApex: RANGE_MOVEMENT.jump ** 2 / (2 * RANGE_MOVEMENT.gravity),
  tolerance: 0.1,
} as const

export const RANGE_BUDGET = {
  frameMs: 8.3,
  phoneFrameMs: 16.7,
  hitchMs: 33,
  firstPlayableMs: 5000,
  voices: 32,
} as const

