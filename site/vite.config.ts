import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mdx from '@mdx-js/rollup'
import remarkGfm from 'remark-gfm'
import tsconfigPaths from 'vite-tsconfig-paths'
import { resolve } from 'node:path'
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { blacksiteAssets } from '../cli/serve-assets.mjs'
import { defaultSiteUrl, pages, renderPage, robots, sitemap } from './src/seo'

const base = process.env.SITE_BASE || '/'
const siteUrl = process.env.SITE_URL || defaultSiteUrl
const outDir = resolve(import.meta.dirname, '../dist/site')

export default defineConfig({
  root: resolve(import.meta.dirname),
  base,
  define: { 'import.meta.env.SITE_URL': JSON.stringify(siteUrl) },
  resolve: {
    alias: {
      '@react-three/fiber': resolve(import.meta.dirname, '../node_modules/@react-three/fiber'),
      '@react-three/rapier': resolve(import.meta.dirname, '../node_modules/@react-three/rapier'),
    },
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/rapier', '@dimforge/rapier3d-compat'],
  },
  plugins: [
    {
      name: 'blacksite-skills',
      resolveId: id => id === 'virtual:blacksite-skills' ? '\0virtual:blacksite-skills' : undefined,
      load(id) {
        if (id !== '\0virtual:blacksite-skills') return
        const root = resolve(import.meta.dirname, '../skills')
        const files: Record<string, string> = {}
        const read = (name: string) => {
          const file = resolve(root, name)
          this.addWatchFile(file)
          files[name] = readFileSync(file, 'utf8')
        }
        for (const name of readdirSync(root)) {
          if (!existsSync(resolve(root, name, 'SKILL.md'))) continue
          read(`${name}/SKILL.md`)
          const references = resolve(root, name, 'references')
          if (existsSync(references)) for (const entry of readdirSync(references).filter(entry => entry.endsWith('.md')).sort()) read(`${name}/references/${entry}`)
        }
        return `export default ${JSON.stringify(files)}`
      },
    },
    mdx({ remarkPlugins: [remarkGfm] }),
    react(),
    tsconfigPaths({ root: resolve(import.meta.dirname, '..') }),
    blacksiteAssets({ blacksiteRoot: resolve(import.meta.dirname, '..') }),
    {
      name: 'blacksite-route-pages',
      apply: 'build',
      closeBundle() {
        const shell = readFileSync(resolve(outDir, 'index.html'), 'utf8')
        for (const page of pages) {
          const dir = resolve(outDir, page.route)
          mkdirSync(dir, { recursive: true })
          writeFileSync(resolve(dir, 'index.html'), renderPage(shell, page, siteUrl, base))
        }
        writeFileSync(resolve(outDir, '404.html'), renderPage(shell, pages[0]!, siteUrl, base, { canonical: false, noindex: true }))
        writeFileSync(resolve(outDir, 'sitemap.xml'), sitemap(siteUrl, base))
        writeFileSync(resolve(outDir, 'robots.txt'), robots(siteUrl, base))
      },
    },
    {
      name: 'blacksite-pages-assets',
      enforce: 'pre',
      transform(source, id) {
        if ((!id.includes('/vendor/als-web/src/') && !id.includes('/packages/subject-fpp/src/arms/')) || !source.includes('/assets/')) return
        return source.replace(/(['"`])\/assets\//g, (_, quote) => `${quote}${base}assets/`)
      },
    },
  ],
  server: { host: '0.0.0.0', allowedHosts: true, fs: { allow: [resolve(import.meta.dirname, '..')] } },
  worker: { format: 'es', plugins: () => [tsconfigPaths({ root: resolve(import.meta.dirname, '..') })] },
  optimizeDeps: { include: ['@dimforge/rapier3d-compat', '@dimforge/rapier3d-simd-compat'] },
  build: {
    target: 'es2022',
    outDir,
    emptyOutDir: true,
    rollupOptions: { input: {
      main: resolve(import.meta.dirname, 'index.html'),
      ...Object.fromEntries(readdirSync(resolve(import.meta.dirname, 'frames')).filter(name => name.endsWith('.html')).map(name => [name.slice(0, -5), resolve(import.meta.dirname, 'frames', name)])),
    } },
  },
})
