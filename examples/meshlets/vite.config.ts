import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { realpathSync } from 'node:fs'

export default defineConfig({
  root: import.meta.dirname,
  worker: { format: 'es' },
  resolve: { dedupe: ['three'] },
  server: {
    host: '0.0.0.0',
    port: 5189,
    strictPort: true,
    allowedHosts: ['.getbb.app', '.ts.net'],
    fs: { allow: [resolve(import.meta.dirname, '../..'), realpathSync(resolve(import.meta.dirname, 'public/owned'))] },
  },
  build: { target: 'esnext' },
})
