import type { Intent } from '@blacksite/warden'
import type { FireEvent, PlayerState } from './authority'
import type { V3 } from './geometry'

export type SoldierView = {
  id: string
  x: number
  z: number
  vx: number
  vz: number
  yaw: number
  pitch: number
  crouch: boolean
  alive: boolean
  aiming: boolean
  reloading: boolean
  active: boolean
}

export type SquadEvent =
  | (Omit<FireEvent, 'id'> & { id: string })
  | { kind: 'reload'; id: string }
  | { kind: 'died'; id: string; by: V3 }
  | { kind: 'flinch'; id: string }
  | { kind: 'intent'; id: string; intent: Intent }
  | { kind: 'alert'; encounter: string; text: string }

export type ToSquad =
  | { type: 'reset'; seed: number; round: number; player: PlayerState }
  | { type: 'player'; player: PlayerState }
  | { type: 'damage'; id: string; amount: number; from: V3 }
  | { type: 'shot'; at: V3 }
  | { type: 'pause'; paused: boolean }

export type FromSquad =
  | { type: 'frame'; round: number; tick: number; soldiers: SoldierView[]; events: SquadEvent[] }
  | { type: 'error'; message: string }
