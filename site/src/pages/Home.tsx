import { installLine, repo, tools } from '../content'
import { CopyLine } from '../components'
import { asset, link } from '../links'
import { showcasesFor } from '../showcases/registry'

export function Home() {
  const demos = tools.flatMap(tool => { const thumbnail = showcasesFor(tool.slug).find(showcase => showcase.thumbnail)?.thumbnail; return thumbnail ? [{ tool, thumbnail }] : [] })
  return <>
    <section className="hero">
      <div className="hero-art" style={{ backgroundImage: `url(${asset('thumbs/hero.webp')})` }} aria-hidden="true" />
      <div className="hero-copy">
        <h1>Skills and building blocks for game{'‑'}dev agents.</h1>
        <p className="hero-line">Your coding agent designs the game with you, prototypes the risky parts, and keeps it at 120 fps.</p>
        <div className="hero-install">
          <CopyLine code={installLine} />
          <a className="hero-alt" href={`${repo}/blob/main/install.ps1`}>Windows</a>
        </div>
        <a className="hero-start" href={link('get-started')}>Get started →</a>
      </div>
    </section>

    {demos.length > 0 && <section className="demos" id="demos" aria-label="Demos">
      {demos.map(({ tool, thumbnail }) => <a key={tool.slug} className="demo-tile" href={link(`tools/${tool.slug}`)}>
        <img src={asset(thumbnail)} alt="" width={1600} height={900} />
        <h2>{tool.name}</h2>
        <p>{tool.tagline}</p>
      </a>)}
    </section>}
  </>
}
