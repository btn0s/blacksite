import { createWorld, trait } from 'koota'
import { createActor, createMachine } from 'xstate'
import { Context, Effect, Fiber, Layer } from 'effect'

export type Intent = { forward: number; right: number; jump: boolean }
export const Controller = trait({ player: 0 })
export const Pawn = trait({ x: 0, z: 0 })
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
  const tick = (dt: number) => {
    if (!life.getSnapshot().matches('alive')) return
    const position = pawn.get(Pawn)!
    const intent = pawn.get(PawnIntent)!
    pawn.set(Pawn, { x: position.x + intent.right * dt, z: position.z + intent.forward * dt })
  }
  const snapshot = () => ({ life: life.getSnapshot().value, position: { ...pawn.get(Pawn)! } })
  const keys = new Set<string>()
  const keyDown = (event: KeyboardEvent) => keys.add(event.code)
  const keyUp = (event: KeyboardEvent) => keys.delete(event.code)
  const start = () => {
    const resource = Effect.acquireRelease(Effect.sync(() => {
      window.addEventListener('keydown', keyDown)
      window.addEventListener('keyup', keyUp)
      return window.setInterval(() => {
        writeIntent({ forward: Number(keys.has('KeyW')) - Number(keys.has('KeyS')), right: Number(keys.has('KeyD')) - Number(keys.has('KeyA')), jump: keys.has('Space') })
        tick(1 / 60)
      }, 1000 / 60)
    }), timer => Effect.sync(() => { window.clearInterval(timer); window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp) }))
    const fiber = Effect.runFork(Effect.scoped(Effect.flatMap(resource, () => Effect.never)))
    return () => { void Effect.runPromise(Fiber.interrupt(fiber)); phase.stop(); life.stop(); world.reset() }
  }
  return { world, controller, pawn, life, phase, writeIntent, tick, snapshot, announce, start }
}
