import * as THREE from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'

type Slot = { color: string; roughness: number }

const jacket: Slot = { color: '#3f5a4a', roughness: 0.86 }
const sleeve: Slot = { color: '#38503f', roughness: 0.88 }
const trousers: Slot = { color: '#5b5346', roughness: 0.94 }
const slots: Record<string, Slot> = {
  Torso_MAT: jacket,
  Shoulder_L_MAT: jacket,
  Shoulder_R_MAT: jacket,
  UpperArm_L_MAT: sleeve,
  UpperArm_R_MAT: sleeve,
  LowerArm_L_MAT: sleeve,
  LowerArm_R_MAT: sleeve,
  Pelvis_MAT: trousers,
  UpperLeg_MAT: trousers,
  LowerLeg_MAT: trousers,
  Feet_MAT: { color: '#3a2c22', roughness: 0.8 },
  Hand_L_MAT: { color: '#8a6a52', roughness: 0.75 },
  Hand_R_MAT: { color: '#8a6a52', roughness: 0.75 },
  Head_MAT: { color: '#8a6a52', roughness: 0.75 },
  Eyes_MAT: { color: '#1a1814', roughness: 0.3 },
}

export function outfit(gltf: GLTF) {
  gltf.scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      const slot = slots[material.name]
      if (!slot || !(material instanceof THREE.MeshStandardMaterial)) continue
      material.color.set(slot.color)
      material.roughness = slot.roughness
    }
  })
  return gltf
}
