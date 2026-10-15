export type StandaloneIntent = { forward: number; right: number; jump: boolean }

export function readStandaloneIntent(keys: ReadonlySet<string>): StandaloneIntent {
  const forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS'))
  const right = Number(keys.has('KeyD')) - Number(keys.has('KeyA'))
  const length = Math.max(1, Math.hypot(forward, right))
  return { forward: forward / length, right: right / length, jump: keys.has('Space') }
}
