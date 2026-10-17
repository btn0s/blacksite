import { tools } from './content'
import { headline, subhead } from './seo'

export type ImageSpec = { file: string; source: string; title: string; subtitle?: string; card: boolean }

export const cardSource = 'thumbs/hero.webp'

export function imageSpecs(thumbnailFor: (tool: string) => string | undefined): ImageSpec[] {
  return [
    { file: 'og/home.jpg', source: thumbnailFor('destruction') ?? cardSource, title: headline, subtitle: subhead, card: false },
    { file: 'og/get-started.jpg', source: cardSource, title: 'Get started', subtitle: 'Install it, open your agent, and say what you want to make.', card: true },
    { file: 'og/skills.jpg', source: cardSource, title: 'How it works', subtitle: 'What your coding agent does when you ask for a game.', card: true },
    { file: 'og/roadmap.jpg', source: cardSource, title: 'Roadmap', subtitle: 'What works today and what comes next.', card: true },
    ...tools.map(tool => {
      const thumbnail = thumbnailFor(tool.slug)
      return { file: `og/${tool.slug}.jpg`, source: thumbnail ?? cardSource, title: tool.name, subtitle: tool.tagline, card: !thumbnail }
    }),
  ]
}
