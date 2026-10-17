import type { ConsumerOverlayState } from 'als-ue5-r3f/als/AnimGraph/consumerOverlayStates'
import type { ArmsAction, ArmsRig, ArmsWeapon } from './state'

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
  rig?: ArmsRig
  armsUrl?: string
  characterUrl?: string
  fov?: number
  weapons?: Partial<Record<ArmsWeapon, ArmsWeaponManifest>>
}

export function validateArmsManifest(value: unknown): ArmsManifest {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1) throw new Error('Arms manifest requires version 1')
  const manifest = value as ArmsManifest
  if (manifest.rig !== undefined && manifest.rig !== 'blacksite' && manifest.rig !== 'als' && manifest.rig !== 'found') throw new Error('Arms rig must be blacksite, als or found')
  if (manifest.fov !== undefined && (!Number.isFinite(manifest.fov) || manifest.fov <= 0 || manifest.fov >= 180)) throw new Error('Arms FOV must be between 0 and 180 degrees')
  for (const weapon of Object.values(manifest.weapons ?? {})) {
    for (const tuple of [weapon.attachment?.position, weapon.attachment?.rotation, weapon.presentation?.position, weapon.presentation?.aimOffset, weapon.presentation?.sight]) {
      if (tuple && (tuple.length !== 3 || !tuple.every(Number.isFinite))) throw new Error('Arms attachment requires three finite coordinates')
    }
    if (weapon.attachment?.scale !== undefined && !(weapon.attachment.scale > 0)) throw new Error('Arms attachment scale must be positive')
  }
  return manifest
}

const manifests = new Map<string, Promise<ArmsManifest>>()

export const DEFAULT_ARMS_MANIFEST = '/assets/arms.json'

export function fetchArmsManifest(manifestUrl = DEFAULT_ARMS_MANIFEST) {
  let manifest = manifests.get(manifestUrl)
  if (!manifest) {
    manifest = fetch(manifestUrl).then(async response => {
      if (response.ok && !(response.headers.get('content-type') ?? '').includes('text/html')) return validateArmsManifest(await response.json())
      if (response.status !== 404 && !response.ok) throw new Error(`Arms manifest request failed (${response.status})`)
      return { version: 1 } as ArmsManifest
    })
    manifests.set(manifestUrl, manifest)
  }
  return manifest
}

export const resolveArmsUrl = (manifestUrl: string, url: string) => new URL(url, new URL(manifestUrl, globalThis.location.href)).href
