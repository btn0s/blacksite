import { TICK_RATE } from '@blacksite/warden'
import { AlsSnapshotBuffer } from 'als-ue5-r3f/als/AlsSnapshotBuffer'
import type { AlsCharacterSnapshot } from 'als-ue5-r3f/als/AlsCharacterSnapshot'
import { ALS_STANDING_CAPSULE_HALF_HEIGHT } from 'als-ue5-r3f/als/AlsCharacter.hooks'
import type { PlayerState } from './authority'
import type { V3 } from './geometry'
import type { FromSquad, SoldierView, SquadEvent, ToSquad } from './protocol'

export const TICK_MS = 1000 / TICK_RATE
export const DELAY_MS = 110

const degrees = 180 / Math.PI
const alsYaw = (simYaw: number) => 90 - simYaw * degrees

function toAls(soldier: SoldierView, t: number, seq: number): AlsCharacterSnapshot {
  const speed = Math.hypot(soldier.vx, soldier.vz)
  const moving = speed > 0.25
  const viewYaw = alsYaw(soldier.yaw)
  const moveYaw = moving ? alsYaw(Math.atan2(soldier.vx, soldier.vz)) : viewYaw
  const actorYaw = soldier.aiming || !moving ? viewYaw : moveYaw
  return {
    t,
    pos: [soldier.x, ALS_STANDING_CAPSULE_HALF_HEIGHT, soldier.z],
    vel: [soldier.vx, 0, soldier.vz],
    actorYaw,
    viewYaw,
    viewPitch: Math.max(-60, Math.min(60, soldier.pitch * degrees)),
    gait: speed > 5 ? 'sprinting' : speed > 1.6 ? 'running' : 'walking',
    stance: soldier.crouch ? 'crouching' : 'standing',
    rotationMode: soldier.aiming ? 'aiming' : moving ? 'velocityDirection' : 'viewDirection',
    locomotionMode: 'grounded',
    action: 'none',
    actionSeq: 0,
    overlay: 'rifle',
    aiming: soldier.aiming,
    seq,
    animation: { hasInput: moving, inputYaw: moveYaw, targetYaw: actorYaw, relativeAcceleration: { x: 0, y: 0 } },
  }
}

type Frame = { t: number; soldiers: Map<string, SoldierView> }
export type TimedEvent = SquadEvent & { at: number }

export class SquadClient {
  readonly buffers = new Map<string, AlsSnapshotBuffer>()
  roster: SoldierView[] = []
  round = 0
  error: string | null = null
  private worker: Worker | null = null
  private offset = Number.POSITIVE_INFINITY
  private seq = 0
  private history: Frame[] = []
  private pending: TimedEvent[] = []
  private listeners = new Set<() => void>()

  start() {
    if (this.worker) return
    this.worker = new Worker(new URL('./squad.worker.ts', import.meta.url), { type: 'module' })
    this.worker.onmessage = ({ data }: MessageEvent<FromSquad>) => {
      if (data.type === 'error') { this.error = data.message; console.warn('squad', data.message); return }
      if (data.round !== this.round) return
      this.push(data.tick, data.soldiers, data.events)
    }
  }

  send(message: ToSquad) { this.worker?.postMessage(message) }

  reset(seed: number, player: PlayerState) {
    this.round++
    this.error = null
    this.offset = Number.POSITIVE_INFINITY
    this.history = []
    this.pending = []
    this.roster = []
    for (const buffer of this.buffers.values()) buffer.reset()
    this.send({ type: 'reset', seed, round: this.round, player })
    for (const listener of this.listeners) listener()
  }

  player(state: PlayerState) { this.send({ type: 'player', player: state }) }
  damage(id: string, amount: number, from: V3) { this.send({ type: 'damage', id, amount, from }) }
  shot(at: V3) { this.send({ type: 'shot', at }) }
  pause(paused: boolean) { this.send({ type: 'pause', paused }) }

  buffer(id: string) {
    let buffer = this.buffers.get(id)
    if (!buffer) { buffer = new AlsSnapshotBuffer({ interpolationDelayMs: DELAY_MS }); this.buffers.set(id, buffer) }
    return buffer
  }

  now = () => performance.now() - (Number.isFinite(this.offset) ? this.offset : performance.now())
  renderTime() { return this.now() - DELAY_MS }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }

  private push(tick: number, soldiers: SoldierView[], events: SquadEvent[]) {
    const t = tick * TICK_MS
    const sample = performance.now() - t
    this.offset = sample < this.offset ? sample : this.offset + Math.min(sample - this.offset, 0.5) * 0.05
    this.seq++
    const rosterChanged = soldiers.length !== this.roster.length
    this.roster = soldiers
    this.history.push({ t, soldiers: new Map(soldiers.map(soldier => [soldier.id, soldier])) })
    if (this.history.length > 24) this.history.shift()
    for (const soldier of soldiers) if (soldier.alive) this.buffer(soldier.id).push(toAls(soldier, t, this.seq))
    for (const event of events) this.pending.push({ ...event, at: t })
    if (rosterChanged) for (const listener of this.listeners) listener()
  }

  sample(id: string, time: number, out: { x: number; z: number; crouch: boolean; alive: boolean; yaw: number }) {
    const history = this.history
    if (!history.length) return false
    let index = history.length - 1
    while (index > 0 && history[index]!.t > time) index--
    const a = history[index]!, b = history[Math.min(history.length - 1, index + 1)]!
    const k = b.t > a.t ? Math.max(0, Math.min(1, (time - a.t) / (b.t - a.t))) : 0
    const from = a.soldiers.get(id)
    if (!from) return false
    const to = b.soldiers.get(id) ?? from
    out.x = from.x + (to.x - from.x) * k
    out.z = from.z + (to.z - from.z) * k
    out.crouch = k < 0.5 ? from.crouch : to.crouch
    out.alive = to.alive
    out.yaw = to.yaw
    return true
  }

  latest(id: string) { return this.history.at(-1)?.soldiers.get(id) }

  drain(until: number, into: (event: TimedEvent) => void) {
    let index = 0
    while (index < this.pending.length && this.pending[index]!.at <= until) into(this.pending[index++]!)
    if (index) this.pending.splice(0, index)
  }

  dispose() { this.worker?.terminate(); this.worker = null }
}
