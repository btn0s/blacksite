import { defineConfig } from 'vite'
import path from 'node:path'

export default defineConfig({
  root: import.meta.dirname,
  plugins: [{
    name: 'baked-material-runtime-boundary',
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        for (const id of Object.keys(chunk.modules)) {
          const file = id.replaceAll('\\', '/')
          if (file.includes('/packages/materials/src/') && !file.endsWith('/src/three.ts')) this.error(`Authoring code reached the baked runtime: ${file}`)
        }
      }
    },
  }],
  build: { target: 'es2022', outDir: path.join(import.meta.dirname, 'dist'), emptyOutDir: true },
})
