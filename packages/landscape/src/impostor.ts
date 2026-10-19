import { Color, DoubleSide, FrontSide, LinearFilter, LinearMipmapLinearFilter, Mesh, NoColorSpace, OrthographicCamera, RenderTarget, SRGBColorSpace, Scene, UnsignedByteType, Vector3, Vector4 } from 'three'
import type { Texture } from 'three'
import { MeshBasicNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu'
import type { Node, WebGPURenderer } from 'three/webgpu'
import { attribute, cameraPosition, cameraViewMatrix, clamp, cos, cross, dot, float, floor, fwidth, length, max, min, mix, mrt, normalGeometry, normalize, output, positionGeometry, screenCoordinate, select, sin, smoothstep, sqrt, step, texture, uniform, uv, varying, vec2, vec3, vec4 } from 'three/tsl'
import type { TreeModel } from './trees'
import type { Wind } from './wind'
import { createWindNodes, landscapeDither } from './nodes'

export interface ImpostorAtlas {
  readonly albedo: Texture
  readonly normal: Texture
  readonly frames: number
  readonly frameSize: number
  readonly centre: Vector3
  readonly radius: number
  readonly milliseconds: number
  dispose(): void
}

export interface TreeTextures {
  readonly bark: Texture
  readonly barkNormal?: Texture
  readonly leaf: Texture
}

export interface BakeOptions {
  readonly frames?: number
  readonly frameSize?: number
  readonly samples?: number
}

function bakeMaterial(map: Texture, tint: readonly [number, number, number], cutout: boolean) {
  const material = new MeshBasicNodeMaterial({ side: cutout ? DoubleSide : FrontSide, toneMapped: false })
  const texel = texture(map)
  material.colorNode = texel.rgb.mul(vec3(...tint)).mul(attribute('color', 'vec3'))
  if (cutout) material.maskNode = texel.a.greaterThanEqual(0.5)
  return material
}

export function hemiOctDirection(u: number, v: number, out = new Vector3()): Vector3 {
  const tx = u * 2 - 1
  const ty = v * 2 - 1
  const x = (tx + ty) * 0.5
  const z = (tx - ty) * 0.5
  const y = 1 - Math.abs(x) - Math.abs(z)
  return out.set(x, Math.max(y, 0), z).normalize()
}

export function bakeImpostor(renderer: WebGPURenderer, model: TreeModel, textures: TreeTextures, options: BakeOptions = {}): ImpostorAtlas {
  const started = performance.now()
  const frames = Math.max(2, options.frames ?? 8)
  const frameSize = options.frameSize ?? 192
  const size = frames * frameSize
  const centre = model.bounds.center.clone()
  const radius = model.bounds.radius * 1.02
  const scene = new Scene()
  const woodMaterial = bakeMaterial(textures.bark, model.species.bark, false)
  const leafMaterial = bakeMaterial(textures.leaf, model.species.leaves, true)
  scene.add(new Mesh(model.wood, woodMaterial), new Mesh(model.leaves, leafMaterial))
  const camera = new OrthographicCamera(-radius, radius, radius, -radius, 0.01, radius * 4)
  const target = new RenderTarget(size, size, {
    count: 2, type: UnsignedByteType, minFilter: LinearMipmapLinearFilter, magFilter: LinearFilter,
    generateMipmaps: true, depthBuffer: true, samples: options.samples ?? 4,
  })
  const [albedo, normal] = target.textures as [Texture, Texture]
  albedo.colorSpace = SRGBColorSpace
  normal.colorSpace = NoColorSpace
  albedo.anisotropy = 4
  albedo.name = 'output'
  normal.name = 'normal'
  const previousTarget = renderer.getRenderTarget()
  const previousMrt = renderer.getMRT()
  const previousClear = renderer.getClearColor(new Color())
  const previousAlpha = renderer.getClearAlpha()
  const previousAutoClear = renderer.autoClear
  const previousShadows = renderer.shadowMap.enabled
  try {
    renderer.shadowMap.enabled = false
    renderer.autoClear = false
    renderer.setMRT(mrt({ output, normal: vec4(normalize(normalGeometry).mul(0.5).add(0.5), 1) }))
    renderer.setClearColor(0x000000, 0)
    renderer.initRenderTarget(target)
    albedo.generateMipmaps = false
    normal.generateMipmaps = false
    renderer.setRenderTarget(target)
    renderer.clear(true, true, true)
    const direction = new Vector3()
    target.scissorTest = true
    for (let j = 0; j < frames; j++) for (let i = 0; i < frames; i++) {
      hemiOctDirection(i / (frames - 1), j / (frames - 1), direction)
      camera.up.set(0, direction.y > 0.999 ? 0 : 1, direction.y > 0.999 ? -1 : 0)
      camera.position.copy(centre).addScaledVector(direction, radius * 2)
      camera.lookAt(centre)
      camera.updateMatrixWorld()
      target.viewport.set(i * frameSize, j * frameSize, frameSize, frameSize)
      target.scissor.set(i * frameSize, j * frameSize, frameSize, frameSize)
      const last = i === frames - 1 && j === frames - 1
      albedo.generateMipmaps = last
      normal.generateMipmaps = last
      renderer.setRenderTarget(target)
      renderer.render(scene, camera)
    }
  } catch (error) {
    target.dispose()
    throw error
  } finally {
    target.scissorTest = false
    renderer.setRenderTarget(previousTarget)
    renderer.setMRT(previousMrt)
    renderer.setClearColor(previousClear, previousAlpha)
    renderer.autoClear = previousAutoClear
    renderer.shadowMap.enabled = previousShadows
    woodMaterial.dispose()
    leafMaterial.dispose()
  }
  return { albedo, normal, frames, frameSize, centre, radius, milliseconds: performance.now() - started, dispose: () => target.dispose() }
}

export interface ImpostorMaterialOptions {
  readonly atlas: ImpostorAtlas
  readonly wind: Wind
  readonly range: readonly [number, number, number, number]
  readonly alphaToCoverage?: boolean
  readonly singleFrame?: boolean
  readonly tint?: readonly [number, number, number]
  readonly contact?: number
  readonly blur?: number
  readonly farTint?: readonly [number, number, number]
  readonly lodView?: Node<'float'>
}

export function createImpostorMaterial(options: ImpostorMaterialOptions): MeshStandardNodeMaterial {
  const { atlas } = options
  const wind = createWindNodes(options.wind)
  const material = new MeshStandardNodeMaterial({ name: 'world-impostor', roughness: 0.92, metalness: 0, side: DoubleSide, alphaToCoverage: options.alphaToCoverage === true })
  const instance = attribute('treeInstance', 'vec4')
  const scale = attribute('treeScale', 'float')
  const shape = uniform(new Vector4(atlas.centre.x, atlas.centre.y, atlas.centre.z, atlas.radius))
  const range = uniform(new Vector4(...options.range))
  const c = cos(instance.w)
  const s = sin(instance.w)
  const rotate = (v: Node<'vec3'>) => vec3(c.mul(v.x).add(s.mul(v.z)), v.y, s.negate().mul(v.x).add(c.mul(v.z)))
  const centre = instance.xyz.add(rotate(shape.xyz.mul(scale)))
  const toCamera = cameraPosition.sub(centre)
  const distance = length(toCamera)
  const rootDistance = length(cameraPosition.sub(instance.xyz))
  const fadeIn = smoothstep(range.x, range.y, rootDistance)
  const fadeOut = float(1).sub(smoothstep(range.z, range.w, rootDistance))
  const direction = toCamera.div(max(distance, 0.001))
  const local = normalize(vec3(c.mul(direction.x).sub(s.mul(direction.z)), max(direction.y, 0).add(0.0001), s.mul(direction.x).add(c.mul(direction.z))))
  const oct = local.div(local.abs().x.add(local.abs().y).add(local.abs().z))
  const grid = varying(vec2(oct.x.add(oct.z), oct.x.sub(oct.z)).mul(0.5).add(0.5).mul(atlas.frames - 1))
  const localUp = select(local.y.greaterThan(0.999), vec3(0, 0, -1), vec3(0, 1, 0))
  const localRight = normalize(cross(localUp, local))
  const right = rotate(localRight)
  const up = rotate(cross(local, localRight))
  const size = shape.w.mul(scale).mul(2).mul(step(0.0001, fadeIn.mul(fadeOut)))
  const lift = positionGeometry.y.add(0.5)
  const sway = wind.sample(instance.xz).mul(0.025).mul(shape.w).mul(scale).mul(lift.mul(lift))
  const position = centre.add(right.mul(positionGeometry.x).add(up.mul(positionGeometry.y)).mul(size)).add(vec3(wind.direction.x, 0, wind.direction.y).mul(sway))
  const fade = varying(vec3(fadeIn, fadeOut, smoothstep(range.y, range.w, rootDistance)))
  const yaw = varying(vec2(c, s))
  const offset = varying(position.sub(centre).sub(vec3(0, 0.18, 0).mul(shape.w).mul(scale)).div(max(shape.w.mul(scale).mul(0.78), 0.001)))
  const view = varying(direction)
  const atlasUv = (frame: Node<'vec2'>) => frame.add(clamp(uv().flipY(), vec2(0.004), vec2(0.996))).div(atlas.frames)
  const bias = fade.z.mul(options.blur ?? 1.25)
  const sample = (image: Texture) => {
    if (options.singleFrame) return texture(image, atlasUv(clamp(floor(grid.add(0.5)), vec2(0), vec2(atlas.frames - 1)))).bias(bias)
    const base = clamp(floor(grid), vec2(0), vec2(atlas.frames - 2))
    const f = clamp(grid.sub(base), 0, 1)
    const a = texture(image, atlasUv(base)).bias(bias)
    const b = texture(image, atlasUv(base.add(vec2(1, 0)))).bias(bias)
    const c = texture(image, atlasUv(base.add(vec2(0, 1)))).bias(bias)
    const d = texture(image, atlasUv(base.add(vec2(1, 1)))).bias(bias)
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y)
  }
  const albedo = sample(atlas.albedo)
  const normals = sample(atlas.normal)
  const coverage = albedo.a
  const opacity = options.alphaToCoverage ? clamp(coverage.sub(0.5).div(max(fwidth(coverage).mul(fade.z.mul(2.5).add(1)), 0.0001)).add(0.5), 0, 1) : float(1)
  const localNormal = normalize(normals.rgb.div(max(normals.a, 0.001)).mul(2).sub(1))
  const baked = normalize(vec3(yaw.x.mul(localNormal.x).add(yaw.y.mul(localNormal.z)), localNormal.y, yaw.y.negate().mul(localNormal.x).add(yaw.x.mul(localNormal.z))))
  const depth = sqrt(max(float(1).sub(dot(offset, offset)), 0))
  const sphere = normalize(offset.add(view.mul(depth)))
  const worldNormal = normalize(mix(baked, sphere, mix(0.55, 0.75, fade.z)))
  const contact = mix(0.42, 1, smoothstep(-0.85, 0.35, offset.y)).mul(mix(0.78, 1, smoothstep(0, 0.55, depth)))
  const albedoColor = albedo.rgb.div(max(coverage, 0.001)).mul(vec3(...(options.tint ?? [1, 1, 1]))).mul(mix(vec3(1), vec3(...(options.farTint ?? [1, 1, 1])), fade.z.mul(fade.z))).mul(mix(1, contact, options.contact ?? 1))
  material.positionNode = position
  material.colorNode = albedoColor
  material.outputNode = vec4(mix(output.rgb, uniform(new Color('#f2c45a')), options.lodView ?? float(0)), output.a)
  material.opacityNode = opacity
  material.maskNode = (options.alphaToCoverage ? opacity.greaterThanEqual(0.02) : coverage.greaterThanEqual(0.5)).and(landscapeDither(screenCoordinate.xy).lessThan(min(fade.x, fade.y)))
  material.normalNode = normalize(cameraViewMatrix.mul(vec4(normalize(mix(worldNormal, vec3(0, 1, 0), 0.08)), 0)).xyz)
  return material
}
