import { extras, flow, installLine, tools } from '../content'
import { linkFor } from '../docs'
import { CopyLine, Section, StatusChip, Thumb } from '../components'
import { asset, base, link } from '../links'
import { skills } from '../skills'

export function Home() {
  const phaseSkills = skills.filter(skill => skill.invocation !== 'reference')
  return <>
    <section className="hero">
      <div className="hero-art" style={{ backgroundImage: `url(${asset('thumbs/hero.webp')})` }} aria-hidden="true" />
      <div className="hero-copy">
        <p className="eyebrow">For Claude Code, Codex and Cursor</p>
        <h1>Skills and building blocks for game-dev agents.</h1>
        <p className="lede">A coding agent can write a game loop. What it can't do in an afternoon is a character with hundreds of animations, multiplayer that feels right, buildings that collapse or squads that flank you. Blacksite gives it the skills and the finished systems to build all of that, fast enough for 120 fps on a desktop and 60 on a phone.</p>
        <CopyLine code={installLine} label="Install" />
        <p className="hero-note">Then ask your agent to start Blacksite, or run <code>/blacksite:make-game &lt;your idea&gt;</code>.</p>
        <div className="hero-links"><a className="button button--primary" href={link('tools/characters')}>Play the demos</a><a className="button" href="#how">How it works</a></div>
      </div>
    </section>

    <section className="halves">
      <a className="half" href={link('skills')}>
        <p className="eyebrow">Half one</p>
        <h2>Skills</h2>
        <p>Walk the agent from your idea to a playable game: design it with you, set up the project, prototype each risky mechanic, combine what works, then optimise. Every building block also has a guide, so the agent uses it the right way instead of guessing.</p>
        <ul className="pill-list">{phaseSkills.map(skill => <li key={skill.name}><code>{skill.name}</code></li>)}</ul>
        <span className="more">All skills</span>
      </a>
      <a className="half" href="#blocks">
        <p className="eyebrow">Half two</p>
        <h2>Building blocks</h2>
        <p>Finished game systems the agent snaps together instead of writing from scratch: characters, weapons, multiplayer, destruction, AI, input and UI, on one stack of React Three Fiber, Rapier and Koota.</p>
        <ul className="pill-list">{tools.map(tool => <li key={tool.slug}>{tool.name}</li>)}</ul>
        <span className="more">See them running</span>
      </a>
    </section>

    <Section eyebrow="Building blocks" title="Systems your agent doesn't have to write" id="blocks">
      <div className="block-grid">
        {tools.map(tool => <a key={tool.slug} className="block-card" href={link(`tools/${tool.slug}`)}>
          <div className="block-thumb"><Thumb tool={tool} /></div>
          <div className="block-copy">
            <div className="block-head"><h3>{tool.name}{tool.codename && <span className="codename"> ({tool.codename})</span>}</h3><StatusChip status={tool.status} /></div>
            <p>{tool.tagline}</p>
          </div>
        </a>)}
      </div>
      <div className="extras">{extras.map(extra => <a key={extra.name} href={linkFor(base, extra.path)}><strong>{extra.name}</strong><span>{extra.text}</span></a>)}</div>
    </Section>

    <Section eyebrow="How an agent builds a game" title="From one sentence to a playable game" id="how">
      <div className="prompt-card"><span className="prompt-who">You</span><code>/blacksite:make-game a stealth game in an abandoned factory, third person</code></div>
      <ol className="flow">
        {flow.map((step, index) => <li key={step.skill}>
          <span className="flow-index">{String(index + 1).padStart(2, '0')}</span>
          <h3>{step.title}</h3>
          <p>{step.text}</p>
          <code>{step.skill}</code>
        </li>)}
      </ol>
      <p className="section-note">Each step writes a handoff into the game project and ends with a check the agent has to pass, so you can stop and pick up again anywhere. <a href={link('skills')}>Read about every skill</a>.</p>
    </Section>

    <section className="promise">
      <div><strong>120 fps</strong><span>on desktop</span></div>
      <div><strong>60 fps</strong><span>on phones</span></div>
      <p>Fast by default. The blocks ship with the budgets, workers and detail levels a browser game usually starts without, and every demo on this site shows its own frame rate. <a href={link('roadmap')}>See the roadmap</a>.</p>
    </section>
  </>
}
