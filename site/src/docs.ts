import type { ComponentType } from 'react'
import { alsRepo, repo } from './content'

type Loader = () => Promise<{ default: ComponentType<{ components?: Record<string, unknown> }> }>
export type Doc = { slug: string; title: string; path: string; tool?: string; load: Loader }

export const docs: Doc[] = [
  { slug: 'roadmap', title: 'Roadmap', path: 'ROADMAP.md', load: () => import('../../ROADMAP.md') },
  { slug: 'als', title: 'ALS agent guide', path: 'vendor/als-web/docs/guide/overview.md', tool: 'characters', load: () => import('../../vendor/als-web/docs/guide/overview.md') },
  { slug: 'player-templates', title: 'Player templates', path: 'docs/player-templates.md', tool: 'multiplayer', load: () => import('../../docs/player-templates.md') },
  { slug: 'cascade', title: 'Cascade guide', path: 'docs/cascade.md', tool: 'destruction', load: () => import('../../docs/cascade.md') },
  { slug: 'arms', title: 'First-person arms', path: 'docs/arms.md', tool: 'weapons', load: () => import('../../docs/arms.md') },
  { slug: 'warden', title: 'Warden guide', path: 'docs/warden.md', tool: 'ai', load: () => import('../../docs/warden.md') },
  { slug: 'input', title: 'Input guide', path: 'packages/input/README.md', tool: 'input', load: () => import('../../packages/input/README.md') },
  { slug: 'ui', title: 'UI guide', path: 'packages/ui/README.md', tool: 'input', load: () => import('../../packages/ui/README.md') },
]

export const docBySlug = (slug: string) => docs.find(doc => doc.slug === slug)
export const docByPath = (path: string) => docs.find(doc => doc.path === path)

export function githubUrl(path: string) {
  const [file, hash] = path.split('#')
  const clean = file!.replace(/^\/+/, '')
  const url = clean.startsWith('vendor/als-web/') ? `${alsRepo}/blob/main/${clean.slice('vendor/als-web/'.length)}` : `${repo}/blob/main/${clean}`
  return hash ? `${url}#${hash}` : url
}

export function resolveRepoPath(from: string, href: string) {
  const [target, hash] = href.split('#')
  const parts = from.split('/').slice(0, -1)
  for (const part of target!.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  const path = parts.join('/')
  return hash ? `${path}#${hash}` : path
}

export function linkFor(base: string, path: string) {
  const [file, hash] = path.split('#')
  if (file === 'README.md') return base
  const doc = docByPath(file!)
  if (doc) return `${base}${doc.slug === 'roadmap' ? 'roadmap' : `guides/${doc.slug}`}${hash ? `#${hash}` : ''}`
  return githubUrl(path)
}

export function rewriteHref(base: string, from: string, href?: string) {
  if (!href) return href
  if (/^[a-z]+:/i.test(href) || href.startsWith('#') || href.startsWith('//')) return href
  return linkFor(base, resolveRepoPath(from, href))
}
