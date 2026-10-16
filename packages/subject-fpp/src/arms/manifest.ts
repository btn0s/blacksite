import { preloadAlsCharacterGltf } from 'als-ue5-r3f/app/AlsCharacterGltf'
import type { ConsumerOverlayState } from 'als-ue5-r3f/als/AnimGraph/consumerOverlayStates'
import { Bone, LoadingManager, type AnimationClip, type Object3D, type WebGLRenderer } from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import basisJsUrl from 'three/examples/jsm/libs/basis/basis_transcoder.js?url'
import basisWasmUrl from 'three/examples/jsm/libs/basis/basis_transcoder.wasm?url'
import { loadArmsDress, type ArmsDress } from './dress'
import type { ArmsAction, ArmsWeapon } from './state'

export interface ArmsWeaponManifest {
  meshUrl?: string
  animationUrl?: string
  clips?: Partial<ConsumerOverlayState['sources']> & Partial<Record<ArmsAction, string>>
  attachment?: {
    bone?: string
    position?: [number, number, number]
    rotation?: [number, number, number]
    scale?: number
  }
  presentation?: {
    position?: [number, number, number]
    aimOffset?: [number, number, number]
    sight?: [number, number, number]
  }
}

export interface ArmsManifest {
  version: 1
  characterUrl?: string
  fov?: number
  weapons?: Partial<Record<ArmsWeapon, ArmsWeaponManifest>>
}

export function validateArmsManifest(value: unknown): ArmsManifest {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1) throw new Error('Arms manifest requires version 1')
  const manifest = value as ArmsManifest
  if (manifest.fov !== undefined && (!Number.isFinite(manifest.fov) || manifest.fov <= 0 || manifest.fov >= 180)) throw new Error('Arms FOV must be between 0 and 180 degrees')
  for (const weapon of Object.values(manifest.weapons ?? {})) {
    for (const tuple of [weapon.attachment?.position, weapon.attachment?.rotation, weapon.presentation?.position, weapon.presentation?.aimOffset, weapon.presentation?.sight]) {
      if (tuple && (tuple.length !== 3 || !tuple.every(Number.isFinite))) throw new Error('Arms attachment requires three finite coordinates')
    }
    if (weapon.attachment?.scale !== undefined && !(weapon.attachment.scale > 0)) throw new Error('Arms attachment scale must be positive')
  }
  return manifest
}

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

export function preloadArmsAssets(manifestUrl = '/assets/arms.json', renderer?: WebGLRenderer) {
  let assets = pending.get(manifestUrl)
  if (!assets) { assets = loadArmsAssets(manifestUrl, renderer); pending.set(manifestUrl, assets) }
  return assets
}

async function loadArmsAssets(manifestUrl: string, renderer?: WebGLRenderer): Promise<ArmsAssets> {
  const dressing = loadArmsDress()
  const response = await fetch(manifestUrl)
  let manifest: ArmsManifest = { version: 1 }
  if (response.ok && !(response.headers.get('content-type') ?? '').includes('text/html')) manifest = validateArmsManifest(await response.json())
  else if (response.status !== 404 && !response.ok) throw new Error(`Arms manifest request failed (${response.status})`)
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

