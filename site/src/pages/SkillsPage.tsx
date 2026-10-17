import { limits, parts } from '../content'
import { Inline } from '../components'
import { githubUrl, linkFor } from '../docs'
import { base } from '../links'
import { examples, referenceGroups, references, steps } from '../skills'

export function SkillsPage() {
  const byName = new Map(references.map(reference => [reference.name, reference]))
  return <div className="page how">
    <header className="tool-head">
      <h1 className="page-title">How it works</h1>
      <p className="lede">Blacksite is one skill your coding agent reads, plus {references.length} reference files it opens when the work needs them. Ask for a game, a level or a mechanic and the agent uses it on its own, even if you never say Blacksite.</p>
    </header>

    <section className="section section--first" aria-labelledby="steps-title">
      <h2 className="section-title" id="steps-title">What the agent does</h2>
      <ol className="how-steps">
        {steps.map(step => <li key={step.title}><h3>{step.title}</h3><p>{step.text}</p></li>)}
      </ol>
    </section>

    <section className="section" aria-labelledby="examples-title">
      <h2 className="section-title" id="examples-title">What you ask for, and what it builds</h2>
      <p className="section-lede">A quick first attempt at a feature works, but looks and feels thin. For each feature, the skill lists what a finished version includes, with numbers.</p>
      <div className="compare-table" role="table">
        <div className="compare-row compare-row--head" role="row"><span role="columnheader">You ask for</span><span role="columnheader">A first attempt</span><span role="columnheader">What the agent builds</span></div>
        {examples.map(example => <div className="compare-row" role="row" key={example.ask}>
          <span role="cell">{example.ask}</span>
          <span role="cell">{example.quick}</span>
          <span role="cell">{example.built}</span>
        </div>)}
      </div>
    </section>

    <section className="section" aria-labelledby="parts-title">
      <h2 className="section-title" id="parts-title">What comes with it</h2>
      <ul className="parts">
        {parts.map(part => <li key={part.name}><a href={linkFor(base, part.path)}><Inline text={part.name} /></a> {part.text}</li>)}
      </ul>
    </section>

    <section className="section" aria-labelledby="knows-title">
      <h2 className="section-title" id="knows-title">What the agent knows</h2>
      <details className="refs">
        <summary>All {references.length} reference files</summary>
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

    <section className="section" aria-labelledby="limits-title">
      <h2 className="section-title" id="limits-title">Limits</h2>
      <ul className="limits">{limits.map(limit => <li key={limit}>{limit}</li>)}</ul>
    </section>
  </div>
}
