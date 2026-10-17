export type ArmsWeapon = 'rifle' | 'pistol'
export type ArmsAction = 'fire' | 'reload' | 'equip'

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
  debug: {
    animationSeconds: number
    frames: number
    cameraRelativeError: number
    maxCameraRelativeError: number
    poseDelta: number
    activeAction: ArmsAction | null
    weapon: ArmsWeapon
    aiming: boolean
    aimAmount: number
    boneCount: number
    triangles: number
  }
}

export function createArmsState(): ArmsState {
  return {
    weapon: 'rifle', aiming: false, speed: 0, sprinting: false,
    fireSequence: 0, reloadSequence: 0, equipSequence: 0,
    debug: { animationSeconds: 0, frames: 0, cameraRelativeError: 0,
      maxCameraRelativeError: 0, poseDelta: 0, activeAction: null,
      weapon: 'rifle', aiming: false, aimAmount: 0, boneCount: 0, triangles: 0 },
  }
}
