import rifleUrl from '../../assets/found/rifle.glb?url'
import pistolUrl from '../../assets/found/pistol.glb?url'
import { FIELD_PORTRAIT, FIELD_WEAPONS } from './field'
import type { FoundSet } from './model'

export const FIELD_SET: FoundSet = {
  name: 'field',
  credit: 'found/CREDITS.md',
  portrait: FIELD_PORTRAIT,
  weapons: { rifle: { ...FIELD_WEAPONS.rifle, url: rifleUrl }, pistol: { ...FIELD_WEAPONS.pistol, url: pistolUrl } },
}
