import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { resolve } from 'node:path'
import { blacksiteAssets } from '../../cli/serve-assets.mjs'
import { valleyTelemetry } from './scripts/telemetry.mjs'

const root = resolve(import.meta.dirname, '../..')

export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: {
      '@react-three/fiber': resolve(root, 'node_modules/@react-three/fiber'),
      '@react-three/rapier': resolve(root, 'node_modules/@react-three/rapier'),
    },
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/rapier', '@dimforge/rapier3d-compat'],
  },
  plugins: [react(), tsconfigPaths({ root }), blacksiteAssets({ blacksiteRoot: root }), valleyTelemetry(import.meta.dirname)],
  server: { host: '0.0.0.0', allowedHosts: true, fs: { allow: [root] } },
  optimizeDeps: { entries: ['index.html'], include: ['@react-three/rapier > @dimforge/rapier3d-compat'] },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('rapier')) return 'rapier'
          if (id.includes('/three/') || id.includes('postprocessing') || id.includes('n8ao')) return 'three'
          if (id.includes('als-web') || id.includes('als-ue5-r3f')) return 'als'
          if (id.includes('node_modules')) return 'vendor'
        },
      },
    },
  },
})
