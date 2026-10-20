import { MeshBasicNodeMaterial, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, NoBlending, StandardNodeLibrary, TangentSpaceNormalMap, Texture, Vector2 } from 'three/webgpu'
import { Fn, bumpMap, context, faceDirection, float, materialColor, max, modelWorldMatrix, mrt, normalView, normalViewGeometry, packNormalToRGB, positionView, texture, uniform, uv, vec2, vec3, vec4, velocity, vertexColor } from 'three/tsl'
import type { MeshStandardMaterial, Node } from 'three/webgpu'
import type { clusterVertex } from './runtime-vertex'
import type { PackedMeshletScene } from './runtime-data'

const materialLibrary = new StandardNodeLibrary()

export function createGeometryMaterial(source: MeshStandardMaterial | MeshStandardNodeMaterial) {
  const material = source instanceof MeshStandardNodeMaterial
    ? source.clone()
    : materialLibrary.fromMaterial(source.clone())
  if (!(material instanceof MeshStandardNodeMaterial)) throw new Error('Cluster surfaces require standard or physical materials')
  material.alphaTest = source.alphaTest
  material.allowOverride = false
  if (material.transparent || material.displacementMap || material.positionNode || material.vertexNode || material.fragmentNode || material.depthNode) {
    throw new Error('Cluster materials require opaque or alpha-tested surfaces with static geometry and standard depth')
  }
  for (const value of Object.values(material)) {
    if (value instanceof Texture && value.channel !== 0 && value.channel !== 1) throw new Error('Cluster material maps require UV set zero or one')
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

export const geometryVertexColor = Fn(builder => builder.context.getVertexColor?.() ?? vertexColor())
export const geometrySecondaryUV = Fn(builder => builder.context.getSecondaryUV?.() ?? uv(1))
export const geometryScaleX = Fn(builder => builder.context.getScaleX?.() ?? modelWorldMatrix.element(0).xyz.length())

type PulledVertex = ReturnType<typeof clusterVertex>

function vertexContext(source: MeshStandardNodeMaterial, pulled: PulledVertex) {
  return { ...source.contextNode?.value, getUV: (map?: { value: Texture }) => map?.value.channel === 1 ? pulled.secondaryUv : pulled.uv, getVertexColor: () => pulled.vertexColor, getSecondaryUV: () => pulled.secondaryUv, getScaleX: () => pulled.scaleX }
}

function coordinatesFor(map: Texture, pulled: PulledVertex) {
  return map.channel === 1 ? pulled.secondaryUv : pulled.uv
}

export function bindGeometryMaterial(material: MeshStandardNodeMaterial, pulled: PulledVertex) {
  material.positionNode = pulled.position
  material.contextNode = context(vertexContext(material, pulled))
  if (material.vertexColors) {
    material.colorNode = vec4(material.colorNode ?? materialColor).mul(pulled.vertexColor)
    material.vertexColors = false
  }

  if (material.normalNode) {
    material.normalNode = material.normalNode.context(vertexContext(material, pulled))
  } else if (material.normalMap) {
    if (material.normalMapType !== TangentSpaceNormalMap) throw new Error('Cluster normal maps must use tangent space')
    material.normalNode = normalMapWithUV(material.normalMap, coordinatesFor(material.normalMap, pulled), material.normalScale)
  } else if (material.bumpMap) {
    material.normalNode = bumpMap(texture(material.bumpMap, coordinatesFor(material.bumpMap, pulled)).setUpdateMatrix(true).r, uniform(material.bumpScale))
  }
  if (material instanceof MeshPhysicalNodeMaterial) {
    if (material.clearcoatNormalNode) material.clearcoatNormalNode = material.clearcoatNormalNode.context(vertexContext(material, pulled))
    else if (material.clearcoatNormalMap) material.clearcoatNormalNode = normalMapWithUV(material.clearcoatNormalMap, coordinatesFor(material.clearcoatNormalMap, pulled), material.clearcoatNormalScale)
  }
}

export function geometryUsesCoverage(source: MeshStandardMaterial | MeshStandardNodeMaterial) {
  const node = source as MeshStandardNodeMaterial
  return source.alphaTest > 0 || Boolean(node.alphaTestNode) || source.alphaHash || Boolean(node.maskNode || node.maskShadowNode)
}

export function createGeometryDepthMaterial(batch: PackedMeshletScene['depthBatches'][number], pulled: PulledVertex, shadow = false) {
  const source = batch.material
  const material = new MeshBasicNodeMaterial({ blending: NoBlending, fog: false })
  material.allowOverride = false
  material.positionNode = pulled.position
  material.side = shadow ? batch.shadowSide : batch.side
  material.colorNode = vec4(0, 0, 0, 1)
  if (!shadow) material.mrtNode = mrt({ output: packNormalToRGB(normalViewGeometry.mul(faceDirection)), velocity })
  if (!source) {
    material.name = shadow ? 'Opaque cluster shadows' : 'Opaque cluster depth'
    return material
  }
  const node = source as MeshStandardNodeMaterial
  const coverageUsesAlpha = source.alphaTest > 0 || Boolean(node.alphaTestNode) || source.alphaHash
  material.name = `${source.name} cluster ${shadow ? 'shadows' : 'depth'}`
  material.alphaTest = node.alphaTestNode ? 0 : source.alphaTest
  material.alphaHash = source.alphaHash
  const context = vertexContext(node, pulled)
  const sourceMask = shadow ? node.maskShadowNode ?? node.maskNode : node.maskNode
  let mask = sourceMask ? sourceMask.context(context) : null
  material.colorNode = vec4(0, 0, 0, 1)
  if (coverageUsesAlpha) {
    const colorAlpha = node.colorNode ? vec4(node.colorNode).a : source.map ? texture(source.map, coordinatesFor(source.map, pulled)).setUpdateMatrix(true).a : float(1)
    const opacity = node.opacityNode ?? float(source.opacity).mul(source.alphaMap ? texture(source.alphaMap, coordinatesFor(source.alphaMap, pulled)).setUpdateMatrix(true).g : 1)
    const alpha = colorAlpha.mul(source.vertexColors ? pulled.vertexColor.a : 1).mul(opacity).context(context)
    material.colorNode = vec4(0, 0, 0, alpha)
    if (node.alphaTestNode) {
      const cutout = alpha.greaterThan(node.alphaTestNode.context(context))
      mask = mask ? mask.and(cutout) : cutout
    }
  }
  material.maskNode = mask
  return material
}
