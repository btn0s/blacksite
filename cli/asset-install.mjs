import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { FabClient } from './fab-port/fab.mjs'
import { installAsset as optimizeAndInstall } from './pipeline-port/pipeline.mjs'

const safe = value => !/(login|token|secret|key|credential)/i.test(value) && !value.startsWith('.env')
async function cachedSource(directory) {
  if (!existsSync(directory)) return undefined
  for (const name of await readdir(directory)) if (safe(name) && /\.(glb|gltf|fbx|usd|usda|usdc|usdz|zip)$/i.test(name)) return path.join(directory, name)
  return undefined
}
export async function installAsset(item, project, directory, progress) {
  if (!path.isAbsolute(project) || !existsSync(project)) throw new Error('Project must be an existing absolute directory')
  const scratch = await mkdtemp(path.join(tmpdir(), 'blacksite-asset-'))
  try {
    let source = await cachedSource(directory)
    if (!source && item.source === 'fab') {
      progress({ step: 'fetch', status: 'start', message: 'Downloading owned Fab format' })
      const client = new FabClient({ cacheDir: directory })
      source = await client.download(item, undefined, directory)
      progress({ step: 'fetch', status: 'done', message: 'Owned Fab format downloaded' })
    }
    if (!source) throw new Error('Owned format is not cached. Download it into BLACKSITE_ASSET_CACHE_DIR/<id> before installation.')
    const manifestPath = path.join(project, 'assets.lock.json')
    const manifest = existsSync(manifestPath) ? JSON.parse(await readFile(manifestPath, 'utf8')) : { version: 1, assets: [] }
    const { encodeToKTX2 } = await import('ktx2-encoder')
    const next = await optimizeAndInstall(item, source, scratch, (stage, amount, message) => progress({ step: stage, status: amount === 100 ? 'done' : 'progress', progress: amount, message }), manifest, {
      projectDir: project,
      scriptsDir: path.join(path.dirname(fileURLToPath(import.meta.url)), 'pipeline-port', 'scripts'),
      encodeTexture: (image, { srgb, normal }) => encodeToKTX2(image, { isUASTC: true, isKTX2File: true, generateMipmap: true, enableDebug: false, isPerceptual: srgb, isSetKTX2SRGBTransferFunc: srgb, isNormalMap: normal }),
    })
    progress({ step: 'install', status: 'done', asset: next.assets.find(asset => asset.id === item.id) })
  } finally { await rm(scratch, { recursive: true, force: true }) }
}
