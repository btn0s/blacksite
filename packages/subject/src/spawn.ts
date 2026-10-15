import { useSyncExternalStore } from 'react'
import type { AlsPlayer } from 'als-ue5-r3f/app/AlsPlayer'

export function useSubjectSpawn(player: AlsPlayer) {
  const revision = useSyncExternalStore(player.subscribe, player.getRevision, player.getRevision)
  return { revision, position: player.spawn }
}
