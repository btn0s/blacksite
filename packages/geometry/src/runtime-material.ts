import { MeshBasicNodeMaterial, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, StandardNodeLibrary, TangentSpaceNormalMap, Texture, Vector2 } from 'three/webgpu'
import { Fn, bumpMap, context, float, max, normalView, positionView, texture, uniform, vec2, vec3, vec4 } from 'three/tsl'
import type { MeshStandardMaterial, Node, NodeMaterial } from 'three/webgpu'

const materialLibrary = new StandardNodeLibrary()

export function createGeometryMaterial(source: MeshStandardMaterial | MeshStandardNodeMaterial) {
  const material = source instanceof MeshStandardNodeMaterial
    ? source.clone()
    : materialLibrary.fromMaterial(source.clone())
  if (!(material instanceof MeshStandardNodeMaterial)) throw new Error('Cluster surfaces require standard or physical materials')
  material.alphaTest = source.alphaTest
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
  const sample = normalTexture.xyz.mul(2).sub(1)
  return tangentNormalWithUV(vec3(sample.xy.mul(uniform(scale)), sample.z), transformedUv)
}

export function tangentNormalWithUV(sample: Node<'vec3'>, coordinates: Node<'vec2'>) {
  return Fn(() => {
    const n = normalView.normalize()
    const q0 = positionView.dFdx()
    const q1 = positionView.dFdy()
    const st0 = coordinates.dFdx()
    const st1 = coordinates.dFdy()
    const q1perp = q1.cross(n)
    const q0perp = n.cross(q0)
    const tangent = q1perp.mul(st0.x).add(q0perp.mul(st1.x))
    const bitangent = q1perp.mul(st0.y).add(q0perp.mul(st1.y))
    const determinant = max(tangent.dot(tangent), bitangent.dot(bitangent))
    const normalization = determinant.greaterThan(0).select(determinant.inverseSqrt(), 0)
    return tangent.mul(sample.x).add(bitangent.mul(sample.y)).mul(normalization).add(n.mul(sample.z)).normalize()
  })()
}

export function bindGeometryMaterial(material: MeshStandardNodeMaterial, pulledUv: ReturnType<typeof vec2>, position: ReturnType<typeof vec3>) {
  material.positionNode = position
  material.contextNode = context({ ...material.contextNode?.value, getUV: () => pulledUv })

  if (material.normalNode) {
    material.normalNode = material.normalNode.context({ getUV: () => pulledUv })
  } else if (material.normalMap) {
    if (material.normalMapType !== TangentSpaceNormalMap) throw new Error('Cluster normal maps must use tangent space')
    material.normalNode = normalMapWithUV(material.normalMap, pulledUv, material.normalScale)
  } else if (material.bumpMap) {
    material.normalNode = bumpMap(texture(material.bumpMap, pulledUv).setUpdateMatrix(true).r, uniform(material.bumpScale))
  }
  if (material instanceof MeshPhysicalNodeMaterial) {
    if (material.clearcoatNormalNode) material.clearcoatNormalNode = material.clearcoatNormalNode.context({ getUV: () => pulledUv })
    else if (material.clearcoatNormalMap) material.clearcoatNormalNode = normalMapWithUV(material.clearcoatNormalMap, pulledUv, material.clearcoatNormalScale)
  }
}

export function createGeometryDepthMaterial(material: MeshStandardMaterial & Partial<NodeMaterial>) {
  const depth = new MeshBasicNodeMaterial({
    colorWrite: false,
    side: material.side,
    map: material.map,
    alphaMap: material.alphaMap,
    alphaTest: material.alphaTest,
    alphaHash: material.alphaHash,
    opacity: material.opacity,
    depthWrite: material.depthWrite,
    depthTest: material.depthTest,
  })
  depth.positionNode = material.positionNode ?? null
  depth.contextNode = material.contextNode ?? null
  depth.colorNode = material.alphaTest > 0 || material.alphaTestNode ? material.colorNode ?? null : null
  depth.opacityNode = material.opacityNode ?? null
  depth.alphaTestNode = material.alphaTestNode ?? null
  depth.maskNode = material.maskNode ?? null
  depth.depthNode = material.depthNode ?? null
  depth.displacementMap = material.displacementMap
  depth.displacementScale = material.displacementScale
  depth.displacementBias = material.displacementBias
  return depth
}

export function createGeometryShadowMaterial(source: MeshStandardMaterial | MeshStandardNodeMaterial, pulledUv: ReturnType<typeof vec2>, position: ReturnType<typeof vec3>) {
  const node = source as MeshStandardNodeMaterial
  const material = new MeshBasicNodeMaterial({ side: source.side, alphaTest: node.alphaTestNode ? 0 : source.alphaTest, depthWrite: true })
  const context = { ...node.contextNode?.value, getUV: () => pulledUv }
  const colorAlpha = node.colorNode ? vec4(node.colorNode).a : source.map ? texture(source.map, pulledUv).setUpdateMatrix(true).a : float(1)
  const opacity = node.opacityNode ?? float(source.opacity).mul(source.alphaMap ? texture(source.alphaMap, pulledUv).setUpdateMatrix(true).g : 1)
  const alpha = colorAlpha.mul(opacity).context(context)
  const sourceMask = node.maskShadowNode ?? node.maskNode
  let mask = sourceMask ? sourceMask.context(context) : null
  if (node.alphaTestNode) {
    const cutout = alpha.greaterThan(node.alphaTestNode.context(context))
    mask = mask ? mask.and(cutout) : cutout
  }
  material.positionNode = position
  material.shadowSide = source.shadowSide
  material.colorNode = vec4(0, 0, 0, alpha)
  material.maskNode = mask
  return material
}
