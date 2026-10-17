import { createReadStream, existsSync } from 'node:fs'
import { cp, mkdir, stat } from 'node:fs/promises'
import path from 'node:path'

export function blacksiteAssets({ blacksiteRoot } = {}) {
  let config
  let source
  let licenses
  let viewmodelLicenses
  let base
  const viewmodelLicensePrefix = 'assets/viewmodel/licenses/'
  return {
    name: 'blacksite-assets',
    configResolved(next) {
      config = next
      const root = path.resolve(config.root, blacksiteRoot ?? 'vendor/blacksite')
      source = path.join(root, 'vendor/als-web/public')
      const armsAssets = path.join(root, 'packages/subject-fpp/assets')
      licenses = new Map([
        ['assets/LICENSE-Blacksite-Arms.md', path.join(armsAssets, 'LICENSE')],
        ['assets/viewmodel/CREDITS.md', path.join(armsAssets, 'arms/CREDITS.md')],
        ['assets/viewmodel/found/CREDITS.md', path.join(armsAssets, 'found/CREDITS.md')],
        ['assets/viewmodel/found/CC-BY-4.0.txt', path.join(armsAssets, 'found/CC-BY-4.0.txt')],
        ['assets/viewmodel/found/Sketchfab-provenance.json', path.join(armsAssets, 'found/Sketchfab-provenance.json')],
      ])
      viewmodelLicenses = path.join(armsAssets, 'arms/licenses')
      base = new URL(config.base ?? '/', 'http://localhost').pathname.replace(/\/$/, '')
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!['GET', 'HEAD'].includes(request.method ?? '')) return next()
        let pathname
        try { pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname) } catch { return next() }
        if (base && pathname.startsWith(`${base}/`)) pathname = pathname.slice(base.length)
        if (!pathname.startsWith('/assets/')) return next()
        const relative = pathname.slice(1)
        const license = licenses.get(relative)
        const viewmodelLicense = relative.startsWith(viewmodelLicensePrefix)
        const file = license ?? (viewmodelLicense ? path.resolve(viewmodelLicenses, relative.slice(viewmodelLicensePrefix.length)) : path.resolve(source, relative))
        if (viewmodelLicense && (!file.startsWith(`${viewmodelLicenses}${path.sep}`) || !['.md', '.txt', '.json'].includes(path.extname(file)))) return next()
        if (!license && !viewmodelLicense && (!file.startsWith(`${source}${path.sep}`) || config.publicDir && existsSync(path.resolve(config.publicDir, relative)))) return next()
        const info = await stat(file).catch(() => undefined)
        if (!info?.isFile()) return next()
        const contentTypes = { '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.json': 'application/json', '.wav': 'audio/wav', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8' }
        response.setHeader('Content-Type', contentTypes[path.extname(pathname)] ?? 'application/octet-stream')
        response.setHeader('Content-Length', info.size)
        if (request.method === 'HEAD') return response.end()
        createReadStream(file).on('error', next).pipe(response)
      })
    },
    async writeBundle() {
      const output = path.resolve(config.root, config.build.outDir)
      if (existsSync(source)) await cp(source, output, { recursive: true, force: false, errorOnExist: false })
      for (const [relative, file] of licenses) {
        if (!existsSync(file)) continue
        await mkdir(path.dirname(path.join(output, relative)), { recursive: true })
        await cp(file, path.join(output, relative))
      }
      if (existsSync(viewmodelLicenses)) await cp(viewmodelLicenses, path.join(output, viewmodelLicensePrefix), { recursive: true })
    },
  }
}
