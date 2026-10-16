import { installLine, repo } from '../content'
import { CopyLine } from '../components'
import { link } from '../links'

const makeGame = 'Make a stealth game in an abandoned factory'

export function GetStartedPage() {
  return <div className="page narrow get-started">
    <h1 className="page-title">Get started</h1>

    <ol className="steps">
      <li>
        <h2>Install</h2>
        <CopyLine code={installLine} />
        <p>On Windows, run <a href={`${repo}/blob/main/install.ps1`}>install.ps1</a> instead.</p>
      </li>
      <li>
        <h2>Open your agent</h2>
        <p>Claude Code, Codex or Cursor, in an empty folder.</p>
      </li>
      <li>
        <h2>Tell it what to make</h2>
        <CopyLine code={makeGame} prompt=">" />
        <p>The skill loads by itself for anything about a game. In Claude Code you can also start it with <code>/blacksite:blacksite</code> and your idea.</p>
      </li>
    </ol>

    <section className="next">
      <h2>What happens next</h2>
      <dl>
        <div><dt>Size</dt><dd>The agent asks one question at a time, then sizes the work. A Slice is the default: one complete loop in one finished space. For anything bigger it proposes the Slice that proves the idea.</dd></div>
        <div><dt>Truth</dt><dd>It writes the real numbers first, such as speeds, fire rates, ranges and budgets, in one module that the whole game reads.</dd></div>
        <div><dt>Parts</dt><dd>It lists what a shipped game in that space would have, with minimum counts: light sources, materials, props, sound layers, enemy behaviours. You approve the list before anything is built.</dd></div>
        <div><dt>Build</dt><dd>Each risky mechanic is built on its own, and the ones that work are joined into one loop. Then the space is dressed and made live.</dd></div>
        <div><dt>Verify</dt><dd>It measures frame time, hitches, pop-in, movement feel and sound on desktop and phone, reads every capture like a critic, then hands you a link to play.</dd></div>
      </dl>
      <p>It is all one skill. <a href={link('skills')}>See the skill and its references →</a></p>
    </section>
  </div>
}
