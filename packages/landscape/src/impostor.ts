import {
  Color, DoubleSide, FrontSide, GLSL3, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshStandardMaterial, NoColorSpace, OrthographicCamera,
  RawShaderMaterial, SRGBColorSpace, Scene, UnsignedByteType, Vector3, Vector4, WebGLRenderTarget,
} from 'three'
import type { Texture, WebGLRenderer } from 'three'
import { patchMaterial, replaceChunk } from './patch'
import type { TreeModel } from './trees'
import { NOISE_GLSL, WIND_GLSL, type Wind } from './wind'

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

const BAKE_VERTEX = /* glsl */ `
precision highp float;
in vec3 position;
in vec3 normal;
in vec2 uv;
in vec3 color;
uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;
out vec3 vNormal;
out vec2 vUv;
out vec3 vColor;
void main() {
  vNormal = normal;
  vUv = uv;
  vColor = color;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const BAKE_FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D map;
uniform vec3 tint;
uniform float cutout;
in vec3 vNormal;
in vec2 vUv;
in vec3 vColor;
layout(location = 0) out vec4 gAlbedo;
layout(location = 1) out vec4 gNormal;
void main() {
  vec4 texel = texture(map, vUv);
  if (cutout > 0.5 && texel.a < 0.5) discard;
  vec3 n = normalize(vNormal);
  gAlbedo = vec4(texel.rgb * tint * vColor, 1.0);
  gNormal = vec4(n * 0.5 + 0.5, 1.0);
}
`

function bakeMaterial(map: Texture, tint: readonly [number, number, number], cutout: boolean) {
  return new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: BAKE_VERTEX,
    fragmentShader: BAKE_FRAGMENT,
    uniforms: { map: { value: map }, tint: { value: new Color(...tint) }, cutout: { value: cutout ? 1 : 0 } },
    side: cutout ? DoubleSide : FrontSide,
  })
}

export function hemiOctDirection(u: number, v: number, out = new Vector3()): Vector3 {
  const tx = u * 2 - 1
  const ty = v * 2 - 1
  const x = (tx + ty) * 0.5
  const z = (tx - ty) * 0.5
  const y = 1 - Math.abs(x) - Math.abs(z)
  return out.set(x, Math.max(y, 0), z).normalize()
}

export function bakeImpostor(renderer: WebGLRenderer, model: TreeModel, textures: TreeTextures, options: BakeOptions = {}): ImpostorAtlas {
  const started = performance.now()
  const frames = options.frames ?? 8
  const frameSize = options.frameSize ?? 192
  const size = frames * frameSize
  const centre = model.bounds.center.clone()
  const radius = model.bounds.radius * 1.02
  const scene = new Scene()
  const woodMaterial = bakeMaterial(textures.bark, model.species.bark, false)
  const leafMaterial = bakeMaterial(textures.leaf, model.species.leaves, true)
  scene.add(new Mesh(model.wood, woodMaterial), new Mesh(model.leaves, leafMaterial))
  const camera = new OrthographicCamera(-radius, radius, radius, -radius, 0.01, radius * 4)
  const target = new WebGLRenderTarget(size, size, {
    count: 2,
    type: UnsignedByteType,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
    generateMipmaps: false,
    depthBuffer: true,
    samples: options.samples ?? 4,
  })
  const [albedo, normal] = target.textures as [Texture, Texture]
  albedo.colorSpace = SRGBColorSpace
  normal.colorSpace = NoColorSpace
  albedo.anisotropy = 4
  albedo.name = `${model.species.name}-impostor-albedo`
  normal.name = `${model.species.name}-impostor-normal`

  const previousTarget = renderer.getRenderTarget()
  const previousClear = new Color()
  renderer.getClearColor(previousClear)
  const previousAlpha = renderer.getClearAlpha()
  const previousAutoClear = renderer.autoClear
  const previousShadows = renderer.shadowMap.autoUpdate
  renderer.shadowMap.autoUpdate = false
  renderer.autoClear = false
  renderer.setClearColor(0x000000, 0)
  target.scissorTest = false
  target.viewport.set(0, 0, size, size)
  renderer.setRenderTarget(target)
  renderer.clear(true, true, true)
  const direction = new Vector3()
  const up = new Vector3()
  target.scissorTest = true
  for (let j = 0; j < frames; j++) {
    for (let i = 0; i < frames; i++) {
      hemiOctDirection(i / (frames - 1), j / (frames - 1), direction)
      up.set(0, 1, 0)
      if (direction.y > 0.999) up.set(0, 0, -1)
      camera.up.copy(up)
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
  }
  target.scissorTest = false
  renderer.setRenderTarget(previousTarget)
  renderer.setClearColor(previousClear, previousAlpha)
  renderer.autoClear = previousAutoClear
  renderer.shadowMap.autoUpdate = previousShadows
  woodMaterial.dispose()
  leafMaterial.dispose()
  return {
    albedo,
    normal,
    frames,
    frameSize,
    centre,
    radius,
    milliseconds: performance.now() - started,
    dispose: () => target.dispose(),
  }
}

export const IMPOSTOR_GLSL = /* glsl */ `
vec2 bsHemiOct(vec3 d) {
  d /= abs(d.x) + abs(d.y) + abs(d.z);
  return vec2(d.x + d.z, d.x - d.z) * 0.5 + 0.5;
}
vec3 bsRotY(vec3 v, float c, float s) {
  return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z);
}
`

const VERTEX_HEAD = /* glsl */ `
attribute vec4 treeInstance;
attribute float treeScale;
uniform vec4 impostorShape;
uniform vec4 impostorRange;
uniform float impostorFrames;
varying vec2 vImpostorGrid;
varying vec2 vImpostorUv;
varying vec3 vImpostorFade;
varying vec2 vImpostorYaw;
`

const VERTEX_BODY = /* glsl */ `
float bsYaw = treeInstance.w;
float bsC = cos(bsYaw);
float bsS = sin(bsYaw);
vec3 bsCentre = treeInstance.xyz + bsRotY(impostorShape.xyz * treeScale, bsC, bsS);
vec3 bsToCam = cameraPosition - bsCentre;
float bsDist = length(bsToCam);
float bsRootDist = distance(cameraPosition, treeInstance.xyz);
float bsIn = smoothstep(impostorRange.x, impostorRange.y, bsRootDist);
float bsOut = 1.0 - smoothstep(impostorRange.z, impostorRange.w, bsRootDist);
vec3 bsDir = bsToCam / max(bsDist, 0.001);
vec3 bsLocal = vec3(bsC * bsDir.x - bsS * bsDir.z, bsDir.y, bsS * bsDir.x + bsC * bsDir.z);
bsLocal.y = max(bsLocal.y, 0.0);
bsLocal = normalize(bsLocal + vec3(0.0, 0.0001, 0.0));
vImpostorGrid = bsHemiOct(bsLocal) * (impostorFrames - 1.0);
vec3 bsUpL = bsLocal.y > 0.999 ? vec3(0.0, 0.0, -1.0) : vec3(0.0, 1.0, 0.0);
vec3 bsRightL = normalize(cross(bsUpL, bsLocal));
vec3 bsUpvL = cross(bsLocal, bsRightL);
vec3 bsRightW = bsRotY(bsRightL, bsC, bsS);
vec3 bsUpW = bsRotY(bsUpvL, bsC, bsS);
float bsSize = impostorShape.w * treeScale * 2.0 * step(0.0001, bsIn * bsOut);
float bsLift = position.y + 0.5;
float bsSway = windAt(treeInstance.xz) * 0.025 * impostorShape.w * treeScale * bsLift * bsLift;
vec3 transformed = bsCentre + (bsRightW * position.x + bsUpW * position.y) * bsSize + vec3(windDirection.x, 0.0, windDirection.y) * bsSway;
vImpostorUv = uv;
vImpostorFade = vec3(bsIn, bsOut, smoothstep(impostorRange.y, impostorRange.w, bsRootDist));
vImpostorYaw = vec2(bsC, bsS);
`

const FRAGMENT_HEAD = /* glsl */ `
uniform sampler2D impostorAlbedo;
uniform sampler2D impostorNormal;
uniform float impostorFrames;
uniform vec3 impostorTint;
varying vec2 vImpostorGrid;
varying vec2 vImpostorUv;
varying vec3 vImpostorFade;
varying vec2 vImpostorYaw;
vec2 bsFrameUv(vec2 frame) {
  return (frame + clamp(vImpostorUv, vec2(0.004), vec2(0.996))) / impostorFrames;
}
`

const FRAGMENT_SAMPLE = /* glsl */ `
float bsSmudge = vImpostorFade.z;
float bsBias = bsSmudge * 1.25;
#ifdef IMPOSTOR_SINGLE
vec2 bsFrame = clamp(floor(vImpostorGrid + 0.5), vec2(0.0), vec2(impostorFrames - 1.0));
vec4 bsA = texture2D(impostorAlbedo, bsFrameUv(bsFrame), bsBias);
vec4 bsN = texture2D(impostorNormal, bsFrameUv(bsFrame), bsBias);
#else
vec2 bsBase = clamp(floor(vImpostorGrid), vec2(0.0), vec2(impostorFrames - 2.0));
vec2 bsF = clamp(vImpostorGrid - bsBase, 0.0, 1.0);
vec4 bsW = vec4((1.0 - bsF.x) * (1.0 - bsF.y), bsF.x * (1.0 - bsF.y), (1.0 - bsF.x) * bsF.y, bsF.x * bsF.y);
vec4 bsA = texture2D(impostorAlbedo, bsFrameUv(bsBase), bsBias) * bsW.x
  + texture2D(impostorAlbedo, bsFrameUv(bsBase + vec2(1.0, 0.0)), bsBias) * bsW.y
  + texture2D(impostorAlbedo, bsFrameUv(bsBase + vec2(0.0, 1.0)), bsBias) * bsW.z
  + texture2D(impostorAlbedo, bsFrameUv(bsBase + vec2(1.0, 1.0)), bsBias) * bsW.w;
vec4 bsN = texture2D(impostorNormal, bsFrameUv(bsBase), bsBias) * bsW.x
  + texture2D(impostorNormal, bsFrameUv(bsBase + vec2(1.0, 0.0)), bsBias) * bsW.y
  + texture2D(impostorNormal, bsFrameUv(bsBase + vec2(0.0, 1.0)), bsBias) * bsW.z
  + texture2D(impostorNormal, bsFrameUv(bsBase + vec2(1.0, 1.0)), bsBias) * bsW.w;
#endif
float bsCoverage = bsA.a;
#ifdef IMPOSTOR_A2C
float bsAlpha = clamp((bsCoverage - 0.5) / max(fwidth(bsCoverage) * (1.0 + bsSmudge * 2.5), 0.0001) + 0.5, 0.0, 1.0);
if (bsAlpha < 0.02) discard;
#else
float bsAlpha = 1.0;
if (bsCoverage < 0.5) discard;
#endif
float bsDitherValue = bsDither(gl_FragCoord.xy);
if (bsDitherValue >= min(vImpostorFade.x, vImpostorFade.y)) discard;
diffuseColor.rgb *= bsA.rgb / max(bsCoverage, 0.001) * impostorTint;
diffuseColor.a = bsAlpha;
vec3 bsLocalNormal = normalize(bsN.rgb / max(bsN.a, 0.001) * 2.0 - 1.0);
vec3 bsWorldNormal = normalize(bsRotY(bsLocalNormal, vImpostorYaw.x, vImpostorYaw.y));
`

export interface ImpostorMaterialOptions {
  readonly atlas: ImpostorAtlas
  readonly wind: Wind
  readonly range: readonly [number, number, number, number]
  readonly alphaToCoverage?: boolean
  readonly singleFrame?: boolean
  readonly tint?: readonly [number, number, number]
}

export function createImpostorMaterial(options: ImpostorMaterialOptions): MeshStandardMaterial {
  const { atlas } = options
  const material = new MeshStandardMaterial({ name: 'world-impostor', color: 0xffffff, roughness: 0.92, metalness: 0, side: DoubleSide, alphaToCoverage: options.alphaToCoverage === true })
  material.defines = {}
  if (options.alphaToCoverage) material.defines.IMPOSTOR_A2C = ''
  if (options.singleFrame) material.defines.IMPOSTOR_SINGLE = ''
  const uniforms = {
    impostorAlbedo: { value: atlas.albedo },
    impostorNormal: { value: atlas.normal },
    impostorFrames: { value: atlas.frames },
    impostorShape: { value: new Vector4(atlas.centre.x, atlas.centre.y, atlas.centre.z, atlas.radius) },
    impostorRange: { value: new Vector4(...options.range) },
    impostorTint: { value: new Vector3(...(options.tint ?? [1, 1, 1])) },
  }
  material.userData.impostor = uniforms
  patchMaterial(material, `world-impostor-${options.singleFrame ? 1 : 4}-${options.alphaToCoverage ? 'a2c' : 'cut'}`, shader => {
    Object.assign(shader.uniforms, options.wind.uniforms, uniforms)
    shader.vertexShader = `${NOISE_GLSL}\n${WIND_GLSL}\n${IMPOSTOR_GLSL}\n${VERTEX_HEAD}\n${shader.vertexShader}`
    shader.vertexShader = replaceChunk(shader.vertexShader, 'begin_vertex', VERTEX_BODY)
    shader.fragmentShader = `${NOISE_GLSL}\n${IMPOSTOR_GLSL}\n${FRAGMENT_HEAD}\n${shader.fragmentShader}`
    shader.fragmentShader = replaceChunk(shader.fragmentShader, 'map_fragment', FRAGMENT_SAMPLE)
    shader.fragmentShader = replaceChunk(shader.fragmentShader, 'alphatest_fragment', '')
    shader.fragmentShader = replaceChunk(shader.fragmentShader, 'normal_fragment_begin', `
      vec3 normal = normalize((viewMatrix * vec4(normalize(mix(bsWorldNormal, vec3(0.0, 1.0, 0.0), 0.2)), 0.0)).xyz);
      vec3 nonPerturbedNormal = normal;
      float faceDirection = 1.0;
    `)
  })
  return material
}
