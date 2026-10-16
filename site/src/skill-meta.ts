export type Invocation = 'user' | 'both' | 'model' | 'reference'
export type Skill = { name: string; description: string; summary: string; invocation: Invocation; argument?: string; path: string }

export const phases = ['start', 'make-game', 'design-game', 'setup-project', 'build-prototype', 'combine-prototypes', 'optimize-game', 'ship-game']
export const references = ['als', 'game-architecture', 'game-assets', 'blacksite-kit']

export function parseFrontmatter(source: string) {
  const match = /^---\n([\s\S]*?)\n---/.exec(source)
  const fields: Record<string, string> = {}
  for (const line of match?.[1]?.split('\n') ?? []) {
    const index = line.indexOf(':')
    if (index > 0) fields[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^["']|["']$/g, '')
  }
  return fields
}

export function invocationOf(fields: Record<string, string>): Invocation {
  if (references.includes(fields.name ?? '')) return 'reference'
  if (fields['disable-model-invocation'] === 'true') return 'user'
  if (fields['argument-hint']) return 'both'
  return 'model'
}

export const invocationLabel: Record<Invocation, string> = {
  user: 'You run it',
  both: 'You or the agent',
  model: 'The agent runs it',
  reference: 'Reference',
}
