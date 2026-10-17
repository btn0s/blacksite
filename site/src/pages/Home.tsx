import { featured, installLine, repo, tools } from '../content'
import { CopyLine } from '../components'
import { asset, link } from '../links'
import { headline, subhead } from '../seo'
import { showcases } from '../showcases/registry'

export function Home() {
  const games = featured.flatMap(entry => { const showcase = showcases.find(item => item.id === entry.showcase); return showcase ? [{ ...entry, ...showcase }] : [] })
  return <>
    <section className="hero">
      <div className="hero-copy">
        <h1>{headline}.</h1>
        <p className="hero-line">{subhead}</p>
        <div className="hero-install">
          <CopyLine code={installLine} />
          <a className="hero-alt" href={`${repo}/blob/main/install.ps1`}>On Windows, use install.ps1</a>
        </div>
        <p className="hero-links"><a className="hero-start" href={link('get-started')}>Get started →</a><a className="hero-quiet" href={link('skills')}>How it works →</a></p>
      </div>
    </section>

    <section className="section" id="games" aria-labelledby="games-title">
      <h2 className="section-title" id="games-title">Example games</h2>
      <div className="demos">
        {games.map(game => <a key={game.id} className="demo-tile" href={`${link(`tools/${game.tool}`)}#${game.id}`}>
          {game.thumbnail && <img src={asset(game.thumbnail)} alt="" width={1600} height={900} loading="lazy" />}
          <h3>{game.title}</h3>
          <p className="caption">{game.kind}</p>
          <p>{game.summary}</p>
        </a>)}
      </div>
    </section>

    <section className="section" aria-labelledby="blocks-title">
      <h2 className="section-title" id="blocks-title">Building blocks</h2>
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
