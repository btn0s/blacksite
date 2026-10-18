import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const materials = path.resolve(root, '../materials')
const sharp = createRequire(path.join(materials, 'package.json'))('sharp')

const SURFACES = {
  cast: 'cast-concrete-scan',
  panel: 'panel-concrete-scan',
  slab: 'slab-concrete-scan',
  stained: 'stained-concrete-scan',
  paint: 'painted-plaster-scan',
  brick: 'brick-scan',
  rust: 'rust-scan',
  metal: 'painted-metal-scan',
  corrugated: 'corrugated-rust-scan',
  asphalt: 'asphalt-scan',
  dirt: 'soil-scan',
  grass: 'grass-scan',
  gravel: 'gravel-soil-scan',
  wood: 'wood-planks-scan',
}
const MAPS = ['color', 'normal', 'orm', 'masks']

const args = process.argv.slice(2)
const option = name => {
  const at = args.indexOf(name)
  return at < 0 ? undefined : args.splice(at, 2)[1]
}
const jobs = Number(option('--jobs') ?? 4)
const SIZES = (option('--sizes') ?? '512').split(',').map(Number)
const from = option('--from')
const only = args.length ? args : Object.keys(SURFACES)
for (const name of only) if (!SURFACES[name]) throw new Error(`unknown surface ${name}`)

const work = from ? path.resolve(from) : await mkdtemp(path.join(tmpdir(), 'look-surfaces-'))
const bake = graph => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/bake.ts', `library/${graph}.json`, '--out', work, '--sizes', [...new Set([...SIZES, 512])].join(','), '--formats', 'ktx2,webp'], { cwd: materials, stdio: 'inherit' })
  child.once('error', reject)
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${graph} bake failed`)))
})
if (!from) {
  const queue = [...only]
  await Promise.all(Array.from({ length: Math.max(1, Math.min(4, jobs)) }, async () => {
    while (queue.length) await bake(SURFACES[queue.shift()])
  }))
}

const hex = value => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, '0')
const entries = {}
const previous = await readFile(path.join(root, 'src/world/bakes.json'), 'utf8').then(JSON.parse, () => ({}))
for (const [name, graph] of Object.entries(SURFACES)) {
  if (!only.includes(name)) { if (previous[name]) entries[name] = previous[name]; continue }
  const source = path.join(work, graph)
  const material = JSON.parse(await readFile(path.join(source, 'material.json'), 'utf8'))
  const target = path.join(root, 'assets/surfaces', name)
  await rm(target, { recursive: true, force: true })
  for (const size of SIZES) {
    await mkdir(path.join(target, String(size)), { recursive: true })
    for (const map of MAPS) await cp(path.join(source, String(size), `${map}.ktx2`), path.join(target, String(size), `${map}.ktx2`))
  }
  const { channels } = await sharp(path.join(source, '512/color.webp')).stats()
  entries[name] = { graph, size: material.size, depth: material.depth, mean: `#${channels.slice(0, 3).map(channel => hex(channel.mean)).join('')}` }
}
await writeFile(path.join(root, 'src/world/bakes.json'), `${JSON.stringify(entries, null, 2)}\n`)

const names = Object.keys(entries)
const id = (name, size, map) => `${name}${size}${map[0].toUpperCase()}${map.slice(1)}`
const imports = names.flatMap(name => SIZES.flatMap(size => MAPS.map(map => `import ${id(name, size, map)} from '../../assets/surfaces/${name}/${size}/${map}.ktx2?url'`)))
const body = names.map(name => `  ${name}: { ${SIZES.map(size => `${size}: { ${MAPS.map(map => `${map}: ${id(name, size, map)}`).join(', ')} }`).join(', ')} },`)
await writeFile(path.join(root, 'src/world/bakes.ts'), `${imports.join('\n')}\nimport info from './bakes.json'\n\nexport const BAKE_INFO = info\n\nexport const BAKE_MAPS = {\n${body.join('\n')}\n} as const\n`)
if (!from) await rm(work, { recursive: true, force: true })
process.stdout.write(`Baked ${only.join(', ')} into assets/surfaces\n`)
