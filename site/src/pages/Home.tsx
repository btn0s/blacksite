import { featured, installLine, repo, tools } from '../content'
import { CopyLine } from '../components'
import { asset, link } from '../links'
import { headline } from '../seo'
import { showcases } from '../showcases/registry'

export function Home() {
  const games = featured.flatMap(entry => { const showcase = showcases.find(item => item.id === entry.showcase); return showcase ? [{ ...entry, ...showcase }] : [] })
  return <>
    <section className="hero">
      <div className="hero-copy">
        <h1>{headline}.</h1>
        <p className="hero-line">Describe a game to Claude Code, Codex or Cursor. The agent plans it with you, builds it from tested parts, and checks on desktop and phone that no frame takes longer than 33 ms before it sends you a link to play.</p>
        <div className="hero-install">
          <CopyLine code={installLine} />
          <a className="hero-alt" href={`${repo}/blob/main/install.ps1`}>On Windows, use install.ps1</a>
        </div>
        <p className="hero-links"><a className="hero-start" href={link('get-started')}>Get started →</a><a className="hero-quiet" href={link('skills')}>How it works →</a></p>
      </div>
    </section>

    <section className="section" id="games" aria-labelledby="games-title">
      <h2 className="section-title" id="games-title">Example games</h2>
      <p className="section-lede">Each one is built only on Blacksite’s public packages, the same way your game would be. They run in this browser; pick one to play it.</p>
      <div className="demos">
        {games.map(game => <a key={game.id} className="demo-tile" href={`${link(`tools/${game.tool}`)}#${game.id}`}>
          {game.thumbnail && <img src={asset(game.thumbnail)} alt="" width={1600} height={900} loading="lazy" />}
          <h3>{game.title}</h3>
          <p className="demo-kind">{game.kind}</p>
          <p>{game.summary}</p>
          <p className="demo-try"><span>Try:</span> {game.tryThis}</p>
        </a>)}
      </div>
    </section>

    <section className="section" aria-labelledby="blocks-title">
      <h2 className="section-title" id="blocks-title">Building blocks</h2>
      <p className="section-lede">Finished game systems the agent puts together instead of writing from scratch. Each one has a page with a demo you can play.</p>
      <div className="block-table" role="table">
        <div className="block-row block-row--head" role="row"><span role="columnheader">Block</span><span role="columnheader">What it gives your game</span></div>
        {tools.map(tool => <div className="block-row" role="row" key={tool.slug}>
          <span role="cell"><a href={link(`tools/${tool.slug}`)}>{tool.name}</a></span>
          <span role="cell">{tool.tagline}</span>
        </div>)}
      </div>
    </section>
  </>
}
