import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mdx from '@mdx-js/rollup'
import tsconfigPaths from 'vite-tsconfig-paths'
import { resolve } from 'node:path'
import { blacksiteAssets } from '../cli/serve-assets.mjs'

const base = process.env.SITE_BASE || '/blacksite/'

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
    mdx(),
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
      cascade: resolve(import.meta.dirname, 'frames/large-structure.html'),
      cascadeWorker: resolve(import.meta.dirname, 'frames/cascade-worker.html'),
      warden: resolve(import.meta.dirname, 'frames/warden.html'),
      fpp: resolve(import.meta.dirname, 'frames/fpp.html'),
      tpp: resolve(import.meta.dirname, 'frames/tpp.html'),
      mp: resolve(import.meta.dirname, 'frames/mp.html'),
    } },
  },
})
