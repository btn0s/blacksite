import { TICK_RATE, type AgentView, type RenderSnapshot, type SimEvent, type TacticalMap } from '@blacksite/warden'
import { AlsSnapshotBuffer } from 'als-ue5-r3f/als/AlsSnapshotBuffer'
import type { AlsCharacterSnapshot } from 'als-ue5-r3f/als/AlsCharacterSnapshot'
import { ALS_STANDING_CAPSULE_HALF_HEIGHT } from 'als-ue5-r3f/als/AlsCharacter.hooks'

export const TICK_MS = 1000 / TICK_RATE
export const DELAY_MS = 125

const degrees = 180 / Math.PI
const alsYaw = (simYaw: number) => 90 - simYaw * degrees
const firing = new Set(['clear', 'suppressing', 'burst-recovery', 'acquisition-latency', 'motor-settling', 'friendly-swept-volume', 'occluded'])

export function aimingOf(agent: AgentView) {
  return agent.alive && (agent.execution.skill === 'engage' || agent.execution.skill === 'suppress' || firing.has(agent.fireGate))
}

function toAls(agent: AgentView, t: number, seq: number): AlsCharacterSnapshot {
  const speed = Math.hypot(agent.velocity.x, agent.velocity.z)
  const moving = speed > 0.25
  const aiming = aimingOf(agent)
  const viewYaw = alsYaw(agent.yaw)
  const moveYaw = moving ? alsYaw(Math.atan2(agent.velocity.x, agent.velocity.z)) : viewYaw
  const actorYaw = aiming || !moving ? viewYaw : moveYaw
  return {
    t,
    pos: [agent.position.x, agent.position.y + ALS_STANDING_CAPSULE_HALF_HEIGHT, agent.position.z],
    vel: [agent.velocity.x, 0, agent.velocity.z],
    actorYaw,
    viewYaw,
    viewPitch: Math.max(-60, Math.min(60, agent.pitch * degrees)),
    gait: speed > 5 ? 'sprinting' : speed > 1.6 ? 'running' : 'walking',
    stance: agent.stance === 'stand' ? 'standing' : 'crouching',
    rotationMode: aiming ? 'aiming' : moving ? 'velocityDirection' : 'viewDirection',
    locomotionMode: 'grounded',
    action: 'none',
    actionSeq: 0,
    overlay: 'rifle',
    aiming,
    seq,
    animation: { hasInput: moving, inputYaw: moveYaw, targetYaw: actorYaw, relativeAcceleration: { x: 0, y: 0 } },
  }
}

export type TimedEvent = SimEvent & { at: number }

export class SquadFeed {
  readonly buffers = new Map<string, AlsSnapshotBuffer>()
  snapshot: RenderSnapshot | undefined
  map: TacticalMap | undefined
  round = 0
  private offset = Number.POSITIVE_INFINITY
  private seq = 0
  private lastTick = -1
  private lastEvent = -1
  private pending: TimedEvent[] = []
  private listeners = new Set<() => void>()
  private history: Array<{ t: number; snapshot: RenderSnapshot; index: Map<string, AgentView> }> = []

  buffer(id: string) {
    let buffer = this.buffers.get(id)
    if (!buffer) { buffer = new AlsSnapshotBuffer({ interpolationDelayMs: DELAY_MS }); this.buffers.set(id, buffer) }
    return buffer
  }

  now = () => performance.now() - (Number.isFinite(this.offset) ? this.offset : performance.now())

  renderTime() { return this.now() - DELAY_MS }

  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }

  push(snapshot: RenderSnapshot, map: TacticalMap | undefined) {
    if (snapshot.tick < this.lastTick || (snapshot.tick === 0 && this.lastTick > 0)) this.restart()
    if (snapshot.tick === this.lastTick && this.snapshot) { this.snapshot = snapshot; return }
    this.lastTick = snapshot.tick
    this.snapshot = snapshot
    if (map) this.map = map
    const t = snapshot.tick * TICK_MS
    const sample = performance.now() - t
    this.offset = sample < this.offset ? sample : this.offset + Math.min(sample - this.offset, 0.5) * 0.05
    this.seq++
    this.history.push({ t, snapshot, index: new Map(snapshot.agents.map(agent => [agent.id, agent])) })
    if (this.history.length > 24) this.history.shift()
    for (const agent of snapshot.agents) this.buffer(agent.id).push(toAls(agent, t, this.seq))
    for (const event of snapshot.events) {
      if (event.tick <= this.lastEvent) continue
      this.pending.push({ ...event, at: event.tick * TICK_MS })
    }
    this.lastEvent = snapshot.events.reduce((latest, event) => Math.max(latest, event.tick), this.lastEvent)
    for (const listener of this.listeners) listener()
  }

  at(time: number) {
    const history = this.history
    if (!history.length) return undefined
    let index = history.length - 1
    while (index > 0 && history[index]!.t > time) index--
    const a = history[index]!
    const b = history[Math.min(history.length - 1, index + 1)]!
    const k = b.t > a.t ? Math.max(0, Math.min(1, (time - a.t) / (b.t - a.t))) : 0
    return { a, b, k }
  }

  position(id: string, time: number, out: { x: number; y: number; z: number }) {
    const frame = this.at(time)
    const a = frame?.a.index.get(id)
    if (!frame || !a) return false
    const b = frame.b.index.get(id) ?? a
    out.x = a.position.x + (b.position.x - a.position.x) * frame.k
    out.y = a.position.y + (b.position.y - a.position.y) * frame.k
    out.z = a.position.z + (b.position.z - a.position.z) * frame.k
    return true
  }

  drain(until: number, into: (event: TimedEvent) => void) {
    let index = 0
    while (index < this.pending.length && this.pending[index]!.at <= until) into(this.pending[index++]!)
    if (index) this.pending.splice(0, index)
  }

  private restart() {
    this.round++
    this.offset = Number.POSITIVE_INFINITY
    this.lastTick = -1
    this.lastEvent = -1
    this.pending = []
    this.history = []
    for (const buffer of this.buffers.values()) buffer.reset()
  }
}
