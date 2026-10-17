import { lazy, Suspense, useEffect } from 'react'
import { tools, type Tool } from '../content'
import { linkFor } from '../docs'
import { CopyLine, Inline } from '../components'
import { base, link } from '../links'
import { showcasesFor } from '../showcases/registry'

const DemoFrame = lazy(() => import('../DemoFrame'))

export function ToolPage({ tool }: { tool: Tool }) {
  const index = tools.indexOf(tool)
  const next = tools[(index + 1) % tools.length]!
  const registered = showcasesFor(tool.slug)
  const demos = registered.length ? registered : tool.demos.flatMap(demo => demo.live && demo.frame ? [{ ...demo, frame: demo.frame }] : [])
  const guide = tool.guides[0]
  const command = tool.agent.commands[0]
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1))
    if (id) document.getElementById(id)?.scrollIntoView()
  }, [tool])
  return <div className="tool-page">
    <header className="tool-line">
      <h1>{tool.name}</h1>
      <p>{tool.tagline}</p>
    </header>

    {demos.map(demo => <section className="showcase" id={demo.id} key={demo.id} aria-labelledby={`${demo.id}-title`}>
      <div className="showcase-head">
        <h2 className="demo-name" id={`${demo.id}-title`}>{demo.title}</h2>
        <p>{demo.summary}</p>
        {demo.tryThis && <p className="demo-try"><span>Try:</span> {demo.tryThis}</p>}
      </div>
      <Suspense fallback={<div className="stage stage--loading" />}><DemoFrame demo={demo} autoplay={demos.length === 1} /></Suspense>
    </section>)}

    {demos.length === 0 && <p className="soon">Demo coming.</p>}

    <section className="tool-notes" aria-labelledby="use-title">
      <h2 className="demo-name" id="use-title">Use it in your game</h2>
      <p><Inline text={tool.agent.note} /></p>
      {command && <div className="tool-command"><p className="tool-command-label">{command.label}</p><CopyLine code={command.code} /></div>}
      <p className="tool-packages">Packages: {tool.packages.map((name, position) => <span key={name}>{position > 0 && ', '}<code>{name}</code></span>)}</p>
      <p className="tool-status"><strong>Status:</strong> {tool.statusNote}</p>
      <p className="tool-links">{guide && <a href={linkFor(base, guide.path)}>{guide.label} →</a>}<a href={link(`tools/${next.slug}`)}>Next: {next.name} →</a></p>
    </section>
  </div>
}
