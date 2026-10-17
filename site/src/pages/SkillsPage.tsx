import { Fragment } from 'react'
import { limits } from '../content'
import { Inline } from '../components'
import { githubUrl, linkFor } from '../docs'
import { asset, base, link } from '../links'
import { showcases } from '../showcases/registry'
import { blockLinks, checkOutput, exampleGames, instincts, referenceGroups, references } from '../skills'

export function SkillsPage() {
  const byName = new Map(references.map(reference => [reference.name, reference]))
  const games = exampleGames.flatMap(id => showcases.filter(showcase => showcase.id === id))
  return <div className="page how">
    <header className="tool-head">
      <h1 className="page-title">How it works</h1>
      <p className="lede">Coding agents can write a game’s code, but they don’t have a game developer’s instincts. Blacksite gives your agent four things.</p>
    </header>

    <section className="section section--first" aria-labelledby="instincts-title">
      <h2 className="section-title" id="instincts-title">Game-dev instincts</h2>
      <p className="section-body">Your agent learns how shipped games handle the details players notice:</p>
      <ul className="limits instincts">{instincts.map(line => <li key={line}>{line}</li>)}</ul>
      <details className="refs">
        <summary>All guides</summary>
        {referenceGroups.map(group => <div className="ref-group" key={group.title}>
          <h3>{group.title}</h3>
          <div className="skill-table" role="table">
            {group.names.map(name => byName.get(name)).filter(reference => reference !== undefined).map(reference => <div className="skill-row" role="row" key={reference.name}>
              <span role="cell">{reference.title}</span>
              <span role="cell"><Inline text={reference.summary} /></span>
              <span role="cell"><a href={githubUrl(reference.path)}><code>{reference.name}.md</code></a></span>
            </div>)}
          </div>
        </div>)}
      </details>
    </section>

    <section className="section" aria-labelledby="blocks-title">
      <h2 className="section-title" id="blocks-title">Building blocks</h2>
      <p className="section-body">Finished systems for the parts that are hardest to get right: {blockLinks.map((block, index) => <Fragment key={block.tool}>{index > 0 && (index === blockLinks.length - 1 ? ' and ' : ', ')}<a href={link(`tools/${block.tool}`)}>{block.label}</a></Fragment>)}. <a href={linkFor(base, 'docs/player-templates.md')}>Starter templates</a> and a library of <a href={linkFor(base, 'assets/README.md')}>free assets</a> come with them.</p>
    </section>

    <section className="section" aria-labelledby="games-title">
      <h2 className="section-title" id="games-title">Example games</h2>
      <p className="section-body">Breach, Traverse and Valley are built only from these blocks. Your agent starts from the closest one.</p>
      <div className="game-thumbs">
        {games.map(game => <a key={game.id} href={`${link(`tools/${game.tool}`)}#${game.id}`}>
          {game.thumbnail && <img src={asset(game.thumbnail)} alt="" width={1600} height={900} />}
          <span>{game.title}</span>
        </a>)}
      </div>
    </section>

    <section className="section" aria-labelledby="checks-title">
      <h2 className="section-title" id="checks-title">Checks</h2>
      <p className="section-body">Your agent can’t watch or listen to its game, so <code>blacksite check</code> plays it on desktop and phone and reports what’s wrong: dropped frames, slow loading, flickering surfaces, sounds that repeat. The agent fixes them before you play.</p>
      <pre className="check-output"><code>{checkOutput}</code></pre>
      <p className="caption">From a real check of Breach’s production build, trimmed to one line per check.</p>
    </section>

    <section className="section" aria-labelledby="limits-title">
      <h2 className="section-title" id="limits-title">Limits</h2>
      <ul className="limits">{limits.map(limit => <li key={limit}>{limit}</li>)}</ul>
    </section>
  </div>
}
