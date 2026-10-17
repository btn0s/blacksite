import type { Control } from '../content'

export type Showcase = {
  tool: string
  title: string
  summary: string
  tryThis: string
  order?: number
  thumbnail?: string
  keyboard: Control[]
  touch: Control[]
}

export type RegisteredShowcase = Showcase & { id: string; frame: string }

const modules = import.meta.glob<{ showcase: Showcase }>('./*/meta.ts', { eager: true })

export const showcases: RegisteredShowcase[] = Object.entries(modules)
  .map(([path, module]) => { const id = path.split('/')[1]!; return { ...module.showcase, id, frame: id } })
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))

export const showcasesFor = (tool: string) => showcases.filter(showcase => showcase.tool === tool)
