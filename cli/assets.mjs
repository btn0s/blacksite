import { spawnSync } from 'node:child_process'
import { chmod, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { FabClient } from './fab-port/fab.mjs'

const home = homedir()
const dataRoot = process.env.BLACKSITE_ASSET_DATA_DIR || path.join(home, '.local', 'share', 'blacksite', 'assets')
const legacyRoot = process.env.BLACKSITE_LEGACY_ASSET_DATA_DIR
const cacheRoot = process.env.BLACKSITE_ASSET_CACHE_DIR || path.join(home, '.cache', 'blacksite', 'assets')
const userRoot = process.env.BLACKSITE_CONFIG_DIR || path.join(home, '.config', 'blacksite', 'assets')
const safeName = name => !/(login|token|secret|key|credential)/i.test(name) && !name.startsWith('.env')
const opt = (args, name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
const flag = (args, name) => args.includes(name)
function execute(name, args, env = process.env) {
  const exe = process.platform === 'win32' ? `${name}.cmd` : name
  const result = spawnSync(exe, args, { stdio: 'inherit', shell: process.platform === 'win32', env })
  if (result.error || result.status !== 0) throw new Error(`${name} failed`)
}
function frontmatter(markdown) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)
  const metadata = {}
  if (match) for (const line of match[1].split(/\r?\n/)) {
    const field = /^([a-z_]+):\s*(.*)$/.exec(line)
    if (field) metadata[field[1]] = field[2].replace(/^['"]|['"]$/g, '')
  }
  return metadata
}
function category(text) {
  const s = text.toLowerCase()
  if (/sound|music|footstep|audio|sfx/.test(s)) return 'audio'
  if (/anim|locomotion|motion capture/.test(s)) return 'animations'
  if (/character|soldier|person|creature|humanoid/.test(s)) return 'characters'
  if (/vfx|particle|effect|explosion/.test(s)) return 'vfx'
  if (/ui|hud|icon|interface|gui/.test(s)) return 'ui'
  if (/material|texture|shader/.test(s)) return 'materials'
  if (/environment|level|corridor|building|terrain|forest|city|village/.test(s)) return 'environments'
  if (/sprite|2d|pixel art/.test(s)) return '2d'
  return 'models'
}
async function library() {
  const entries = []
  for (const source of ['fab', 'itch']) {
    const current = path.join(dataRoot, `${source}-library`)
    const directory = existsSync(current) ? current : legacyRoot ? path.join(legacyRoot, `${source}-library`) : current
    if (!existsSync(directory)) continue
    for (const filename of await readdir(directory)) {
      if (!filename.endsWith('.md') || !safeName(filename)) continue
      const full = path.join(directory, filename)
      const info = await stat(full)
      if (!info.isFile() || info.size > 2_000_000) continue
      const body = await readFile(full, 'utf8')
      const meta = frontmatter(body)
      const rawId = meta.asset_id || meta.game_id || filename.slice(0, -3)
      if (!/^[a-zA-Z0-9_-]{1,150}$/.test(rawId)) continue
      const id = `${source}_${rawId}`
      const formats = [...new Set([...body.matchAll(/\.(glb|gltf|fbx|usd|usdz|zip|blend|wav|mp3|ogg|png|jpg)\b/gi)].map(m => m[1].toLowerCase()))]
      if (/Unreal versions|UE_\d|Unreal Engine/i.test(body)) formats.push('ue')
      const title = meta.title || filename.slice(0, -3)
      const text = `${title} ${meta.categories || ''}`
      const cached = path.join(cacheRoot, id)
      entries.push({ id, title, source, owned: true, category: category(text), formats, size: null, license: source === 'fab' ? 'Fab Standard License' : 'See item license', status: { owned: true, downloaded: existsSync(cached), inProject: false }, tags: (meta.categories || meta.tags || '').split(',').map(x => x.trim()).filter(Boolean), score: 0, seller: meta.seller || meta.author || '', url: meta.url || '', description: body.slice(0, 1800), assetId: meta.asset_id || '', namespace: meta.namespace || '' })
    }
  }
  return entries
}
function rank(items, query, args) {
  const words = query.toLowerCase().replace(/low[ -]?poly/g, 'lowpoly').replace(/sci[ -]?fi/g, 'scifi').split(/[^a-z0-9]+/).filter(x => x.length > 2 && !['the', 'and', 'game', 'with', 'for'].includes(x))
  return items.filter(item => (!opt(args, '--source') || item.source === opt(args, '--source')) && (!opt(args, '--category') || item.category === opt(args, '--category')) && (!opt(args, '--format') || item.formats.includes(opt(args, '--format'))) && (!flag(args, '--downloaded') || item.status.downloaded) && (!flag(args, '--in-project') || item.status.inProject)).map(item => {
    const title = item.title.toLowerCase().replace(/low[ -]?poly/g, 'lowpoly').replace(/sci[ -]?fi/g, 'scifi')
    const tags = item.tags.join(' ').toLowerCase().replace(/low[ -]?poly/g, 'lowpoly').replace(/sci[ -]?fi/g, 'scifi')
    const description = item.description.toLowerCase().replace(/low[ -]?poly/g, 'lowpoly').replace(/sci[ -]?fi/g, 'scifi')
    const score = words.reduce((sum, word) => sum + (title.includes(word) ? 8 : 0) + (tags.includes(word) ? 4 : 0) + (description.includes(word) ? 1 : 0), 0)
    return { ...item, score }
  }).filter(item => !words.length || item.score).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
}
function output(value, json) { process.stdout.write(`${JSON.stringify(value, null, json ? 0 : 2)}\n`) }
async function login(args) {
  if (flag(args, '--status')) {
    const fab = await new FabClient().sessionStatus().then(result => result.signedIn).catch(() => false)
    const itch = existsSync(path.join(userRoot, 'itch', 'session.json')) || Boolean(process.env.ITCH_IO_API_KEY)
    output({ fab: { signedIn: fab, account: null }, itch: { signedIn: itch, account: null } }, true)
    return
  }
  if (!process.stdin.isTTY) throw new Error('Run blacksite assets login in your own interactive terminal')
  const source = args[0] || 'all'
  if (!['fab', 'itch', 'all'].includes(source)) throw new Error('Choose fab|itch|all')
  if (source === 'fab' || source === 'all') {
    execute('assets', ['login', 'fab'])
    await new FabClient().secureSession()
  }
  if (source === 'itch' || source === 'all') {
    process.stderr.write('itch.io API key: ')
    const apiKey = await new Promise((resolve, reject) => {
      let data = ''
      process.stdin.setRawMode(true)
      process.stdin.resume()
      const receive = chunk => {
        const input = chunk.toString('utf8')
        if (input.includes('\u0003')) { process.stdin.off('data', receive); process.stdin.setRawMode(false); reject(new Error('Login cancelled')); return }
        if (input.includes('\r') || input.includes('\n')) { process.stdin.off('data', receive); process.stdin.setRawMode(false); process.stderr.write('\n'); resolve(data); return }
        data += input
      }
      process.stdin.on('data', receive)
    })
    if (!apiKey.trim()) throw new Error('An itch.io API key is required')
    const directory = path.join(userRoot, 'itch')
    await mkdir(directory, { recursive: true, mode: 0o700 })
    await writeFile(path.join(directory, 'session.json'), JSON.stringify({ apiKey: apiKey.trim() }), { mode: 0o600 })
    await chmod(path.join(directory, 'session.json'), 0o600)
  }
  process.stdout.write('Signed in. Run blacksite assets sync to refresh the owned index.\n')
}
async function logout(args) {
  const source = args[0] || 'all'
  if (!['fab', 'itch', 'all'].includes(source)) throw new Error('Choose fab|itch|all')
  if (source === 'fab' || source === 'all') await new FabClient().removeSession()
  if (source === 'itch' || source === 'all') await rm(path.join(userRoot, 'itch', 'session.json'), { force: true })
  process.stdout.write('Local sessions removed.\n')
}
async function sync(args) {
  const source = opt(args, '--source') || 'all'
  if (!['fab', 'itch', 'all'].includes(source)) throw new Error('Choose --source fab|itch|all')
  if (source === 'fab' || source === 'all') execute('assets', ['sync', 'fab'])
  if (source === 'itch' || source === 'all') {
    const file = path.join(userRoot, 'itch', 'session.json')
    const apiKey = process.env.ITCH_IO_API_KEY || (existsSync(file) ? JSON.parse(await readFile(file, 'utf8')).apiKey : undefined)
    if (!apiKey) throw new Error('Run blacksite assets login itch in your own terminal first')
    execute('assets', ['sync', 'itch'], { ...process.env, ITCH_IO_API_KEY: apiKey })
  }
  for (const selected of source === 'all' ? ['fab', 'itch'] : [source]) {
    if (!legacyRoot) continue
    const from = path.join(legacyRoot, `${selected}-library`)
    const to = path.join(dataRoot, `${selected}-library`)
    if (!existsSync(from)) continue
    await mkdir(to, { recursive: true })
    const names = (await readdir(from)).filter(name => name.endsWith('.md') && safeName(name))
    for (const name of names) {
      const origin = path.join(from, name)
      const destination = path.join(to, name)
      const sourceInfo = await stat(origin)
      const targetInfo = existsSync(destination) ? await stat(destination) : null
      if (!targetInfo || sourceInfo.size !== targetInfo.size || sourceInfo.mtimeMs > targetInfo.mtimeMs) await copyFile(origin, destination)
    }
    for (const name of await readdir(to)) if (name.endsWith('.md') && safeName(name) && !names.includes(name)) await rm(path.join(to, name))
  }
  process.stdout.write(`Indexed ${(await library()).length} owned assets.\n`)
}
async function assets(args) {
  const verb = args.shift()
  if (!verb) throw new Error('Use blacksite assets list|search|suggest|pick|add|formats, or assets --help')
  const items = await library()
  const project = opt(args, '--project')
  if (project && existsSync(path.join(project, 'assets.lock.json'))) {
    const manifest = JSON.parse(await readFile(path.join(project, 'assets.lock.json'), 'utf8'))
    const installed = new Set(manifest.assets.map(asset => asset.id))
    for (const item of items) item.status.inProject = installed.has(item.id)
  }
  if (verb === 'list' || verb === 'search') return output(rank(items, verb === 'search' ? args[0] || '' : '', args).slice(0, Number(opt(args, '--limit') || 25)).map(({ description, assetId, namespace, ...entry }) => entry), flag(args, '--json'))
  if (verb === 'suggest') {
    const idea = opt(args, '--idea') || ''
    if (!idea) throw new Error('Use --idea "game idea"')
    const roles = ['characters', 'environments', 'models', 'animations', 'materials', 'vfx', 'audio', 'ui']
    const roleWords = { characters: 'character soldier', environments: 'environment corridor level', models: 'props weapons', animations: 'movement animation', materials: 'texture material', vfx: 'impact particle', audio: 'footstep gunshot sound', ui: 'hud interface' }
    return output(Object.fromEntries(roles.map(role => [role, rank(items.filter(item => item.category === role), `${idea} ${roleWords[role]}`, args).slice(0, 5).map(({ description, assetId, namespace, ...entry }) => entry)])), flag(args, '--json'))
  }
  if (verb === 'formats') {
    const item = items.find(x => x.id === args[0])
    if (!item) throw new Error('Owned asset not found')
    const directory = path.join(cacheRoot, item.id)
    const cached = existsSync(directory) ? (await readdir(directory)).filter(safeName) : []
    return output({ id: item.id, formats: item.formats, cached }, flag(args, '--json'))
  }
  if (verb === 'pick') {
    if (!process.stdin.isTTY) throw new Error('Use blacksite assets add <id...> --project <dir> in noninteractive mode')
    const input = await import('node:readline/promises')
    const prompt = input.createInterface({ input: process.stdin, output: process.stderr })
    const found = rank(items, opt(args, '--idea') || '', args).slice(0, 20)
    found.forEach((item, index) => process.stderr.write(`${index + 1}. ${item.title} (${item.id})\n`))
    const selected = (await prompt.question('Pick numbers separated by commas: ')).split(',').map(s => found[Number(s.trim()) - 1]?.id).filter(Boolean)
    prompt.close()
    return add(selected, project, items, flag(args, '--json'))
  }
  if (verb === 'add' || verb === 'install') return add(args.filter(a => !a.startsWith('--') && a !== project), project, items, flag(args, '--json'))
  throw new Error(`Unknown assets command: ${verb}`)
}
async function add(ids, project, items, json) {
  if (!project || !path.isAbsolute(project)) throw new Error('Use --project <absolute directory>')
  if (!ids.length) throw new Error('Choose at least one owned asset ID')
  const { installAsset } = await import('./asset-install.mjs')
  for (const id of ids) {
    const item = items.find(x => x.id === id)
    if (!item) throw new Error(`Owned asset not found: ${id}`)
    await installAsset(item, project, path.join(cacheRoot, id), event => output(event, json))
  }
}
export async function runAssets(args) {
  const verb = args[0]
  if (['library', 'show', 'packs', 'fetch', 'build', 'lock', 'credits'].includes(verb)) return (await import('./library.mjs')).runLibrary(verb, args.slice(1))
  if (verb === 'add') {
    const { isLibraryId, runLibrary } = await import('./library.mjs')
    const ids = args.slice(1).filter((arg, i, list) => !arg.startsWith('--') && list[i - 1] !== '--project')
    const open = await Promise.all(ids.map(isLibraryId))
    if (args.includes('--pack') || (ids.length && open.every(Boolean))) return runLibrary('add', args.slice(1))
    if (open.some(Boolean)) throw new Error('Add open-library assets and owned assets in separate commands')
  }
  if (verb === 'login') return login(args.slice(1))
  if (verb === 'logout') return logout(args.slice(1))
  if (verb === 'status') return login(['--status'])
  if (verb === 'sync') return sync(args.slice(1))
  return assets(args)
}
