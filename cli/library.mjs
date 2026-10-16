import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { createWriteStream, existsSync } from 'node:fs'
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
  'MIT': { name: 'MIT', url: 'https://opensource.org/license/mit', attribution: true },
  'Public-Domain': { name: 'Public domain', url: 'https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits', attribution: false },
}
const DENIED_HOSTS = /(unrealengine\.com|quixel|megascans|mixamo|sonniss|pixabay|bbcrewind|cgtrader|turbosquid|unity\.com|assetstore)/i
const EVIDENCE_HOSTS = [{ host: /(^|\.)fab\.com$/i, licences: ['CC-BY-4.0'], needs: ['page'] }, { host: /(^|\.)itch\.io$/i, licences: ['CC0-1.0', 'CC-BY-4.0', 'CC-BY-3.0'], needs: ['page', 'file'] }]
const hostOf = url => { try { return new URL(url).hostname } catch { return '' } }
const CATEGORIES = ['material', 'hdri', 'prop', 'foliage', 'weapon', 'character', 'animation', 'sound', 'footstep', 'ambience', 'ir', 'terrain']

export async function loadCatalog() {
  return JSON.parse(await readFile(catalogPath, 'utf8'))
}

export function validate(catalog) {
  const problems = []
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
    if (!entry.source?.url || !entry.author || !entry.title || !entry.use) problems.push(`${at}: needs title, author, use and source.url`)
    for (const file of entry.files ?? []) if (DENIED_HOSTS.test(file.url)) problems.push(`${at}: ${file.url} is a denied host`)
    if (DENIED_HOSTS.test(entry.source?.url ?? '')) problems.push(`${at}: source host is denied`)
    for (const rule of EVIDENCE_HOSTS) {
      if (![entry.source?.url, ...(entry.files ?? []).map(file => file.url)].some(url => rule.host.test(hostOf(url ?? '')))) continue
      if (!rule.licences.includes(entry.licence)) problems.push(`${at}: only ${rule.licences.join(', ')} is accepted from this store`)
      for (const need of rule.needs) if (!entry.licenceEvidence?.[need]) problems.push(`${at}: needs licenceEvidence.${need} quoting the ${need === 'page' ? 'listing page' : 'licence file in the download'}`)
      if (entry.acquire !== 'manual') problems.push(`${at}: store downloads need a login, so acquire must be manual`)
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
  return createHash('sha256').update(await readFile(file)).digest('hex')
}

async function extract(zip, directory) {
  const yauzl = (await import('yauzl')).default
  const archive = await new Promise((resolve, reject) => yauzl.open(zip, { lazyEntries: true }, (error, value) => error ? reject(error) : resolve(value)))
  await new Promise((resolve, reject) => {
    archive.on('error', reject)
    archive.on('end', resolve)
    archive.on('entry', item => {
      const name = item.fileName.replaceAll('\\', '/')
      const target = path.resolve(directory, name)
      if (!target.startsWith(path.resolve(directory) + path.sep) || name.endsWith('/') || /(login|token|secret|key|credential)/i.test(path.basename(name))) { archive.readEntry(); return }
      archive.openReadStream(item, async (error, stream) => {
        if (error) return reject(error)
        await mkdir(path.dirname(target), { recursive: true })
        pipeline(stream, createWriteStream(target)).then(() => archive.readEntry(), reject)
      })
    })
    archive.readEntry()
  })
}

function safeTarget(directory, name) {
  const target = path.resolve(directory, name)
  if (!target.startsWith(path.resolve(directory) + path.sep)) throw new Error(`Unsafe file name ${name}`)
  return target
}

export async function fetchAsset(entry, { force = false, update = false, from, log = () => {} } = {}) {
  const directory = path.join(cacheRoot, entry.id)
  const downloads = path.join(directory, 'download')
  const source = path.join(directory, 'source')
  let files = entry.files
  if (!files?.length || update) {
    const resolved = entry.source.site === 'polyhaven' ? await resolvePolyHaven(entry) : entry.source.site === 'ambientcg' ? await resolveAmbientCG(entry) : entry.files
    const known = new Map((entry.files ?? []).map(file => [file.name, file]))
    files = resolved.map(file => ({ ...known.get(file.name), ...file }))
  }
  const done = path.join(directory, 'fetched.json')
  if (!force && existsSync(done)) {
    const previous = JSON.parse(await readFile(done, 'utf8'))
    if (previous.files.every(file => files.some(f => f.name === file.name && (!f.sha256 || f.sha256 === file.sha256)))) return { directory: source, files: previous.files, cached: true }
  }
  if (entry.acquire === 'manual' && !from) throw new Error(`${entry.id}: ${entry.source.site} does not allow scripted downloads. Download ${files.map(file => file.name).join(', ')} yourself from ${entry.source.url}, then run blacksite assets fetch ${entry.id} --from <file or folder>.`)
  await rm(directory, { recursive: true, force: true })
  const recorded = []
  for (const file of files) {
    const local = from && ((await stat(from)).isDirectory() ? path.join(from, file.name) : from)
    const target = safeTarget(downloads, local && !existsSync(path.join(from, file.name)) ? file.name.replace(/\.[^.]+$/, '') + path.extname(local) : file.name)
    log(`fetch ${entry.id}: ${file.name}`)
    if (local) await cp(local, target)
    else await download(file.url, target)
    const hash = await sha256(target)
    const size = (await stat(target)).size
    if (file.sha256 && file.sha256 !== hash && !update) throw new Error(`${entry.id}: ${file.name} changed upstream (sha256 ${hash.slice(0, 12)} != ${file.sha256.slice(0, 12)}). Review it, then rerun with --update.`)
    recorded.push({ name: file.name, url: file.url, sha256: hash, size, ...(file.extract ? { extract: true } : {}) })
    if (file.extract) await extract(target, source)
    else { const out = safeTarget(source, path.relative(downloads, target)); await mkdir(path.dirname(out), { recursive: true }); await cp(target, out) }
  }
  await rm(downloads, { recursive: true, force: true })
  await writeFile(done, JSON.stringify({ id: entry.id, fetched: new Date().toISOString(), files: recorded }, null, 2))
  return { directory: source, files: recorded, cached: false }
}

export async function buildAsset(entry, options = {}) {
  const fetched = await fetchAsset(entry, options)
  const { processAsset } = await import('../assets/scripts/process.mjs')
  const out = options.out ?? path.join(buildRoot, entry.id)
  const manifest = await processAsset({ ...entry, process: { ...(entry.dimensions ? { dimensions: entry.dimensions } : {}), ...entry.process } }, fetched.directory, out, { ktx2: options.ktx2 })
  return { fetched, manifest, out }
}

function attribution(entry) {
  return entry.attribution || `"${entry.title}" by ${entry.author}, ${LICENCES[entry.licence].name} (${entry.source.url})`
}

export function creditsMarkdown(assets, heading = 'Credits') {
  const lines = [`# ${heading}`, '', 'Assets from the Blacksite open library. Every file was fetched from its original source and processed for the web.', '']
  const byLicence = new Map()
  for (const asset of [...assets].sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id))) {
    if (!byLicence.has(asset.licence)) byLicence.set(asset.licence, [])
    byLicence.get(asset.licence).push(asset)
  }
  for (const [licence, list] of [...byLicence].sort(([a], [b]) => (a === 'CC0-1.0' ? -1 : b === 'CC0-1.0' ? 1 : a.localeCompare(b)))) {
    const info = LICENCES[licence]
    lines.push(`## ${info.name}`, '', `Licence: ${info.url}`, '')
    lines.push('| Asset | Category | Author | Source |' + (info.attribution ? ' Attribution |' : ''), '| --- | --- | --- | --- |' + (info.attribution ? ' --- |' : ''))
    for (const asset of list) lines.push(`| \`${asset.id}\` ${asset.title} | ${asset.category} | ${asset.author} | [${new URL(asset.source.url).hostname}](${asset.source.url}) |` + (info.attribution ? ` ${asset.attribution} |` : ''))
    lines.push('')
  }
  return lines.join('\n')
}

async function writeCredits(project, entries) {
  const file = path.join(project, 'assets.credits.json')
  const current = existsSync(file) ? JSON.parse(await readFile(file, 'utf8')) : { version: 1, assets: [] }
  const map = new Map(current.assets.map(asset => [asset.id, asset]))
  for (const entry of entries) map.set(entry.id, { id: entry.id, title: entry.title, category: entry.category, author: entry.author, licence: entry.licence, source: { url: entry.source.url }, attribution: attribution(entry), files: entry.files?.map(({ name, sha256, size }) => ({ name, sha256, size })) ?? [] })
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
  const entries = ids.map(id => catalog.assets.find(asset => asset.id === id) ?? (() => { throw new Error(`Not in the open library: ${id}`) })())
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
    const summary = []
    const failed = []
    for (const entry of select(catalog, args)) {
      if (entry.acquire === 'manual' && !existsSync(path.join(cacheRoot, entry.id, 'fetched.json'))) { log(`skip ${entry.id}: download it yourself from ${entry.source.url}, then blacksite assets fetch ${entry.id} --from <file>`); continue }
      let manifest
      try { ({ manifest } = await buildAsset(entry, { force: flag(args, '--force'), update: flag(args, '--update'), ktx2: !flag(args, '--no-ktx2'), log })) } catch (error) { failed.push(entry.id); log(`failed ${entry.id}: ${error instanceof Error ? error.message : error}`); continue }
      summary.push(manifest)
      log(`built ${entry.id}: ${manifest.bytes} B${manifest.withinBudget ? '' : ` OVER BUDGET (${manifest.over.join(', ')})`}`)
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
    if (!project || !path.isAbsolute(project) || !existsSync(project)) throw new Error('Use --project <absolute existing directory>')
    const entries = select(catalog, args)
    for (const entry of entries) {
      const target = path.join(project, 'public', 'assets', 'library', entry.id)
      const { manifest } = await buildAsset(entry, { out: target, ktx2: !flag(args, '--no-ktx2'), log, update: flag(args, '--update') })
      out({ step: 'install', id: entry.id, path: path.relative(project, target), bytes: manifest.bytes, withinBudget: manifest.withinBudget }, json)
    }
    await writeCredits(project, entries)
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
