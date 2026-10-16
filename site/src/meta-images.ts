import { tools } from './content'
import { headline } from './seo'

export type ImageSpec = { file: string; source: string; title: string; subtitle?: string; card: boolean }

export const cardSource = 'thumbs/hero.webp'

export function imageSpecs(thumbnailFor: (tool: string) => string | undefined): ImageSpec[] {
  return [
    { file: 'og/home.jpg', source: thumbnailFor('destruction') ?? cardSource, title: headline, card: false },
    { file: 'og/get-started.jpg', source: cardSource, title: 'Get started', subtitle: 'Install it, open your agent, and tell it what to make.', card: true },
    { file: 'og/skills.jpg', source: cardSource, title: 'Skills', subtitle: 'From a game idea to a playable web game.', card: true },
    { file: 'og/roadmap.jpg', source: cardSource, title: 'Roadmap', subtitle: 'What works today and what comes next.', card: true },
    ...tools.map(tool => {
      const thumbnail = thumbnailFor(tool.slug)
      return { file: `og/${tool.slug}.jpg`, source: thumbnail ?? cardSource, title: tool.name, subtitle: tool.tagline, card: !thumbnail }
    }),
  ]
}
