import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { featured, limits, parts, resolveLegacy, tools } from './content'
import { githubUrl, linkFor, rewriteHref } from './docs'
import { examples, invocationOf, parseFrontmatter, referenceGroups, referenceNotes, steps } from './skill-meta'
import { pages } from './seo'
import { showcases } from './showcases/registry'

const root = resolve(import.meta.dirname, '../..')

describe('legacy routes', () => {
  it('sends old demo and doc URLs to tool pages', () => {
    expect(resolveLegacy('demos/demolition')).toBe('tools/destruction')
    expect(resolveLegacy('demos/movement/')).toBe('tools/characters')
    expect(resolveLegacy('docs/warden')).toBe('tools/ai')
    expect(resolveLegacy('docs/roadmap')).toBe('roadmap')
    expect(resolveLegacy('guides/als')).toBe('tools/characters')
    expect(resolveLegacy('demos/unknown')).toBe('')
    expect(resolveLegacy('tools/ai')).toBeNull()
  })

  it('points every redirect at a page that exists', () => {
    for (const route of ['demos/fpp', 'demos/mp', 'demos/warden', 'docs/input', 'docs/cascade']) {
      const target = resolveLegacy(route)!
      expect(tools.some(tool => `tools/${tool.slug}` === target)).toBe(true)
    }
  })
})

describe('links', () => {
  it('keeps rendered guides on the site and sends other files to GitHub', () => {
    expect(linkFor('/', 'ROADMAP.md')).toBe('/roadmap')
    expect(linkFor('/', 'README.md')).toBe('/')
    expect(linkFor('/', 'packages/warden/README.md')).toBe('https://github.com/btn0s/blacksite/blob/main/packages/warden/README.md')
    expect(githubUrl('vendor/als-web/docs/guide/overview.md')).toBe('https://github.com/btn0s/als-web/blob/main/docs/guide/overview.md')
  })

  it('resolves relative markdown links against the guide path', () => {
    expect(rewriteHref('/', 'packages/input/README.md', '../../ROADMAP.md#input')).toBe('/roadmap#input')
    expect(rewriteHref('/', 'packages/input/README.md', 'https://example.com')).toBe('https://example.com')
    expect(rewriteHref('/', 'packages/input/README.md', '#usage')).toBe('#usage')
  })
})

describe('skills', () => {
  it('reads frontmatter fields', () => {
    expect(parseFrontmatter('---\nname: start\ndescription: "Pick a path."\n---\nBody')).toEqual({ name: 'start', description: 'Pick a path.' })
  })

  it('classifies who invokes each skill', () => {
    const skills = Object.fromEntries(readdirSync(resolve(root, 'skills'))
      .filter(name => existsSync(resolve(root, 'skills', name, 'SKILL.md')))
      .map(name => [name, invocationOf(parseFrontmatter(readFileSync(resolve(root, 'skills', name, 'SKILL.md'), 'utf8')))]))
    expect(skills).toEqual({ blacksite: 'both' })
  })

  it('places every reference in one group with a label and a one-line summary', () => {
    const directory = resolve(root, 'skills', 'blacksite', 'references')
    const names = readdirSync(directory).filter(name => name.endsWith('.md')).map(name => name.replace(/\.md$/, '')).sort()
    expect(referenceGroups.flatMap(group => group.names).sort()).toEqual(names)
    expect(Object.keys(referenceNotes).sort()).toEqual(names)
    for (const name of names) {
      expect(referenceNotes[name]!.label, name).not.toBe('')
      expect(referenceNotes[name]!.summary.length, name).toBeGreaterThan(20)
    }
  })
})

describe('tools', () => {
  it('gives every tool a page with guides, commands and honest status', () => {
    expect(tools.map(tool => tool.slug)).toEqual(['characters', 'world', 'destruction', 'weapons', 'multiplayer', 'ai', 'input'])
    for (const tool of tools) {
      expect(tool.guides.length).toBeGreaterThan(0)
      expect(tool.statusNote.length).toBeGreaterThan(0)
      for (const demo of tool.demos) if (demo.live) expect(demo.frame).toBeTruthy()
    }
  })
})

describe('showcases', () => {
  it('registers each showcase on a real tool with its own frame', () => {
    expect(showcases.length).toBeGreaterThan(0)
    for (const showcase of showcases) {
      expect(tools.some(tool => tool.slug === showcase.tool)).toBe(true)
      expect(existsSync(resolve(root, 'site/frames', `${showcase.frame}.html`))).toBe(true)
      expect(readFileSync(resolve(root, 'site/frames', `${showcase.frame}.html`), 'utf8')).toContain(`../src/showcases/${showcase.id}/`)
      if (showcase.thumbnail) expect(existsSync(resolve(root, 'site/public', showcase.thumbnail))).toBe(true)
      expect(showcase.summary.length, showcase.id).toBeGreaterThan(20)
      expect(showcase.tryThis.length, showcase.id).toBeGreaterThan(10)
    }
  })

  it('leads the home page with games that have a thumbnail', () => {
    for (const entry of featured) expect(showcases.find(showcase => showcase.id === entry.showcase)?.thumbnail, entry.showcase).toBeTruthy()
  })
})

describe('copy', () => {
  it('names no other engine or system codename in what visitors read', () => {
    const text = JSON.stringify([tools.map(({ packages: _, agent: { commands: __, ...agent }, ...tool }) => ({ ...tool, agent })), featured, parts, limits, steps, examples, referenceNotes, pages, showcases.map(({ summary, tryThis, title }) => ({ summary, tryThis, title }))])
    expect(text).not.toMatch(/Unreal|Unity|Godot|\bUE5\b|Armory|Warden|Relay|Cascade/)
  })
})
