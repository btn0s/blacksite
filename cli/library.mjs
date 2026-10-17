import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = process.env.BLACKSITE_LIBRARY_CATALOG || path.join(repo, 'assets', 'catalog.json')
const cacheRoot = process.env.BLACKSITE_LIBRARY_CACHE_DIR || path.join(homedir(), '.cache', 'blacksite', 'library')
const buildRoot = process.env.BLACKSITE_LIBRARY_BUILD_DIR || path.join(repo, 'assets', '.build')
const opt = (args, name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1] }
const flag = (args, name) => args.includes(name)
const valued = ['--pack', '--project', '--category', '--from']
const positional = args => args.filter((arg, i) => !arg.startsWith('--') && !valued.includes(args[i - 1]))

export const LICENCES = {
  'CC0-1.0': { name: 'CC0 1.0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', attribution: false },
  'CC-BY-4.0': { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', attribution: true },
  'CC-BY-3.0': { name: 'CC BY 3.0', url: 'https://creativecommons.org/licenses/by/3.0/', attribution: true },
  'MIT': { name: 'MIT', url: 'https://opensource.org/license/mit', attribution: true, notice: true },
  'Apache-2.0': { name: 'Apache 2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0', attribution: true, notice: true },
  'BSD-2-Clause': { name: 'BSD 2-Clause', url: 'https://opensource.org/license/bsd-2-clause', attribution: true, notice: true },
  'BSD-3-Clause': { name: 'BSD 3-Clause', url: 'https://opensource.org/license/bsd-3-clause', attribution: true, notice: true },
  'Public-Domain': { name: 'Public domain', url: 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits', attribution: false },
}
const DENIED_HOSTS = /(unrealengine\.com|quixel|megascans|mixamo|sonniss|pixabay|bbcrewind|cgtrader|turbosquid|unity\.com|assetstore)/i
const EVIDENCE_HOSTS = [{ host: /(^|\.)fab\.com$/i, licences: ['CC-BY-4.0'], needs: ['page'] }, { host: /(^|\.)itch\.io$/i, licences: ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-3.0'], needs: ['page', 'file'] }]
const hostOf = url => { try { return new URL(url).hostname } catch { return '' } }
const CATEGORIES = ['material', 'hdri', 'prop', 'foliage', 'weapon', 'character', 'animation', 'sound', 'footstep', 'ambience', 'ir', 'terrain']
const skipped = name => /(login|token|secret|key|credential)/i.test(path.basename(name)) || path.basename(name).startsWith('.env')
const safeName = name => typeof name === 'string' && name.length > 0 && !/[\\\x00-\x1f:]/.test(name) && !path.posix.isAbsolute(name) && name.split('/').every(part => part && part !== '.' && part !== '..' && !skipped(part))
const validUrl = url => { try { const parsed = new URL(url); return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password } catch { return false } }

export async function loadCatalog() {
  return JSON.parse(await readFile(catalogPath, 'utf8'))
}

export function validate(catalog) {
  const problems = []
  if (!Array.isArray(catalog?.assets)) return ['Catalog needs an assets array']
  const ids = new Set()
  for (const entry of catalog.assets) {
    const at = entry.id || '(missing id)'
    if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(entry.id || '')) problems.push(`${at}: id must be kebab-case`)
    if (ids.has(entry.id)) problems.push(`${at}: duplicate id`)
    ids.add(entry.id)
    if (!CATEGORIES.includes(entry.category)) problems.push(`${at}: unknown category ${entry.category}`)
    const licence = LICENCES[entry.licence]
    if (!licence) problems.push(`${at}: licence ${entry.licence} is not on the allowlist`)
    if (licence?.attribution && !entry.attribution) problems.push(`${at}: ${entry.licence} needs attribution text`)
    if (licence?.notice && !entry.licenceNotice?.trim()) problems.push(`${at}: ${entry.licence} needs licenceNotice with its copyright, licence and any required upstream notices`)
    if (!entry.source?.url || !entry.author || !entry.title || !entry.use) problems.push(`${at}: needs title, author, use and source.url`)
    if (!validUrl(entry.source?.url)) problems.push(`${at}: invalid source URL`)
    const names = new Set()
    for (const file of entry.files ?? []) {
      if (!safeName(file.name)) problems.push(`${at}: unsafe file name ${file.name}`)
      if (names.has(file.name)) problems.push(`${at}: duplicate file name ${file.name}`)
      names.add(file.name)
      if (!validUrl(file.url)) problems.push(`${at}: invalid file URL`)
      if (DENIED_HOSTS.test(hostOf(file.url))) problems.push(`${at}: ${file.url} is a denied host`)
      if (file.sha256 && !/^[a-f0-9]{64}$/.test(file.sha256)) problems.push(`${at}: invalid sha256 for ${file.name}`)
      if (file.include) { try { new RegExp(file.include, 'i') } catch { problems.push(`${at}: invalid include expression for ${file.name}`) } }
    }
    if (DENIED_HOSTS.test(hostOf(entry.source?.url ?? ''))) problems.push(`${at}: source host is denied`)
    for (const rule of EVIDENCE_HOSTS) {
      if (![entry.source?.url, ...(entry.files ?? []).map(file => file.url)].some(url => rule.host.test(hostOf(url ?? '')))) continue
      if (!rule.licences.includes(entry.licence)) problems.push(`${at}: only ${rule.licences.join(', ')} is accepted from this store`)
      for (const need of rule.needs) if (!entry.licenceEvidence?.[need]) problems.push(`${at}: needs licenceEvidence.${need} quoting the ${need === 'page' ? 'listing page' : 'licence file in the download'}`)
      if (entry.acquire !== 'manual') problems.push(`${at}: store entries require manual acquisition`)
    }
    if (!entry.files?.length && !['polyhaven', 'ambientcg'].includes(entry.source?.site)) problems.push(`${at}: needs files`)
  }
  for (const pack of Object.values(catalog.packs ?? {})) for (const id of pack.assets) if (!ids.has(id)) problems.push(`pack references unknown asset ${id}`)
  return problems
}

async function json(url) {
  const response = await fetch(url, { headers: { 'user-agent': 'blacksite-asset-library' } })
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
  return response.json()
}

async function resolvePolyHaven(entry) {
  const id = entry.source.id
  const data = await json(`https://api.polyhaven.com/files/${id}`)
  const res = entry.source.resolution ?? (entry.category === 'hdri' ? '2k' : entry.category === 'material' ? '2k' : '1k')
  if (entry.category === 'hdri') {
    const file = data.hdri?.[res]?.hdr
    if (!file) throw new Error(`${entry.id}: Poly Haven has no ${res} HDR`)
    return [{ url: file.url, name: path.basename(new URL(file.url).pathname) }]
  }
  if (entry.category === 'material') {
    const files = []
    const wanted = [['Diffuse', 'jpg'], ['nor_gl', 'jpg'], ['arm', 'jpg'], ['Rough', 'jpg'], ['AO', 'jpg']]
    for (const [map, format] of wanted) {
      const file = data[map]?.[res]?.[format] ?? data[map]?.[res]?.png
      if (file) files.push({ url: file.url, name: path.basename(new URL(file.url).pathname) })
    }
    if (files.some(file => /_arm_/.test(file.name))) return files.filter(file => !/_(rough|ao)_/.test(file.name))
    return files
  }
  const gltf = data.gltf?.[res]?.gltf
  if (!gltf) throw new Error(`${entry.id}: Poly Haven has no ${res} glTF`)
  return [{ url: gltf.url, name: path.basename(new URL(gltf.url).pathname) }, ...Object.entries(gltf.include ?? {}).map(([name, file]) => ({ url: file.url, name }))]
}

async function resolveAmbientCG(entry) {
  const data = await json(`https://ambientcg.com/api/v2/full_json?id=${encodeURIComponent(entry.source.id)}&include=downloadData`)
  const asset = data.foundAssets?.[0]
  const attribute = entry.source.attribute ?? '2K-JPG'
  const download = asset?.downloadFolders?.default?.downloadFiletypeCategories?.zip?.downloads?.find(d => d.attribute === attribute)
  if (!download) throw new Error(`${entry.id}: ambientCG has no ${attribute} download`)
  return [{ url: download.fullDownloadPath, name: download.fileName, extract: true }]
}

async function download(url, target) {
  const response = await fetch(url, { headers: { 'user-agent': 'blacksite-asset-library/1.0 (open asset library fetcher; one download per user request)' }, redirect: 'follow' })
  if (!response.ok || !response.body) throw new Error(`${url}: HTTP ${response.status}`)
  await mkdir(path.dirname(target), { recursive: true })
  const partial = `${target}.part`
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial))
  await rename(partial, target)
}

async function sha256(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

async function extract(archive, directory, include) {
  const wanted = include ? new RegExp(include, 'i') : undefined
  if (/\.7z$/i.test(archive)) return extract7z(archive, directory, wanted)
  const yauzl = (await import('yauzl')).default
  const zip = await new Promise((resolve, reject) => yauzl.open(archive, { lazyEntries: true }, (error, value) => error ? reject(error) : resolve(value)))
  let count = 0
  await new Promise((resolve, reject) => {
    const fail = error => { zip.close(); reject(error) }
    zip.on('error', fail)
    zip.on('end', resolve)
    zip.on('entry', item => {
      const name = item.fileName.replaceAll('\\', '/')
      const kind = (item.externalFileAttributes >>> 16) & 0o170000
      if (!safeName(name) || name.endsWith('/') || (kind && kind !== 0o100000) || (wanted && !wanted.test(name))) { zip.readEntry(); return }
      const target = safeTarget(directory, name)
      zip.openReadStream(item, (error, stream) => {
        if (error) return fail(error)
        mkdir(path.dirname(target), { recursive: true }).then(() => pipeline(stream, createWriteStream(target))).then(() => { count++; zip.readEntry() }, fail)
      })
    })
    zip.readEntry()
  })
  if (!count) throw new Error(`${path.basename(archive)}: no matching regular files`)
}

async function extract7z(archive, directory, wanted) {
  const SevenZip = (await import('7z-wasm')).default
  const lines = []
  const sz = await SevenZip({ print: line => lines.push(line), printErr: line => lines.push(line) })
  await mkdir(directory, { recursive: true })
  sz.FS.mkdir('/in')
  sz.FS.mkdir('/out')
  sz.FS.mount(sz.NODEFS, { root: path.dirname(archive) }, '/in')
  const input = `/in/${path.basename(archive)}`
  const run = args => {
    let code
    try { code = sz.callMain([...args, '-bd']) } catch { throw new Error(`${path.basename(archive)}: 7z failed: ${lines.slice(-5).join(' ')}`) }
    if (code !== 0) throw new Error(`${path.basename(archive)}: 7z exited ${code}: ${lines.slice(-5).join(' ')}`)
  }
  try {
    run(['l', '-slt', '-ba', input])
    const records = lines.join('\n').split(/\n\s*\n/).map(block => Object.fromEntries(block.split('\n').map(line => { const at = line.indexOf(' = '); return at < 0 ? [] : [line.slice(0, at), line.slice(at + 3)] }).filter(pair => pair.length === 2)))
    const chosen = records.filter(record => record.Path && record.Folder !== '+' && !/^D|\sl/.test(record.Attributes ?? '') && !record['Symbolic Link'] && !record['Hard Link']).map(record => record.Path).filter(name => safeName(name) && (!wanted || wanted.test(name)))
    if (!chosen.length) throw new Error(`${path.basename(archive)}: no matching regular files`)
    sz.FS.writeFile('/list.txt', chosen.join('\n'))
    lines.length = 0
    run(['x', input, '-o/out', '-y', '-spd', '@/list.txt'])
    for (const name of chosen) {
      const source = `/out/${name}`
      if (!sz.FS.isFile(sz.FS.lstat(source).mode)) throw new Error(`${path.basename(archive)}: not a regular file: ${name}`)
      const target = safeTarget(directory, name)
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, sz.FS.readFile(source))
      sz.FS.unlink(source)
    }
  } finally { sz.FS.unmount('/in') }
}

function safeTarget(directory, name) {
  if (!safeName(name)) throw new Error(`Unsafe file name ${name}`)
  const target = path.resolve(directory, name)
  if (!target.startsWith(path.resolve(directory) + path.sep)) throw new Error(`Unsafe file name ${name}`)
  return target
}

async function sourceInventory(directory, prefix = '') {
  const files = []
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + item.name
    if (!safeName(name) || item.name === '.build-state.json') continue
    const full = safeTarget(directory, item.name)
    if (item.isDirectory()) files.push(...await sourceInventory(full, `${name}/`))
    else if (item.isFile()) files.push({ name, size: (await stat(full)).size, sha256: await sha256(full) })
  }
  return files.sort((a, b) => a.name.localeCompare(b.name))
}

async function validSource(directory, recorded) {
  if (!existsSync(directory)) return false
  const actual = await sourceInventory(directory)
  return actual.length > 0 && (!recorded || JSON.stringify(actual) === JSON.stringify(recorded))
}

export async function fetchAsset(entry, { force = false, update = false, from, log = () => {} } = {}) {
  const problems = validate({ assets: [entry] })
  if (problems.length) throw new Error(problems.join('\n'))
  const directory = safeTarget(cacheRoot, entry.id)
  const source = path.join(directory, 'source')
  let files = entry.files
  if (!files?.length || update) {
    const resolved = entry.source.site === 'polyhaven' ? await resolvePolyHaven(entry) : entry.source.site === 'ambientcg' ? await resolveAmbientCG(entry) : entry.files
    const known = new Map((entry.files ?? []).map(file => [file.name, file]))
    files = (resolved ?? []).map(file => ({ ...known.get(file.name), ...file }))
  }
  const resolvedProblems = validate({ assets: [{ ...entry, files }] })
  if (!files?.length) throw new Error(`${entry.id}: source resolved no files`)
  if (resolvedProblems.length) throw new Error(resolvedProblems.join('\n'))
  const done = path.join(directory, 'fetched.json')
  if (!force && !update && !from && existsSync(done)) {
    const previous = JSON.parse(await readFile(done, 'utf8'))
    const matches = previous.files.length === files.length && files.every(file => previous.files.some(old => old.name === file.name && old.url === file.url && Boolean(old.extract) === Boolean(file.extract) && old.include === file.include && (!file.sha256 || file.sha256 === old.sha256)))
    if (matches && await validSource(source, previous.sourceFiles)) return { directory: source, files: previous.files, cached: true }
  }
  if (entry.acquire === 'manual' && !from) throw new Error(`${entry.id}: ${entry.source.site ?? 'this source'} requires manual acquisition. Download ${files.map(file => file.name).join(', ')} from ${entry.source.url}, then run blacksite assets fetch ${entry.id} --from <file or folder>.`)
  let fromDirectory = false
  if (from) {
    if (skipped(from)) throw new Error('Refusing a protected input file name')
    const info = await lstat(from)
    fromDirectory = info.isDirectory()
    if (!fromDirectory && !info.isFile()) throw new Error('--from must be a regular file or directory')
    if (!fromDirectory && files.length !== 1) throw new Error('Use --from <directory> for an asset with multiple files')
  }
  await mkdir(cacheRoot, { recursive: true })
  const staging = await mkdtemp(path.join(cacheRoot, `.${entry.id}-`))
  const downloads = path.join(staging, 'download')
  const stagedSource = path.join(staging, 'source')
  const recorded = []
  try {
    for (const file of files) {
      const local = from && (fromDirectory ? safeTarget(from, file.name) : from)
      if (local && !(await lstat(local)).isFile()) throw new Error(`${file.name}: local source must be a regular file`)
      const localName = local && !fromDirectory && file.extract ? file.name.replace(/\.[^.]+$/, '') + path.extname(local) : file.name
      const target = safeTarget(downloads, localName)
      await mkdir(path.dirname(target), { recursive: true })
      log(`fetch ${entry.id}: ${file.name}`)
      const stored = file.sha256 && path.join(cacheRoot, '.downloads', file.sha256)
      if (local) await cp(local, target)
      else if (!update && file.extract && stored && existsSync(stored)) await cp(stored, target)
      else await download(file.url, target)
      const hash = await sha256(target)
      const size = (await stat(target)).size
      if (file.sha256 && file.sha256 !== hash && !update) throw new Error(`${entry.id}: ${file.name} changed upstream (sha256 ${hash.slice(0, 12)} != ${file.sha256.slice(0, 12)}). Review it, then rerun with --update.`)
      recorded.push({ name: file.name, url: file.url, sha256: hash, size, ...(file.extract ? { extract: true } : {}), ...(file.include ? { include: file.include } : {}) })
      if (file.extract) {
        await extract(target, stagedSource, file.include)
        const keep = path.join(cacheRoot, '.downloads', hash)
        if (!existsSync(keep)) { await mkdir(path.dirname(keep), { recursive: true }); await rename(target, keep) }
      } else {
        const out = safeTarget(stagedSource, file.name)
        await mkdir(path.dirname(out), { recursive: true })
        await cp(target, out)
      }
    }
    await rm(downloads, { recursive: true, force: true })
    const sourceFiles = await sourceInventory(stagedSource)
    await writeFile(path.join(staging, 'fetched.json'), JSON.stringify({ id: entry.id, files: recorded, sourceFiles }, null, 2))
    await rm(directory, { recursive: true, force: true })
    await rename(staging, directory)
    return { directory: source, files: recorded, cached: false }
  } finally { await rm(staging, { recursive: true, force: true }) }
}

export async function buildAsset(entry, options = {}) {
  const fetched = await fetchAsset(entry, options)
  const out = options.out ?? path.join(buildRoot, entry.id)
  const fingerprint = createHash('sha256').update(JSON.stringify({ entry, files: fetched.files, ktx2: options.ktx2 !== false, processor: await sha256(path.join(repo, 'assets/scripts/process.mjs')), dependencies: await sha256(path.join(repo, 'package.json')) })).digest('hex')
  const stateFile = path.join(out, '.build-state.json')
  if (!options.force && existsSync(stateFile) && existsSync(path.join(out, 'asset.json'))) {
    const state = JSON.parse(await readFile(stateFile, 'utf8'))
    if (state.fingerprint === fingerprint && await validSource(out, state.files)) return { fetched, manifest: JSON.parse(await readFile(path.join(out, 'asset.json'), 'utf8')), out, cached: true }
  }
  const { processAsset } = await import('../assets/scripts/process.mjs')
  await mkdir(path.dirname(out), { recursive: true })
  const staging = await mkdtemp(path.join(path.dirname(out), `.${entry.id}-`))
  try {
    const manifest = await processAsset({ ...entry, process: { ...(entry.dimensions ? { dimensions: entry.dimensions } : {}), ...entry.process } }, fetched.directory, staging, { ktx2: options.ktx2 })
    if (entry.licenceNotice) {
      await writeFile(path.join(staging, 'LICENSE.txt'), entry.licenceNotice + '\n')
      manifest.files['LICENSE.txt'] = (await stat(path.join(staging, 'LICENSE.txt'))).size
      await writeFile(path.join(staging, 'asset.json'), JSON.stringify(manifest, null, 2))
    }
    await writeFile(path.join(staging, '.build-state.json'), JSON.stringify({ fingerprint, files: await sourceInventory(staging) }, null, 2))
    await rm(out, { recursive: true, force: true })
    await rename(staging, out)
    return { fetched, manifest, out, cached: false }
  } finally { await rm(staging, { recursive: true, force: true }) }
}

function attribution(entry) {
  return entry.attribution || `"${entry.title}" by ${entry.author}, ${LICENCES[entry.licence].name} (${entry.source.url})`
}

export function creditsMarkdown(assets, heading = 'Credits') {
  const lines = [`# ${heading}`, '', 'Assets from the Blacksite open library, fetched from recorded sources or licensed mirrors and processed for the web.', '']
  const byLicence = new Map()
  for (const asset of [...assets].sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id))) {
    if (!byLicence.has(asset.licence)) byLicence.set(asset.licence, [])
    byLicence.get(asset.licence).push(asset)
  }
  for (const [licence, list] of [...byLicence].sort(([a], [b]) => (a === 'CC0-1.0' ? -1 : b === 'CC0-1.0' ? 1 : a.localeCompare(b)))) {
    const info = LICENCES[licence]
    lines.push(`## ${info.name}`, '', `Licence: ${info.url}`, '')
    lines.push('| Asset | Category | Author | Source |' + (info.attribution ? ' Attribution |' : ''), '| --- | --- | --- | --- |' + (info.attribution ? ' --- |' : ''))
    const cell = value => String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ')
    for (const asset of list) lines.push(`| \`${asset.id}\` ${cell(asset.title)} | ${asset.category} | ${cell(asset.author)} | [${new URL(asset.source.url).hostname}](${asset.source.url}) |` + (info.attribution ? ` ${cell(asset.attribution)} |` : ''))
    lines.push('')
    for (const notice of new Set(list.map(asset => asset.licenceNotice).filter(Boolean))) lines.push(notice, '')
  }
  return lines.join('\n')
}

async function writeCredits(project, entries) {
  const file = path.join(project, 'assets.credits.json')
  const current = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : { version: 1, assets: [] }
  const map = new Map(current.assets.map(asset => [asset.id, asset]))
  for (const entry of entries) map.set(entry.id, { id: entry.id, title: entry.title, category: entry.category, author: entry.author, licence: entry.licence, ...(entry.licenceNotice ? { licenceNotice: entry.licenceNotice } : {}), source: { url: entry.source.url }, attribution: attribution(entry), files: entry.files?.map(({ name, sha256, size }) => ({ name, sha256, size })) ?? [] })
  const assets = [...map.values()].sort((a, b) => a.id.localeCompare(b.id))
  await writeFile(file, JSON.stringify({ version: 1, assets }, null, 2) + '\n')
  await writeFile(path.join(project, 'CREDITS.md'), creditsMarkdown(assets))
  return assets
}

function select(catalog, args) {
  const pack = opt(args, '--pack')
  const ids = [...positional(args), ...(pack ? catalog.packs?.[pack]?.assets ?? [] : [])]
  if (pack && !catalog.packs?.[pack]) throw new Error(`Unknown pack ${pack}. Packs: ${Object.keys(catalog.packs ?? {}).join(', ')}`)
  if (flag(args, '--all')) return catalog.assets
  const entries = [...new Set(ids)].map(id => catalog.assets.find(asset => asset.id === id) ?? (() => { throw new Error(`Not in the open library: ${id}`) })())
  if (!entries.length) throw new Error('Choose asset ids or --pack <name>')
  return entries
}

function out(value, json) { process.stdout.write(json ? `${JSON.stringify(value)}\n` : `${typeof value === 'string' ? value : JSON.stringify(value, null, 2)}\n`) }

export async function isLibraryId(id) {
  if (!existsSync(catalogPath)) return false
  return (await loadCatalog()).assets.some(asset => asset.id === id)
}

export async function runLibrary(verb, args) {
  const catalog = await loadCatalog()
  const json = flag(args, '--json')
  const log = message => process.stderr.write(`${message}\n`)
  if (verb === 'library') {
    if (flag(args, '--check')) {
      const problems = validate(catalog)
      if (problems.length) { out(problems.join('\n')); process.exitCode = 1 } else out(`Library OK: ${catalog.assets.length} assets, ${Object.keys(catalog.packs ?? {}).length} packs`)
      return
    }
    const query = (positional(args)[0] || '').toLowerCase()
    const category = opt(args, '--category')
    const found = catalog.assets.filter(asset => (!category || asset.category === category) && (!query || `${asset.id} ${asset.title} ${asset.tags.join(' ')} ${asset.use}`.toLowerCase().includes(query)))
    if (json) return out(found.map(({ files, process, ...asset }) => asset), true)
    for (const asset of found) process.stdout.write(`${asset.id.padEnd(34)} ${asset.category.padEnd(10)} ${LICENCES[asset.licence].name.padEnd(10)} ${asset.title}\n`)
    if (!found.length) process.stdout.write('No matches. Try blacksite assets library --category material\n')
    return
  }
  if (verb === 'show') return out(select(catalog, args)[0], json)
  if (verb === 'packs') return out(json ? catalog.packs : Object.entries(catalog.packs ?? {}).map(([name, pack]) => `${name.padEnd(16)} ${pack.assets.length} assets  ${pack.description}`).join('\n'), json)
  if (verb === 'fetch') {
    for (const entry of select(catalog, args)) {
      const from = opt(args, '--from')
      const result = await fetchAsset(entry, { force: flag(args, '--force') || Boolean(from), update: flag(args, '--update'), from: from && path.resolve(from), log })
      out({ id: entry.id, cached: result.cached, directory: result.directory, files: result.files.map(({ name, size, sha256 }) => ({ name, size, sha256 })) }, json)
    }
    return
  }
  if (verb === 'build') {
    if (flag(args, '--index-only')) { await writeIndex(catalog); return out('Library index regenerated', json) }
    const summary = []
    const failed = []
    for (const entry of select(catalog, args)) {
      if (entry.acquire === 'manual' && !existsSync(path.join(cacheRoot, entry.id, 'fetched.json'))) { log(`skip ${entry.id}: download it yourself from ${entry.source.url}, then blacksite assets fetch ${entry.id} --from <file>`); continue }
      let manifest, cached
      try { ({ manifest, cached } = await buildAsset(entry, { force: flag(args, '--force'), update: flag(args, '--update'), ktx2: !flag(args, '--no-ktx2'), log })) } catch (error) { failed.push(entry.id); log(`failed ${entry.id}: ${error instanceof Error ? error.message : error}`); continue }
      summary.push(manifest)
      log(`${cached ? 'cached' : 'built'} ${entry.id}: ${manifest.bytes} B${manifest.withinBudget ? '' : ` OVER BUDGET (${manifest.over.join(', ')})`}`)
    }
    await writeIndex(catalog)
    if (failed.length) process.exitCode = 1
    return out(json ? { built: summary, failed } : `${summary.length} built into ${path.relative(process.cwd(), buildRoot) || buildRoot}${failed.length ? `; failed: ${failed.join(', ')}` : ''}`, json)
  }
  if (verb === 'lock') {
    for (const entry of select(catalog, args)) {
      if (entry.acquire === 'manual') { log(`skip ${entry.id}: manual acquisition`); continue }
      const result = await fetchAsset(entry, { force: true, update: true, log })
      entry.files = result.files
      await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n')
    }
    await writeFile(catalogPath, JSON.stringify(catalog, null, 2) + '\n')
    return out('Catalog hashes updated')
  }
  if (verb === 'add') {
    const project = opt(args, '--project')
    if (!project || !path.isAbsolute(project) || !existsSync(project) || !(await stat(project)).isDirectory()) throw new Error('Use --project <absolute existing directory>')
    const entries = select(catalog, args)
    for (const entry of entries) {
      const target = path.join(project, 'public', 'assets', 'library', entry.id)
      const { manifest, fetched, out: built } = await buildAsset(entry, { ktx2: !flag(args, '--no-ktx2'), log, update: flag(args, '--update'), force: flag(args, '--force') })
      await mkdir(path.dirname(target), { recursive: true })
      const staging = await mkdtemp(path.join(path.dirname(target), `.${entry.id}-`))
      try {
        await cp(built, staging, { recursive: true, filter: file => path.basename(file) !== '.build-state.json' })
        await rm(target, { recursive: true, force: true })
        await rename(staging, target)
      } finally { await rm(staging, { recursive: true, force: true }) }
      await writeCredits(project, [{ ...entry, files: fetched.files }])
      out({ step: 'install', id: entry.id, path: path.relative(project, target), bytes: manifest.bytes, withinBudget: manifest.withinBudget }, json)
    }
    return out(json ? { credits: 'CREDITS.md' } : `Recorded ${entries.length} assets in CREDITS.md`, json)
  }
  if (verb === 'credits') {
    const project = opt(args, '--project')
    if (project) {
      const file = path.join(project, 'assets.credits.json')
      if (!existsSync(file)) throw new Error('No assets.credits.json in that project')
      const credits = JSON.parse(await readFile(file, 'utf8'))
      await writeFile(path.join(project, 'CREDITS.md'), creditsMarkdown(credits.assets))
      return out('CREDITS.md regenerated')
    }
    return out(creditsMarkdown(select(catalog, args).map(entry => ({ ...entry, attribution: attribution(entry) }))))
  }
  throw new Error(`Unknown library command ${verb}`)
}

async function writeIndex(catalog) {
  await mkdir(buildRoot, { recursive: true })
  const assets = []
  for (const entry of catalog.assets) {
    const file = path.join(buildRoot, entry.id, 'asset.json')
    if (!existsSync(file)) continue
    const { files, process, ...meta } = entry
    assets.push({ ...meta, attribution: attribution(entry), sourceBytes: (files ?? []).reduce((sum, f) => sum + (f.size ?? 0), 0), build: JSON.parse(await readFile(file, 'utf8')) })
  }
  const basis = path.join(repo, 'node_modules', 'three', 'examples', 'jsm', 'libs', 'basis')
  if (existsSync(basis)) await cp(basis, path.join(buildRoot, 'basis'), { recursive: true })
  await writeFile(path.join(buildRoot, 'index.json'), JSON.stringify({ generated: new Date().toISOString(), packs: catalog.packs, assets }, null, 2))
  await writeFile(path.join(buildRoot, 'CREDITS.md'), creditsMarkdown(assets))
}
