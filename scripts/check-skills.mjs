import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve('skills')
const names = ['start', 'make-game', 'design-game', 'setup-project', 'build-prototype', 'combine-prototypes', 'optimize-game', 'ship-game', 'game-architecture', 'blacksite-kit', 'game-assets', 'als']
const errors = []
for (const name of names) {
  const directory = path.join(root, name)
  const file = path.join(directory, 'SKILL.md')
  const yaml = path.join(directory, 'agents', 'openai.yaml')
  if (!existsSync(file) || !existsSync(yaml)) { errors.push(`${name}: missing SKILL.md or agents/openai.yaml`); continue }
  const source = await readFile(file, 'utf8')
  const lines = source.split('\n')
  if (lines.length >= 500) errors.push(`${name}: SKILL.md must be under 500 lines`)
  if (!source.startsWith('---\n') || !source.includes('\n---\n') || !source.includes(`\nname: ${name}\n`) || !/^description: .+$/m.test(source)) errors.push(`${name}: invalid frontmatter`)
  if (/\]\(\.\.\//.test(source) || /`\.\.\//.test(source)) errors.push(`${name}: cross-folder skill link`)
  if (name === 'start') {
    if (!source.includes('disable-model-invocation: true')) errors.push('start: must be user-only')
    if (!(await readFile(yaml, 'utf8')).includes('allow_implicit_invocation: false')) errors.push('start: openai.yaml must disable implicit invocation')
  }
}
for (const entry of await readdir(root)) if (!names.includes(entry)) errors.push(`Unexpected skill: ${entry}`)
if (errors.length) { for (const error of errors) process.stderr.write(`${error}\n`); process.exitCode = 1 }
else process.stdout.write(`${names.length} skills valid\n`)
