import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mdx from '@mdx-js/rollup'
import remarkGfm from 'remark-gfm'
import tsconfigPaths from 'vite-tsconfig-paths'
import { resolve } from 'node:path'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { blacksiteAssets } from '../cli/serve-assets.mjs'

const base = process.env.SITE_BASE || '/'

export default defineConfig({
  root: resolve(import.meta.dirname),
  base,
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
        for (const name of readdirSync(root)) {
          const file = resolve(root, name, 'SKILL.md')
          if (!existsSync(file)) continue
          this.addWatchFile(file)
          files[name] = readFileSync(file, 'utf8')
        }
        return `export default ${JSON.stringify(files)}`
      },
    },
    mdx({ remarkPlugins: [remarkGfm] }),
    react(),
    tsconfigPaths({ root: resolve(import.meta.dirname, '..') }),
    blacksiteAssets({ blacksiteRoot: resolve(import.meta.dirname, '..') }),
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
    outDir: resolve(import.meta.dirname, '../dist/site'),
    emptyOutDir: true,
    rollupOptions: { input: {
      main: resolve(import.meta.dirname, 'index.html'),
      ...Object.fromEntries(readdirSync(resolve(import.meta.dirname, 'frames')).filter(name => name.endsWith('.html')).map(name => [name.slice(0, -5), resolve(import.meta.dirname, 'frames', name)])),
    } },
  },
})
