import { installLine, tools } from '../content'
import { CopyLine } from '../components'
import { asset, link } from '../links'
import { showcasesFor } from '../showcases/registry'

const steps = ['design', 'set up', 'prototype', 'combine', 'optimise', 'ship']

export function Home() {
  const live = tools.flatMap(tool => { const thumbnail = showcasesFor(tool.slug).find(showcase => showcase.thumbnail)?.thumbnail; return thumbnail ? [{ tool, thumbnail }] : [] })
  const coming = tools.filter(tool => !live.some(entry => entry.tool === tool))
  return <>
    <section className="hero">
      <div className="hero-art" style={{ backgroundImage: `url(${asset('thumbs/hero.webp')})` }} aria-hidden="true" />
      <div className="hero-copy">
        <h1>Skills and building blocks for game‑dev agents.</h1>
        <p className="lede">Your coding agent gets the skills and the finished systems to build real games: characters, destruction, multiplayer and squads, at 120 fps on desktop and 60 on phones.</p>
        <CopyLine code={installLine} />
        <a className="button button--primary" href={link(`tools/${live[0]?.tool.slug ?? 'characters'}`)}>Play the demos</a>
      </div>
    </section>

    <section className="section">
      <div className="block-grid">
        {live.map(({ tool, thumbnail }) => <a key={tool.slug} className="block-card" href={link(`tools/${tool.slug}`)}>
          <img src={asset(thumbnail)} alt="" loading="lazy" />
          <h3>{tool.name}</h3>
        </a>)}
      </div>
      {coming.length > 0 && <p className="quiet">Also: {coming.map(tool => tool.name).join(', ')}. Demos coming.</p>}
    </section>

    <section className="section">
      <h2 className="section-title">How an agent builds a game</h2>
      <p className="prompt-line"><code>/blacksite:make-game a stealth game in an abandoned factory, third person</code></p>
      <p className="steps">{steps.join(' → ')}. <a href={link('skills')}>The skills →</a></p>
    </section>
  </>
}
