import type { ComponentType } from 'react'
import { alsRepo, repo } from './content'
import { docList, type DocEntry } from './doc-list'

type Loader = () => Promise<{ default: ComponentType<{ components?: Record<string, unknown> }> }>
export type Doc = DocEntry & { load: Loader }

const loaders: Record<string, Loader> = {
  roadmap: () => import('../../ROADMAP.md'),
  als: () => import('../../vendor/als-web/docs/guide/overview.md'),
  'player-templates': () => import('../../docs/player-templates.md'),
  cascade: () => import('../../docs/cascade.md'),
  arms: () => import('../../docs/arms.md'),
  warden: () => import('../../docs/warden.md'),
  input: () => import('../../packages/input/README.md'),
  ui: () => import('../../packages/ui/README.md'),
}

export const docs: Doc[] = docList.map(doc => ({ ...doc, load: loaders[doc.slug]! }))

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
