export type Invocation = 'user' | 'both' | 'model'
export type Skill = { name: string; description: string; summary: string; invocation: Invocation; argument?: string; path: string }
export type Reference = { name: string; title: string; summary: string; path: string }

export const workflow = ['Size', 'Truth', 'Parts list', 'Build', 'Make it live', 'Verify', 'Ship']

export const referenceGroups = [
  { title: 'Workflow', names: ['design', 'setup', 'prototype', 'combine', 'verify', 'optimise', 'ship'] },
  { title: 'Craft', names: ['craft', 'feel', 'sound', 'performance'] },
  { title: 'Building blocks', names: ['characters', 'als', 'weapons', 'ai', 'destruction', 'multiplayer', 'input'] },
  { title: 'Wiring and assets', names: ['architecture', 'assets', 'catalog'] },
]

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
  if (fields['disable-model-invocation'] === 'true') return 'user'
  if (fields['argument-hint']) return 'both'
  return 'model'
}

export function summarizeReference(source: string) {
  const blocks = source.split(/\n\s*\n/).map(block => block.trim())
  const title = blocks.find(block => block.startsWith('# '))?.slice(2).trim() ?? ''
  const paragraph = blocks.find(block => block && !/^(?:[#|>-]|```)/.test(block) && !/^\d+\./.test(block)) ?? ''
  const plain = paragraph.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`/g, '').replace(/\s+/g, ' ')
  return { title, summary: plain.split(/(?<=[.!?])\s+(?=[A-Z`])/)[0] ?? plain }
}

export const invocationLabel: Record<Invocation, string> = {
  user: 'You run it',
  both: 'You or the agent',
  model: 'The agent runs it',
}
