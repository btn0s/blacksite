import { repo, tools } from './content'
import { docList } from './doc-list'

export const siteName = 'Blacksite'
export const defaultSiteUrl = 'https://blacksite-sable.vercel.app'
export const themeColor = '#0c0e0b'
export const headline = 'Skills and building blocks for game-dev agents'
export const imageSize = { width: 1200, height: 630 }

export type PageMeta = { route: string; title: string; description: string; image: string; imageAlt: string; type: 'website' | 'article' }

const toolDescriptions: Record<string, string> = {
  characters: 'A three.js port of ALS Refactored: a player body that walks, sprints, mantles, rolls, ragdolls and aims in first or third person.',
  world: 'Open country from the grass at your feet to mountains at the horizon: terrain, grass, forests, one wind field and a physically based sky. Walk the Valley.',
  destruction: 'Cascade: concrete buildings that crack, lose their supports and fall, with the physics in a web worker. Call an air strike in the demo.',
  weapons: 'Armory: rigged first-person arms with a rifle and a pistol. Fire, reload, aim and recoil, with hits the server can check. Try the firing range.',
  multiplayer: 'Relay: rooms where each player moves their own body, the server checks hits, and remote players run the full character animation.',
  ai: 'Warden: enemy squads that pick cover, flank and coordinate, in a deterministic simulation that can replay every fight. Watch a squad fight.',
  input: 'One input layer for keyboard, mouse, gamepad and touch, bound to named actions, plus menus, pause and settings that work with a controller.',
}

const guideDescriptions: Record<string, string> = {
  als: 'How a game uses the ALS Web character: who owns state, movement and animation, the frame order, units and axes, with recipes for common jobs.',
  'player-templates': 'The fpp, tpp, mp and blank starting points for a new Blacksite game, what each one sets up, and how far along each one is.',
  cascade: 'How Cascade works: bond graphs, stress solvers, fracture, the physics worker and renderer, plus walk mode inside a destructible building.',
  arms: 'How the first-person arms work: the ALS skeleton masked to arms, the rifle and pistol upper-body graph, and the fire, reload and equip clips.',
  warden: 'How to add Warden squad AI to a game: the packages to install, wiring it into a React Three Fiber scene, and running it in a worker.',
  input: 'The Blacksite input package: one runtime for keyboard, mouse, touch and gamepads, with action contexts for menus, modals and gameplay.',
  ui: 'The Blacksite UI package: shadcn and Base UI components with the neutral tokens, and console-style screens that work with a controller.',
}

export const pages: PageMeta[] = [
  { route: '', title: `${siteName} — ${headline}`, description: 'Skills and building blocks for game-dev agents. Your coding agent designs a web game with you, prototypes the risky parts and keeps it at 120 fps.', image: 'og/home.jpg', imageAlt: `${siteName}: ${headline}`, type: 'website' },
  { route: 'get-started', title: `Get started — ${siteName}`, description: 'Install Blacksite, open Claude Code, Codex or Cursor and describe a game. The agent sizes it, builds what shipped games have and checks it.', image: 'og/get-started.jpg', imageAlt: `Get started with ${siteName}`, type: 'article' },
  { route: 'skills', title: `Skills — ${siteName}`, description: 'The Blacksite skill and its references: how a coding agent builds the version of a game feature that shipped games built, and checks it like a critic.', image: 'og/skills.jpg', imageAlt: `${siteName} skills`, type: 'article' },
  { route: 'roadmap', title: `Roadmap — ${siteName}`, description: 'What works in Blacksite today, what is in progress and what comes next for its game-dev skills and building blocks.', image: 'og/roadmap.jpg', imageAlt: `${siteName} roadmap`, type: 'article' },
  ...tools.map((tool): PageMeta => ({ route: `tools/${tool.slug}`, title: `${tool.name} — ${siteName}`, description: toolDescriptions[tool.slug] ?? tool.tagline, image: `og/${tool.slug}.jpg`, imageAlt: `${siteName} ${tool.name}: ${tool.tagline}`, type: 'article' })),
  ...docList.filter(doc => doc.slug !== 'roadmap').map((doc): PageMeta => ({ route: `guides/${doc.slug}`, title: `${doc.title} — ${siteName}`, description: guideDescriptions[doc.slug] ?? doc.title, image: doc.tool ? `og/${doc.tool}.jpg` : 'og/home.jpg', imageAlt: `${siteName} ${doc.title}`, type: 'article' })),
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
