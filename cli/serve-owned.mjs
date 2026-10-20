import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { extname, resolve, sep } from 'node:path'

export function ownedAssets(directory = resolve(homedir(), 'dev/owned-assets')) {
  const root = resolve(directory)
  const configure = server => {
    server.middlewares.use('/owned', async (request, response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') return next()
        let file
        try { file = resolve(root, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`) } catch { return next() }
        if (!file.startsWith(`${root}${sep}`)) return next()
        const info = await stat(file).catch(() => null)
        if (!info?.isFile()) { response.statusCode = 404; response.end('Asset not found'); return }
        const types = { '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' }
        response.setHeader('Content-Type', types[extname(file)] ?? 'application/octet-stream')
        response.setHeader('Accept-Ranges', 'bytes')
        let start = 0, end = info.size - 1
        if (request.headers.range) {
          const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range)
          const first = range?.[1], last = range?.[2]
          if (range && first) { start = Number(first); end = last ? Math.min(Number(last), end) : end }
          else if (range && last) start = Math.max(0, info.size - Number(last))
          else start = info.size
          if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= info.size) {
            response.statusCode = 416
            response.setHeader('Content-Range', `bytes */${info.size}`)
            response.end()
            return
          }
          response.statusCode = 206
          response.setHeader('Content-Range', `bytes ${start}-${end}/${info.size}`)
        }
        response.setHeader('Content-Length', Math.max(0, end - start + 1))
        response.setHeader('Cache-Control', 'no-cache')
        if (request.method === 'HEAD' || info.size === 0) return response.end()
        createReadStream(file, { start, end }).on('error', next).pipe(response)
    })
  }
  return {
    name: 'blacksite-owned-assets',
    configureServer: configure,
    configurePreviewServer: configure,
  }
}
