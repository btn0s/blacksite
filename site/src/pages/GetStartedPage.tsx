import { installLine, repo, skillsLine } from '../content'
import { CopyLine } from '../components'
import { link } from '../links'
import { skills } from '../skills'

const makeGame = 'Make a stealth game in an abandoned factory'
const command = `/blacksite:${skills[0]?.name ?? 'blacksite'}`

export function GetStartedPage() {
  return <div className="page narrow get-started">
    <h1 className="page-title">Get started</h1>

    <ol className="steps">
      <li>
        <h2>Install</h2>
        <CopyLine code={skillsLine} />
        <p>It adds the skill to Claude Code, Codex or Cursor. The skill offers to install the <code>blacksite</code> command when it needs it.</p>
        <p id="full-toolkit">Or install the full toolkit directly:</p>
        <CopyLine code={installLine} />
        <p>On Windows, run <a href={`${repo}/blob/main/install.ps1`}>install.ps1</a> in PowerShell.</p>
      </li>
      <li>
        <h2>Open your agent in an empty folder</h2>
        <p>Claude Code, Codex or Cursor.</p>
      </li>
      <li>
        <h2>Say what you want to make</h2>
        <CopyLine code={makeGame} prompt=">" />
        <p>You don’t have to name the skill; the agent loads it for anything about a game. In Claude Code you can also type <code>{command}</code> followed by your idea.</p>
      </li>
    </ol>
    <p className="done">That’s it.</p>

    <section className="next">
      <h2>What you get</h2>
      <p>The agent asks a few questions, one at a time, then proposes a size. The default is one finished space with about 5 to 10 minutes of play. It builds it over a day or a few sessions, checks it on desktop and phone, and gives you a link to play with the check results.</p>
      <p><a href={link('skills')}>How it works, step by step →</a></p>
    </section>
  </div>
}
