import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { readFileSync } from 'node:fs'

const dependencies = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')).dependencies

export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: dependencies['als-ue5-r3f'] ? path.resolve('vendor/blacksite/vendor/als-web/public') : false,
  server: { host: '0.0.0.0', port: 5173 },
})
