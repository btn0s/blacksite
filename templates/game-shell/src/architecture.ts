import { createWorld, trait } from 'koota'
import { createActor, createMachine } from 'xstate'
import { Context, Effect, Layer } from 'effect'

export type Intent = { forward: number; right: number; jump: boolean }
export const Controller = trait({ player: 0 })
export const Pawn = trait({ x: 0, y: 0, z: 0 })
export const PawnIntent = trait({ forward: 0, right: 0, jump: false })

const GameEvents = Context.Service<{ emit: (name: string) => void }>('GameEvents')
const GameEventsLive = Layer.succeed(GameEvents, { emit: (name: string) => window.dispatchEvent(new CustomEvent('game-event', { detail: name })) })

export function createSession() {
  const world = createWorld()
  const controller = world.spawn(Controller({ player: 1 }))
  const pawn = world.spawn(Pawn, PawnIntent)
  const life = createActor(createMachine({ initial: 'alive', states: { alive: { on: { DIE: 'dead' } }, dead: { on: { RESPAWN: 'alive' } } } })).start()
  const phase = createActor(createMachine({ initial: 'menu', states: { menu: { on: { PLAY: 'playing' } }, playing: { on: { PAUSE: 'paused', MENU: 'menu' } }, paused: { on: { RESUME: 'playing', MENU: 'menu' } } } })).start()
  const announce = (name: string) => Effect.runSync(Effect.provide(Effect.gen(function* () { const events = yield* GameEvents; events.emit(name) }), GameEventsLive))
  const writeIntent = (intent: Intent) => {
    if (!controller.has(Controller) || !life.getSnapshot().matches('alive')) return
    pawn.set(PawnIntent, intent)
  }
  const mirror = (position: { x: number; y: number; z: number }) => pawn.set(Pawn, { x: position.x, y: position.y, z: position.z })
  const snapshot = () => ({ life: life.getSnapshot().value, phase: phase.getSnapshot().value, position: { ...pawn.get(Pawn)! } })
  const start = () => () => { phase.stop(); life.stop(); world.reset() }
  return { world, controller, pawn, life, phase, writeIntent, mirror, snapshot, announce, start }
}
