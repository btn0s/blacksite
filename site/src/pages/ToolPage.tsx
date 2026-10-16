import { lazy, Suspense } from 'react'
import { tools, type Tool } from '../content'
import { linkFor } from '../docs'
import { CopyLine } from '../components'
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
  return <div className="tool-page">
    <header className="tool-line">
      <h1>{tool.name}</h1>
      <p>{tool.tagline}</p>
    </header>

    {demos.map((demo, demoIndex) => <section className="showcase" id={demo.id} key={demo.id}>
      {demos.length > 1 && <h2 className="demo-name">{demo.title}</h2>}
      <Suspense fallback={<div className="stage stage--loading" />}><DemoFrame demo={demo} autoplay={demoIndex === 0} /></Suspense>
    </section>)}

    <section className="tool-notes">
      {demos.length === 0 && <p className="soon">Demo coming.</p>}
      <p>{tool.status !== 'Usable' && <strong>{tool.status}. </strong>}{tool.agent.note}</p>
      {command && <CopyLine code={command.code} />}
      <p className="tool-links">{guide && <a href={linkFor(base, guide.path)}>Agent guide →</a>}<a href={link(`tools/${next.slug}`)}>Next: {next.name} →</a></p>
    </section>
  </div>
}
