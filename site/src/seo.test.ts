import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { tools } from './content'
import { docList } from './doc-list'
import { imageSpecs } from './meta-images'
import { defaultSiteUrl, imageSize, pages, renderPage, robots, sitemap } from './seo'
import { showcasesFor } from './showcases/registry'
import { specHash, thumbnailsFromMeta } from '../../scripts/meta-images'

const site = resolve(import.meta.dirname, '..')
const shell = readFileSync(resolve(site, 'index.html'), 'utf8')
const thumbnailFor = (tool: string) => showcasesFor(tool).find(showcase => showcase.thumbnail)?.thumbnail

function jpegSize(file: string) {
  const data = readFileSync(file)
  expect(data[0] === 0xff && data[1] === 0xd8, `${file} is not a JPEG`).toBe(true)
  for (let offset = 2; offset < data.length;) {
    const marker = data[offset + 1]!, length = data.readUInt16BE(offset + 2)
    if (marker >= 0xc0 && marker <= 0xc3) return { width: data.readUInt16BE(offset + 7), height: data.readUInt16BE(offset + 5) }
    offset += 2 + length
  }
  throw new Error(`${file} has no frame header`)
}

const tag = (html: string, pattern: RegExp) => html.match(pattern)?.[1]

describe('route meta', () => {
  it('covers every page the app renders', () => {
    const routes = ['', 'get-started', 'skills', 'roadmap', ...tools.map(tool => `tools/${tool.slug}`), ...docList.filter(doc => doc.slug !== 'roadmap').map(doc => `guides/${doc.slug}`)]
    expect(pages.map(page => page.route).sort()).toEqual(routes.sort())
  })

  it.each(pages.map(page => [page.route || '/', page] as const))('gives %s a title, description, canonical and 1200x630 image', (_, page) => {
    const html = renderPage(shell, page, defaultSiteUrl)
    expect(html).toContain('<html lang="en">')
    const title = tag(html, /<title>([^<]+)<\/title>/)!
    expect(title).toContain('Blacksite')
    expect(title.length).toBeLessThanOrEqual(60)
    expect(html.match(/<title>/g)).toHaveLength(1)
    const description = tag(html, /<meta name="description" content="([^"]+)"/)!
    expect(description.length).toBeGreaterThan(60)
    expect(description.length).toBeLessThanOrEqual(160)
    expect(tag(html, /<link rel="canonical" href="([^"]+)"/)).toBe(`${defaultSiteUrl}/${page.route}`)
    expect(tag(html, /<meta property="og:url" content="([^"]+)"/)).toBe(`${defaultSiteUrl}/${page.route}`)
    expect(tag(html, /<meta name="twitter:card" content="([^"]+)"/)).toBe('summary_large_image')
    for (const property of ['og:title', 'og:description', 'og:type', 'og:site_name', 'og:image:alt']) expect(html).toContain(`property="${property}"`)
    const image = tag(html, /<meta property="og:image" content="([^"]+)"/)!
    expect(image).toBe(`${defaultSiteUrl}/${page.image}`)
    expect(tag(html, /<meta name="twitter:image" content="([^"]+)"/)).toBe(image)
    const file = resolve(site, 'public', page.image)
    expect(jpegSize(file)).toEqual(imageSize)
    expect(statSync(file).size).toBeLessThan(300 * 1024)
  })

  it('marks the home page up as source code with the repository', () => {
    const json = tag(renderPage(shell, pages[0]!, defaultSiteUrl), /<script type="application\/ld\+json">(.+?)<\/script>/)!
    expect(JSON.parse(json)).toMatchObject({ '@type': 'SoftwareSourceCode', name: 'Blacksite', url: `${defaultSiteUrl}/`, codeRepository: 'https://github.com/btn0s/blacksite' })
  })

  it('lists every route in the sitemap and points robots at it', () => {
    const xml = sitemap(defaultSiteUrl)
    for (const page of pages) expect(xml).toContain(`<loc>${defaultSiteUrl}/${page.route}</loc>`)
    expect(robots(defaultSiteUrl)).toBe(`User-agent: *\nAllow: /\n\nSitemap: ${defaultSiteUrl}/sitemap.xml\n`)
  })
})

describe('meta images', () => {
  it('reads the same thumbnails as the showcase registry', () => {
    const fromMeta = thumbnailsFromMeta()
    for (const tool of tools) expect(fromMeta.get(tool.slug)).toBe(thumbnailFor(tool.slug))
  })

  it('are current with their thumbnails and text; run pnpm meta:images if this fails', () => {
    const recorded = JSON.parse(readFileSync(resolve(site, 'public/og/sources.json'), 'utf8')) as Record<string, string>
    const specs = imageSpecs(thumbnailFor)
    expect(Object.keys(recorded).sort()).toEqual(specs.map(spec => spec.file).sort())
    for (const spec of specs) expect(recorded[spec.file], spec.file).toBe(specHash(spec))
    for (const page of pages) expect(specs.some(spec => spec.file === page.image), page.image).toBe(true)
  })
})
