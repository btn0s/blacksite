type WarmupTask = { name: string; stage: string; scope: string; run: (context: { signal?: AbortSignal }) => Promise<unknown> }
type WarmupProgress = { stage: string; name: string; completed: number; total: number }
type WarmupOptions = { scope: string; signal?: AbortSignal; onProgress?: (progress: WarmupProgress) => void }

export function createWarmupRegistry() {
  const tasks: WarmupTask[] = []
  return {
    register(task: WarmupTask) {
      if (!task.name || !task.stage || !task.scope || typeof task.run !== 'function') throw new Error('Invalid warmup task')
      if (tasks.some(existing => existing.name === task.name)) throw new Error(`Duplicate warmup task: ${task.name}`)
      tasks.push(task)
    },
    async run({ scope, signal, onProgress = () => {} }: WarmupOptions) {
      const selected = tasks.filter(task => task.scope === scope)
      for (let index = 0; index < selected.length; index++) {
        signal?.throwIfAborted()
        const task = selected[index]
        onProgress({ stage: task.stage, name: task.name, completed: index, total: selected.length })
        await task.run({ signal })
      }
      onProgress({ stage: 'ready', name: 'ready', completed: selected.length, total: selected.length })
    },
  }
}

const gameWarmup = createWarmupRegistry()
export const registerWarmup = (task: WarmupTask) => gameWarmup.register(task)
export const runWarmup = (options: WarmupOptions) => gameWarmup.run(options)
