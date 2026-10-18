import * as THREE from 'three'
import { WORLD_VARYING } from '../varying'
import { autoResolution, streamBaked, type BakedMaterial, type StreamedTextures } from '@blacksite/materials/three'
import { BAKE_INFO, BAKE_MAPS } from './bakes'
import { TEXTURES } from './textures'

export type SurfaceName = 'cast' | 'panel' | 'slab' | 'stained' | 'paint' | 'brick' | 'rust' | 'metal' | 'corrugated' | 'asphalt' | 'dirt' | 'grass' | 'gravel' | 'wood'

export type SurfaceWeather = { readonly grime?: number; readonly damp?: number; readonly soot?: number }

type SurfaceSpec = { readonly color?: string; readonly weather: Required<SurfaceWeather> }

const weather = (grime: number, damp: number, soot: number) => ({ grime, damp, soot })

export const SURFACES: Record<SurfaceName, SurfaceSpec> = {
  cast: { color: '#d2cdbd', weather: weather(0.6, 0.5, 0.55) },
  panel: { color: '#d6d1bf', weather: weather(0.55, 0.45, 0.5) },
  slab: { color: '#c4bfae', weather: weather(0.6, 0.6, 0.3) },
  stained: { color: '#cfcbb4', weather: weather(0.7, 0.55, 0.6) },
  paint: { color: '#93a68f', weather: weather(0.5, 0.45, 0.55) },
  brick: { color: '#a9978a', weather: weather(0.55, 0.5, 0.6) },
  rust: { color: '#a08070', weather: weather(0.4, 0.4, 0.3) },
  metal: { color: '#9a9d92', weather: weather(0.45, 0.35, 0.35) },
  corrugated: { color: '#8f8a76', weather: weather(0.45, 0.45, 0.4) },
  asphalt: { color: '#7b7b74', weather: weather(0.4, 0.6, 0.2) },
  dirt: { color: '#7c7a68', weather: weather(0.2, 0.5, 0.1) },
  grass: { color: '#82835f', weather: weather(0.2, 0.4, 0.1) },
  gravel: { color: '#9c968a', weather: weather(0.3, 0.5, 0.15) },
  wood: { color: '#8f8775', weather: weather(0.45, 0.4, 0.4) },
}

const loader = new THREE.TextureLoader()
const textures = new Map<string, THREE.Texture>()
const streams = new Map<SurfaceName, StreamedTextures>()
let anisotropy = 4
const pending: Promise<unknown>[] = []
let renderer: THREE.WebGLRenderer | undefined
let rendererFound: (renderer: THREE.WebGLRenderer) => void = () => {}
const rendererReady = new Promise<THREE.WebGLRenderer>(resolve => { rendererFound = resolve })

function useRenderer(found: THREE.WebGLRenderer) {
  if (renderer) return
  renderer = found
  rendererFound(found)
}

function streamTextures(stream: StreamedTextures) {
  return [stream.color, stream.normal, stream.orm, stream.masks]
}

export function setAnisotropy(found: THREE.WebGLRenderer) {
  useRenderer(found)
  anisotropy = Math.min(8, found.capabilities.getMaxAnisotropy())
  for (const texture of [...textures.values(), ...[...streams.values()].flatMap(streamTextures)]) { texture.anisotropy = anisotropy; if (texture.version > 0) texture.needsUpdate = true }
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

function bake(name: SurfaceName) {
  const cached = streams.get(name)
  if (cached) return cached
  const info = BAKE_INFO[name]
  const baked: BakedMaterial = { name: info.graph, size: info.size, depth: info.depth, format: 'ktx2', maps: BAKE_MAPS[name] }
  const stream = streamBaked(baked, { renderer: rendererReady, resolution: autoResolution(), anisotropy })
  streams.set(name, stream)
  pending.push(stream.ready)
  return stream
}

export const texturesReady = () => Promise.all(pending)

export const worldRenderer = () => rendererReady

export function preloadSurfaces() {
  for (const name of Object.keys(SURFACES) as SurfaceName[]) bake(name)
  return texturesReady()
}

export type GroundAO = { height: number; strength: number }
export type WeatherRoom = { readonly min: readonly [number, number]; readonly max: readonly [number, number]; readonly floor?: number; readonly ceiling: number }
export type WeatherOpening = { readonly at: readonly [number, number, number]; readonly radius: number }
export type WeatherSpaces = { readonly rooms?: readonly WeatherRoom[]; readonly openings?: readonly WeatherOpening[] }

const MAX_ROOMS = 8
const MAX_OPENINGS = 16
const spaces = {
  lookRooms: { value: Array.from({ length: MAX_ROOMS }, () => new THREE.Vector4()) },
  lookRoomHeights: { value: Array.from({ length: MAX_ROOMS }, () => new THREE.Vector2()) },
  lookRoomCount: { value: 0 },
  lookOpenings: { value: Array.from({ length: MAX_OPENINGS }, () => new THREE.Vector4()) },
  lookOpeningCount: { value: 0 },
}

export function weatherSpaces({ rooms = [], openings = [] }: WeatherSpaces = {}) {
  if (rooms.length > MAX_ROOMS) throw new Error(`weatherSpaces takes at most ${MAX_ROOMS} rooms`)
  if (openings.length > MAX_OPENINGS) throw new Error(`weatherSpaces takes at most ${MAX_OPENINGS} openings`)
  rooms.forEach((room, index) => {
    spaces.lookRooms.value[index]!.set(Math.min(room.min[0], room.max[0]), Math.min(room.min[1], room.max[1]), Math.max(room.min[0], room.max[0]), Math.max(room.min[1], room.max[1]))
    spaces.lookRoomHeights.value[index]!.set(room.floor ?? 0, room.ceiling)
  })
  openings.forEach((opening, index) => spaces.lookOpenings.value[index]!.set(opening.at[0], opening.at[1], opening.at[2], opening.radius))
  spaces.lookRoomCount.value = rooms.length
  spaces.lookOpeningCount.value = openings.length
}

const surfaceVertex = `
vec4 lookPosition = vec4(transformed, 1.0);
vec3 lookNormal = objectNormal;
#ifdef USE_INSTANCING
lookPosition = instanceMatrix * lookPosition;
lookNormal = mat3(instanceMatrix) * lookNormal;
#endif
vLookWorld = (modelMatrix * lookPosition).xyz;
vLookUp = normalize(mat3(modelMatrix) * lookNormal).y;`

const surfaceUv = `
#ifdef USE_MAP
vMapUv *= lookTile;
#endif
#ifdef USE_NORMALMAP
vNormalMapUv *= lookTile;
#endif
#ifdef USE_ROUGHNESSMAP
vRoughnessMapUv *= lookTile;
#endif
#ifdef USE_METALNESSMAP
vMetalnessMapUv *= lookTile;
#endif
#ifdef USE_AOMAP
vAoMapUv *= lookTile;
#endif`

const surfaceCommon = `
${WORLD_VARYING}
varying float vLookUp;
uniform sampler2D lookMasks;
uniform vec3 lookWeather;
uniform vec2 lookGroundAO;
uniform vec4 lookRooms[${MAX_ROOMS}];
uniform vec2 lookRoomHeights[${MAX_ROOMS}];
uniform int lookRoomCount;
uniform vec4 lookOpenings[${MAX_OPENINGS}];
uniform int lookOpeningCount;`

const surfaceWeather = `
#ifdef USE_MAP
vec4 lookMask = texture2D(lookMasks, vMapUv);
#else
vec4 lookMask = vec4(0.0);
#endif
float lookFloor = 0.0;
float lookCeiling = 1e4;
for (int i = 0; i < ${MAX_ROOMS}; i++) {
  if (i >= lookRoomCount) break;
  vec4 lookRoom = lookRooms[i];
  if (vLookWorld.x >= lookRoom.x && vLookWorld.z >= lookRoom.y && vLookWorld.x <= lookRoom.z && vLookWorld.z <= lookRoom.w) { lookFloor = lookRoomHeights[i].x; lookCeiling = lookRoomHeights[i].y; }
}
float lookAbove = vLookWorld.y - lookFloor;
float lookBelow = lookCeiling - vLookWorld.y;
float lookWall = 1.0 - abs(vLookUp);
float lookWet = 0.0;
float lookSmoke = 0.0;
for (int i = 0; i < ${MAX_OPENINGS}; i++) {
  if (i >= lookOpeningCount) break;
  vec4 lookOpening = lookOpenings[i];
  vec3 lookDelta = vLookWorld - lookOpening.xyz;
  float lookDrop = max(-lookDelta.y, 0.0) * 0.3 * lookWall;
  lookWet = max(lookWet, 1.0 - smoothstep(lookOpening.w, lookOpening.w * 2.0, length(vec2(length(lookDelta.xz), lookDrop))));
  lookSmoke = max(lookSmoke, (1.0 - smoothstep(lookOpening.w * 0.5, lookOpening.w * 1.8, length(lookDelta))) * step(0.0, lookDelta.y));
}
float lookGrime = lookWeather.x * clamp(lookMask.g * 0.75 + (1.0 - smoothstep(0.0, 1.4, lookAbove)) * lookWall * 0.6 - lookMask.r * 0.3, 0.0, 1.0);
float lookDamp = lookWeather.y * clamp((0.3 + 0.7 * lookMask.b) * max((1.0 - smoothstep(0.0, 0.8, lookAbove)) * lookWall, lookWet), 0.0, 1.0);
float lookSoot = lookWeather.z * clamp(max((1.0 - smoothstep(0.0, 1.8, lookBelow)) * step(-0.05, lookBelow), lookSmoke) * (0.6 + 0.4 * lookMask.g), 0.0, 1.0);
diffuseColor.rgb *= mix(vec3(1.0), vec3(0.55, 0.51, 0.45), lookGrime);
diffuseColor.rgb *= 1.0 - 0.4 * lookDamp;
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.2 + vec3(0.01), lookSoot * 0.85);`

const surfaceRoughness = `
roughnessFactor = clamp(roughnessFactor + 0.1 * lookGrime + 0.12 * lookSoot - 0.5 * lookDamp, 0.05, 1.0);`

const surfaceOcclusion = `
float lookAO = mix(1.0 - lookGroundAO.y, 1.0, smoothstep(0.0, lookGroundAO.x, lookAbove));
reflectedLight.indirectDiffuse *= lookAO;
reflectedLight.directDiffuse *= mix(1.0, lookAO, 0.6);`

const NO_MASKS = new THREE.DataTexture(new Uint8Array(4), 1, 1)
NO_MASKS.needsUpdate = true

type SurfaceUniforms = { lookMasks: { value: THREE.Texture }; lookWeather: { value: THREE.Vector3 }; lookGroundAO: { value: THREE.Vector2 }; lookTile: { value: number } }

function weathered(material: THREE.MeshStandardMaterial, uniforms: SurfaceUniforms) {
  const previous = material.onBeforeCompile
  const key = material.customProgramCacheKey
  const inherited = key === THREE.Material.prototype.customProgramCacheKey ? '' : key.call(material)
  material.onBeforeCompile = (shader, found) => {
    previous.call(material, shader, found)
    useRenderer(found)
    Object.assign(shader.uniforms, uniforms, spaces)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${WORLD_VARYING}\nvarying float vLookUp;\nuniform float lookTile;`)
      .replace('#include <uv_vertex>', `#include <uv_vertex>\n${surfaceUv}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\n${surfaceVertex}`)
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${surfaceCommon}`)
      .replace('#include <map_fragment>', `#include <map_fragment>\n${surfaceWeather}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${surfaceRoughness}`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${surfaceOcclusion}`)
  }
  material.customProgramCacheKey = () => `${inherited}|look-surface`
  material.userData.weather = uniforms
  return material
}

export type SurfaceMaps = { readonly map: THREE.Texture; readonly normalMap: THREE.Texture; readonly roughnessMap?: THREE.Texture; readonly metalnessMap?: THREE.Texture; readonly aoMap?: THREE.Texture }
export type SurfaceSource = { readonly name: string; readonly tile: number; readonly maps: SurfaceMaps; readonly masks?: THREE.Texture; readonly normalScale?: number; readonly roughness?: number; readonly metalness?: number }
export type SurfaceOptions = { color?: string; scale?: number; ao?: GroundAO | false; side?: THREE.Side; decal?: number; weather?: SurfaceWeather | false }

const DEFAULT_AO: GroundAO = { height: 1.1, strength: 0.5 }
const NO_WEATHER: Required<SurfaceWeather> = { grime: 0, damp: 0, soot: 0 }

function variant(options: SurfaceOptions) {
  const ao = options.ao === false ? '|noao' : options.ao ? `|ao${options.ao.height},${options.ao.strength}` : ''
  const weather = options.weather === false ? '|dry' : options.weather ? `|w${options.weather.grime ?? ''},${options.weather.damp ?? ''},${options.weather.soot ?? ''}` : ''
  return `${ao}${weather}`
}

type Built = { label: string; maps: SurfaceMaps; masks: THREE.Texture; tile: number; color: string; normalScale: number; roughness: number; metalness: number; weather: Required<SurfaceWeather>; albedo?: string }

function build(base: Built, options: SurfaceOptions & { roughness?: number }, meter: boolean) {
  const ao = options.ao === false ? { height: 1, strength: 0 } : options.ao ?? DEFAULT_AO
  const amounts = options.weather === false ? NO_WEATHER : { ...base.weather, ...options.weather }
  const tile = base.tile * (options.scale ?? 1)
  const material = new THREE.MeshStandardMaterial({
    name: `look-${base.label}${variant(options)}`,
    ...base.maps,
    normalScale: new THREE.Vector2(base.normalScale, base.normalScale),
    color: options.color ?? base.color,
    roughness: options.roughness ?? base.roughness,
    metalness: base.metalness,
    side: options.side ?? THREE.FrontSide,
    envMapIntensity: 0.55,
  })
  material.userData.tile = tile
  if (base.albedo) material.userData.albedo = base.albedo
  weathered(material, {
    lookMasks: { value: base.masks },
    lookWeather: { value: new THREE.Vector3(amounts.grime, amounts.damp, amounts.soot) },
    lookGroundAO: { value: new THREE.Vector2(ao.height, ao.strength) },
    lookTile: { value: meter ? 1 / tile : 1 },
  })
  if (options.decal) decalBias(material, DECAL_BIAS * options.decal)
  return material
}

function named(name: SurfaceName): Built {
  const stream = bake(name)
  const spec = SURFACES[name]
  return { label: name, maps: { map: stream.color, normalMap: stream.normal, roughnessMap: stream.orm, metalnessMap: stream.orm, aoMap: stream.orm }, masks: stream.masks, tile: stream.size, color: spec.color ?? '#ffffff', normalScale: 1, roughness: 1, metalness: 1, weather: spec.weather, albedo: BAKE_INFO[name].mean }
}

function sourced(source: SurfaceSource): Built {
  return { label: source.name, maps: source.maps, masks: source.masks ?? NO_MASKS, tile: source.tile, color: '#ffffff', normalScale: source.normalScale ?? 1, roughness: source.roughness ?? 1, metalness: source.metalness ?? (source.maps.metalnessMap ? 1 : 0), weather: NO_WEATHER }
}

const materials = new Map<string, THREE.MeshStandardMaterial>()
const sourcedMaterials = new WeakMap<SurfaceSource, Map<string, THREE.MeshStandardMaterial>>()

export function releaseSurface(source: SurfaceSource) {
  const cache = sourcedMaterials.get(source)
  if (!cache) return
  for (const material of cache.values()) material.dispose()
  sourcedMaterials.delete(source)
}

export function surface(name: SurfaceName | SurfaceSource, options: SurfaceOptions = {}) {
  const key = `${options.color ?? ''}|${options.scale ?? 1}|${variant(options)}|${options.side ?? 0}|${options.decal ?? ''}`
  if (typeof name !== 'string') {
    const cache = sourcedMaterials.get(name) ?? new Map<string, THREE.MeshStandardMaterial>()
    sourcedMaterials.set(name, cache)
    const cached = cache.get(key)
    if (cached) return cached
    const material = build(sourced(name), options, false)
    cache.set(key, material)
    material.addEventListener('dispose', () => cache.delete(key))
    return material
  }
  const cached = materials.get(`${name}|${key}`)
  if (cached) return cached
  const material = build(named(name), options, false)
  materials.set(`${name}|${key}`, material)
  return material
}

export function meterSurface(name: SurfaceName | SurfaceSource, options: SurfaceOptions & { roughness?: number } = {}) {
  return build(typeof name === 'string' ? named(name) : sourced(name), options, true)
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

export const DECAL_BIAS = 3e-4
export const OVERLAY_BIAS = 1.5e-3

export function decalBias<T extends THREE.Material>(material: T, bias = DECAL_BIAS) {
  const previous = material.onBeforeCompile
  const key = material.customProgramCacheKey
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer)
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\nmvPosition.xyz *= ${(1 - bias).toFixed(6)};\ngl_Position = projectionMatrix * mvPosition;`)
  }
  material.customProgramCacheKey = () => `${key.call(material)}|decal${bias}`
  material.userData.decalBias = bias
  return material
}

const contactMaterials = new Map<number, THREE.MeshBasicMaterial>()
export function contactShadow(width: number, depth: number, opacity = 0.55, spread = 1.4) {
  let material = contactMaterials.get(opacity)
  if (!material) {
    material = new THREE.MeshBasicMaterial({ map: contact(), transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, color: '#000000', fog: true })
    decalBias(material, OVERLAY_BIAS)
    contactMaterials.set(opacity, material)
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width + spread, depth + spread), material)
  mesh.rotation.x = -Math.PI / 2
  mesh.renderOrder = 1
  mesh.name = 'contact-shadow'
  return mesh
}

export type AtmosphereOptions = { ambient?: number; horizon?: number; fog?: string; density?: number; sunDirection?: [number, number, number]; sunIntensity?: number; skyIntensity?: number; shadowSize?: number; shadowRadius?: number; shadowMap?: number }

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

const GROUND_TILE = 4

let ground: THREE.MeshStandardMaterial | null = null
export function groundMaterial() {
  if (ground) return ground
  const dirt = bake('dirt')
  const grass = bake('grass')
  const gravel = bake('gravel')
  const material = new THREE.MeshStandardMaterial({ name: 'look-ground', map: dirt.color, normalMap: dirt.normal, roughnessMap: dirt.orm, aoMap: dirt.orm, color: SURFACES.dirt.color, roughness: 1, envMapIntensity: 0.4 })
  material.userData.tile = GROUND_TILE
  material.userData.albedo = BAKE_INFO.dirt.mean
  const glsl = (value: number) => value.toFixed(5)
  material.onBeforeCompile = (shader, found) => {
    useRenderer(found)
    shader.uniforms.grassMap = { value: grass.color }
    shader.uniforms.gravelMap = { value: gravel.color }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGroundXZ;\nvarying vec2 vGroundUv;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>\nvGroundUv = vMapUv * ${glsl(GROUND_TILE)};\nvMapUv *= ${glsl(GROUND_TILE / dirt.size)};\nvNormalMapUv *= ${glsl(GROUND_TILE / dirt.size)};\nvRoughnessMapUv *= ${glsl(GROUND_TILE / dirt.size)};\nvAoMapUv *= ${glsl(GROUND_TILE / dirt.size)};`)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvGroundXZ = (modelMatrix * vec4(transformed, 1.0)).xz;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vGroundXZ;\nvarying vec2 vGroundUv;\nuniform sampler2D grassMap;\nuniform sampler2D gravelMap;\n${noise}`)
      .replace('#include <map_fragment>', `
        vec3 groundDirt = texture2D(map, vMapUv).rgb;
        vec3 groundGrass = texture2D(grassMap, vGroundUv * ${glsl(1 / grass.size)} + 0.37).rgb * vec3(0.93, 0.95, 0.82);
        vec3 groundGravel = texture2D(gravelMap, vGroundUv * ${glsl(1 / gravel.size)}).rgb * 0.92;
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
  return decalBias(new THREE.MeshStandardMaterial({ name: 'look-puddle', color: '#2c2d27', roughness: 0.03, metalness: 0.55, envMapIntensity: 1.4, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), OVERLAY_BIAS)
}

const textureMeans = new WeakMap<THREE.Texture, THREE.Color>()

function textureMean(texture: THREE.Texture) {
  const cached = textureMeans.get(texture)
  if (cached) return cached
  const image = texture.image as (CanvasImageSource & { width: number; height: number }) | undefined
  if (!image?.width || (texture as THREE.CompressedTexture).isCompressedTexture || typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 32
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.drawImage(image, 0, 0, 32, 32)
  const data = context.getImageData(0, 0, 32, 32).data
  const space = texture.colorSpace === THREE.SRGBColorSpace ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace
  const mean = new THREE.Color(0, 0, 0)
  const texel = new THREE.Color()
  for (let index = 0; index < data.length; index += 4) mean.add(texel.setRGB(data[index]! / 255, data[index + 1]! / 255, data[index + 2]! / 255, space))
  mean.multiplyScalar(4 / data.length)
  textureMeans.set(texture, mean)
  return mean
}

export function surfaceAlbedo(hit: THREE.Intersection, target = new THREE.Color()) {
  const mesh = hit.object as THREE.Mesh
  const material = (Array.isArray(mesh.material) ? mesh.material[hit.face?.materialIndex ?? 0] : mesh.material) as THREE.MeshStandardMaterial | undefined
  if (!material?.color || !material.visible || material.colorWrite === false) return null
  target.copy(material.color)
  const albedo = material.userData.albedo as string | undefined
  const mean = albedo ? new THREE.Color(albedo) : material.map ? textureMean(material.map) : null
  if (mean) target.multiply(mean)
  const instanced = mesh as THREE.InstancedMesh
  if (hit.instanceId !== undefined && instanced.instanceColor) target.multiply(new THREE.Color().fromBufferAttribute(instanced.instanceColor, hit.instanceId))
  const colors = mesh.geometry.getAttribute('color')
  if (material.vertexColors && colors && hit.face) {
    const vertex = new THREE.Color()
    const sum = new THREE.Color(0, 0, 0)
    for (const index of [hit.face.a, hit.face.b, hit.face.c]) sum.add(vertex.fromBufferAttribute(colors as THREE.BufferAttribute, index))
    target.multiply(sum.multiplyScalar(1 / 3))
  }
  return target
}
