export function createWarmupRegistry() {
  const tasks = []
  return {
    register({ name, stage, scope, run }) {
      if (!name || !stage || !scope || typeof run !== 'function') throw new Error('Invalid warmup task')
      if (tasks.some(task => task.name === name)) throw new Error(`Duplicate warmup task: ${name}`)
      tasks.push({ name, stage, scope, run })
    },
    async run({ scope, signal, onProgress = () => {} }) {
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
export const registerWarmup = task => gameWarmup.register(task)
export const runWarmup = options => gameWarmup.run(options)
