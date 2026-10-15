import type { ComponentType } from 'react'

type Doc = { slug: string; title: string; load: () => Promise<{ default: ComponentType<{ components?: Record<string, unknown> }> }> }

export const docs: Doc[] = [
  { slug: 'readme', title: 'Overview', load: () => import('../../README.md') },
  { slug: 'roadmap', title: 'Roadmap', load: () => import('../../ROADMAP.md') },
  { slug: 'docs-index', title: 'Docs index', load: () => import('../../docs/README.md') },
  { slug: 'cascade', title: 'Cascade', load: () => import('../../docs/cascade.md') },
  { slug: 'warden', title: 'Warden', load: () => import('../../docs/warden.md') },
  { slug: 'maintenance', title: 'Maintenance', load: () => import('../../docs/maintenance.md') },
  { slug: 'migration', title: 'Migration', load: () => import('../../docs/migration-blacksite.md') },
  { slug: 'ui', title: 'UI package', load: () => import('../../packages/ui/README.md') },
  { slug: 'input', title: 'Input package', load: () => import('../../packages/input/README.md') },
]

export const docBySlug = (slug: string) => docs.find(doc => doc.slug === slug)
