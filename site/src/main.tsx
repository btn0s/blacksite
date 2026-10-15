import { Suspense, lazy, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { demoById, demos } from './registry'
import { docBySlug, docs } from './docs'
import './site.css'

const base = import.meta.env.BASE_URL
const link = (path: string) => `${base}${path}`

function Markdown({ slug }: { slug: string }) {
  const doc = docBySlug(slug)
  if (!doc) return <p>Document not found.</p>
  const Content = lazy(doc.load)
  return <article className="markdown"><Suspense fallback={<p>Loading document…</p>}><Content components={{ a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
    const name = href?.split('/').pop()?.replace(/\.md(#.*)?$/, '').toLowerCase()
    const mapped = name === 'readme' ? 'readme' : name === 'roadmap' ? 'roadmap' : name === 'migration-blacksite' ? 'migration' : name
    return <a href={mapped && docBySlug(mapped) ? link(`docs/${mapped}`) : href}>{children}</a>
  } }} /></Suspense></article>
}

function DemoPage({ id }: { id: string }) {
  const demo = demoById(id)
  if (!demo) return <p>Demo not found.</p>
  const Scene = lazy(demo.loader)
  return <><div className="page-heading"><div><span className="eyebrow">LIVE DEMO · {demo.static ? 'STATIC' : 'LOCAL'}</span><h1>{demo.title}</h1><p>{demo.description}</p></div></div>
    {demo.static || import.meta.env.DEV ? <Suspense fallback={<div className="demo-placeholder">Loading scene…</div>}><Scene demo={demo} /></Suspense> : <div className="demo-placeholder"><h2>Run locally</h2><p>This demo needs the Blacksite server. Run <code>pnpm dev:site</code> and open this route locally.</p></div>}
    <h2 className="section-title">Documentation</h2><Markdown slug={demo.doc} /></>
}

function Home() {
  return <><div className="hero"><span className="eyebrow">BROWSER GAME ENGINE</span><h1>Blacksite Engine</h1><p>Build high-quality, high-performance desktop and mobile browser games with agents. Blacksite provides player control, combat, tactical AI, destruction, and a checkable game-making workflow.</p><code>curl -fsSL https://raw.githubusercontent.com/btn0s/blacksite/main/install.sh | sh</code><div className="hero-links"><a href={link('demos/cascade')}>Explore demos →</a><a href={link('docs/readme')}>Read the docs →</a></div></div><h2 className="section-title">Demos</h2><div className="cards">{demos.map(demo => <a className="card" key={demo.id} href={link(`demos/${demo.id}`)}><span className="eyebrow">{demo.static ? 'BROWSER' : 'LOCAL'}</span><strong>{demo.title}</strong><p>{demo.description}</p></a>)}</div></>
}

function App() {
  const [path, setPath] = useState(location.pathname)
  useEffect(() => { const update = () => setPath(location.pathname); addEventListener('popstate', update); return () => removeEventListener('popstate', update) }, [])
  const route = path.startsWith(base) ? path.slice(base.length) : ''
  return <div className="layout"><aside className="sidebar"><a className="brand" href={base}><span className="brand-mark">B</span><span>BLACKSITE<small>ENGINE</small></span></a><nav><a href={base}>Overview</a><span className="nav-label">DEMOS</span>{demos.map(demo => <a key={demo.id} href={link(`demos/${demo.id}`)}>{demo.title}</a>)}<span className="nav-label">DOCS</span>{docs.map(doc => <a key={doc.slug} href={link(`docs/${doc.slug}`)}>{doc.title}</a>)}</nav></aside><main className="content">{route.startsWith('demos/') ? <DemoPage id={route.slice(6).split('/')[0]!} /> : route.startsWith('docs/') ? <><div className="page-heading"><span className="eyebrow">DOCUMENTATION</span><h1>{docBySlug(route.slice(5).split('/')[0]!)?.title ?? 'Document'}</h1></div><Markdown slug={route.slice(5).split('/')[0]!} /></> : <Home />}</main></div>
}

createRoot(document.getElementById('root')!).render(<App />)
