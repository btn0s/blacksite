import { readFile, writeFile } from 'node:fs/promises'

const product = JSON.parse(await readFile(new URL('../product.json', import.meta.url), 'utf8'))
const readme = new URL('../README.md', import.meta.url)
const plugin = new URL('../.claude-plugin/plugin.json', import.meta.url)
const marketplace = new URL('../.claude-plugin/marketplace.json', import.meta.url)

const readmeText = await readFile(readme, 'utf8')
await writeFile(readme, readmeText.replace(/^# .*$/m, `# ${product.name}`))

for (const [file, name] of [[plugin, product.plugin], [marketplace, product.marketplace]]) {
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  manifest.name = name
  if (file === marketplace) manifest.plugins[0].name = product.plugin
  await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`)
}
