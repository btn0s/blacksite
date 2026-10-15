import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { readFileSync } from 'node:fs'

const dependencies = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8')).dependencies
const allowedHosts = ['.getbb.app', '.ts.net', ...(process.env.VITE_ALLOWED_HOSTS ?? '').split(',').map(host => host.trim()).filter(Boolean)]

export default defineConfig({
  plugins: [react(), tailwindcss()],
  publicDir: dependencies['als-ue5-r3f'] ? path.resolve('vendor/blacksite/vendor/als-web/public') : false,
  server: {
    host: '0.0.0.0',
    allowedHosts,
    port: Number(process.env.VITE_PORT ?? 5173),
    proxy: dependencies['@blacksite/relay'] ? {
      '/relay': {
        target: 'http://127.0.0.1:2567',
        changeOrigin: true,
        ws: true,
        rewrite: requestPath => requestPath.replace(/^\/relay(?=\/|$)/, ''),
      },
    } : undefined,
  },
})
