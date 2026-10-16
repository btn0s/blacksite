import { Suspense, lazy, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { demoById, demos } from './registry'
import { docBySlug, docs } from './docs'
import './site.css'
import movementSource from './showcases/movement.tsx?raw'
import demolitionSource from './showcases/demolition.ts?raw'

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
  return <div className="demo-page"><div className="page-heading"><div><span className="eyebrow">{demo.showcase ? 'BLACKSITE SHOWCASE' : `LIVE LAB · ${demo.static ? 'STATIC' : 'LOCAL'}`}</span><h1>{demo.title}</h1><p>{demo.description}</p></div></div>
    {demo.static || import.meta.env.DEV ? <Suspense fallback={<div className="demo-placeholder">Loading scene…</div>}><Scene demo={demo} /></Suspense> : <div className="demo-placeholder"><h2>Run locally</h2><p>This demo needs the Blacksite server. Run <code>pnpm dev:site</code> and open this route locally.</p></div>}
    {demo.showcase ? <ShowcaseDocs id={demo.id} /> : <><h2 className="section-title">Documentation</h2><Markdown slug={demo.doc} /></>}</div>
}

function excerpt(source: string, start: string, count = 34) {
  const lines = source.split('\n')
  const index = lines.findIndex(line => line.includes(start))
  return lines.slice(index, index + count).join('\n')
}

function ShowcaseDocs({ id }: { id: string }) {
  const movement = id === 'movement'
  const source = movement ? movementSource : demolitionSource
  const code = excerpt(source, movement ? 'function Scene()' : 'const manifest = createShowcaseFrame', movement ? 35 : 34)
  return <section className="showcase-docs"><span className="eyebrow">FROM SCENE SOURCE</span><h2>{movement ? 'A space made for motion' : 'A structure with real consequences'}</h2><p>{movement ? 'ALS drives the body, camera, animation and physical responses. The yard makes each movement mode visible through changes in height and cover.' : 'Cascade authors the frame, runs destruction in a worker, and presents fragments and effects. The same session accepts orbit charge placement and first-person tools.'}</p><pre><code>{code}</code></pre><p>Read the <a href={link(`docs/${movement ? 'readme' : 'cascade'}`)}>{movement ? 'Subject and ALS overview' : 'Cascade package guide'}</a>{movement ? <> and <a href={link('docs/input')}>input guide</a></> : null}. <a href={link('docs/docs-index')}>All package docs →</a></p></section>
}

function Home() {
  return <><div className="hero"><span className="eyebrow">BROWSER GAME ENGINE</span><h1>Build worlds that respond.</h1><p>Movement, destruction, combat, tactical AI, and multiplayer systems for browser games. Enter a scene and see the game facing APIs at work.</p><div className="hero-links"><a href={link('demos/movement')}>Explore showcases →</a><a href={link('docs/readme')}>Read the docs →</a></div></div><h2 className="section-title">Showcases</h2><div className="cards showcase-cards">{demos.filter(demo => demo.showcase).map((demo, index) => <a className="card showcase-card" key={demo.id} href={link(`demos/${demo.id}`)}><div className={`card-art card-art--${demo.id}`}><span>0{index + 1} / BLACKSITE</span></div><div className="card-copy"><span className="eyebrow">PLAYABLE SCENE</span><strong>{demo.title}</strong><p>{demo.description}</p><b>Enter showcase ↗</b></div></a>)}</div><h2 className="section-title">Labs</h2><p className="section-intro">Developer tools and experiments remain available for inspection.</p><div className="cards lab-cards">{demos.filter(demo => !demo.showcase).map(demo => <a className="card" key={demo.id} href={link(`demos/${demo.id}`)}><span className="eyebrow">{demo.static ? 'BROWSER' : 'LOCAL'}</span><strong>{demo.title}</strong><p>{demo.description}</p></a>)}</div></>
}

function App() {
  const [path, setPath] = useState(location.pathname)
  useEffect(() => { const update = () => setPath(location.pathname); addEventListener('popstate', update); return () => removeEventListener('popstate', update) }, [])
  const route = path.startsWith(base) ? path.slice(base.length) : ''
  return <div className="layout"><aside className="sidebar"><a className="brand" href={base}><span className="brand-mark">B</span><span>BLACKSITE<small>ENGINE</small></span></a><nav><a href={base}>Overview</a><span className="nav-label">SHOWCASES</span>{demos.filter(demo => demo.showcase).map(demo => <a key={demo.id} href={link(`demos/${demo.id}`)}>{demo.title}</a>)}<span className="nav-label">LABS</span>{demos.filter(demo => !demo.showcase).map(demo => <a key={demo.id} href={link(`demos/${demo.id}`)}>{demo.title}</a>)}<span className="nav-label">DOCS</span>{docs.map(doc => <a key={doc.slug} href={link(`docs/${doc.slug}`)}>{doc.title}</a>)}</nav></aside><main className="content">{route.startsWith('demos/') ? <DemoPage id={route.slice(6).split('/')[0]!} /> : route.startsWith('docs/') ? <><div className="page-heading"><span className="eyebrow">DOCUMENTATION</span><h1>{docBySlug(route.slice(5).split('/')[0]!)?.title ?? 'Document'}</h1></div><Markdown slug={route.slice(5).split('/')[0]!} /></> : <Home />}</main></div>
}

createRoot(document.getElementById('root')!).render(<App />)
