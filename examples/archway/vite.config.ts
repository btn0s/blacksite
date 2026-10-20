import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { resolve } from 'node:path'
import { realpathSync } from 'node:fs'
import { blacksiteAssets } from '../../cli/serve-assets.mjs'
import { ownedAssets } from '../../cli/serve-owned.mjs'
import { sceneTelemetry } from '../../cli/serve-telemetry.mjs'

const root = resolve(import.meta.dirname, '../..')

export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: {
      '@blacksite/geometry': resolve(root, 'packages/geometry/src/index.ts'),
      'als-ue5-r3f': resolve(root, 'vendor/als-web/src'),
      '@react-three/fiber': resolve(root, 'node_modules/@react-three/fiber'),
      '@react-three/rapier': resolve(root, 'node_modules/@react-three/rapier'),
    },
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/rapier', '@dimforge/rapier3d-compat'],
  },
  plugins: [react(), tsconfigPaths({ root }), blacksiteAssets({ blacksiteRoot: root }), ownedAssets(process.env.BLACKSITE_OWNED_ASSETS ?? resolve(root, '../owned-assets')), sceneTelemetry(resolve(root, 'artifacts/archway'))],
  server: { host: '0.0.0.0', allowedHosts: true, fs: { allow: [root, realpathSync(resolve(root, 'node_modules')), realpathSync(resolve(root, 'vendor/als-web'))] } },
  optimizeDeps: { entries: ['index.html'], include: ['@react-three/rapier > @dimforge/rapier3d-compat'] },
})
