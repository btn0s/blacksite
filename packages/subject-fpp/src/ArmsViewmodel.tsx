import { lazy, Suspense, use } from 'react'
import { fetchArmsManifest } from './arms/manifestFile'
import type { ArmsViewmodelProps } from './arms/presentation'
import BlacksiteViewmodel from './viewmodel/BlacksiteViewmodel'

export { createArmsState } from './arms/state'
export type { ArmsState, ArmsWeapon, ArmsAction, ArmsRig } from './arms/state'
export type { ArmsManifest, ArmsWeaponManifest } from './arms/manifestFile'
export { portraitFov, type ArmsPresentation, type ArmsViewmodelProps } from './arms/presentation'
export { VIEWMODEL, VIEWMODEL_WEAPONS, GRIPS, bobFrequency, VIEWMODEL_CLIPS, switchSeconds, type ClipEvent, type ViewmodelClip } from './arms/model'

const AlsViewmodel = lazy(() => import('./arms/AlsViewmodel'))

export function ArmsViewmodel(props: ArmsViewmodelProps) {
  return <Suspense fallback={null}><SelectedViewmodel {...props} /></Suspense>
}

function SelectedViewmodel(props: ArmsViewmodelProps) {
  const manifest = use(fetchArmsManifest(props.manifestUrl))
  const legacy = manifest.characterUrl || Object.values(manifest.weapons ?? {}).some(weapon => weapon.meshUrl || weapon.animationUrl || weapon.clips || weapon.attachment || weapon.presentation)
  const rig = props.rig ?? manifest.rig ?? (legacy ? 'als' : 'blacksite')
  return rig === 'als' ? <AlsViewmodel {...props} /> : <BlacksiteViewmodel {...props} />
}
