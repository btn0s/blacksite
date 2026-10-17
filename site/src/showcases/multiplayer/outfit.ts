import * as THREE from 'three'
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js'

const jacket = { color: '#55573f', roughness: 0.9 }
const vest = { color: '#3d3f33', roughness: 0.85 }
const trousers = { color: '#3a3b33', roughness: 0.95 }
const slots: Record<string, { color: string; roughness: number; emissive?: string; emissiveIntensity?: number }> = {
  Torso_MAT: vest,
  Shoulder_L_MAT: jacket,
  Shoulder_R_MAT: jacket,
  UpperArm_L_MAT: jacket,
  UpperArm_R_MAT: { color: '#7d3a26', roughness: 0.9 },
  LowerArm_L_MAT: jacket,
  LowerArm_R_MAT: jacket,
  Pelvis_MAT: trousers,
  UpperLeg_MAT: trousers,
  LowerLeg_MAT: trousers,
  Feet_MAT: { color: '#1f1c18', roughness: 0.75 },
  Hand_L_MAT: { color: '#2a2621', roughness: 0.8 },
  Hand_R_MAT: { color: '#2a2621', roughness: 0.8 },
  Head_MAT: { color: '#2c2d28', roughness: 0.85 },
  Eyes_MAT: { color: '#141410', roughness: 0.3, emissive: '#d8902c', emissiveIntensity: 0.9 },
}

export function outfit(gltf: GLTF) {
  gltf.scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return
    object.castShadow = true
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
