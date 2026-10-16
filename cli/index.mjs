#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runAssets } from './assets.mjs'
import { runPrototype } from './prototype.mjs'
import { runCheck } from './check.mjs'
import { product } from './product.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const command = argv.shift() || 'help'
const flag = (name) => argv.includes(name)
const value = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined }
const nodeBin = process.execPath
const skillNames = ['start', 'make-game', 'design-game', 'setup-project', 'build-prototype', 'combine-prototypes', 'optimize-game', 'ship-game', 'game-architecture', 'blacksite-kit', 'game-assets', 'als']
const legacySkills = ['stack', 'game-design', 'prototypes', 'orchestrate', 'kit', 'architecture']
function run(executable, args, cwd = process.cwd()) {
  const result = spawnSync(executable, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(executable) })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${executable} exited with status ${result.status}`)
}
function tool(name) { return process.platform === 'win32' ? `${name}.cmd` : name }
async function instructions(file, content) {
  const begin = '<!-- blacksite:start -->'
  const end = '<!-- blacksite:end -->'
  const previous = existsSync(file) ? await readFile(file, 'utf8') : ''
  const section = `${begin}\n${content}\n${end}`
  const next = previous.includes(begin) && previous.includes(end) ? previous.replace(new RegExp(`${begin}[\\s\\S]*?${end}`), section) : `${previous.trimEnd()}${previous.trim() ? '\n\n' : ''}${section}\n`
  await mkdir(path.dirname(file), { recursive: true })
  if (next !== previous) await writeFile(file, next)
}
async function removeInstructions(file) {
  if (!existsSync(file)) return
  const begin = '<!-- blacksite:start -->'
  const end = '<!-- blacksite:end -->'
  const previous = await readFile(file, 'utf8')
  const next = previous.replace(new RegExp(`\\n?${begin}[\\s\\S]*?${end}\\n?`), '\n').trimEnd()
  if (next !== previous) await writeFile(file, next ? `${next}\n` : '')
}
async function install() {
  const agent = value('--agent') || 'auto'
  const selected = agent === 'auto' ? process.env.CLAUDE_CODE ? 'claude' : process.env.CURSOR_SESSION ? 'cursor' : 'codex' : agent
  if (!['claude', 'codex', 'cursor'].includes(selected)) throw new Error('Choose --agent claude|codex|cursor|auto')
  const global = flag('--global')
  if (global && flag('--project')) throw new Error('Choose --global or --project')
  if (selected === 'claude') {
    if (flag('--uninstall')) {
      const result = spawnSync(tool('claude'), ['plugin', 'uninstall', `${product.plugin}@${product.marketplace}`, '--scope', global ? 'user' : 'project', '-y'], { stdio: 'inherit', shell: process.platform === 'win32' })
      if (result.error) throw result.error
      spawnSync(tool('claude'), ['plugin', 'marketplace', 'remove', product.marketplace], { stdio: 'inherit', shell: process.platform === 'win32' })
      return
    }
    const source = process.env.BLACKSITE_MARKETPLACE || root
    run(tool('claude'), ['plugin', 'install', product.plugin, '--marketplace', source, '--scope', global ? 'user' : 'project', ...(flag('--yes') || !process.stdin.isTTY ? ['-y'] : [])])
    return
  }
  const base = global ? homedir() : process.cwd()
  const target = selected === 'cursor' ? path.join(base, '.cursor', 'skills') : path.join(base, '.agents', 'skills')
  const instructionFile = selected === 'cursor' ? path.join(base, '.cursor', 'rules', 'blacksite.mdc') : global ? path.join(base, '.codex', 'AGENTS.md') : path.join(base, 'AGENTS.md')
  if (flag('--uninstall')) {
    for (const name of [...skillNames, ...legacySkills]) await rm(path.join(target, name), { recursive: true, force: true })
    await removeInstructions(instructionFile)
    process.stdout.write(`Removed Blacksite skills for ${selected}\n`)
    return
  }
  await mkdir(target, { recursive: true })
  for (const name of legacySkills) await rm(path.join(target, name), { recursive: true, force: true })
  for (const name of skillNames) await cp(path.join(root, 'skills', name), path.join(target, name), { recursive: true, force: true })
  await instructions(instructionFile, 'When the user first invokes Blacksite without a specific task, read ' + path.relative(path.dirname(instructionFile), path.join(target, 'start', 'SKILL.md')).replaceAll('\\', '/') + ' and ask: "What would you like to do?" Offer the choices from that skill. For game design, prototypes, architecture, and tools, read the matching skill in ' + path.relative(path.dirname(instructionFile), target).replaceAll('\\', '/') + '. Assets are optional. Never read credential files or copy purchased assets.')
  process.stdout.write(`Installed Blacksite skills for ${selected} in ${target}\n`)
}
function doctor() {
  const checks = Object.fromEntries(['node', 'pnpm', 'git', 'bb', 'assets'].map(name => {
    const executable = name === 'node' ? nodeBin : tool(name)
    const result = spawnSync(executable, [name === 'assets' ? '--help' : '--version'], { encoding: 'utf8', timeout: 5000, shell: process.platform === 'win32' && /\.cmd$/i.test(executable) })
    return [name, { available: !result.error && result.status === 0, version: (result.stdout || '').split('\n')[0].slice(0, 120) }]
  }))
  checks.notes = ['GPU rendering needs a real device for playtesting.', 'Headless tools handle scaffolding, assets, and gates; playtest on a user-controlled GPU device.']
  process.stdout.write(`${JSON.stringify(checks, null, flag('--json') ? 0 : 2)}\n`)
}
async function main() {
  if (command === 'help' || command === '--help' || flag('--help')) { process.stdout.write(`${product.cli}\n  install [--agent claude|codex|cursor|auto] [--global|--project] [--yes|--uninstall]\n  doctor\n  catalog [--json]\n  scaffold --profile tpp|fpp|blank|mp --name <name> --dir <absolute-dir> [--json] [--gate]\n  new <scaffold options> [--assets id,...]\n  budget\n  check <url|built-dir> [--only perf,hitch,pop,feel,critic,audio] [--profile desktop,phone] [--out dir]\n  prototype new <name> [--with tpp|fpp|subject|armory|warden|cascade|mp]\n  prototype list|promote\n  architecture\n  update\n  assets login <fab|itch|all>\n  assets logout <fab|itch|all>\n  assets status\n  assets sync [--source fab|itch|all]\n  assets list|search|suggest|pick|add|formats\n`); return }
  if (command === 'install') return install()
  if (command === 'doctor') return doctor()
  if (command === 'catalog' || command === 'scaffold') return run(nodeBin, [path.join(root, 'cli', 'scaffold.mjs'), ...(command === 'catalog' ? ['catalog', ...argv] : argv)])
  if (command === 'new') {
    const selected = value('--assets')?.split(',').filter(Boolean) || []
    const filtered = argv.filter((part, index) => part !== '--assets' && argv[index - 1] !== '--assets')
    run(nodeBin, [path.join(root, 'cli', 'scaffold.mjs'), ...filtered])
    if (selected.length) await runAssets(['add', ...selected, '--project', value('--dir'), ...(flag('--json') ? ['--json'] : [])])
    return
  }
  if (command === 'budget') return run(nodeBin, [path.join(root, 'cli', 'budget-check.mjs'), ...argv])
  if (command === 'check') return runCheck(argv)
  if (command === 'assets') return runAssets(argv)
  if (command === 'prototype') return runPrototype(argv)
  if (command === 'architecture') { process.stdout.write(await readFile(path.join(root, 'skills', 'game-architecture', 'SKILL.md'), 'utf8')); return }
  if (command === 'update') return process.platform === 'win32' ? run('powershell.exe', ['-NoProfile', '-File', path.join(root, 'install.ps1'), ...argv]) : run('sh', [path.join(root, 'install.sh'), ...argv])
  throw new Error(`Unknown command: ${command}. Run ${product.cli} --help; asset commands start with ${product.cli} assets.`)
}
try { await main() } catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1 }
