export type Vec3 = { x: number; y: number; z: number }
export type WeaponId = 'rifle' | 'pistol'
export type PawnLocomotion = {
  gait: 'walking' | 'running' | 'sprinting'
  stance: 'standing' | 'crouching'
  mode: 'grounded' | 'inAir'
  actorYaw: number
  rotationMode: 'velocityDirection' | 'viewDirection' | 'aiming'
  hasInput: boolean
  inputYaw: number
  targetYaw: number
  relativeAcceleration: { x: number; y: number }
}
export type PawnState = { id: string; owner: string; authority: 'server' | 'owner'; seq: number; t: number; position: Vec3; velocity: Vec3; yaw: number; pitch: number; health: number; weapon?: WeaponId; aiming?: boolean; locomotion?: PawnLocomotion }
export type PawnIntent = { forward: number; right: number; jump: boolean; yaw: number; pitch: number; aiming?: boolean }
export type ClientMessage =
  | { type: 'move'; seq: number; position: Vec3; velocity: Vec3; intent: PawnIntent; locomotion?: PawnLocomotion }
  | { type: 'fire'; seq: number; direction: Vec3 }
  | { type: 'weapon'; seq: number; weapon: WeaponId; reload: boolean }
export type ServerMessage =
  | { type: 'welcome'; id: string; states: PawnState[] }
  | { type: 'state'; state: PawnState }
  | { type: 'leave'; id: string }
  | { type: 'hit'; shooter: string; target: string; damage: number; health: number }
  | { type: 'rejected'; reason: string }
export const finiteVec = (value: unknown): value is Vec3 => !!value && typeof value === 'object' && ['x', 'y', 'z'].every(axis => Number.isFinite((value as Record<string, number>)[axis]))
function isPawnLocomotion(value: unknown): value is PawnLocomotion {
  if (!value || typeof value !== 'object') return false
  const state = value as Record<string, unknown>
  const acceleration = state.relativeAcceleration as Record<string, unknown> | undefined
  return ['walking', 'running', 'sprinting'].includes(state.gait as string)
    && ['standing', 'crouching'].includes(state.stance as string)
    && ['grounded', 'inAir'].includes(state.mode as string)
    && ['velocityDirection', 'viewDirection', 'aiming'].includes(state.rotationMode as string)
    && typeof state.hasInput === 'boolean'
    && ['actorYaw', 'inputYaw', 'targetYaw'].every(field => Number.isFinite(state[field]))
    && !!acceleration && typeof acceleration === 'object'
    && ['x', 'y'].every(axis => Number.isFinite(acceleration[axis]) && Math.abs(acceleration[axis] as number) <= 1)
}
export function isClientMessage(value: unknown): value is ClientMessage {
  if (!value || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  if (!Number.isSafeInteger(message.seq) || (message.seq as number) < 0) return false
  if (message.type === 'weapon') return (message.weapon === 'rifle' || message.weapon === 'pistol') && typeof message.reload === 'boolean'
  if (message.type === 'fire') return finiteVec(message.direction)
  if (message.type !== 'move' || !finiteVec(message.position) || !finiteVec(message.velocity) || message.locomotion !== undefined && !isPawnLocomotion(message.locomotion)) return false
  const intent = message.intent as Record<string, unknown> | undefined
  return !!intent && Number.isFinite(intent.forward) && Number.isFinite(intent.right) && typeof intent.jump === 'boolean' && Number.isFinite(intent.yaw) && Number.isFinite(intent.pitch) && (intent.aiming === undefined || typeof intent.aiming === 'boolean')
}
