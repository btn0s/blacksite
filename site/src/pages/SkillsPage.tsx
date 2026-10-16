import { extras } from '../content'
import { githubUrl, linkFor } from '../docs'
import { base } from '../links'
import { invocationLabel, referenceGroups, references, skills, workflow } from '../skills'

export function SkillsPage() {
  const byName = new Map(references.map(reference => [reference.name, reference]))
  return <div className="page">
    <header className="tool-head">
      <h1 className="page-title">One skill builds the version shipped games built</h1>
      <p className="lede">Blacksite is one skill. Your coding agent loads it for anything game-related, even if you never mention Blacksite. It sizes the work, writes down the real numbers, lists the parts a shipped game would have, builds them and checks the result the way a critic would. It reads the references below when the work calls for them.</p>
    </header>

    <ol className="skill-flow" aria-label="The workflow">
      {workflow.map(step => <li key={step} className={step === 'Ship' ? 'optional' : undefined}><code>{step}</code>{step === 'Ship' && <span>only when you ask</span>}</li>)}
    </ol>

    <section className="section">
      <h2 className="section-title">The skill</h2>
      <div className="skill-table" role="table">
        {skills.map(skill => <div className="skill-row" role="row" key={skill.name}>
          <span role="cell"><a href={githubUrl(skill.path)}><code>{skill.name}</code></a>{skill.argument && <small> {skill.argument}</small>}</span>
          <span role="cell">{skill.summary}</span>
          <span role="cell"><span className={`invoke invoke--${skill.invocation}`}>{invocationLabel[skill.invocation]}</span></span>
        </div>)}
      </div>
    </section>

    {referenceGroups.map(group => <section className="section" key={group.title}>
      <h2 className="section-title">{group.title}</h2>
      <div className="skill-table" role="table">
        {group.names.map(name => byName.get(name)).filter(reference => reference !== undefined).map(reference => <div className="skill-row" role="row" key={reference.name}>
          <span role="cell"><a href={githubUrl(reference.path)}><code>{reference.name}</code></a></span>
          <span role="cell">{reference.summary}</span>
        </div>)}
      </div>
    </section>)}

    <section className="section">
      <p className="section-note"><strong>You or the agent</strong> means the agent loads the skill whenever the work is about a game, and you can also start it yourself with an idea. Each building block also has its own guide, linked from its page.</p>
    </section>

    <section className="section">
      <h2 className="section-title">Also included</h2>
      {extras.map(extra => <p className="extra" key={extra.name}><a href={linkFor(base, extra.path)}>{extra.name}</a>. {extra.text}</p>)}
    </section>
  </div>
}
