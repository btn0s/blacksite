import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mdx from '@mdx-js/rollup'
import tsconfigPaths from 'vite-tsconfig-paths'
import { resolve } from 'node:path'

const base = process.env.SITE_BASE || '/blacksite/'

export default defineConfig({
  root: resolve(import.meta.dirname),
  base,
  publicDir: resolve(import.meta.dirname, '../vendor/als-web/public'),
  resolve: { dedupe: ['react', 'react-dom', 'three', '@react-three/fiber'] },
  plugins: [
    mdx(),
    react(),
    tsconfigPaths({ root: resolve(import.meta.dirname, '..') }),
    {
      name: 'als-pages-base',
      enforce: 'pre',
      transform(source, id) {
        if (!id.includes('/vendor/als-web/src/') || !source.includes("'/assets/")) return
        return source.replaceAll("'/assets/", `'${base}assets/`)
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
    } },
  },
})
