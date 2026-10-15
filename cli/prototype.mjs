import { mkdir, readFile, readdir, writeFile, cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const option = (args, name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1] }
const slug = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const directory = args => path.resolve(option(args, '--project') || process.cwd())
const safe = name => /^[a-z][a-z0-9-]{0,63}$/.test(name)
const kits = ['als-tpp', 'tpp', 'fpp', 'subject', 'armory', 'warden', 'cascade', 'fpp-mp', 'fpp-tpp-mp']
async function ensureKitPackages(project, kit) {
  const requested = kit === 'fpp' ? ['subject-fpp', 'armory'] : ['als-tpp', 'tpp'].includes(kit) ? [] : kit ? [kit] : []
  if ((!requested.length && !['als-tpp', 'tpp'].includes(kit)) || !existsSync(path.join(project, '.stack-complete'))) return
  const manifestFile = path.join(project, 'package.json')
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
  const workspaceFile = path.join(project, 'pnpm-workspace.yaml')
  let workspace = await readFile(workspaceFile, 'utf8')
  const packagesRoot = path.join(project, 'vendor', 'blacksite', 'packages')
  let changed = false
  if (['als-tpp', 'tpp', 'subject'].includes(kit) && !manifest.dependencies['als-ue5-r3f']) { manifest.dependencies['als-ue5-r3f'] = 'workspace:*'; changed = true }
  if (['als-tpp', 'tpp', 'subject'].includes(kit) && !workspace.includes("  - 'vendor/blacksite/vendor/als-web'")) { workspace = workspace.replace('allowBuilds:', "  - 'vendor/blacksite/vendor/als-web'\nallowBuilds:"); changed = true }
  const seen = new Set()
  async function add(folder) {
    if (seen.has(folder)) return
    seen.add(folder)
    const file = path.join(packagesRoot, folder, 'package.json')
    if (!existsSync(file)) throw new Error(`Blacksite package unavailable: ${folder}`)
    const pkg = JSON.parse(await readFile(file, 'utf8'))
    if (!manifest.dependencies[pkg.name]) { manifest.dependencies[pkg.name] = 'workspace:*'; changed = true }
    const entry = `  - 'vendor/blacksite/packages/${folder}'`
    if (!workspace.includes(entry)) { workspace = workspace.replace('allowBuilds:', `${entry}\nallowBuilds:`); changed = true }
    for (const dependency of Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies })) if (dependency.startsWith('@blacksite/')) await add(dependency.slice('@blacksite/'.length))
  }
  for (const folder of requested) await add(folder)
  if (!changed) return
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(workspaceFile, workspace)
  const executable = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const result = spawnSync(executable, ['install'], { cwd: project, encoding: 'utf8', shell: process.platform === 'win32' })
  if (result.error || result.status !== 0) throw new Error(`pnpm install failed: ${(result.stderr || result.stdout || result.error?.message || '').slice(-2000)}`)
}
async function create(args) {
  const name = slug(args[1] || '')
  if (!safe(name)) throw new Error('Use prototype new <name> [--with tpp|fpp|subject|armory|warden|cascade]')
  const kit = option(args, '--with')
  if (kit && !kits.includes(kit)) throw new Error(`Unknown kit: ${kit}`)
  if (kit === 'fpp-mp' || kit === 'fpp-tpp-mp') throw new Error(`${kit} is unavailable: networked player and loopback session are not implemented yet`)
  const project = directory(args)
  if (!existsSync(path.join(project, '.stack.json'))) throw new Error('Run inside a Blacksite scaffold or use --project')
  const root = path.join(project, 'src', 'prototypes', name)
  if (existsSync(root)) throw new Error(`Prototype already exists: ${name}`)
  await mkdir(root, { recursive: true })
  await mkdir(path.join(project, 'docs', 'prototypes'), { recursive: true })
  const code = `import { useEffect, useState } from 'react'\nimport { createWorld, trait } from 'koota'\n\nconst Progress = trait({ count: 0 })\nconst world = createWorld()\nconst entity = world.spawn(Progress)\n\nexport default function Prototype() {\n  const [count, setCount] = useState(0)\n  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.code === 'Space') advance() }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [])\n  const advance = () => { const next = entity.get(Progress)!.count + 1; entity.set(Progress, { count: next }); setCount(next) }\n  return <main className="panel"><h1>${name}</h1><p>${kit || 'blank'} prototype · Progress {count}</p><button onClick={advance}>Try mechanic</button></main>\n}\n`
  await writeFile(path.join(root, 'mode.tsx'), code)
  if (['als-tpp', 'tpp', 'fpp'].includes(kit)) await cp(path.join(rootDirectory, 'templates', 'prototype-kits', kit === 'tpp' ? 'als-tpp' : kit, 'mode.tsx'), path.join(root, 'mode.tsx'))
  const inputs = ['als-tpp', 'tpp'].includes(kit) ? 'WASD, mouse, sprint, jump' : kit === 'fpp' ? 'WASD, mouse, view, weapon, reload, fire' : 'keyboard Space or Try mechanic button'
  const outputs = ['als-tpp', 'tpp'].includes(kit) ? 'ALS pose and camera' : kit === 'fpp' ? 'camera pose, weapon events, recoil, shot count' : 'progress count'
  const traits = ['als-tpp', 'tpp', 'fpp'].includes(kit) ? 'Pawn, PawnIntent from the shared session; add prototype traits here' : 'Progress'
  await writeFile(path.join(project, 'docs', 'prototypes', `${name}.md`), `# ${name}\n\nKit: ${kit || 'blank'}\n\n## Question\n\nWhat must this prototype prove?\n\n## Contract\n\n- Inputs: ${inputs}\n- Outputs: ${outputs}\n- Koota traits: ${traits}\n- Machine events: define any discrete transitions here\n- Effect services: list resource and I/O interfaces here\n- State ownership: Koota gameplay world\n\n## What was learned\n\nRecord player evidence before promoting.\n`)
  await ensureKitPackages(project, kit)
  if (!args.includes('--quiet')) process.stdout.write(`${root}\n`)
}
async function list(args) {
  const root = path.join(directory(args), 'src', 'prototypes')
  if (!existsSync(root)) { process.stdout.write('[]\n'); return }
  const entries = []
  for (const name of await readdir(root)) if (existsSync(path.join(root, name, 'mode.tsx'))) entries.push({ name, path: `src/prototypes/${name}`, contract: `docs/prototypes/${name}.md` })
  process.stdout.write(`${JSON.stringify(entries)}\n`)
}
async function promote(args) {
  const names = args.slice(1).filter(value => !value.startsWith('--') && value !== option(args, '--project'))
  if (!names.length || names.some(name => !safe(name))) throw new Error('Use prototype promote <name...>')
  const project = directory(args)
  const base = path.join(project, 'src', 'prototypes')
  for (const name of names) if (!existsSync(path.join(base, name, 'mode.tsx'))) throw new Error(`Prototype not found: ${name}`)
  const game = path.join(project, 'src', 'game')
  await mkdir(game, { recursive: true })
  for (const name of names) await cp(path.join(base, name), path.join(game, name), { recursive: true })
  const imports = names.map((name, index) => `import Mode${index} from './${name}/mode'`).join('\n')
  const modes = names.map((_, index) => `<Mode${index} />`).join('')
  await writeFile(path.join(game, 'mode.tsx'), `${imports}\n\nexport default function Game() { return <div className="game-combined">${modes}</div> }\n`)
  await writeFile(path.join(project, 'docs', 'prototypes', 'promotion.md'), `# Promoted prototypes\n\n${names.map(name => `- ${name}`).join('\n')}\n\nVerify the core loop from Main menu → Play and resolve shared world, input, events, and service ownership.\n`)
  process.stdout.write(`${game}\n`)
}
export async function runPrototype(args) {
  if (args[0] === 'new') return create(args)
  if (args[0] === 'list') return list(args)
  if (args[0] === 'promote') return promote(args)
  throw new Error('Use prototype new|list|promote')
}
