import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import './site.css'
import { repo, resolveLegacy, toolBySlug, tools } from './content'
import { docBySlug } from './docs'
import { Home } from './pages/Home'
import { ToolPage } from './pages/ToolPage'
import { SkillsPage } from './pages/SkillsPage'
import { GuidePage } from './pages/GuidePage'
import { GetStartedPage } from './pages/GetStartedPage'
import { base, link } from './links'
import { applyMeta, metaFor, pages, siteName } from './seo'

function currentRoute() {
  const path = location.pathname
  return (path.startsWith(base) ? path.slice(base.length) : path.replace(/^\//, '')).replace(/\/+$/, '')
}

function useRoute() {
  const [route, setRoute] = useState(currentRoute)
  useEffect(() => {
    const update = () => setRoute(currentRoute())
    addEventListener('popstate', update)
    return () => removeEventListener('popstate', update)
  }, [])
  useEffect(() => {
    const target = resolveLegacy(route)
    if (target !== null) { history.replaceState(null, '', link(target)); setRoute(target) }
  }, [route])
  return route
}

function NotFound() {
  return <section className="page narrow"><h1 className="page-title">Nothing here</h1><p className="lede">That page moved or never existed. <a href={base}>Back to the start</a>.</p></section>
}

function Page({ route }: { route: string }) {
  const [section, slug] = route.split('/')
  if (!route) return <Home />
  if (section === 'tools' && slug && toolBySlug(slug)) return <ToolPage tool={toolBySlug(slug)!} />
  if (section === 'get-started' && !slug) return <GetStartedPage />
  if (section === 'skills' && !slug) return <SkillsPage />
  if (section === 'roadmap' && !slug) return <GuidePage doc={docBySlug('roadmap')!} />
  if (section === 'guides' && slug && docBySlug(slug)) return <GuidePage doc={docBySlug(slug)!} />
  return <NotFound />
}

function Nav({ route }: { route: string }) {
  const active = (path: string) => route === path || route.startsWith(`${path}/`) ? 'active' : undefined
  const [open, setOpen] = useState(false)
  useEffect(() => setOpen(false), [route])
  return <header className="topbar">
    <a className="brand" href={base} aria-label="Blacksite home"><span className="brand-mark" aria-hidden="true" /><span>Blacksite</span></a>
    <button className="menu-button" type="button" aria-expanded={open} aria-controls="site-nav" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Menu'}</button>
    <nav id="site-nav" className={open ? 'open' : undefined}>
      <div className="nav-group">{tools.map(tool => <a key={tool.slug} className={active(`tools/${tool.slug}`)} href={link(`tools/${tool.slug}`)}>{tool.name}</a>)}</div>
      <div className="nav-group nav-group--secondary">
        <a className={active('get-started')} href={link('get-started')}>Get started</a>
        <a className={active('skills')} href={link('skills')}>How it works</a>
        <a className={active('roadmap')} href={link('roadmap')}>Roadmap</a>
        <a href={repo} className="nav-external">GitHub</a>
      </div>
    </nav>
  </header>
}

function Footer() {
  return <footer className="footer">Blacksite · <a href={`${repo}/blob/main/LICENSE.md`}>FSL</a>, Apache-2.0 after two years · <a href={`${repo}/blob/main/site/public/CREDITS.md`}>Credits</a> · <a href={repo}>GitHub</a></footer>
}

function App() {
  const route = useRoute()
  useEffect(() => {
    applyMeta(metaFor(route) ?? { ...pages[0]!, route, title: `Nothing here — ${siteName}` })
    if (!location.hash) window.scrollTo(0, 0)
  }, [route])
  return <div className="shell"><Nav route={route} /><main className="main"><Page route={route} /></main><Footer /></div>
}

createRoot(document.getElementById('root')!).render(<App />)
