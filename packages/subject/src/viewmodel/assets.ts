import type { Object3D } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import armsUrl from '../../assets/arms/blacksite-arms.glb?url'
import rifleUrl from '../../assets/weapons/rifle.glb?url'
import pistolUrl from '../../assets/weapons/pistol.glb?url'
import { loadArmsDress } from '../arms/dress'
import { DEFAULT_ARMS_MANIFEST, fetchArmsManifest, resolveArmsUrl, type ArmsManifest } from '../arms/manifestFile'
import type { ArmsWeapon } from '../arms/state'
import type { ViewmodelAssets } from './runtime'

export const BLACKSITE_ARMS_URL = armsUrl

const pending = new Map<string, Promise<ViewmodelAssets & { manifest: ArmsManifest }>>()

export function preloadViewmodelAssets(manifestUrl = DEFAULT_ARMS_MANIFEST) {
  let assets = pending.get(manifestUrl)
  if (!assets) { assets = loadViewmodelAssets(manifestUrl); pending.set(manifestUrl, assets) }
  return assets
}

async function loadViewmodelAssets(manifestUrl: string) {
  const dressing = loadArmsDress()
  const manifest = await fetchArmsManifest(manifestUrl)
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const resolve = (url: string) => resolveArmsUrl(manifestUrl, url)
  const load = async (url: string) => (await loader.loadAsync(url)).scene as Object3D
  const [arms, rifle, pistol] = await Promise.all([
    load(manifest.armsUrl ? resolve(manifest.armsUrl) : new URL(armsUrl, globalThis.location.href).href),
    load(manifest.weapons?.rifle?.meshUrl ? resolve(manifest.weapons.rifle.meshUrl) : new URL(rifleUrl, globalThis.location.href).href),
    load(manifest.weapons?.pistol?.meshUrl ? resolve(manifest.weapons.pistol.meshUrl) : new URL(pistolUrl, globalThis.location.href).href),
  ])
  const dress = await dressing
  const weapons: Record<ArmsWeapon, Object3D> = { rifle, pistol }
  return {
    manifest, arms, weapons,
    dress: {
      ...dress,
      fieldArms: (scene: Object3D) => { if (!manifest.armsUrl) dress.fieldArms(scene) },
      weapon: (weapon: ArmsWeapon, object: Object3D) => { if (!manifest.weapons?.[weapon]?.meshUrl) dress.fieldWeapon(weapon, object) },
    },
  }
}
