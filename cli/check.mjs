import path from 'node:path'
import { CHECKS, OPT_IN_CHECKS, PROFILES, runChecks, summarize } from '../packages/check/src/runner.mjs'

export async function runCheck(argv) {
  const value = name => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] : undefined }
  const list = name => value(name)?.split(',').map(item => item.trim()).filter(Boolean)
  const target = argv.find((item, index) => !item.startsWith('--') && !argv[index - 1]?.startsWith('--'))
  if (!target || argv.includes('--help')) {
    process.stdout.write(`blacksite check <url|built-dir> [--page frames/game.html] [--only ${[...CHECKS, ...OPT_IN_CHECKS].join(',')}] [--profile ${Object.keys(PROFILES).join(',')}] [--out dir] [--seconds 12] [--grid 4] [--json]\n`)
    return
  }
  const only = list('--only') ?? []
  const profiles = list('--profile') ?? []
  for (const name of only) if (!CHECKS.includes(name) && !OPT_IN_CHECKS.includes(name)) throw new Error(`Unknown check: ${name}`)
  for (const name of profiles) if (!PROFILES[name]) throw new Error(`Unknown profile: ${name}`)
  const out = value('--out') ?? path.join('blacksite-check', new Date().toISOString().replace(/[:.]/g, '-'))
  const json = argv.includes('--json')
  const report = await runChecks({
    target, page: value('--page'), only, profiles, out,
    seconds: value('--seconds') ? Number(value('--seconds')) : undefined,
    grid: value('--grid') ? Number(value('--grid')) : undefined,
    log: json ? undefined : line => process.stderr.write(`${line}\n`),
  })
  process.stdout.write(json ? `${JSON.stringify(report)}\n` : `${summarize(report)}\nreport: ${path.join(path.resolve(out), 'report.json')}\n`)
  if (!report.pass) process.exitCode = 1
}
