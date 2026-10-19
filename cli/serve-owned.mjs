import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, resolve, sep } from 'node:path'

export function ownedAssets(directory = resolve(homedir(), 'dev/owned-assets')) {
  const root = resolve(directory)
  return {
    name: 'blacksite-owned-assets',
    configureServer(server) {
      server.middlewares.use('/owned', async (request, response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') return next()
        let file
        try { file = resolve(root, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`) } catch { return next() }
        if (!file.startsWith(`${root}${sep}`)) return next()
        const info = await stat(file).catch(() => null)
        if (!info?.isFile()) { response.statusCode = 404; response.end('Asset not found'); return }
        const types = { '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' }
        response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream')
        response.setHeader('Content-Length', info.size)
        response.setHeader('Cache-Control', 'no-cache')
        if (request.method === 'HEAD') return response.end()
        createReadStream(file).on('error', next).pipe(response)
      })
    },
  }
}
