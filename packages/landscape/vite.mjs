import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildLandscape } from './scripts/build.mjs'
import { valleyShape } from './src/valley.ts'

const generators = ['bake.ts', 'river.ts', 'random.ts', 'valley.ts']
const types = { '.json': 'application/json', '.bin': 'application/octet-stream' }

export function blacksiteLandscape({ shape = valleyShape, name = 'landscape', directory, sources = [] } = {}) {
  let config
  let output
  let base
  let pending
  const ensure = () => pending ??= (async () => {
    const hash = createHash('sha256')
    for (const file of [...generators.map(file => path.join(import.meta.dirname, 'src', file)), ...sources]) hash.update(await readFile(file))
    hash.update(JSON.stringify([shape.name, shape.centre, shape.near, shape.far, shape.band, shape.seaLevel, shape.sea, shape.water]))
    const stamp = hash.digest('hex')
    const marker = path.join(output, 'stamp.txt')
    if (existsSync(marker) && await readFile(marker, 'utf8') === stamp && existsSync(path.join(output, 'landscape.json'))) return
    config.logger.info(`baking the ${shape.name} landscape (first run, about 15 s)`)
    await buildLandscape(output, shape)
    await writeFile(marker, stamp)
  })()
  return {
    name: `blacksite-landscape-${name}`,
    configResolved(next) {
      config = next
      output = path.resolve(directory ?? path.join(config.cacheDir, '..', 'blacksite-landscape', shape.name))
      base = new URL(config.base ?? '/', 'http://localhost').pathname.replace(/\/$/, '')
    },
    buildStart: () => ensure(),
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!['GET', 'HEAD'].includes(request.method ?? '')) return next()
        let pathname
        try { pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname) } catch { return next() }
        if (base && pathname.startsWith(`${base}/`)) pathname = pathname.slice(base.length)
        if (!pathname.startsWith(`/${name}/`)) return next()
        const file = path.resolve(output, pathname.slice(name.length + 2))
        if (!file.startsWith(`${output}${path.sep}`) || path.basename(file) === 'stamp.txt') return next()
        await ensure()
        const info = await stat(file).catch(() => undefined)
        if (!info?.isFile()) return next()
        response.setHeader('Content-Type', types[path.extname(file)] ?? 'application/octet-stream')
        response.setHeader('Content-Length', info.size)
        if (request.method === 'HEAD') return response.end()
        createReadStream(file).on('error', next).pipe(response)
      })
    },
    async generateBundle() {
      await ensure()
      for (const file of ['landscape.json', 'water.json', 'near.bin', 'far.bin']) this.emitFile({ type: 'asset', fileName: `${name}/${file}`, source: await readFile(path.join(output, file)) })
    },
  }
}
