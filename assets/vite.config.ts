import { defineConfig } from 'vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { resolve } from 'node:path'

export default defineConfig({
  root: resolve(import.meta.dirname, 'viewer'),
  base: './',
  publicDir: resolve(import.meta.dirname, '.build'),
  plugins: [tsconfigPaths({ root: resolve(import.meta.dirname, '..') })],
  resolve: { dedupe: ['three'] },
  build: { outDir: resolve(import.meta.dirname, '.build-site'), emptyOutDir: true, target: 'es2022' },
  server: { host: '0.0.0.0', allowedHosts: ['.getbb.app'] },
})
