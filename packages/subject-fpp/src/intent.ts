export type ActionIntent = { forward: number; right: number; jump: boolean; sprint: boolean; crouch: boolean; walk: boolean; aim: boolean }

export type IntentLatch = { sprint: boolean; crouch: boolean }

export function readActionIntent(move: { x: number; y: number }, held: (action: string) => boolean, latch: IntentLatch = { sprint: false, crouch: false }): ActionIntent {
  const length = Math.max(1, Math.hypot(move.x, move.y))
  const forward = move.y / length
  const aim = held('aim')
  if (latch.sprint && (forward < 0.3 || aim || held('fire'))) latch.sprint = false
  return { forward, right: move.x / length, jump: held('jump'), sprint: held('sprint') || latch.sprint, crouch: held('crouch') !== latch.crouch, walk: held('walk'), aim }
}
