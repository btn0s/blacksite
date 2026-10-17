import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bake } from '../src/bake'
import { readGraph } from '../src/node'

const directory = fileURLToPath(new URL('.', import.meta.url))
const file = path.join(directory, 'asymmetric.json')
const report = await bake(await readGraph(file), file, path.join(directory, 'baked'), { sizes: [128], formats: ['ktx2', 'webp'] })
if (report.errors.length) throw new Error(report.errors.join('\n'))
process.stdout.write(`${report.files.length} asymmetric check maps baked in ${report.ms.toFixed(0)} ms\n`)
