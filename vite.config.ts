import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tsconfigPaths from 'vite-tsconfig-paths';
export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  server: { host: '0.0.0.0', allowedHosts: true },
  worker: { plugins: () => [tsconfigPaths()], format: 'es' },
  // Pre-bundle both Rapier flavours: discovering one mid-session re-optimizes and reloads, which kills a Worker mid-fetch.
  optimizeDeps: { include: ['@dimforge/rapier3d-compat', '@dimforge/rapier3d-simd-compat'] },
  build: { target: 'es2022', rollupOptions: { input: { lab: 'index.html', cascadeWorker: 'cascade-worker.html', largeStructure: 'large-structure.html' } } },
});
