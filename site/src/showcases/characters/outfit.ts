import * as THREE from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'

const jacket = { color: '#4c4d38', roughness: 0.92 }
const trousers = { color: '#3c3e36', roughness: 0.95 }
const slots: Record<string, { color: string; roughness: number; emissive?: string; emissiveIntensity?: number }> = {
  Torso_MAT: jacket,
  Shoulder_L_MAT: jacket,
  Shoulder_R_MAT: jacket,
  UpperArm_L_MAT: jacket,
  UpperArm_R_MAT: jacket,
  LowerArm_L_MAT: jacket,
  LowerArm_R_MAT: jacket,
  Pelvis_MAT: trousers,
  UpperLeg_MAT: trousers,
  LowerLeg_MAT: trousers,
  Feet_MAT: { color: '#201d19', roughness: 0.75 },
  Hand_L_MAT: { color: '#2b2722', roughness: 0.8 },
  Hand_R_MAT: { color: '#2b2722', roughness: 0.8 },
  Head_MAT: { color: '#2e2f2a', roughness: 0.85 },
  Eyes_MAT: { color: '#141410', roughness: 0.3, emissive: '#d8902c', emissiveIntensity: 0.6 },
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
