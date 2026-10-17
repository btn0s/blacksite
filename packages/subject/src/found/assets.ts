import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import type { FoundSet } from './model'
import type { FoundAssets } from './runtime'

const pending = new WeakMap<FoundSet, Promise<FoundAssets>>()

export function preloadFoundAssets(set: FoundSet) {
  let assets = pending.get(set)
  if (!assets) { assets = loadFoundAssets(set); pending.set(set, assets) }
  return assets
}

async function loadFoundAssets(set: FoundSet): Promise<FoundAssets> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const load = async (url: string) => {
    const gltf = await loader.loadAsync(new URL(url, globalThis.location.href).href)
    return { scene: gltf.scene, animations: gltf.animations }
  }
  const [rifle, pistol] = await Promise.all([load(set.weapons.rifle.url), load(set.weapons.pistol.url)])
  return { rifle, pistol }
}
