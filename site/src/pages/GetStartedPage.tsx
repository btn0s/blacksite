import { installLine, repo } from '../content'
import { CopyLine } from '../components'
import { link } from '../links'

const makeGame = '/blacksite:make-game a stealth game in an abandoned factory'

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
      </li>
    </ol>

    <section className="next">
      <h2>What happens next</h2>
      <dl>
        <div><dt>Design</dt><dd>The agent asks one question at a time and writes down the fantasy, core loop, camera, scope and the risky parts. You approve the design before anything is built.</dd></div>
        <div><dt>Set up</dt><dd>It creates the game project and checks that it builds and the menus work.</dd></div>
        <div><dt>Prototypes</dt><dd>Each risky mechanic is built on its own and playable from a developer menu. The ones that work are combined into one core loop.</dd></div>
        <div><dt>Budget</dt><dd>It holds the game to 120 fps on desktop and 60 on phones, then hands you a link to play.</dd></div>
      </dl>
      <p>Each phase is a skill. <a href={link('skills')}>See all the skills →</a></p>
    </section>
  </div>
}
