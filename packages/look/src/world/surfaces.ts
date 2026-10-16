import * as THREE from 'three'
import { TEXTURES } from './textures'

export type SurfaceName = 'cast' | 'panel' | 'slab' | 'stained' | 'paint' | 'brick' | 'rust' | 'metal' | 'corrugated' | 'asphalt' | 'dirt' | 'grass' | 'gravel'

type SurfaceSpec = { tile: number; color?: string; roughness: number; metalness?: number; normal?: number }

export const SURFACES: Record<SurfaceName, SurfaceSpec> = {
  cast: { tile: 3, color: '#b8b3a5', roughness: 0.96, normal: 1 },
  panel: { tile: 3, color: '#c4bfae', roughness: 0.94, normal: 0.8 },
  slab: { tile: 4, color: '#aaa596', roughness: 0.95, normal: 0.8 },
  stained: { tile: 3.5, color: '#b4b3a0', roughness: 0.95, normal: 0.6 },
  paint: { tile: 2.5, color: '#93a68f', roughness: 0.9, normal: 0.8 },
  brick: { tile: 2.2, color: '#a9978a', roughness: 0.93, normal: 1 },
  rust: { tile: 2, color: '#a08070', roughness: 0.85, metalness: 0.25, normal: 1 },
  metal: { tile: 2, color: '#9a9d92', roughness: 0.72, metalness: 0.35, normal: 1 },
  corrugated: { tile: 1.6, color: '#8f8a76', roughness: 0.7, metalness: 0.4, normal: 1.2 },
  asphalt: { tile: 4, color: '#7b7b74', roughness: 0.62, normal: 0.7 },
  dirt: { tile: 4, color: '#7c7a68', roughness: 1, normal: 1 },
  grass: { tile: 5, color: '#82835f', roughness: 1, normal: 1 },
  gravel: { tile: 2.5, color: '#9c968a', roughness: 0.95, normal: 1 },
}

const loader = new THREE.TextureLoader()
const textures = new Map<string, THREE.Texture>()
let anisotropy = 4
const pending: Promise<unknown>[] = []

export function setAnisotropy(renderer: THREE.WebGLRenderer) {
  anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())
  for (const texture of textures.values()) { texture.anisotropy = anisotropy; if (texture.image) texture.needsUpdate = true }
}

function texture(file: string, color: boolean) {
  const cached = textures.get(file)
  if (cached) return cached
  let done: (value: unknown) => void = () => {}
  pending.push(new Promise(resolve => { done = resolve }))
  const loaded = loader.load(TEXTURES[file]!, done, undefined, done)
  loaded.wrapS = loaded.wrapT = THREE.RepeatWrapping
  loaded.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
  loaded.anisotropy = anisotropy
  textures.set(file, loaded)
  return loaded
}

export const texturesReady = () => Promise.all(pending)

export function preloadSurfaces() {
  for (const name of Object.keys(SURFACES)) { texture(`${name}_c.webp`, true); texture(`${name}_n.webp`, false) }
  return texturesReady()
}

export type GroundAO = { height: number; strength: number }

export function patchGroundAO(material: THREE.MeshStandardMaterial, ao: GroundAO = { height: 1.1, strength: 0.5 }) {
  const previous = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer)
    shader.uniforms.aoHeight = { value: ao.height }
    shader.uniforms.aoStrength = { value: ao.strength }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vLookWorldY;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvLookWorldY = (modelMatrix * vec4(transformed, 1.0)).y;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vLookWorldY;\nuniform float aoHeight;\nuniform float aoStrength;')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nfloat lookAO = mix(1.0 - aoStrength, 1.0, smoothstep(0.0, aoHeight, vLookWorldY));\nreflectedLight.indirectDiffuse *= lookAO;\nreflectedLight.directDiffuse *= mix(1.0, lookAO, 0.6);')
  }
  material.customProgramCacheKey = () => `look-ao-${ao.height}-${ao.strength}`
  return material
}

export type SurfaceMaps = { readonly map: THREE.Texture; readonly normalMap: THREE.Texture; readonly roughnessMap?: THREE.Texture; readonly metalnessMap?: THREE.Texture; readonly aoMap?: THREE.Texture }
export type SurfaceSource = { readonly name: string; readonly tile: number; readonly maps: SurfaceMaps; readonly normalScale?: number; readonly roughness?: number; readonly metalness?: number }
export type SurfaceOptions = { color?: string; scale?: number; ao?: GroundAO | false; side?: THREE.Side }

const materials = new Map<string, THREE.MeshStandardMaterial>()
const sourced = new WeakMap<SurfaceSource, Map<string, THREE.MeshStandardMaterial>>()

function sourceSurface(source: SurfaceSource, key: string, options: SurfaceOptions) {
  const cache = sourced.get(source) ?? new Map<string, THREE.MeshStandardMaterial>()
  sourced.set(source, cache)
  const cached = cache.get(key)
  if (cached) return cached
  const normal = source.normalScale ?? 1
  const material = new THREE.MeshStandardMaterial({
    name: `look-${source.name}`,
    ...source.maps,
    normalScale: new THREE.Vector2(normal, normal),
    color: options.color ?? '#ffffff',
    roughness: source.roughness ?? 1,
    metalness: source.metalness ?? (source.maps.metalnessMap ? 1 : 0),
    side: options.side ?? THREE.FrontSide,
    envMapIntensity: 0.55,
  })
  material.userData.tile = source.tile * (options.scale ?? 1)
  if (options.ao !== false) patchGroundAO(material, options.ao || undefined)
  cache.set(key, material)
  material.addEventListener('dispose', () => cache.delete(key))
  return material
}

export function releaseSurface(source: SurfaceSource) {
  const cache = sourced.get(source)
  if (!cache) return
  for (const material of cache.values()) material.dispose()
  sourced.delete(source)
}

export function surface(name: SurfaceName | SurfaceSource, options: SurfaceOptions = {}) {
  const key = `${typeof name === 'string' ? name : 'source'}|${options.color ?? ''}|${options.scale ?? 1}|${options.ao === false ? 'noao' : JSON.stringify(options.ao ?? '')}|${options.side ?? 0}`
  if (typeof name !== 'string') return sourceSurface(name, key, options)
  const cached = materials.get(key)
  if (cached) return cached
  const spec = SURFACES[name]
  const material = new THREE.MeshStandardMaterial({
    name: `look-${name}`,
    map: texture(`${name}_c.webp`, true),
    normalMap: texture(`${name}_n.webp`, false),
    normalScale: new THREE.Vector2(spec.normal ?? 1, spec.normal ?? 1),
    color: options.color ?? spec.color ?? '#ffffff',
    roughness: spec.roughness,
    metalness: spec.metalness ?? 0,
    side: options.side ?? THREE.FrontSide,
    envMapIntensity: 0.55,
  })
  material.userData.tile = spec.tile * (options.scale ?? 1)
  if (options.ao !== false) patchGroundAO(material, options.ao || undefined)
  materials.set(key, material)
  return material
}

export function meterSurface(name: SurfaceName | SurfaceSource, options: { color?: string; scale?: number; ao?: GroundAO | false; roughness?: number } = {}) {
  const base = surface(name, options)
  const material = base.clone()
  material.onBeforeCompile = base.onBeforeCompile
  material.customProgramCacheKey = base.customProgramCacheKey
  if (options.roughness !== undefined) material.roughness = options.roughness
  const repeat = 1 / (base.userData.tile as number)
  const clones = new Map<THREE.Texture, THREE.Texture>()
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap'] as const) {
    const map = base[key]
    if (!map) continue
    const scaled = clones.get(map) ?? map.clone()
    clones.set(map, scaled)
    scaled.repeat.set(repeat, repeat)
    scaled.needsUpdate = true
    material[key] = scaled
  }
  return material
}

export function worldBoxGeometry(width: number, height: number, depth: number, tile: number) {
  const geometry = new THREE.BoxGeometry(width, height, depth)
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute
  const faces: Array<[number, number]> = [[depth, height], [depth, height], [width, depth], [width, depth], [width, height], [width, height]]
  for (let face = 0; face < 6; face++) {
    const [u, v] = faces[face]!
    for (let vertex = 0; vertex < 4; vertex++) {
      const index = face * 4 + vertex
      uv.setXY(index, uv.getX(index) * u / tile, uv.getY(index) * v / tile)
    }
  }
  return geometry
}

export function worldPlaneGeometry(width: number, depth: number, tile: number) {
  const geometry = new THREE.PlaneGeometry(width, depth)
  geometry.rotateX(-Math.PI / 2)
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute
  for (let index = 0; index < uv.count; index++) uv.setXY(index, uv.getX(index) * width / tile, uv.getY(index) * depth / tile)
  return geometry
}

export function worldCylinderGeometry(radius: number, height: number, tile: number, segments = 12) {
  const geometry = new THREE.CylinderGeometry(radius, radius, height, segments, 1)
  const uv = geometry.getAttribute('uv') as THREE.BufferAttribute
  const around = Math.PI * 2 * radius
  for (let index = 0; index < uv.count; index++) uv.setXY(index, uv.getX(index) * around / tile, uv.getY(index) * height / tile)
  return geometry
}

let contactTexture: THREE.Texture | null = null
function contact() {
  if (contactTexture) return contactTexture
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')!
  const image = context.createImageData(size, size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = Math.max(0, Math.abs(x + 0.5 - size / 2) / (size / 2) * 1.25 - 0.25)
    const dy = Math.max(0, Math.abs(y + 0.5 - size / 2) / (size / 2) * 1.25 - 0.25)
    const falloff = Math.max(0, 1 - Math.hypot(dx, dy))
    const alpha = Math.pow(falloff, 1.6)
    image.data.set([0, 0, 0, Math.round(alpha * 255)], (y * size + x) * 4)
  }
  context.putImageData(image, 0, 0)
  contactTexture = new THREE.CanvasTexture(canvas)
  return contactTexture
}

const contactMaterials = new Map<number, THREE.MeshBasicMaterial>()
export function contactShadow(width: number, depth: number, opacity = 0.55, spread = 1.4) {
  let material = contactMaterials.get(opacity)
  if (!material) {
    material = new THREE.MeshBasicMaterial({ map: contact(), transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, color: '#000000', fog: true })
    contactMaterials.set(opacity, material)
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width + spread, depth + spread), material)
  mesh.rotation.x = -Math.PI / 2
  mesh.renderOrder = 1
  mesh.name = 'contact-shadow'
  return mesh
}

export type AtmosphereOptions = { ambient?: number; horizon?: number; fog?: string; density?: number; sunDirection?: [number, number, number]; sunIntensity?: number; skyIntensity?: number; shadowSize?: number; shadowRadius?: number; shadowMap?: number; exposure?: number }

const skyVertex = `
varying vec3 vDirection;
void main() {
  vDirection = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 clip = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
  gl_Position = clip.xyww;
}`
const skyFragment = `
uniform sampler2D sky;
uniform vec3 fogColor;
uniform float intensity;
uniform float horizon;
varying vec3 vDirection;
void main() {
  vec3 direction = normalize(vDirection);
  vec2 uv = vec2(atan(direction.z, direction.x) / 6.2831853 + 0.5, asin(clamp(direction.y, -1.0, 1.0)) / 3.1415926 + 0.5);
  gl_FragColor = vec4(texture2D(sky, uv).rgb * intensity, 1.0);
  #include <colorspace_fragment>
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(horizon, -0.02, direction.y));
}`

export function createAtmosphere(scene: THREE.Scene, renderer: THREE.WebGLRenderer, options: AtmosphereOptions = {}) {
  const fogColor = new THREE.Color(options.fog ?? '#8c8e80')
  scene.fog = new THREE.FogExp2(fogColor, options.density ?? 0.016)
  scene.background = fogColor
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = options.exposure ?? 1.05
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  setAnisotropy(renderer)

  const skyTexture = texture('sky.webp', true)
  skyTexture.wrapT = THREE.ClampToEdgeWrapping
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), new THREE.ShaderMaterial({
    uniforms: { sky: { value: skyTexture }, fogColor: { value: fogColor }, intensity: { value: options.skyIntensity ?? 1 }, horizon: { value: options.horizon ?? 0.3 } },
    vertexShader: skyVertex,
    fragmentShader: skyFragment,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    fog: false,
  }))
  dome.frustumCulled = false
  dome.renderOrder = -1
  dome.name = 'sky'
  dome.onBeforeRender = (_renderer, _scene, camera) => { dome.position.copy(camera.position) }
  dome.scale.setScalar(10)
  scene.add(dome)

  const hemisphere = new THREE.HemisphereLight('#c2c6b8', '#463f31', options.ambient ?? 1.1)
  scene.add(hemisphere)
  const sun = new THREE.DirectionalLight('#f0d9b0', options.sunIntensity ?? 1.9)
  const direction = new THREE.Vector3(...(options.sunDirection ?? [-0.55, 0.62, -0.38])).normalize()
  const shadowSize = options.shadowSize ?? 40
  sun.position.copy(direction).multiplyScalar(80)
  sun.castShadow = true
  sun.shadow.mapSize.setScalar(options.shadowMap ?? (isTouchDevice() ? 1024 : 2048))
  sun.shadow.radius = options.shadowRadius ?? 4
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.03
  Object.assign(sun.shadow.camera, { left: -shadowSize, right: shadowSize, top: shadowSize, bottom: -shadowSize, near: 1, far: 200 })
  sun.shadow.camera.updateProjectionMatrix()
  scene.add(sun, sun.target)

  const pmrem = new THREE.PMREMGenerator(renderer)
  const applyEnvironment = () => {
    if (!skyTexture.image) return
    const equirect = skyTexture.clone()
    equirect.mapping = THREE.EquirectangularReflectionMapping
    equirect.needsUpdate = true
    scene.environment = pmrem.fromEquirectangular(equirect).texture
    scene.environmentIntensity = 0.65
    equirect.dispose()
  }
  if (skyTexture.image) applyEnvironment()
  else void texturesReady().then(applyEnvironment)

  const follow = (target: THREE.Vector3) => {
    sun.target.position.copy(target)
    sun.position.copy(target).addScaledVector(direction, 80)
    const texel = (shadowSize * 2) / sun.shadow.mapSize.x
    sun.position.x = Math.round(sun.position.x / texel) * texel
    sun.position.z = Math.round(sun.position.z / texel) * texel
    sun.target.position.x = sun.position.x - direction.x * 80
    sun.target.position.z = sun.position.z - direction.z * 80
  }

  return { sun, hemisphere, dome, fogColor, follow }
}

export function internalPixelRatio() {
  const coarse = matchMedia('(pointer: coarse)').matches
  return Math.min(devicePixelRatio, coarse ? 1.25 : 1)
}

export function isTouchDevice() {
  return matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 && innerWidth < 900
}

const noise = `
float lookHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float lookNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(lookHash(i), lookHash(i + vec2(1.0, 0.0)), u.x), mix(lookHash(i + vec2(0.0, 1.0)), lookHash(i + vec2(1.0, 1.0)), u.x), u.y);
}`

let ground: THREE.MeshStandardMaterial | null = null
export function groundMaterial() {
  if (ground) return ground
  const dirt = SURFACES.dirt
  const material = new THREE.MeshStandardMaterial({ name: 'look-ground', map: texture('dirt_c.webp', true), normalMap: texture('dirt_n.webp', false), color: dirt.color, roughness: 1, envMapIntensity: 0.4 })
  material.userData.tile = dirt.tile
  const grass = texture('grass_c.webp', true)
  const gravel = texture('gravel_c.webp', true)
  material.onBeforeCompile = shader => {
    shader.uniforms.grassMap = { value: grass }
    shader.uniforms.gravelMap = { value: gravel }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vGroundXZ;\nuniform sampler2D grassMap;\nuniform sampler2D gravelMap;\n${noise}`)
      .replace('#include <map_fragment>', `
        vec3 groundDirt = texture2D(map, vMapUv).rgb;
        vec3 groundGrass = texture2D(grassMap, vMapUv * 0.83 + 0.37).rgb * vec3(0.93, 0.95, 0.82);
        vec3 groundGravel = texture2D(gravelMap, vMapUv * 1.6).rgb * 0.92;
        float grassMask = smoothstep(0.38, 0.6, lookNoise(vGroundXZ * 0.045) * 0.7 + lookNoise(vGroundXZ * 0.19) * 0.3);
        float gravelMask = smoothstep(0.62, 0.74, lookNoise(vGroundXZ * 0.07 + 13.1) * 0.75 + lookNoise(vGroundXZ * 0.4) * 0.25);
        vec3 groundColor = mix(mix(groundDirt, groundGrass, grassMask), groundGravel, gravelMask * (1.0 - grassMask));
        float groundShade = 0.82 + 0.18 * lookNoise(vGroundXZ * 0.3);
        diffuseColor.rgb *= groundColor * groundShade;
      `)
  }
  material.customProgramCacheKey = () => 'look-ground'
  ground = material
  return material
}

export function puddleMaterial() {
  return new THREE.MeshStandardMaterial({ name: 'look-puddle', color: '#2c2d27', roughness: 0.03, metalness: 0.55, envMapIntensity: 1.4, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 })
}
