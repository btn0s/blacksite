import { Color, DoubleSide, FrontSide, Vector3 } from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import type { Node } from 'three/webgpu'
import { attribute, bool, clamp, dot, float, fwidth, max, mix, normalize, normalLocal, output, positionGeometry, positionLocal, pow, screenCoordinate, sin, smoothstep, texture, uniform, varying, vec3, vec4 } from 'three/tsl'
import type { TreeModel } from './trees'
import type { TreeTextures } from './impostor'
import type { Wind } from './wind'
import { createWindNodes, landscapeDither } from './nodes'

export function createTreeMaterial(options: {
  model: TreeModel
  textures: TreeTextures
  wind: Wind
  leaf: boolean
  alphaToCoverage: boolean
  range: readonly [number, number]
  viewer: Vector3
  lodView: Node<'float'>
  fullDetail: Node<'float'>
  sun?: { readonly direction: Vector3; readonly color: Color }
}) {
  const { model, leaf } = options
  const wind = createWindNodes(options.wind)
  const root = attribute('treeRoot', 'vec3')
  const scale = attribute('treeScale', 'float')
  const weights = attribute('treeWind', 'vec3')
  const strength = wind.sample(root.xz)
  const trunk = weights.x.mul(strength.mul(0.55).add(sin(wind.time.mul(0.75).add(weights.z.mul(6.283)).add(root.x.mul(0.05))).mul(0.18).mul(strength.add(0.35)))).mul(0.55)
  const branch = weights.y.mul(sin(wind.time.mul(weights.z.mul(1.4).add(1.6)).add(weights.z.mul(12)).add(dot(positionGeometry, vec3(0.35, 0.2, 0.3))))).mul(strength.mul(0.09).add(0.05))
  const position = positionLocal.add(vec3(wind.direction.x, 0, wind.direction.y).mul(trunk).mul(scale)).add(normalLocal.mul(branch).mul(scale).mul(0.5)).add(vec3(0, branch.mul(scale).mul(0.25), 0))
  const distance = varying(uniform(options.viewer).sub(root).length())
  const fade = smoothstep(options.range[0], options.range[1], distance).mul(float(1).sub(options.fullDetail))
  const texel = texture(leaf ? options.textures.leaf : options.textures.bark)
  const tint = vec3(...(leaf ? model.species.leaves : model.species.bark))
  const albedo = texel.rgb.mul(tint)
  const opacity = leaf && options.alphaToCoverage ? clamp(texel.a.sub(0.5).div(max(fwidth(texel.a), 0.0001)).add(0.5), 0, 1) : texel.a
  const material = new MeshStandardNodeMaterial({
    name: `world-tree-${model.species.name}-${leaf ? 'leaves' : 'wood'}`,
    roughness: leaf ? 0.78 : 0.95,
    metalness: 0,
    vertexColors: true,
    side: leaf ? DoubleSide : FrontSide,
    normalMap: leaf ? null : options.textures.barkNormal ?? null,
    alphaToCoverage: leaf && options.alphaToCoverage,
    alphaTest: leaf ? options.alphaToCoverage ? 0.02 : 0.5 : 0,
  })
  material.positionNode = position
  material.colorNode = albedo
  material.outputNode = vec4(mix(output.rgb, uniform(new Color('#62d995')), options.lodView), output.a)
  material.opacityNode = leaf && options.alphaToCoverage ? opacity : float(1)
  const visible = landscapeDither(screenCoordinate.xy).greaterThanEqual(fade)
  material.maskNode = leaf ? visible.and(opacity.greaterThanEqual(options.alphaToCoverage ? 0.02 : 0.5)) : visible
  material.maskShadowNode = leaf ? texel.a.greaterThanEqual(0.5) : bool(true)
  if (leaf && options.sun) {
    const back = pow(max(dot(normalize(varying(position).sub(uniform(options.viewer))), uniform(options.sun.direction)), 0), 4)
    material.emissiveNode = albedo.mul(varying(attribute('color', 'vec3'))).mul(uniform(options.sun.color)).mul(back.mul(0.5).add(0.06)).mul(float(1).sub(options.lodView))
  }
  return material
}
