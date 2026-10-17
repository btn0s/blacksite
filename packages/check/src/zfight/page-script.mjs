import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const directory = path.dirname(fileURLToPath(import.meta.url))
const ORDER = ['depth.mjs', 'bvh.mjs', 'triangles.mjs', 'lint.mjs', 'analyze.mjs', 'probe.mjs', 'session.mjs']

export function pageScript() {
  const body = ORDER.map(file => readFileSync(path.join(directory, file), 'utf8')
    .replace(/^import[^\n]*\n/gm, '')
    .replace(/^export (function|const|class)/gm, '$1'))
    .join('\n')
  return `(() => {\n${body}\ninstallPage()\n})()`
}
