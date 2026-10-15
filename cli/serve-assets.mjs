import { createReadStream, existsSync } from 'node:fs'
import { cp, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'

export function blacksiteAssets() {
  let config
  let source
  let armsLicense
  const armsLicensePath = 'assets/LICENSE-Blacksite-Arms.md'
  return {
    name: 'blacksite-assets',
    configResolved(next) {
      config = next
      source = path.resolve(config.root, 'vendor/blacksite/vendor/als-web/public')
      armsLicense = path.resolve(config.root, 'vendor/blacksite/packages/subject-fpp/assets/LICENSE')
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!['GET', 'HEAD'].includes(request.method ?? '')) return next()
        let pathname
        try { pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname) } catch { return next() }
        if (!pathname.startsWith('/assets/')) return next()
        const relative = pathname.slice(1)
        const license = relative === armsLicensePath
        const file = license ? armsLicense : path.resolve(source, relative)
        if (!license && (!file.startsWith(`${source}${path.sep}`) || existsSync(path.resolve(config.publicDir, relative)))) return next()
        const info = await stat(file).catch(() => undefined)
        if (!info?.isFile()) return next()
        const contentTypes = { '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.json': 'application/json', '.wav': 'audio/wav', '.md': 'text/plain; charset=utf-8' }
        response.setHeader('Content-Type', contentTypes[path.extname(pathname)] ?? 'application/octet-stream')
        response.setHeader('Content-Length', info.size)
        if (request.method === 'HEAD') return response.end()
        createReadStream(file).on('error', next).pipe(response)
      })
    },
    async writeBundle() {
      const output = path.resolve(config.root, config.build.outDir)
      if (existsSync(source)) await cp(source, output, { recursive: true, force: false, errorOnExist: false })
      if (existsSync(armsLicense)) {
        await mkdir(path.join(output, 'assets'), { recursive: true })
        await cp(armsLicense, path.join(output, armsLicensePath))
      }
    },
  }
}
