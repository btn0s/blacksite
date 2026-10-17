import { tools } from './content'
import { headline } from './seo'

export type ImageSpec = { file: string; title: string; subtitle?: string; images: string[] }

const pictured = new Set(['characters', 'weapons', 'world'])

const lines: Record<string, string> = {
  characters: 'Walk, sprint, climb, roll and fall.',
  weapons: 'A rifle and a pistol in rigged arms.',
  world: 'Terrain, grass, forests, wind and sky.',
  destruction: 'Concrete buildings that crack and fall.',
  multiplayer: 'Shared rooms where the server checks every hit.',
  ai: 'Enemy squads that take cover and flank.',
  input: 'Keyboard, mouse, gamepad and touch.',
}

export function imageSpecs(thumbnailFor: (tool: string) => string | undefined): ImageSpec[] {
  const games = ['weapons', 'characters', 'world'].flatMap(tool => thumbnailFor(tool) ?? [])
  return [
    { file: 'og/home.jpg', title: `${headline}.`, images: games },
    { file: 'og/get-started.jpg', title: 'Get started', subtitle: 'Install it, open your agent, say what you want.', images: [] },
    { file: 'og/skills.jpg', title: 'How it works', subtitle: 'Guides, building blocks, example games and checks.', images: [] },
    { file: 'og/roadmap.jpg', title: 'Roadmap', subtitle: 'What works today and what comes next.', images: [] },
    ...tools.map(tool => {
      const thumbnail = pictured.has(tool.slug) ? thumbnailFor(tool.slug) : undefined
      return { file: `og/${tool.slug}.jpg`, title: tool.name, subtitle: lines[tool.slug] ?? tool.tagline, images: thumbnail ? [thumbnail] : [] }
    }),
  ]
}
