import { build } from 'esbuild'

for (const [entry, output] of [
  ['cli/pipeline-port/src/pipeline-core.ts', 'cli/pipeline-port/pipeline.mjs'],
  ['cli/fab-port/src/index.ts', 'cli/fab-port/fab.mjs'],
]) {
  await build({ entryPoints: [entry], outfile: output, bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', minify: true })
}
