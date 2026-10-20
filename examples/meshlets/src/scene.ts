import {
  Box3, Color, DataTexture, DataUtils, DirectionalLight, EquirectangularReflectionMapping,
  Euler, FogExp2, HalfFloatType, HemisphereLight, LinearFilter, Matrix4, MeshPhysicalNodeMaterial,
  MeshStandardMaterial, MeshStandardNodeMaterial, Quaternion, RedFormat, RepeatWrapping, Scene,
  SRGBColorSpace, TextureLoader, Vector3,
} from 'three/webgpu'
import { loadMeshletAsset, loadMeshletModel, normalMapWithUV } from '@blacksite/geometry'
import type { MeshletModel, MeshletSceneEntry } from '@blacksite/geometry'
import { bumpMap, cos, float, mix, mx_noise_float, normalWorldGeometry, positionWorld, sin, smoothstep, texture, triplanarTexture, uniform, vec2, vec3 } from 'three/tsl'
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'
import { createTerrainFromAsset } from './terrain'
import { createVegetation } from './vegetation'

type Point = [number, number, number]
type CameraPreset = { position: Point; target: Point }

function createCitadel(model: MeshletModel, ground: number): MeshletSceneEntry[] {
  const entries = new Map<number, MeshletSceneEntry & { instances: Matrix4[] }>()
  const materials = model.materials.map(material => {
    if (!(material instanceof MeshStandardMaterial)) throw new Error('Architecture requires a standard surface material')
    return material
  })
  const addPart = (name: string, x: number, y: number, z: number, yaw = 0, scale = 1) => {
    const original = model.instances.find(instance => instance.name === `modular_fort_01_${name}`)
    if (!original) throw new Error(`Fort component is missing: ${name}`)
    const asset = model.geometries.get(original.geometry)!
    const linear = original.matrix.clone().setPosition(0, 0, 0)
    const bounds = new Box3(new Vector3().fromArray(asset.metadata.bounds.min), new Vector3().fromArray(asset.metadata.bounds.max)).applyMatrix4(linear)
    const center = bounds.getCenter(new Vector3())
    const matrix = new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(0, yaw, 0)), new Vector3(scale, scale, scale))
      .multiply(new Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z)).multiply(linear)
    let entry = entries.get(original.geometry)
    if (!entry) {
      entry = { asset, instances: [], materials }
      entries.set(original.geometry, entry)
    }
    entry.instances.push(matrix)
  }
  addPart('tower_round', -43, ground - 0.8, -37, -0.16, 0.66)
  addPart('tower_round', -10, ground - 0.4, -37, 0.23, 0.73)
  addPart('tower_round', -45, ground + 0.1, -70, 0.5, 0.8)
  addPart('tower_round', -11, ground + 0.8, -70, 0.05, 0.92)
  addPart('wall_thin_gate_01', -26, ground, -36, Math.PI / 2, 1.2)
  addPart('wall_thin_straight_02', -36, ground - 0.2, -36, Math.PI / 2, 0.65)
  addPart('wall_thin_straight_03', -16, ground, -36, Math.PI / 2, 0.65)
  addPart('wall_thick_straight_02', -43, ground - 0.5, -53, 0.03, 1.45)
  addPart('wall_thick_straight_01', -10, ground - 0.2, -53, -0.03, 1.45)
  addPart('wall_thin_straight_04', -27, ground + 0.3, -70, Math.PI / 2, 1.45)
  addPart('wall_stairs_straight_01', -32, ground + 0.1, -51, Math.PI / 2, 1)
  addPart('tower_round', -29, ground + 2, -60, 0.31, 1.15)
  return [...entries.values()]
}

export async function createCoastalScene(status: (message: string) => void) {
  status('Loading the coastline, stonework and coastal plants…')
  const loader = new TextureLoader()
  const [terrainAsset, oceanAsset, fort, environment, mossAlbedo, mossNormal, mossOrm, rockAlbedo, rockNormal, rockOrm] = await Promise.all([
    loadMeshletAsset('/owned/geometry/terrain.meshlets'),
    loadMeshletAsset('/owned/geometry/ocean.meshlets'),
    loadMeshletModel('/owned/geometry/fort/manifest.json'),
    new HDRLoader().loadAsync('/owned/sunset-sky.hdr'),
    loader.loadAsync('/owned/ground-moss-albedo.png'), loader.loadAsync('/owned/ground-moss-normal.png'), loader.loadAsync('/owned/ground-moss-orm.png'),
    loader.loadAsync('/owned/coastal-rock-albedo.jpg'), loader.loadAsync('/owned/coastal-rock-normal.jpg'), loader.loadAsync('/owned/coastal-rock-orm.jpg'),
  ])
  const terrain = createTerrainFromAsset(terrainAsset)
  for (const map of [mossAlbedo, mossNormal, mossOrm, rockAlbedo, rockNormal, rockOrm]) {
    map.wrapS = map.wrapT = RepeatWrapping
    map.anisotropy = 8
  }
  for (const map of [mossAlbedo, rockAlbedo]) map.colorSpace = SRGBColorSpace
  const groundMaterial = new MeshStandardNodeMaterial({ roughness: 0.95 })
  const growth = mx_noise_float(positionWorld.xz.mul(0.055)).mul(0.5).add(0.5)
  const grassWeight = smoothstep(0.5, 0.95, normalWorldGeometry.y).mul(smoothstep(-0.15, 0.65, growth))
  const groundUv = positionWorld.xz.div(2)
  const rockColour = triplanarTexture(texture(rockAlbedo), null, null, float(1 / 1.5), positionWorld, normalWorldGeometry).rgb
  groundMaterial.colorNode = mix(rockColour, texture(mossAlbedo, groundUv).rgb, grassWeight)
  groundMaterial.roughnessNode = mix(triplanarTexture(texture(rockOrm), null, null, float(1 / 1.5), positionWorld, normalWorldGeometry).g, texture(mossOrm, groundUv).g, grassWeight)
  const axes = normalWorldGeometry.abs().pow(4)
  const weights = axes.div(axes.x.add(axes.y).add(axes.z))
  const rockSurfaceNormal = normalMapWithUV(rockNormal, positionWorld.yz.div(1.5)).mul(weights.x)
    .add(normalMapWithUV(rockNormal, positionWorld.zx.div(1.5)).mul(weights.y))
    .add(normalMapWithUV(rockNormal, positionWorld.xy.div(1.5)).mul(weights.z)).normalize()
  groundMaterial.normalNode = mix(rockSurfaceNormal, normalMapWithUV(mossNormal, groundUv), grassWeight).normalize()
  const scene = new Scene()
  scene.name = 'Tidal citadel'
  environment.mapping = EquirectangularReflectionMapping
  scene.background = environment
  scene.environment = environment
  scene.backgroundIntensity = 0.45
  scene.environmentIntensity = 0.65
  scene.backgroundRotation.y = 1.6
  scene.environmentRotation.y = 1.6
  scene.backgroundBlurriness = 0.035
  const fog = new FogExp2('#deddd5', 0.0022)
  scene.fog = fog
  const skyFill = new HemisphereLight('#a9c9e0', '#4d625d', 0.7)
  const sunlight = new DirectionalLight('#ffdcac', 3)
  sunlight.position.set(-150, 95, -80)
  sunlight.target.position.set(-25, 12, -52)
  scene.add(skyFill, sunlight, sunlight.target)
  const clock = uniform(0)
  const water = new MeshPhysicalNodeMaterial({ color: new Color('#073f48'), roughness: 0.24, ior: 1.333, specularIntensity: 0.75 })
  const elevationData = Uint16Array.from(terrain.field.heights, height => DataUtils.toHalfFloat(height))
  const elevationTexture = new DataTexture(elevationData, terrain.field.size, terrain.field.size, RedFormat, HalfFloatType)
  elevationTexture.minFilter = elevationTexture.magFilter = LinearFilter
  elevationTexture.needsUpdate = true
  const p = positionWorld.xz
  const seabed = texture(elevationTexture, p.sub(vec2(...terrain.field.origin)).div(terrain.field.extent)).r
  const waterDepth = seabed.negate().max(0)
  const foamNoise = mx_noise_float(vec3(p.mul(0.8), clock.mul(0.18))).mul(0.5).add(0.5)
  const foam = smoothstep(0.1, 0.7, waterDepth).oneMinus().mul(smoothstep(0.25, 0.7, foamNoise)).mul(0.75)
  water.colorNode = mix(mix(vec3(new Color('#1b726c')), vec3(new Color('#073f48')), smoothstep(0.3, 7, waterDepth)), vec3(new Color('#b8d0c6')), foam)
  water.roughnessNode = mix(0.43, 0.24, smoothstep(0.1, 4, waterDepth))
  const wave = sin(p.x.mul(0.43).add(p.y.mul(0.27)).sub(clock.mul(0.55))).mul(0.32)
    .add(sin(p.x.mul(-0.74).add(p.y.mul(0.65)).add(clock.mul(0.71))).mul(0.13))
    .add(cos(p.x.mul(2.3).add(p.y.mul(1.7)).sub(clock.mul(1.15))).mul(0.035))
  water.normalNode = bumpMap(wave, 1.2)
  const entries: MeshletSceneEntry[] = [
    { asset: { metadata: terrainAsset.metadata, load: () => loadMeshletAsset('/owned/geometry/terrain.meshlets') }, instances: [new Matrix4()], materials: [groundMaterial] },
    { asset: { metadata: oceanAsset.metadata, load: () => loadMeshletAsset('/owned/geometry/ocean.meshlets') }, instances: [new Matrix4()], materials: [water] },
    ...createCitadel(fort, terrain.heightAt(-27, -53) - 0.25),
  ]
  status('Planting the coast and preparing the cluster hierarchy…')
  entries.push(...await createVegetation(terrain))
  terrain.geometry.dispose()
  const cameraPresets: Record<'overview' | 'channel', CameraPreset> = {
    overview: { position: [-62, 26, -7], target: [-26, 27, -48] },
    channel: { position: [-57, terrain.heightAt(-57, -15) + 1.8, -15], target: [-24, 29, -48] },
  }
  return { scene, entries, terrain, sunlight, fog, cameraPresets, update: (timeSeconds: number) => { clock.value = timeSeconds } }
}
