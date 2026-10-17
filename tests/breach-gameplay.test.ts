import { describe, expect, it, vi } from 'vitest'
import { MOVE } from '../examples/breach/src/model'
import { AttackBudget } from '../examples/breach/src/authority'
import type { FromSquad, SoldierView, ToSquad } from '../examples/breach/src/protocol'
import { SquadClient } from '../examples/breach/src/squad'

describe('Breach overlapping encounters', () => {
  it('shares two attack slots between rooms and hands expired slots to waiting soldiers', () => {
    const budget = new AttackBudget()
    const alive = new Set(['lobby-1', 'hall-1', 'office-1'])
    budget.begin(0, alive)
    expect(budget.allow('lobby-1')).toBe(true)
    expect(budget.allow('hall-1')).toBe(true)
    expect(budget.allow('office-1')).toBe(false)
    for (let tick = 1; tick < 90; tick++) {
      budget.begin(tick, alive)
      expect(budget.allow('lobby-1')).toBe(true)
      expect(budget.allow('hall-1')).toBe(true)
    }
    budget.begin(90, alive)
    expect(budget.allow('lobby-1')).toBe(false)
    expect(budget.allow('office-1')).toBe(true)
  })

  it('releases a dead or idle shooter immediately on the next authority tick', () => {
    const budget = new AttackBudget()
    budget.begin(0, new Set(['lobby-1', 'hall-1', 'office-1']))
    budget.allow('lobby-1')
    budget.allow('hall-1')
    budget.begin(1, new Set(['hall-1', 'office-1']))
    expect(budget.allow('office-1')).toBe(true)
    budget.begin(17, new Set(['hall-1', 'office-1', 'office-2']))
    expect(budget.allow('office-2')).toBe(true)
  })

  it('reports the final casualty in every room before its tactical runtime goes idle', async () => {
    let loop = () => {}
    const interval = vi.spyOn(globalThis, 'setInterval').mockImplementation(callback => {
      loop = callback as () => void
      return 0 as unknown as ReturnType<typeof setInterval>
    })
    const messages: FromSquad[] = []
    const scope = { postMessage(message: FromSquad) { messages.push(message) }, onmessage: null as ((event: MessageEvent<ToSquad>) => void) | null }
    vi.stubGlobal('self', scope)
    const player = { x: 0, y: MOVE.eye, z: 12, yaw: 0, pitch: 0, crouch: false, moving: false, sprinting: false, alive: true }
    const send = (data: ToSquad) => scope.onmessage?.(new MessageEvent<ToSquad>('message', { data }))
    try {
      await import('../examples/breach/src/squad.worker')
      let clock = performance.now()
      vi.spyOn(performance, 'now').mockImplementation(() => clock)
      const advance = () => { clock += 40; loop() }
      send({ type: 'reset', seed: 7, round: 1, player })
      advance()
      send({ type: 'player', player: { ...player, z: 0 } })
      advance()
      send({ type: 'player', player: { ...player, z: -16 } })
      advance()
      const before = messages.filter(message => message.type === 'frame').at(-1)!
      expect(before.soldiers.filter(soldier => soldier.active)).toHaveLength(9)
      for (const soldier of before.soldiers) send({ type: 'damage', id: soldier.id, amount: 200, from: { x: 0, y: MOVE.eye, z: -16 } })
      advance()
      const after = messages.filter(message => message.type === 'frame').at(-1)!
      expect(after.soldiers.every(soldier => !soldier.alive)).toBe(true)
      expect(messages.filter(message => message.type === 'frame').flatMap(message => message.events).filter(event => event.kind === 'died')).toHaveLength(9)
      expect(messages.filter(message => message.type === 'error')).toEqual([])
    } finally {
      interval.mockRestore()
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    }
  })

  it('ignores frames from a previous round after resetting the client', () => {
    const workers: Array<{ onmessage: ((event: MessageEvent<FromSquad>) => void) | null }> = []
    class FakeWorker {
      onmessage: ((event: MessageEvent<FromSquad>) => void) | null = null
      constructor() { workers.push(this) }
      postMessage() {}
      terminate() {}
    }
    vi.stubGlobal('Worker', FakeWorker)
    const client = new SquadClient()
    const player = { x: 0, y: MOVE.eye, z: 22, yaw: 0, pitch: 0, crouch: false, moving: false, sprinting: false, alive: true }
    const soldier: SoldierView = { id: 'lobby-1', x: 0, z: 5, vx: 0, vz: 0, yaw: 0, pitch: 0, crouch: false, alive: true, aiming: false, reloading: false, active: true }
    const send = (round: number) => workers[0]!.onmessage?.(new MessageEvent<FromSquad>('message', { data: { type: 'frame', round, tick: 1, soldiers: [soldier], events: [] } }))
    try {
      client.start()
      client.reset(7, player)
      send(1)
      expect(client.roster).toHaveLength(1)
      client.reset(8, player)
      send(1)
      expect(client.roster).toHaveLength(0)
      send(2)
      expect(client.roster).toHaveLength(1)
    } finally {
      client.dispose()
      vi.unstubAllGlobals()
    }
  })
})
