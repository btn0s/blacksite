import type { MeshStandardNodeMaterial, Node } from 'three/webgpu'
import { Fn, If, cameraViewMatrix, float, mat3, materialColor, materialRoughness, mix, normalize, positionWorld, smoothstep, uniform, vec3, vec4 } from 'three/tsl'
import { footprintTone, groundLayers, groundTone } from './ground'
import { createTerrainNodes, landscapeNoise } from './nodes'
import type { TerrainOptions, TerrainUniforms } from './terrain'

export interface GroundBlendOptions {
  readonly uniforms: TerrainUniforms
  readonly averages: TerrainOptions['layers']['averages']
  readonly layerSpecs: TerrainOptions['layerSpecs']
  readonly footprint?: TerrainOptions['footprint']
}

export interface GroundBlendTuning {
  enabled: boolean
  band: number
  noise: number
  reach: number
}

export const GROUND_BLEND_DEFAULTS: Readonly<GroundBlendTuning> = { enabled: true, band: 0.8, noise: 0.6, reach: 40 }

export interface GroundBlend {
  readonly tuning: Readonly<GroundBlendTuning>
  tune(values: Partial<GroundBlendTuning>): void
  apply(material: MeshStandardNodeMaterial): void
}

export function createGroundBlend(options: GroundBlendOptions): GroundBlend {
  const terrain = createTerrainNodes(options.uniforms)
  const enabled = uniform(GROUND_BLEND_DEFAULTS.enabled ? 1 : 0)
  const band = uniform(GROUND_BLEND_DEFAULTS.band)
  const noise = uniform(GROUND_BLEND_DEFAULTS.noise)
  const reach = uniform(GROUND_BLEND_DEFAULTS.reach)
  const tuning: GroundBlendTuning = { ...GROUND_BLEND_DEFAULTS }
  const ground = Fn(() => {
    const albedo = vec3(0).toVar()
    const normal = vec3(0, 1, 0).toVar()
    const roughness = float(1).toVar()
    const weight = float(0).toVar()
    If(enabled.greaterThan(0.5), () => {
      const root = positionWorld.xz
      const height = positionWorld.y.sub(terrain.nearHeight(root))
      If(height.lessThan(band.mul(noise.mul(0.8).add(1))), () => {
        const surface = terrain.nearSurface(root)
        const base = terrain.normal(surface)
        const layers = groundLayers(options.averages, options.layerSpecs, root, surface, base)
        const colour = groundTone(layers.average, root, layers.macro, layers.weights).toVar()
        const edge = terrain.edge(root)
        if (options.footprint) colour.mulAssign(footprintTone(options.footprint, edge))
        const breakup = landscapeNoise(root.mul(0.9), 61).mul(0.65).add(landscapeNoise(root.mul(3.1), 67).mul(0.35))
        const lift = breakup.sub(0.5).mul(noise).mul(band).mul(1.6)
        const inside = smoothstep(reach.mul(0.4), reach, edge.negate().max(0))
        weight.assign(float(1).sub(smoothstep(0, band, height.add(lift))).mul(float(1).sub(inside)))
        albedo.assign(colour)
        normal.assign(normalize(cameraViewMatrix.mul(vec4(base, 0)).xyz))
        roughness.assign(layers.roughness)
      })
    })
    return mat3(albedo, normal, vec3(roughness, weight, 0))
  })().toVar()
  return {
    tuning,
    tune(values) {
      Object.assign(tuning, values)
      enabled.value = tuning.enabled ? 1 : 0
      band.value = tuning.band
      noise.value = tuning.noise
      reach.value = tuning.reach
    },
    apply(material) {
      const colour = vec4(material.colorNode ?? materialColor)
      const metal = material.metalnessNode ? float(material.metalnessNode).clamp(0, 1) : float(0)
      const weight = ground.element(2).y.mul(float(1).sub(metal))
      material.colorNode = vec4(mix(colour.rgb, ground.element(0), weight), colour.a)
      const roughness: Node<'float'> = material.roughnessNode ?? materialRoughness
      material.roughnessNode = mix(roughness, ground.element(2).x, weight)
      if (material.normalNode) material.normalNode = normalize(mix(material.normalNode, ground.element(1), weight.mul(0.7)))
    },
  }
}
