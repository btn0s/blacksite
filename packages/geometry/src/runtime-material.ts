import { MeshBasicNodeMaterial, MeshPhysicalMaterial, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, TangentSpaceNormalMap, Texture, Vector2 } from 'three/webgpu'
import { Fn, bumpMap, context, max, normalView, positionView, texture, uniform, vec2, vec3 } from 'three/tsl'
import type { MeshStandardMaterial } from 'three/webgpu'

export function createGeometryMaterial(source: MeshStandardMaterial | MeshStandardNodeMaterial) {
  const material = source instanceof MeshStandardNodeMaterial
    ? source.clone()
    : source instanceof MeshPhysicalMaterial
      ? new MeshPhysicalNodeMaterial().copy(source)
      : new MeshStandardNodeMaterial().copy(source)
  if (material.transparent || material.displacementMap || material.positionNode || material.vertexNode || material.fragmentNode || material.depthNode) {
    throw new Error('Cluster materials require opaque or alpha-tested surfaces with static geometry and standard depth')
  }
  if (material.vertexColors) throw new Error('Cluster geometry currently supports position, normal and one UV set')
  for (const value of Object.values(material)) {
    if (value instanceof Texture && value.channel !== 0) throw new Error('Cluster material maps require the primary UV set')
  }
  if (material instanceof MeshPhysicalNodeMaterial && (material.transmission > 0 || material.anisotropy > 0)) {
    throw new Error('Cluster physical materials currently require zero transmission and anisotropy')
  }
  return material
}

export function normalMapWithUV(map: Texture, pulledUv: ReturnType<typeof vec2>, scale = new Vector2(1, 1)) {
  const normalTexture = texture(map, pulledUv).setUpdateMatrix(true)
  const transformedUv = normalTexture.getTransformedUV(pulledUv)
  return Fn(() => {
    const n = normalView.normalize()
    const q0 = positionView.dFdx()
    const q1 = positionView.dFdy()
    const st0 = transformedUv.dFdx()
    const st1 = transformedUv.dFdy()
    const q1perp = q1.cross(n)
    const q0perp = n.cross(q0)
    const tangent = q1perp.mul(st0.x).add(q0perp.mul(st1.x))
    const bitangent = q1perp.mul(st0.y).add(q0perp.mul(st1.y))
    const determinant = max(tangent.dot(tangent), bitangent.dot(bitangent))
    const normalization = determinant.greaterThan(0).select(determinant.inverseSqrt(), 0)
    const sample = normalTexture.xyz.mul(2).sub(1)
    const xy = sample.xy.mul(uniform(scale))
    return tangent.mul(xy.x).add(bitangent.mul(xy.y)).mul(normalization).add(n.mul(sample.z)).normalize()
  })()
}

export function bindGeometryMaterial(material: MeshStandardNodeMaterial, pulledUv: ReturnType<typeof vec2>, position: ReturnType<typeof vec3>) {
  material.positionNode = position
  material.contextNode = context({ ...material.contextNode?.value, getUV: () => pulledUv })

  if (!material.normalNode && material.normalMap) {
    if (material.normalMapType !== TangentSpaceNormalMap) throw new Error('Cluster normal maps must use tangent space')
    material.normalNode = normalMapWithUV(material.normalMap, pulledUv, material.normalScale)
  } else if (!material.normalNode && material.bumpMap) {
    material.normalNode = bumpMap(texture(material.bumpMap, pulledUv).setUpdateMatrix(true).r, uniform(material.bumpScale))
  }
  if (material instanceof MeshPhysicalNodeMaterial && !material.clearcoatNormalNode && material.clearcoatNormalMap) {
    material.clearcoatNormalNode = normalMapWithUV(material.clearcoatNormalMap, pulledUv, material.clearcoatNormalScale)
  }
  const depth = new MeshBasicNodeMaterial({
    colorWrite: false,
    side: material.side,
    map: material.map,
    alphaMap: material.alphaMap,
    alphaTest: material.alphaTest,
    opacity: material.opacity,
    depthWrite: material.depthWrite,
    depthTest: material.depthTest,
  })
  depth.positionNode = position
  depth.contextNode = material.contextNode
  depth.colorNode = material.colorNode
  depth.opacityNode = material.opacityNode
  depth.alphaTestNode = material.alphaTestNode
  return depth
}
