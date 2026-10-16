import { lazy, Suspense } from 'react'
import { tools, type Tool, type ShowcaseDemo } from '../content'
import { linkFor } from '../docs'
import { CopyLine, Keys, StatusChip } from '../components'
import { base, link } from '../links'

const DemoFrame = lazy(() => import('../DemoFrame'))

function Controls({ demo }: { demo: ShowcaseDemo }) {
  if (!demo.keyboard.length && !demo.touch.length) return null
  return <div className="controls">
    {demo.keyboard.length > 0 && <div><h4>Keyboard and mouse</h4><dl>{demo.keyboard.map(control => <div key={control.action}><dt><Keys keys={control.keys} /></dt><dd>{control.action}</dd></div>)}</dl></div>}
    {demo.touch.length > 0 && <div><h4>Touch</h4><dl>{demo.touch.map(control => <div key={control.action}><dt><Keys keys={control.keys} /></dt><dd>{control.action}</dd></div>)}</dl></div>}
  </div>
}

function Demo({ tool, demo, first }: { tool: Tool; demo: ShowcaseDemo; first: boolean }) {
  return <article className="showcase" id={demo.id}>
    {demo.live && demo.frame
      ? <Suspense fallback={<div className="stage stage--loading" />}><DemoFrame frame={demo.frame} title={demo.title} poster={tool.thumbnail} autoplay={first} /></Suspense>
      : <div className="stage stage--soon"><div><p className="eyebrow">Next up</p><h3>{demo.title}</h3><p>{demo.summary}</p></div></div>}
    <div className="showcase-info">
      <div className="showcase-about">
        <h3>{demo.title}</h3>
        <p>{demo.summary}</p>
        {demo.tryThis.length > 0 && <ul className="try">{demo.tryThis.map(item => <li key={item}>{item}</li>)}</ul>}
      </div>
      <Controls demo={demo} />
    </div>
  </article>
}

export function ToolPage({ tool }: { tool: Tool }) {
  const index = tools.indexOf(tool)
  const next = tools[(index + 1) % tools.length]!
  return <div className="page tool-page">
    <header className="tool-head">
      <p className="eyebrow"><a href={`${base}#blocks`}>Building blocks</a> / {tool.name}</p>
      <div className="tool-title"><h1 className="page-title">{tool.name}{tool.codename && <span className="codename"> ({tool.codename})</span>}</h1><StatusChip status={tool.status} /></div>
      <p className="lede">{tool.pitch}</p>
    </header>

    {tool.demos.length > 0
      ? tool.demos.map((demo, demoIndex) => <Demo key={demo.id} tool={tool} demo={demo} first={demoIndex === 0} />)
      : <div className="stage stage--soon"><div><p className="eyebrow">Demo coming</p><h3>{tool.name}</h3><p>{tool.tagline}</p></div></div>}

    <div className="tool-grid">
      <section className="panel panel--wide">
        <p className="eyebrow">How an agent uses it</p>
        <p>{tool.agent.note}</p>
        <p className="reads">It reads {tool.agent.reads.map((read, readIndex) => <span key={read.path}>{readIndex > 0 && (readIndex === tool.agent.reads.length - 1 ? ' and ' : ', ')}<a href={linkFor(base, read.path)}>{read.label}</a></span>)}.</p>
        {tool.agent.commands.map(command => <CopyLine key={command.code} label={command.label} code={command.code} />)}
        <p className="packages">Packages: {tool.packages.map(name => <code key={name}>{name}</code>)}</p>
      </section>
      <section className="panel">
        <p className="eyebrow">Status</p>
        <p className="status-line"><StatusChip status={tool.status} /></p>
        <p>{tool.statusNote}</p>
      </section>
      <section className="panel">
        <p className="eyebrow">Guides</p>
        <ul className="guide-list">{tool.guides.map(guide => <li key={guide.path}><a href={linkFor(base, guide.path)}>{guide.label}</a></li>)}</ul>
      </section>
    </div>

    <a className="next-tool" href={link(`tools/${next.slug}`)}><span className="eyebrow">Next building block</span><strong>{next.name}{next.codename && <span className="codename"> ({next.codename})</span>}</strong></a>
  </div>
}
