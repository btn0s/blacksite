export type ArmsWeapon = 'rifle' | 'pistol'
export type ArmsAction = 'fire' | 'reload' | 'equip'
export type ArmsRig = 'blacksite' | 'als' | 'found'

export interface ArmsMotion {
  forward: number
  lateral: number
  grounded: boolean
  crouching: boolean
  look?: { pitch: number; yaw: number }
  walk?: number
  bob?: number
}

export interface ArmsState {
  weapon: ArmsWeapon
  aiming: boolean
  aimSeconds?: number
  poseHold?: boolean
  speed: number
  sprinting: boolean
  fireSequence: number
  reloadSequence: number
  equipSequence: number
  inspectSequence: number
  landSequence: number
  landSpeed: number
  empty: boolean
  timeScale: number
  motion?: ArmsMotion
  kick: { pitch: number; roll: number }
  debug: {
    animationSeconds: number
    frames: number
    cameraRelativeError: number
    maxCameraRelativeError: number
    poseDelta: number
    activeAction: ArmsAction | null
    action: ArmsAction | 'holster' | 'inspect' | null
    actionTime: number
    weapon: ArmsWeapon
    aiming: boolean
    aimAmount: number
    sprintAmount: number
    boneCount: number
    triangles: number
    handError: number
    reach: number
    weaponOffset: [number, number, number]
    recoilOffset: number
    swayRotation: number
    bobPhase: number
    holder: number[]
    clip: number[]
    feel: number[]
    advance: number
  }
}

export function createArmsState(): ArmsState {
  return {
    weapon: 'rifle', aiming: false, speed: 0, sprinting: false,
    fireSequence: 0, reloadSequence: 0, equipSequence: 0, inspectSequence: 0,
    landSequence: 0, landSpeed: 0, empty: false, timeScale: 1, kick: { pitch: 0, roll: 0 },
    debug: { animationSeconds: 0, frames: 0, cameraRelativeError: 0,
      maxCameraRelativeError: 0, poseDelta: 0, activeAction: null, action: null, actionTime: 0,
      weapon: 'rifle', aiming: false, aimAmount: 0, sprintAmount: 0, boneCount: 0, triangles: 0,
      handError: 0, reach: 0, weaponOffset: [0, 0, 0], recoilOffset: 0, swayRotation: 0, bobPhase: 0, holder: [0, 0, 0, 0, 0, 0], clip: [0, 0, 0, 0, 0, 0], feel: [0, 0, 0, 0, 0, 0, 0, 0, 0], advance: 0 },
  }
}
