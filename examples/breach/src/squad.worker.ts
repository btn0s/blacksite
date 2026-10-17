import { DEFAULT_CONFIG, TICK_RATE, TacticalRuntime, type AgentView, type Intent } from '@blacksite/warden'
import { AttackBudget, BreachAuthority, PLAYER_ID, type PlayerState } from './authority'
import { ENCOUNTERS, type Encounter } from './layout'
import { AI } from './model'
import type { FromSquad, SoldierView, SquadEvent, ToSquad } from './protocol'
import { encounterWorld } from './world'

type Fight = { encounter: Encounter; authority: BreachAuthority; runtime: TacticalRuntime; ids: Map<string, string>; back: Map<string, string>; active: boolean; views: Map<string, AgentView> }

const scope = self as unknown as { postMessage(message: FromSquad): void; onmessage: ((event: MessageEvent<ToSquad>) => void) | null }
const ticks = (seconds: number) => Math.round(seconds * TICK_RATE)
const firing = new Set(['clear', 'suppressing', 'burst-recovery', 'acquisition-latency', 'motor-settling', 'friendly-swept-volume', 'occluded'])

let fights: Fight[] = []
let player: PlayerState | null = null
let tick = 0
let round = 0
let paused = false
let events: SquadEvent[] = []
let last = 0
let attacks = new AttackBudget()

function build(seed: number, start: PlayerState) {
  for (const fight of fights) fight.runtime.dispose()
  player = { ...start }
  tick = 0
  events = []
  attacks = new AttackBudget()
  fights = ENCOUNTERS.map((encounter, index) => {
    const world = encounterWorld(encounter)
    const ids = new Map<string, string>(), back = new Map<string, string>()
    const facing: Record<string, { yaw: number; crouch?: boolean }> = {}
    encounter.soldiers.forEach((soldier, slot) => {
      const id = `bravo-${slot + 1}`
      ids.set(id, soldier.id)
      back.set(soldier.id, id)
      facing[id] = { yaw: soldier.facing, crouch: soldier.crouch }
    })
    const authority = new BreachAuthority(world.map, seed + index * 7919, facing, start, id => attacks.allow(ids.get(id)!))
    const runtime = new TacticalRuntime(
      { ...DEFAULT_CONFIG, seed: seed + index, agentsPerTeam: encounter.soldiers.length, maxTicks: 36_000, scenarioId: 'breach' },
      world,
      { authority, controlledAgentIds: [PLAYER_ID], attackTokens: { count: AI.attackTokens, holdTicks: ticks(AI.tokenHoldSeconds), cooldownTicks: ticks(AI.tokenCooldownSeconds) }, intents: { leadTicks: ticks(AI.barkLeadSeconds) } },
    )
    return { encounter, authority, runtime, ids, back, active: false, views: new Map() }
  })
}

function inside(fight: Fight, x: number, z: number) {
  const { min, max } = fight.encounter.trigger
  return x >= min[0] && x <= max[0] && z >= min[1] && z <= max[1]
}

function activate(fight: Fight) {
  if (fight.active) return
  fight.active = true
  events.push({ kind: 'alert', encounter: fight.encounter.id, text: fight.encounter.callout })
}

function view(fight: Fight, id: string): SoldierView {
  const agent = fight.views.get(id)
  const state = fight.authority.states.find(state => state.id === id)!
  const aiming = !!agent && state.alive && (agent.execution.skill === 'engage' || agent.execution.skill === 'suppress' || firing.has(agent.fireGate))
  return {
    id: fight.ids.get(id)!, x: state.position.x, z: state.position.z, vx: state.velocity.x, vz: state.velocity.z, yaw: state.yaw, pitch: state.pitch,
    crouch: state.stance !== 'stand', alive: state.alive, aiming, reloading: state.reloadingUntil > 0, active: fight.active,
  }
}

function step() {
  if (!player) return
  tick++
  const alive = new Set(fights.flatMap(fight => fight.authority.states.filter(state => state.team === 'bravo' && state.alive).map(state => fight.ids.get(state.id)!)))
  attacks.begin(tick, alive)
  for (const fight of fights) {
    if (!fight.active && (inside(fight, player.x, player.z) || fight.authority.alive() < fight.encounter.soldiers.length)) activate(fight)
    fight.authority.setPlayer(player)
    if (!fight.active || fight.authority.alive() === 0) {
      drain(fight)
      continue
    }
    const snapshot = fight.runtime.step()
    for (const agent of snapshot.agents) if (agent.team === 'bravo') fight.views.set(agent.id, agent)
    for (const event of snapshot.events) {
      if (event.type !== 'intent' || event.tick !== snapshot.tick || !event.agentId) continue
      const id = fight.ids.get(event.agentId)
      if (id) events.push({ kind: 'intent', id, intent: event.text as Intent })
    }
    drain(fight)
  }
  const soldiers = fights.flatMap(fight => [...fight.ids.keys()].map(id => view(fight, id)))
  scope.postMessage({ type: 'frame', round, tick, soldiers, events })
  events = []
}

function drain(fight: Fight) {
  for (const event of fight.authority.gameEvents) events.push({ ...event, id: fight.ids.get(event.id) ?? event.id } as SquadEvent)
  fight.authority.gameEvents.length = 0
}

function loop() {
  const now = performance.now()
  const due = Math.min(3, Math.floor((now - last) / (1000 / TICK_RATE)))
  if (!paused) for (let index = 0; index < due; index++) {
    try { step() } catch (error) { scope.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) }) }
  }
  last = due > 0 ? (due === 3 ? now : last + due * (1000 / TICK_RATE)) : last
}

scope.onmessage = ({ data }) => {
  if (data.type === 'reset') { round = data.round; build(data.seed, data.player); last = performance.now() }
  else if (data.type === 'player') player = data.player
  else if (data.type === 'pause') { paused = data.paused; last = performance.now() }
  else if (data.type === 'damage') {
    for (const fight of fights) {
      const id = fight.back.get(data.id)
      if (!id) continue
      activate(fight)
      fight.authority.damage(id, data.amount, data.from)
    }
  } else if (data.type === 'shot') {
    for (const fight of fights) {
      if (!fight.active) continue
      fight.authority.hearShot(data.at)
    }
  }
}

setInterval(loop, 1000 / TICK_RATE / 2)
