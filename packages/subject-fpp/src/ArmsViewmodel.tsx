import { lazy, Suspense, use } from 'react'
import { fetchArmsManifest, type ArmsManifest } from './arms/manifestFile'
import type { ArmsRig } from './arms/state'
import type { ArmsViewmodelProps } from './arms/presentation'
import BlacksiteViewmodel from './viewmodel/BlacksiteViewmodel'
import { FIELD_SET } from './found/sets'

export { createArmsState } from './arms/state'
export type { ArmsState, ArmsWeapon, ArmsAction, ArmsRig } from './arms/state'
export type { ArmsManifest, ArmsWeaponManifest } from './arms/manifestFile'
export { portraitFov, type ArmsPresentation, type ArmsViewmodelProps } from './arms/presentation'
export { VIEWMODEL, VIEWMODEL_WEAPONS, GRIPS, bobFrequency, VIEWMODEL_CLIPS, switchSeconds, type ClipEvent, type ViewmodelClip } from './arms/model'
export { FIELD_SET } from './found/sets'
export { FIELD_WEAPONS } from './found/field'
export { FOUND_HOLSTER, FOUND_INSPECT, clipSeconds, foundTimings, type FoundTiming, type FoundSet, type FoundWeapon, type FoundClip, type FoundClipSource } from './found/model'

const AlsViewmodel = lazy(() => import('./arms/AlsViewmodel'))
const FoundViewmodel = lazy(() => import('./found/FoundViewmodel'))

export function preloadArms({ manifestUrl, rig }: { manifestUrl?: string; rig?: ArmsRig } = {}) {
  return fetchArmsManifest(manifestUrl).then(async manifest => {
    if (selectRig(manifest, rig) !== 'found') return
    const [{ preloadFoundAssets }] = await Promise.all([import('./found/assets'), import('./found/FoundViewmodel')])
    await preloadFoundAssets(FIELD_SET)
  })
}

export function ArmsViewmodel(props: ArmsViewmodelProps) {
  return <Suspense fallback={null}><SelectedViewmodel {...props} /></Suspense>
}

function SelectedViewmodel(props: ArmsViewmodelProps) {
  const manifest = use(fetchArmsManifest(props.manifestUrl))
  const rig = selectRig(manifest, props.rig)
  return rig === 'als' ? <AlsViewmodel {...props} /> : rig === 'found' ? <FoundViewmodel {...props} /> : <BlacksiteViewmodel {...props} />
}

function selectRig(manifest: ArmsManifest, rig?: ArmsRig): ArmsRig {
  const legacy = manifest.characterUrl || Object.values(manifest.weapons ?? {}).some(weapon => weapon.meshUrl || weapon.animationUrl || weapon.clips || weapon.attachment || weapon.presentation)
  return rig ?? manifest.rig ?? (legacy ? 'als' : 'found')
}
