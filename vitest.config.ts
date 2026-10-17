import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: { include: ['tests/**/*.test.ts', 'packages/ai-nav/src/**/*.test.ts', 'packages/armory/src/**/*.test.ts', 'packages/cascade/src/**/*.test.ts', 'packages/check/src/**/*.test.ts', 'packages/input/src/**/*.test.ts', 'packages/materials/src/**/*.test.ts', 'packages/relay/src/**/*.test.ts', 'packages/soundscape/src/**/*.test.ts', 'packages/subject/src/**/*.test.ts', 'packages/subject-fpp/src/**/*.test.ts', 'packages/ui/src/**/*.test.ts', 'site/src/**/*.test.ts'] },
});
