import {
  AGENT_RADIUS,
  Buttons,
  DEFAULT_SKILL,
  DT,
  ObservationGenerator,
  hashValue,
  insideObstacle,
  normalizeCommand,
  neutralCommand,
  type AgentCommand,
  type Observation,
  type SelfState,
  type SimEvent,
  type TacticalAuthority,
  type TacticalMap,
  type TeamId,
  type Vec3,
} from '@blacksite/warden'
import { castLevel, clearLine, type V3 } from './geometry'
import type { Hit } from './layout'
import { AI, MOVE, aiHitChance } from './model'

export const PLAYER_ID = 'alpha-1'

export type PlayerState = { x: number; y: number; z: number; yaw: number; pitch: number; crouch: boolean; moving: boolean; sprinting: boolean; alive: boolean }

export type FireEvent = { kind: 'fire'; id: string; from: V3; to: V3; normal: V3; hit: Hit | 'player' | 'none'; damage: number; near: number }
export type GameEvent = FireEvent | { kind: 'reload'; id: string } | { kind: 'died'; id: string; by: V3 } | { kind: 'flinch'; id: string }

type Bot = {
  id: string
  team: TeamId
  x: number
  z: number
  vx: number
  vz: number
  yaw: number
  pitch: number
  stance: 'stand' | 'crouch'
  health: number
  ammo: number
  reserve: number
  reloadingUntil: number
  lastShotAt: number
  kills: number
  burstLeft: number
  pauseUntil: number
  firstBurst: boolean
  seenSince: number
  lostAt: number
  reaction: number
  flinchUntil: number
  suppression: number
}

const eye = (stance: 'stand' | 'crouch') => stance === 'stand' ? 1.5 : 0.95
const ticks = (seconds: number) => Math.round(seconds / DT)

export class AttackBudget {
  private tick = 0
  private readonly holders = new Map<string, { since: number; wanted: number }>()
  private readonly cooldown = new Map<string, number>()

  begin(tick: number, alive: ReadonlySet<string>) {
    this.tick = tick
    for (const [id, lease] of this.holders) {
      if (alive.has(id) && tick - lease.since < ticks(AI.tokenHoldSeconds) && tick - lease.wanted <= ticks(AI.tokenIdleSeconds)) continue
      this.holders.delete(id)
      this.cooldown.set(id, tick + (alive.has(id) ? ticks(AI.tokenCooldownSeconds) : 0))
    }
  }

  allow(id: string) {
    const lease = this.holders.get(id)
    if (lease) { lease.wanted = this.tick; return true }
    if (this.holders.size >= AI.attackTokens || this.tick < (this.cooldown.get(id) ?? 0)) return false
    this.holders.set(id, { since: this.tick, wanted: this.tick })
    return true
  }
}

export class BreachAuthority implements TacticalAuthority {
  tick = 0
  status: 'running' | 'complete' = 'running'
  winner?: TeamId | 'draw'
  readonly objective: { owner?: TeamId; position: Vec3; progress: number }
  readonly gameEvents: GameEvent[] = []
  private readonly bots = new Map<string, Bot>()
  private readonly observations: ObservationGenerator
  private player: PlayerState
  private random: () => number
  private eventSequence = 0
  private lastCommands: AgentCommand[] = []

  constructor(private readonly map: TacticalMap, seed: number, facing: Record<string, { yaw: number; crouch?: boolean }>, player: PlayerState, private readonly fireAllowed: (id: string) => boolean = () => true) {
    let state = seed >>> 0 || 1
    this.random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296 }
    this.observations = new ObservationGenerator({ map, seed, lineOfSight: (from, to) => clearLine(from, to) })
    this.objective = { position: { ...map.objectives[0]!.position }, progress: 0 }
    this.player = { ...player }
    map.spawns.bravo.forEach((position, index) => {
      const id = `bravo-${index + 1}`
      const pose = facing[id] ?? { yaw: 0 }
      this.bots.set(id, {
        id, team: 'bravo', x: position.x, z: position.z, vx: 0, vz: 0, yaw: pose.yaw, pitch: 0, stance: pose.crouch ? 'crouch' : 'stand',
        health: AI.health, ammo: AI.magazine, reserve: AI.magazine * 4, reloadingUntil: 0, lastShotAt: -100, kills: 0,
        burstLeft: this.burst(), pauseUntil: 0, firstBurst: true, seenSince: -1, lostAt: -100, reaction: this.reaction(), flinchUntil: 0, suppression: 0,
      })
    })
  }

  private burst() { return AI.burst[0] + Math.floor(this.random() * (AI.burst[1] - AI.burst[0] + 1)) }
  private reaction() { return ticks(AI.reactionSeconds[0] + this.random() * (AI.reactionSeconds[1] - AI.reactionSeconds[0])) }

  setPlayer(player: PlayerState) { this.player = { ...player } }

  get states(): SelfState[] {
    const skill = { ...DEFAULT_SKILL }
    const player = this.player
    const self: SelfState = {
      alive: player.alive, ammo: 30, health: player.alive ? 100 : 0, id: PLAYER_ID, lastShotAt: -100, pitch: player.pitch,
      position: { x: player.x, y: 0, z: player.z }, reloadingUntil: 0, reserveAmmo: 90, skill, stance: player.crouch ? 'crouch' : 'stand',
      suppression: 0, team: 'alpha', velocity: { x: 0, y: 0, z: 0 }, yaw: player.yaw,
    }
    return [self, ...[...this.bots.values()].map(bot => ({
      alive: bot.health > 0, ammo: bot.ammo, health: bot.health, id: bot.id, lastShotAt: bot.lastShotAt, pitch: bot.pitch,
      position: { x: bot.x, y: 0, z: bot.z }, reloadingUntil: bot.reloadingUntil, reserveAmmo: bot.reserve, skill, stance: bot.stance,
      suppression: bot.suppression, team: bot.team, velocity: { x: bot.vx, y: 0, z: bot.vz }, yaw: bot.yaw,
    }))]
  }

  kills(id: string) { return this.bots.get(id)?.kills ?? 0 }
  observation(id: string): Observation | undefined { return this.observations.observation(id) }
  generateObservations() { return this.observations.generate(this.tick, this.states) }

  hearShot(at: V3) {
    this.observations.recordShot({ id: `player-shot:${this.tick}:${this.eventSequence++}`, tick: this.tick, agentId: PLAYER_ID }, { x: at.x, y: 0, z: at.z })
  }

  damage(id: string, amount: number, from: V3) {
    const bot = this.bots.get(id)
    if (!bot || bot.health <= 0) return
    bot.health = Math.max(0, bot.health - amount)
    bot.flinchUntil = this.tick + ticks(AI.flinchSeconds)
    bot.suppression = Math.min(1, bot.suppression + 0.4)
    if (bot.health > 0) {
      this.observations.recordDamage(id, { x: from.x, y: 0, z: from.z }, this.tick)
      this.gameEvents.push({ kind: 'flinch', id })
    } else this.gameEvents.push({ kind: 'died', id, by: from })
  }

  alive() { return [...this.bots.values()].filter(bot => bot.health > 0).length }

  step(input: ReadonlyArray<AgentCommand>) {
    this.tick++
    const tick = this.tick
    const events: SimEvent[] = []
    const commands = new Map<string, AgentCommand>()
    for (const command of input) if (command.tick === tick && this.bots.has(command.agentId)) commands.set(command.agentId, normalizeCommand(command, tick))
    this.lastCommands = [neutralCommand(tick, PLAYER_ID, 'human'), ...[...this.bots.keys()].map(id => commands.get(id) ?? neutralCommand(tick, id))]
    const target = { x: this.player.x, y: this.player.y, z: this.player.z }
    for (const bot of this.bots.values()) {
      bot.suppression = Math.max(0, bot.suppression - DT * 0.35)
      if (bot.reloadingUntil && tick >= bot.reloadingUntil) {
        const amount = Math.min(AI.magazine - bot.ammo, bot.reserve)
        bot.ammo += amount
        bot.reserve -= amount
        bot.reloadingUntil = 0
      }
      const command = commands.get(bot.id) ?? neutralCommand(tick, bot.id)
      this.move(bot, command)
      if (bot.health <= 0) continue
      const from = { x: bot.x, y: eye(bot.stance), z: bot.z }
      const visible = this.player.alive && clearLine(from, { x: target.x, y: target.y - 0.25, z: target.z })
      if (visible) { if (bot.seenSince < 0) bot.seenSince = tick; bot.lostAt = tick }
      else if (tick - bot.lostAt > ticks(1)) { bot.seenSince = -1; bot.firstBurst = true; bot.reaction = this.reaction() }
      if (command.buttons & Buttons.reload && bot.ammo < AI.magazine && bot.reserve > 0 && !bot.reloadingUntil) this.reload(bot)
      const wantsFire = (command.buttons & Buttons.fire) !== 0 && !(command.buttons & Buttons.sprint)
      if (!wantsFire || bot.reloadingUntil || tick < bot.flinchUntil || tick < bot.pauseUntil) continue
      if (tick - bot.lastShotAt < Math.max(1, Math.round(1 / (AI.roundsPerSecond * DT)))) continue
      if (visible && tick - bot.seenSince < bot.reaction) continue
      if (bot.ammo <= 0) { if (bot.reserve > 0) this.reload(bot); continue }
      if (!this.fireAllowed(bot.id)) continue
      this.fire(bot, from, target, visible, events)
    }
    return { checksum: this.checksum(), commands: structuredClone(this.lastCommands), events }
  }

  private reload(bot: Bot) {
    bot.reloadingUntil = this.tick + ticks(AI.reloadSeconds)
    this.gameEvents.push({ kind: 'reload', id: bot.id })
  }

  private move(bot: Bot, command: AgentCommand) {
    if (bot.health <= 0) { bot.vx = bot.vz = 0; return }
    const slow = this.tick < bot.flinchUntil ? 0.35 : 1
    const speed = (command.stance === 'crouch' ? AI.crouchSpeed : command.buttons & Buttons.sprint ? AI.sprintSpeed : AI.runSpeed) * slow
    const step = AI.acceleration * DT
    const approach = (value: number, goal: number) => value + Math.max(-step, Math.min(step, goal - value))
    let vx = approach(bot.vx, command.move.x * speed)
    let vz = approach(bot.vz, command.move.y * speed)
    const origin = { x: bot.x, y: 0, z: bot.z }
    let next = { x: bot.x + vx * DT, y: 0, z: bot.z + vz * DT }
    const blocked = (at: Vec3) => insideObstacle(this.map, at, AGENT_RADIUS)
      || (this.player.alive && Math.hypot(at.x - this.player.x, at.z - this.player.z) < AGENT_RADIUS + MOVE.radius)
      || [...this.bots.values()].some(other => other !== bot && other.health > 0 && Math.hypot(at.x - other.x, at.z - other.z) < AGENT_RADIUS * 2)
    if (blocked(next)) {
      const xOnly = { ...origin, x: next.x }, zOnly = { ...origin, z: next.z }
      if (!blocked(xOnly)) { next = xOnly; vz = 0 }
      else if (!blocked(zOnly)) { next = zOnly; vx = 0 }
      else { next = origin; vx = vz = 0 }
    }
    bot.x = next.x
    bot.z = next.z
    bot.vx = vx
    bot.vz = vz
    bot.yaw = Math.atan2(Math.sin(bot.yaw + command.lookDelta.yaw), Math.cos(bot.yaw + command.lookDelta.yaw))
    bot.pitch = Math.max(-1.35, Math.min(1.35, bot.pitch + command.lookDelta.pitch))
    bot.stance = command.stance === 'stand' ? 'stand' : 'crouch'
  }

  private fire(bot: Bot, from: V3, target: V3, visible: boolean, events: SimEvent[]) {
    const tick = this.tick
    const facing = { x: Math.sin(bot.yaw) * Math.cos(bot.pitch), y: Math.sin(bot.pitch), z: Math.cos(bot.yaw) * Math.cos(bot.pitch) }
    const chest = { x: target.x, y: target.y - (this.player.crouch ? 0.35 : 0.45), z: target.z }
    const toward = { x: chest.x - from.x, y: chest.y - from.y, z: chest.z - from.z }
    const range = Math.hypot(toward.x, toward.y, toward.z)
    const aligned = range > 0.01 && (facing.x * toward.x + facing.z * toward.z) / Math.max(0.01, Math.hypot(toward.x, toward.z)) > Math.cos(0.45)
    let aim: V3
    let hitPlayer = false
    if (visible && aligned && range < AI.sightRange + 8) {
      const chance = aiHitChance((tick - bot.seenSince) * DT, { moving: this.player.moving, sprinting: this.player.sprinting, crouched: this.player.crouch })
      hitPlayer = !(AI.firstBurstMisses && bot.firstBurst) && this.random() < chance
      if (hitPlayer) aim = { x: chest.x + (this.random() - 0.5) * 0.25, y: chest.y + (this.random() - 0.3) * 0.5, z: chest.z + (this.random() - 0.5) * 0.25 }
      else {
        const radius = AI.missRadius[0] + this.random() * (AI.missRadius[1] - AI.missRadius[0])
        const angle = this.random() * Math.PI * 2
        const side = { x: -toward.z / range, z: toward.x / range }
        aim = { x: chest.x + side.x * Math.cos(angle) * radius, y: Math.max(0.05, chest.y + Math.sin(angle) * radius * 0.7), z: chest.z + side.z * Math.cos(angle) * radius }
      }
    } else {
      const spread = 0.04
      aim = { x: from.x + (facing.x + (this.random() - 0.5) * spread) * 30, y: from.y + (facing.y + (this.random() - 0.5) * spread) * 30, z: from.z + (facing.z + (this.random() - 0.5) * spread) * 30 }
    }
    const dx = aim.x - from.x, dy = aim.y - from.y, dz = aim.z - from.z
    const length = Math.hypot(dx, dy, dz) || 1
    const direction = { x: dx / length, y: dy / length, z: dz / length }
    const muzzle = { x: from.x + direction.x * 0.6, y: from.y - 0.08, z: from.z + direction.z * 0.6 }
    const wall = castLevel(muzzle, direction, 80)
    let end: V3
    let normal: V3 = { x: -direction.x, y: -direction.y, z: -direction.z }
    let hit: FireEvent['hit'] = 'none'
    let damage = 0
    if (hitPlayer && (!wall || wall.distance > range - 0.4)) {
      end = { x: muzzle.x + direction.x * (range - 0.25), y: muzzle.y + direction.y * (range - 0.25), z: muzzle.z + direction.z * (range - 0.25) }
      hit = 'player'
      damage = AI.damage
    } else if (wall) {
      end = wall.point
      normal = wall.normal
      hit = wall.block.hit
    } else end = { x: muzzle.x + direction.x * 80, y: muzzle.y + direction.y * 80, z: muzzle.z + direction.z * 80 }
    const head = { x: target.x - muzzle.x, y: target.y - muzzle.y, z: target.z - muzzle.z }
    const along = Math.max(0, Math.min(Math.hypot(end.x - muzzle.x, end.y - muzzle.y, end.z - muzzle.z), head.x * direction.x + head.y * direction.y + head.z * direction.z))
    const near = Math.hypot(muzzle.x + direction.x * along - target.x, muzzle.y + direction.y * along - target.y, muzzle.z + direction.z * along - target.z)
    this.gameEvents.push({ kind: 'fire', id: bot.id, from: muzzle, to: end, normal, hit, damage, near })
    const shot: SimEvent = { agentId: bot.id, endPosition: { x: end.x, y: end.y, z: end.z }, id: `breach:${tick}:${this.eventSequence++}`, position: { x: bot.x, y: from.y, z: bot.z }, team: bot.team, text: `${bot.id} fired`, tick, type: 'shot' }
    events.push(shot)
    this.observations.recordShot(shot, { x: bot.x, y: 0, z: bot.z })
    bot.ammo--
    bot.lastShotAt = tick
    bot.burstLeft--
    if (bot.burstLeft <= 0) {
      bot.burstLeft = this.burst()
      bot.pauseUntil = tick + ticks(AI.burstPauseSeconds[0] + this.random() * (AI.burstPauseSeconds[1] - AI.burstPauseSeconds[0]))
      bot.firstBurst = false
    }
  }

  checksum() {
    return hashValue({ tick: this.tick, bots: [...this.bots.values()].map(bot => [bot.x, bot.z, bot.health]) })
  }

  dispose() { this.observations.dispose() }
}
