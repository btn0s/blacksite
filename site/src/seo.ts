import { repo, tools } from './content'
import { docList } from './doc-list'

export const siteName = 'Blacksite'
export const defaultSiteUrl = 'https://blacksite-sable.vercel.app'
export const themeColor = '#0e0e0f'
export const headline = 'The game-dev instincts your coding agent is missing'
export const subhead = 'Blacksite gives your agents best practices from real games, top-quality examples to learn from, and building blocks to build on.'
export const imageSize = { width: 1200, height: 630 }

export type PageMeta = { route: string; title: string; description: string; image: string; imageAlt: string; type: 'website' | 'article' }

export const description = 'A game dev skill for Claude Code, Codex and Cursor. Your agent builds 3D browser games in three.js from best practices, examples and building blocks.'

const toolTitles: Record<string, string> = {
  characters: 'Character movement and animation for three.js',
  world: 'Open-world terrain and foliage for browser games',
  destruction: 'Building destruction physics for browser games',
  weapons: 'First-person weapons for browser games',
  multiplayer: 'Server-checked multiplayer for browser games',
  ai: 'Enemy squad AI for browser games',
  input: 'Gamepad, touch and menu input for browser games',
}

const toolDescriptions: Record<string, string> = {
  characters: 'A player character for browser games that walks, sprints, climbs ledges, rolls and aims in first or third person, with a rooftop run to play.',
  world: 'Open-world terrain, grass, forests, wind and sky for browser games that hold up from your feet to distant mountains, with a valley to walk.',
  destruction: 'Concrete buildings for browser games that crack, lose their supports and collapse, with the physics running in a web worker.',
  weapons: 'A first-person rifle and pistol for browser games on rigged arms, with recoil and server-checked hits, plus a squad fight and a firing range.',
  multiplayer: 'Multiplayer rooms for browser games where each player moves their own character and the server checks every hit, with a bot to play against.',
  ai: 'Enemy squad AI for browser games: squads that see, hear, take cover and flank, in a simulation that gives the same result every time.',
  input: 'One input layer for browser games covering keyboard, mouse, gamepad and touch, plus menus, pause and settings screens a controller can drive.',
}

const guideDescriptions: Record<string, string> = {
  'player-templates': 'The four starting projects for a Blacksite game: first person, third person, multiplayer and blank. What each one sets up and how far along it is.',
  cascade: 'How destruction works: bonds and stress, fracture, the physics worker and renderer, and walking inside a building that can collapse.',
  arms: 'How the first-person arms work: the skeleton masked to the arms, the rifle and pistol animation graph, and the fire, reload and equip clips.',
  warden: 'How to add squad AI to a game: the packages to install, connecting it to a React Three Fiber scene, and running it in a worker.',
  input: 'The Blacksite input package: one runtime for keyboard, mouse, touch and gamepads, with separate controls for menus, dialogs and gameplay.',
  ui: 'The Blacksite UI package: menu components with neutral styling, and console-style screens you can drive with a gamepad.',
}

export const pages: PageMeta[] = [
  { route: '', title: `${siteName}: game dev skills for your coding agents`, description, image: 'og/home.jpg', imageAlt: `${siteName}: ${headline}`, type: 'website' },
  { route: 'get-started', title: `Get started with ${siteName}`, description: 'Install Blacksite with one command, open Claude Code, Codex or Cursor in an empty folder, and describe the game you want your agent to build.', image: 'og/get-started.jpg', imageAlt: `Get started with ${siteName}`, type: 'article' },
  { route: 'skills', title: `How ${siteName} works: game dev skills for coding agents`, description: 'How Blacksite gives your coding agent game dev skills: guides, building blocks, example games, and checks that play the game on desktop and phone.', image: 'og/skills.jpg', imageAlt: `How ${siteName} works`, type: 'article' },
  { route: 'roadmap', title: `${siteName} roadmap: what works today and what comes next`, description: 'What works in Blacksite today, what is being built now, and what comes after that, for the game dev skill and its building blocks.', image: 'og/roadmap.jpg', imageAlt: `${siteName} roadmap`, type: 'article' },
  ...tools.map((tool): PageMeta => ({ route: `tools/${tool.slug}`, title: `${toolTitles[tool.slug] ?? tool.name} · ${siteName}`, description: toolDescriptions[tool.slug] ?? tool.tagline, image: `og/${tool.slug}.jpg`, imageAlt: `${siteName} ${tool.name}: ${tool.tagline}`, type: 'article' })),
  ...docList.filter(doc => doc.slug !== 'roadmap').map((doc): PageMeta => ({ route: `guides/${doc.slug}`, title: `${doc.title} · ${siteName}`, description: guideDescriptions[doc.slug] ?? doc.title, image: doc.tool ? `og/${doc.tool}.jpg` : 'og/home.jpg', imageAlt: `${siteName} ${doc.title}`, type: 'article' })),
]

export const metaFor = (route: string) => pages.find(page => page.route === route)

export const absoluteUrl = (siteUrl: string, base: string, path: string) => `${siteUrl.replace(/\/+$/, '')}${base.startsWith('/') ? base : `/${base}`}${path}`

const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function headTags(page: PageMeta, siteUrl: string, base = '/', options: { canonical?: boolean; noindex?: boolean } = {}) {
  const url = absoluteUrl(siteUrl, base, page.route), image = absoluteUrl(siteUrl, base, page.image)
  const tags = [
    `<title>${escape(page.title)}</title>`,
    `<meta name="description" content="${escape(page.description)}"/>`,
    options.noindex ? '<meta name="robots" content="noindex"/>' : '',
    options.canonical === false ? '' : `<link rel="canonical" href="${escape(url)}"/>`,
    `<meta name="theme-color" content="${themeColor}"/>`,
    `<meta property="og:site_name" content="${siteName}"/>`,
    `<meta property="og:type" content="${page.type}"/>`,
    `<meta property="og:title" content="${escape(page.title)}"/>`,
    `<meta property="og:description" content="${escape(page.description)}"/>`,
    `<meta property="og:url" content="${escape(url)}"/>`,
    `<meta property="og:image" content="${escape(image)}"/>`,
    `<meta property="og:image:type" content="image/jpeg"/>`,
    `<meta property="og:image:width" content="${imageSize.width}"/>`,
    `<meta property="og:image:height" content="${imageSize.height}"/>`,
    `<meta property="og:image:alt" content="${escape(page.imageAlt)}"/>`,
    '<meta name="twitter:card" content="summary_large_image"/>',
    `<meta name="twitter:title" content="${escape(page.title)}"/>`,
    `<meta name="twitter:description" content="${escape(page.description)}"/>`,
    `<meta name="twitter:image" content="${escape(image)}"/>`,
    `<meta name="twitter:image:alt" content="${escape(page.imageAlt)}"/>`,
  ]
  if (page.route === '') tags.push(`<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'SoftwareSourceCode', name: siteName, description: page.description,
    url, codeRepository: repo, programmingLanguage: 'TypeScript', runtimePlatform: 'Web browser', image,
  }).replace(/</g, '\\u003c')}</script>`)
  return tags.filter(Boolean).join('')
}

export function renderPage(html: string, page: PageMeta, siteUrl: string, base = '/', options: { canonical?: boolean; noindex?: boolean } = {}) {
  return html
    .replace(/<meta name="theme-color"[^>]*>/, '')
    .replace(/<title>[^<]*<\/title>/, () => headTags(page, siteUrl, base, options))
}

export function sitemap(siteUrl: string, base = '/') {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.map(page => `  <url><loc>${escape(absoluteUrl(siteUrl, base, page.route))}</loc></url>`).join('\n')}\n</urlset>\n`
}

export const robots = (siteUrl: string, base = '/') => `User-agent: *\nAllow: /\n\nSitemap: ${absoluteUrl(siteUrl, base, 'sitemap.xml')}\n`

export function applyMeta(page: PageMeta) {
  document.title = page.title
  const set = (selector: string, attribute: string, key: string, value: string) => {
    let element = document.head.querySelector<HTMLMetaElement | HTMLLinkElement>(selector)
    if (!element) {
      element = document.createElement(selector.startsWith('link') ? 'link' : 'meta')
      element.setAttribute(selector.startsWith('link') ? 'rel' : attribute, key)
      document.head.append(element)
    }
    element.setAttribute(selector.startsWith('link') ? 'href' : 'content', value)
  }
  const siteUrl = import.meta.env.SITE_URL ?? defaultSiteUrl
  const url = absoluteUrl(siteUrl, import.meta.env.BASE_URL, page.route), image = absoluteUrl(siteUrl, import.meta.env.BASE_URL, page.image)
  set('meta[name="description"]', 'name', 'description', page.description)
  set('link[rel="canonical"]', 'rel', 'canonical', url)
  set('meta[property="og:type"]', 'property', 'og:type', page.type)
  set('meta[property="og:title"]', 'property', 'og:title', page.title)
  set('meta[property="og:description"]', 'property', 'og:description', page.description)
  set('meta[property="og:url"]', 'property', 'og:url', url)
  set('meta[property="og:image"]', 'property', 'og:image', image)
  set('meta[property="og:image:alt"]', 'property', 'og:image:alt', page.imageAlt)
  set('meta[name="twitter:title"]', 'name', 'twitter:title', page.title)
  set('meta[name="twitter:description"]', 'name', 'twitter:description', page.description)
  set('meta[name="twitter:image"]', 'name', 'twitter:image', image)
}
