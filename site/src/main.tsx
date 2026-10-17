import { useEffect, useRef, useState } from 'react'
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

type Current = (path: string) => 'page' | undefined

const icon = (d: string) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden="true"><path d={d} /></svg>

function BlocksMenu({ current }: { current: Current }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: Event) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() } }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', outside)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', outside)
      document.removeEventListener('keydown', key)
    }
  }, [open])
  const inside = tools.some(tool => current(`tools/${tool.slug}`))
  return <div className="blocks-menu" ref={root}>
    <button ref={trigger} type="button" className={inside ? 'nav-trigger is-current' : 'nav-trigger'} aria-expanded={open} aria-controls="blocks-menu" onClick={() => setOpen(!open)}>
      Building blocks<svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" /></svg>
    </button>
    <ul id="blocks-menu" className="blocks-list" hidden={!open}>
      {tools.map(tool => <li key={tool.slug}><a aria-current={current(`tools/${tool.slug}`)} href={link(`tools/${tool.slug}`)} onClick={() => setOpen(false)}>{tool.name}</a></li>)}
    </ul>
  </div>
}

function Nav({ route }: { route: string }) {
  const current: Current = path => route === path || route.startsWith(`${path}/`) ? 'page' : undefined
  const [open, setOpen] = useState(false)
  const toggle = useRef<HTMLButtonElement>(null), panel = useRef<HTMLElement>(null)
  useEffect(() => setOpen(false), [route])
  useEffect(() => {
    const wide = matchMedia('(min-width: 861px)')
    const close = () => { if (wide.matches) setOpen(false) }
    wide.addEventListener('change', close)
    return () => wide.removeEventListener('change', close)
  }, [])
  useEffect(() => {
    if (!open) return
    document.body.classList.add('menu-open')
    panel.current?.querySelector<HTMLElement>('a[href]')?.focus()
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); toggle.current?.focus(); return }
      if (event.key !== 'Tab' || !panel.current || !toggle.current) return
      const items = [toggle.current, ...panel.current.querySelectorAll<HTMLElement>('a[href]')]
      const first = items[0]!, last = items[items.length - 1]!, at = document.activeElement as HTMLElement
      if (!items.includes(at)) { event.preventDefault(); first.focus() }
      else if (event.shiftKey && at === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && at === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); document.body.classList.remove('menu-open') }
  }, [open])
  return <header className="topbar">
    <a className="brand" href={base} aria-label="Blacksite home"><span className="brand-mark" aria-hidden="true" /><span>Blacksite</span></a>
    <nav className="nav-desktop" aria-label="Main">
      <div className="nav-group">
        <BlocksMenu current={current} />
        <a aria-current={current('skills')} href={link('skills')}>How it works</a>
        <a aria-current={current('get-started')} href={link('get-started')}>Get started</a>
      </div>
      <div className="nav-group">
        <a aria-current={current('roadmap')} href={link('roadmap')}>Roadmap</a>
        <a href={repo} className="nav-external">GitHub</a>
      </div>
    </nav>
    <button ref={toggle} className="menu-button" type="button" aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open} aria-controls="site-menu" onClick={() => setOpen(!open)}>
      {open ? icon('M6 6l12 12M18 6 6 18') : icon('M4 7h16M4 12h16M4 17h16')}
    </button>
    <nav id="site-menu" ref={panel} className={open ? 'menu-panel open' : 'menu-panel'} aria-label="Menu" onClick={event => { if ((event.target as HTMLElement).closest('a')) setOpen(false) }}>
      <a aria-current={current('skills')} href={link('skills')}>How it works</a>
      <a className="menu-start" aria-current={current('get-started')} href={link('get-started')}>Get started</a>
      <p className="menu-label" id="menu-blocks">Building blocks</p>
      <ul className="menu-blocks" aria-labelledby="menu-blocks">
        {tools.map(tool => <li key={tool.slug}><a aria-current={current(`tools/${tool.slug}`)} href={link(`tools/${tool.slug}`)}>{tool.name}</a></li>)}
      </ul>
      <div className="menu-foot">
        <a aria-current={current('roadmap')} href={link('roadmap')}>Roadmap</a>
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
