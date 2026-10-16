#!/usr/bin/env node
import { readFile, writeFile, mkdir, readdir, cp } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { runPrototype, writeKit } from './prototype.mjs'
import { initializeSubmodule } from './scaffold-git.mjs'

const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const templateDirectory = path.join(rootDirectory, 'templates')
const blacksiteUrl = 'https://github.com/btn0s/blacksite.git'
const systems = {
  subject: { name: 'Subject', description: 'Player control: arms-only solo FPP or ALS third person', dependencies: [] },
  armory: { name: 'Armory', description: 'Deterministic weapon simulation', dependencies: [] },
  warden: { name: 'Warden', description: 'Squad AI and decision systems', dependencies: [] },
  cascade: { name: 'Cascade', description: 'Destruction simulation and effects', dependencies: [] },
}
const profiles = {
  fpp: { name: 'First person', description: 'Game shell with rigged, animated first person arms', included: ['subject', 'armory'], optional: Object.keys(systems), unavailable: [] },
  tpp: { name: 'Third person', description: 'Game shell with an ALS controller prototype', included: [], optional: Object.keys(systems), unavailable: [] },
  mp: { name: 'Multiplayer first and third person', description: 'Networked rigged FPP arms and ALS bodies with switchable camera', included: ['subject', 'armory', 'relay', 'protocol'], optional: Object.keys(systems), unavailable: [] },
  blank: { name: 'Blank', description: 'Game shell with a walker in the starter yard', included: [], optional: Object.keys(systems), unavailable: [] },
}
function parse(argv) {
  const result = { command: argv[0] === 'catalog' ? 'catalog' : 'scaffold', json: argv.includes('--json'), gate: argv.includes('--gate') }
  const args = result.command === 'catalog' ? argv.slice(1) : argv
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (['--json', '--gate'].includes(arg)) continue
    if (!['--profile', '--name', '--dir', '--systems', '--blacksite-ref'].includes(arg) || !args[i + 1]) throw new Error(`Unknown or incomplete option: ${arg}`)
    result[arg.slice(2)] = args[++i]
  }
  return result
}
function emit(json, step, status, message) {
  const line = JSON.stringify({ step, status, message })
  if (json) process.stdout.write(`${line}\n`)
  else process.stderr.write(`${step}: ${message}\n`)
}
function run(command, args, cwd) {
  const windows = process.platform === 'win32'
  const executable = windows && ['pnpm', 'npm'].includes(command) ? `${command}.cmd` : command
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', shell: windows && executable.endsWith('.cmd'), maxBuffer: 32 * 1024 * 1024 })
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${(result.stderr || result.stdout || result.error?.message || '').trim().slice(-3000)}`)
  return result.stdout.trim()
}
async function json(file) { return JSON.parse(await readFile(file, 'utf8')) }
function slug(name) { return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'game' }
async function npmRange(name) {
  const version = run('npm', ['view', name, 'version'], process.cwd()).split('\n').at(-1)
  if (!/^\d+\.\d+\.\d+/.test(version)) throw new Error(`No published version for ${name}`)
  return `^${version}`
}
async function packageClosure(blacksite, requested) {
  const names = new Map()
  for (const folder of await readdir(path.join(blacksite, 'packages'))) {
    const file = path.join(blacksite, 'packages', folder, 'package.json')
    if (existsSync(file)) names.set((await json(file)).name, folder)
  }
  const selected = new Set()
  async function visit(name) {
    if (selected.has(name)) return
    const folder = names.get(name)
    if (!folder) throw new Error(`Blacksite package unavailable: ${name}`)
    selected.add(name)
    const manifest = await json(path.join(blacksite, 'packages', folder, 'package.json'))
    for (const dep of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) if (dep.startsWith('@blacksite/')) await visit(dep)
  }
  for (const id of requested) await visit(`@blacksite/${id}`)
  return [...selected].map(name => `vendor/blacksite/packages/${names.get(name)}`).sort()
}
async function main() {
  const options = parse(process.argv.slice(2))
  if (options.command === 'catalog') {
    const packageRoot = path.join(rootDirectory, 'packages')
    const packageRows = existsSync(packageRoot) ? await Promise.all((await readdir(packageRoot)).map(async folder => {
      const file = path.join(packageRoot, folder, 'package.json')
      return existsSync(file) ? { id: folder, name: (await json(file)).name } : null
    })) : await json(path.join(rootDirectory, 'cli', 'catalog-packages.json'))
    const catalog = {
      profiles: Object.entries(profiles).map(([id, profile]) => ({ id, ...profile })),
      systems: Object.entries(systems).map(([id, system]) => ({ id, ...system, profiles: Object.fromEntries(Object.entries(profiles).map(([profile, data]) => [profile, data.included.includes(id) ? 'included' : data.unavailable.includes(id) ? 'unavailable' : 'optional'])) })),
      packages: packageRows.filter(Boolean),
      templates: [{ id: 'game-shell', path: 'templates/game-shell' }],
      kits: ['blank', 'tpp', 'fpp', 'subject', 'armory', 'warden', 'cascade', 'mp'].map(id => ({ id, command: `blacksite prototype new <name> --with ${id}`, status: ['subject', 'armory', 'warden', 'cascade'].includes(id) ? 'experimental' : 'usable' })),
      tools: ['install', 'doctor', 'catalog', 'scaffold', 'new', 'budget', 'check', 'assets', 'prototype', 'architecture', 'update'],
    }
    process.stdout.write(`${JSON.stringify(catalog)}\n`)
    return
  }
  const profile = options.profile
  if (!profiles[profile]) throw new Error('Choose --profile tpp|fpp|blank|mp')
  if (!options.name || !options.name.trim()) throw new Error('--name is required')
  if (!options.dir || !path.isAbsolute(options.dir)) throw new Error('--dir must be absolute')
  const requested = new Set(profiles[profile].included)
  for (const id of (options.systems || '').split(',').filter(Boolean)) {
    if (!systems[id]) throw new Error(`Unknown system: ${id}`)
    requested.add(id)
  }
  const root = path.resolve(options.dir)
  const config = { profile, name: options.name, systems: [...requested].sort(), blacksiteRef: options['blacksite-ref'] || null }
  const marker = path.join(root, '.stack.json')
  const complete = path.join(root, '.stack-complete')
  if (existsSync(root)) {
    const entries = await readdir(root)
    if (entries.length && !existsSync(marker)) {
      const designOnly = entries.every(entry => entry === 'docs' || entry === '.git') && (!entries.includes('docs') || (await readdir(path.join(root, 'docs'))).every(entry => entry === 'game-design.md'))
      if (!designOnly) throw new Error(`Refusing nonempty directory without scaffold marker: ${root}`)
    }
    if (existsSync(marker) && JSON.stringify(await json(marker)) !== JSON.stringify(config)) throw new Error('Existing scaffold options differ; use a new directory')
  }
  if (existsSync(complete)) {
    if (options.gate) {
      emit(options.json, 'gate', 'start', 'Running lint, typecheck, build, and budget check')
      run('pnpm', ['check'], root)
      emit(options.json, 'gate', 'done', 'Gate passed')
    }
    process.stdout.write(`${JSON.stringify({ result: 'ok', dir: root, devCommand: 'pnpm dev', port: 5173 })}\n`)
    return
  }
  emit(options.json, 'directory', 'start', root)
  await mkdir(root, { recursive: true })
  await writeFile(marker, `${JSON.stringify(config, null, 2)}\n`)
  if (!existsSync(path.join(root, '.git'))) run('git', ['init'], root)
  emit(options.json, 'directory', 'done', 'Initialized Git repository')
  emit(options.json, 'submodules', 'start', 'Adding Blacksite with nested ALS')
  const localRef = options['blacksite-ref']?.startsWith('file://') ? options['blacksite-ref'] : null
  await initializeSubmodule(root, localRef || blacksiteUrl, 'vendor/blacksite', localRef ? null : options['blacksite-ref'])
  emit(options.json, 'submodules', 'done', 'Recursive Blacksite submodule initialized')
  const packageIds = [...requested].map(id => id === 'subject' && profile === 'fpp' ? 'subject-fpp' : id)
  if (profile === 'mp') packageIds.push('subject-fpp')
  const needsAls = profile === 'tpp' || packageIds.includes('subject') || packageIds.includes('subject-fpp')
  const base = ['ui', 'look', 'input', 'check', 'soundscape']
  const closure = await packageClosure(path.join(root, 'vendor/blacksite'), [...base, ...packageIds])
  const workspace = ['packages:', ...closure.map(item => `  - '${item}'`), ...(needsAls ? ["  - 'vendor/blacksite/vendor/als-web'"] : []), 'allowBuilds:', '  esbuild: true', ...(profile === 'mp' ? ['  msgpackr-extract: false'] : []), 'minimumReleaseAge: 0', ''].join('\n')
  await writeFile(path.join(root, 'pnpm-workspace.yaml'), workspace)
  const dependencyNames = ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/rapier', 'effect', 'koota', 'xstate']
  const devNames = ['typescript', 'vite', '@vitejs/plugin-react', '@tailwindcss/vite', 'oxlint', '@types/react', '@types/react-dom', '@types/three', ...(profile === 'mp' ? ['tsx', 'concurrently', '@types/node'] : [])]
  const dependencies = Object.fromEntries(base.map(id => [`@blacksite/${id}`, 'workspace:*']))
  if (needsAls) dependencies['als-ue5-r3f'] = 'workspace:*'
  for (const id of packageIds) dependencies[`@blacksite/${id}`] = 'workspace:*'
  for (const name of dependencyNames) dependencies[name] = await npmRange(name)
  const devDependencies = {}
  for (const name of devNames) devDependencies[name] = await npmRange(name)
  const manifest = { name: slug(options.name), private: true, type: 'module', scripts: { dev: profile === 'mp' ? 'concurrently -k "tsx server/index.ts" "vite"' : 'vite', lint: profile === 'mp' ? 'oxlint src scripts server' : 'oxlint src scripts', typecheck: 'tsc --noEmit', build: 'vite build', 'budget-check': 'node scripts/budget-check.mjs', check: 'pnpm lint && pnpm typecheck && pnpm build && pnpm budget-check' }, dependencies, devDependencies }
  await writeFile(path.join(root, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(path.join(root, 'pnpm-workspace.yaml'), `${workspace}overrides:\n  react: '${dependencies.react}'\n  react-dom: '${dependencies['react-dom']}'\n  three: '${dependencies.three}'\n  '@react-three/fiber': '${dependencies['@react-three/fiber']}'\n  '@types/three': '${devDependencies['@types/three']}'\n`)
  const source = path.join(templateDirectory, 'game-shell')
  await cp(source, root, { recursive: true, force: true })
  const kit = profile === 'tpp' ? 'als-tpp' : profile
  await runPrototype(['new', `controller-${profile}`, '--with', kit, '--project', root, '--quiet'])
  await writeKit(kit, path.join(root, 'src', 'game', 'mode.tsx'), 'game')
  if (profile === 'mp') {
    await mkdir(path.join(root, 'server'), { recursive: true })
    await cp(path.join(templateDirectory, 'multiplayer-server', 'index.ts'), path.join(root, 'server', 'index.ts'))
    await cp(path.join(templateDirectory, 'multiplayer-server', 'README.md'), path.join(root, 'server', 'README.md'))
  }
  await mkdir(path.join(root, 'lint'), { recursive: true })
  await cp(path.join(templateDirectory, 'lint', 'game.mjs'), path.join(root, 'lint', 'game.mjs'), { recursive: true, force: true })
  await cp(path.join(templateDirectory, 'lint', '.oxlintrc.json'), path.join(root, '.oxlintrc.json'), { force: true })
  await cp(path.join(templateDirectory, 'monorepo', 'tsconfig.json'), path.join(root, 'tsconfig.json'), { force: true })
  if (profile !== 'tpp') {
    const tsconfigFile = path.join(root, 'tsconfig.json')
    const tsconfig = await json(tsconfigFile)
    tsconfig.include = ['src', 'vendor/blacksite/packages/look/src/n8ao.d.ts', ...(profile === 'mp' ? ['server'] : []), ...(needsAls ? ['vendor/blacksite/vendor/als-web/src/app/globals.d.ts'] : [])]
    await writeFile(tsconfigFile, `${JSON.stringify(tsconfig, null, 2)}\n`)
  }
  await cp(path.join(templateDirectory, 'monorepo', 'vite.config.mjs'), path.join(root, 'vite.config.mjs'), { force: true })
  await mkdir(path.join(root, 'scripts'), { recursive: true })
  await cp(path.join(rootDirectory, 'cli', 'budget-check.mjs'), path.join(root, 'scripts', 'budget-check.mjs'), { force: true })
  const worldTextures = (await readdir(path.join(root, 'vendor/blacksite/packages/look/assets/world'))).filter(file => file.endsWith('.webp')).map(file => `assets/${file.replace(/\.webp$/, '')}-*.webp`)
  const armsTextures = needsAls ? (await readdir(path.join(root, 'vendor/blacksite/packages/subject-fpp/assets/materials'))).filter(file => file.endsWith('.webp')).map(file => `assets/${file.replace(/\.webp$/, '')}-*.webp`) : []
  await writeFile(path.join(root, 'budget.config.json'), JSON.stringify({ maxChunkBytes: 4000000, maxTotalJsBytes: 8000000, maxAssetBytes: 20000000, fixedStepHz: 60, tiers: { desktop: { targetFps: 120, renderScale: 1 }, mobile: { targetFps: 60, renderScale: 0.75, effectScale: 0.5, distanceScale: 0.6, densityScale: 0.5, updateRateScale: 0.5 } }, legacyAssetPaths: ['assets/skm-als.glb', 'assets/skm-als-pistol.glb', 'assets/skm-als-rifle.glb', ...worldTextures, ...armsTextures], requiresFixedStep: true }, null, 2) + '\n')
  await cp(path.join(templateDirectory, 'loading', 'warmup.ts'), path.join(root, 'scripts', 'warmup.ts'), { force: true })
  await cp(path.join(templateDirectory, 'monorepo', 'gitignore.txt'), path.join(root, '.gitignore'), { force: true })
  await writeFile(path.join(root, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>${options.name.replaceAll('&', '&amp;').replaceAll('<', '&lt;')}</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n`)
  emit(options.json, 'files', 'done', `Copied ${profile} starter and ${closure.length} Blacksite workspace packages`)
  emit(options.json, 'install', 'start', 'Running pnpm install')
  run('pnpm', ['install'], root)
  emit(options.json, 'install', 'done', 'Dependencies installed')
  if (options.gate) {
    emit(options.json, 'gate', 'start', 'Running lint, typecheck, build, and budget check')
    run('pnpm', ['check'], root)
    emit(options.json, 'gate', 'done', 'Gate passed')
  }
  await writeFile(complete, 'complete\n')
  const final = { result: 'ok', dir: root, devCommand: 'pnpm dev', port: 5173 }
  process.stdout.write(`${JSON.stringify(final)}\n`)
}
try { await main() } catch (error) {
  const json = process.argv.includes('--json')
  emit(json, 'scaffold', 'fail', error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
