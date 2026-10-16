import { installLine, repo, tools } from '../content'
import { CopyLine } from '../components'
import { asset, link } from '../links'
import { showcasesFor } from '../showcases/registry'

const makeGame = '/blacksite:make-game a stealth game in an abandoned factory'

export function Home() {
  const bands = tools.flatMap(tool => { const thumbnail = showcasesFor(tool.slug).find(showcase => showcase.thumbnail)?.thumbnail; return thumbnail ? [{ tool, thumbnail }] : [] })
  return <>
    <section className="hero">
      <div className="hero-art" style={{ backgroundImage: `url(${asset('thumbs/hero.webp')})` }} aria-hidden="true" />
      <div className="hero-copy">
        <h1>Skills and building blocks for game{'‑'}dev agents.</h1>
        <ol className="start">
          <li><span>Install</span><CopyLine code={installLine} /><a className="start-alt" href={`${repo}/blob/main/install.ps1`}>Windows</a></li>
          <li><span>Open your agent</span><p>Claude Code, Codex or Cursor.</p></li>
          <li><span>Tell it what to make</span><CopyLine code={makeGame} prompt=">" /></li>
        </ol>
        <p className="start-note">It designs the game with you, prototypes the risky parts, and keeps it at 120 fps on desktop and 60 on phones.</p>
      </div>
      {bands.length > 0 && <a className="hero-cue" href="#demos">Demos ↓</a>}
    </section>

    <section className="bands" id="demos">
      {bands.map(({ tool, thumbnail }) => <a key={tool.slug} className="band" href={link(`tools/${tool.slug}`)}>
        <img src={asset(thumbnail)} alt="" loading="lazy" />
        <div><h2>{tool.name}</h2><p>{tool.tagline}</p></div>
      </a>)}
    </section>
  </>
}
