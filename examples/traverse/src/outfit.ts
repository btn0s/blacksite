import * as THREE from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'

type Slot = { color: string; roughness: number; emissive?: string; emissiveIntensity?: number }

const jacket: Slot = { color: '#6a4630', roughness: 0.88 }
const sleeve: Slot = { color: '#5c3d2a', roughness: 0.9 }
const trousers: Slot = { color: '#383a33', roughness: 0.95 }
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
  Feet_MAT: { color: '#1d1b17', roughness: 0.7 },
  Hand_L_MAT: { color: '#2a2621', roughness: 0.8 },
  Hand_R_MAT: { color: '#2a2621', roughness: 0.8 },
  Head_MAT: { color: '#2c2d28', roughness: 0.85 },
  Eyes_MAT: { color: '#141410', roughness: 0.3, emissive: '#c9a35a', emissiveIntensity: 0.35 },
}

export function outfit(gltf: GLTF) {
  gltf.scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      const slot = slots[material.name]
      if (!slot || !(material instanceof THREE.MeshStandardMaterial)) continue
      material.color.set(slot.color)
      material.roughness = slot.roughness
      if (slot.emissive) { material.emissive.set(slot.emissive); material.emissiveIntensity = slot.emissiveIntensity ?? 1 }
    }
  })
  return gltf
}
