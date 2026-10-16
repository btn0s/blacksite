import { extras } from '../content'
import { githubUrl, linkFor } from '../docs'
import { base } from '../links'
import { invocationLabel, skills } from '../skills'

const flowNames = ['start', 'make-game', 'design-game', 'setup-project', 'build-prototype', 'combine-prototypes', 'optimize-game', 'ship-game']

export function SkillsPage() {
  const phases = skills.filter(skill => skill.invocation !== 'reference')
  const references = skills.filter(skill => skill.invocation === 'reference')
  return <div className="page">
    <header className="tool-head">
      <h1 className="page-title">Skills walk the agent from an idea to a game</h1>
      <p className="lede">A skill is a set of instructions your coding agent loads when the task calls for it. You start one with a slash command, and the agent loads the rest as the game moves along. Each one ends with a check the agent has to pass.</p>
    </header>

    <ol className="skill-flow" aria-label="The skill flow">
      {flowNames.map(name => <li key={name} className={name === 'ship-game' ? 'optional' : undefined}><code>{name}</code>{name === 'ship-game' && <span>only when you ask</span>}</li>)}
    </ol>

    <section className="section">
      <h2 className="section-title">One skill per phase</h2>
      <div className="skill-table" role="table">
        {phases.map(skill => <div className="skill-row" role="row" key={skill.name}>
          <span role="cell"><a href={githubUrl(skill.path)}><code>{skill.name}</code></a>{skill.argument && <small> {skill.argument}</small>}</span>
          <span role="cell">{skill.summary}</span>
          <span role="cell"><span className={`invoke invoke--${skill.invocation}`}>{invocationLabel[skill.invocation]}</span></span>
        </div>)}
      </div>
    </section>

    <section className="section">
      <h2 className="section-title">Guides the agent loads when it needs them</h2>
      <div className="skill-table" role="table">
        {references.map(skill => <div className="skill-row" role="row" key={skill.name}>
          <span role="cell"><a href={githubUrl(skill.path)}><code>{skill.name}</code></a></span>
          <span role="cell">{skill.summary}</span>
        </div>)}
      </div>
      <p className="section-note"><strong>You run it</strong> means only you can start it, with a slash command. <strong>The agent runs it</strong> means the agent loads it when the work calls for it, and you can still start it yourself. Each building block also has its own guide, linked from its page.</p>
    </section>

    <section className="section">
      <h2 className="section-title">Also included</h2>
      {extras.map(extra => <p className="extra" key={extra.name}><a href={linkFor(base, extra.path)}>{extra.name}</a>. {extra.text}</p>)}
    </section>
  </div>
}
