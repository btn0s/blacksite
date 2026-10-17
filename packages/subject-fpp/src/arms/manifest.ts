import { preloadAlsCharacterGltf } from 'als-ue5-r3f/app/AlsCharacterGltf'
import { Bone, LoadingManager, type AnimationClip, type Object3D, type WebGLRenderer } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import basisJsUrl from 'three/examples/jsm/libs/basis/basis_transcoder.js?url'
import basisWasmUrl from 'three/examples/jsm/libs/basis/basis_transcoder.wasm?url'
import { loadArmsDress, type ArmsDress } from './dress'
import type { ArmsWeapon } from './state'
import { DEFAULT_ARMS_MANIFEST, fetchArmsManifest, type ArmsManifest } from './manifestFile'

export { validateArmsManifest, type ArmsManifest, type ArmsWeaponManifest } from './manifestFile'

export function validateArmsSkeleton(reference: Object3D, source: Object3D) {
  const bones = (scene: Object3D) => {
    const result = new Map<string, Bone>()
    scene.traverse(object => { if (object instanceof Bone) result.set(object.name, object) })
    return result
  }
  const expected = bones(reference)
  const actual = bones(source)
  if (expected.size !== 68 || actual.size !== expected.size) throw new Error('Arms animation asset requires the 68-bone SK_Als skeleton')
  for (const [name, bone] of expected) {
    const other = actual.get(name)
    if (!other || (bone.parent instanceof Bone ? bone.parent.name : null) !== (other.parent instanceof Bone ? other.parent.name : null)
      || bone.position.distanceTo(other.position) > 0.0001
      || bone.quaternion.angleTo(other.quaternion) > 0.0001
      || bone.scale.distanceTo(other.scale) > 0.0001) throw new Error(`Arms animation skeleton differs at ${name}`)
  }
}

const pending = new Map<string, ReturnType<typeof loadArmsAssets>>()

export function preloadArmsAssets(manifestUrl = DEFAULT_ARMS_MANIFEST, renderer?: WebGLRenderer) {
  let assets = pending.get(manifestUrl)
  if (!assets) { assets = loadArmsAssets(manifestUrl, renderer); pending.set(manifestUrl, assets) }
  return assets
}

async function loadArmsAssets(manifestUrl: string, renderer?: WebGLRenderer): Promise<ArmsAssets> {
  const dressing = loadArmsDress()
  const manifest = await fetchArmsManifest(manifestUrl)
  const resolve = (url: string) => new URL(url, new URL(manifestUrl, globalThis.location.href)).href
  const manager = new LoadingManager().setURLModifier(url => url.endsWith('basis_transcoder.js') ? basisJsUrl : url.endsWith('basis_transcoder.wasm') ? basisWasmUrl : url)
  const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder)
  const ktx = renderer ? new KTX2Loader(manager).setTranscoderPath('/blacksite-basis/').detectSupport(renderer) : null
  if (ktx) loader.setKTX2Loader(ktx)
  const character = manifest.characterUrl ? await loader.loadAsync(resolve(manifest.characterUrl)) : await preloadAlsCharacterGltf(resolve('/assets/skm-als.glb'))
  const animations: AnimationClip[] = [...character.animations]
  const meshes = await Promise.all((['rifle', 'pistol'] as const).map(async weapon => {
    const entry = manifest.weapons?.[weapon]
    const [mesh, clips] = await Promise.all([
      entry?.meshUrl ? loader.loadAsync(resolve(entry.meshUrl)) : preloadAlsCharacterGltf(resolve(`/assets/skm-als-${weapon}.glb`)),
      entry?.animationUrl ? loader.loadAsync(resolve(entry.animationUrl)) : null,
    ])
    if (clips) { validateArmsSkeleton(character.scene, clips.scene); animations.push(...clips.animations) }
    return [weapon, mesh.scene] as const
  }))
  ktx?.dispose()
  const dress = await dressing
  return {
    manifest, character, animations, weapons: { rifle: meshes[0][1], pistol: meshes[1][1] },
    dress, dressed: { arms: !manifest.characterUrl, rifle: !manifest.weapons?.rifle?.meshUrl, pistol: !manifest.weapons?.pistol?.meshUrl },
  }
}

export interface ArmsAssets {
  manifest: ArmsManifest
  character: { scene: Object3D; animations: AnimationClip[] }
  animations: AnimationClip[]
  weapons: Record<ArmsWeapon, Object3D>
  dress?: ArmsDress
  dressed?: { arms: boolean } & Record<ArmsWeapon, boolean>
}

