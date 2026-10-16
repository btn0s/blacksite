import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { resolve } from 'node:path'
import { blacksiteAssets } from '../../cli/serve-assets.mjs'

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
  plugins: [react(), tsconfigPaths({ root }), blacksiteAssets({ blacksiteRoot: root })],
  worker: { format: 'es', plugins: () => [tsconfigPaths({ root })] },
  server: { host: '0.0.0.0', allowedHosts: true, fs: { allow: [root] } },
  optimizeDeps: { entries: ['index.html'], include: ['@react-three/rapier > @dimforge/rapier3d-compat'] },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('rapier')) return 'rapier'
          if (id.includes('node_modules/three/')) return 'three'
          if (id.includes('/packages/als') || id.includes('als-')) return 'als'
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler') || id.includes('@react-three')) return 'react'
        },
      },
    },
  },
})
