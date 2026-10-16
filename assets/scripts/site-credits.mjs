import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { creditsMarkdown, loadCatalog } from '../../cli/library.mjs'

const target = fileURLToPath(new URL('../../site/public/CREDITS.md', import.meta.url))
const catalog = await loadCatalog()
const previous = await readFile(target, 'utf8')
const existing = previous.split('\n## Font licence notices\n')[0].split('\n## Open library catalog\n')[0].trimEnd()
const fonts = await readFile(new URL('../font-notices.md', import.meta.url), 'utf8')
const credits = creditsMarkdown(catalog.assets, 'Open library catalog')
  .replace(/^#/gm, '##')
  .replace('Assets from the Blacksite open library, fetched from recorded sources or licensed mirrors and processed for the web.', 'Catalog records for separately fetched library assets. These binaries are not bundled with the main site. Installed projects receive credits for their selected assets; the starter viewer serves its own CREDITS.md.')
await writeFile(target, `${existing}\n\n## Font licence notices\n\n${fonts.trim()}\n\n${credits.trimEnd()}\n`)
