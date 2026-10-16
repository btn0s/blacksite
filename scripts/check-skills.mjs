import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve('skills')
const names = ['blacksite']
const engines = /\b(?:unreal|unity|godot|cryengine|source 2)\b|\bUE[45]?\b/i
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
  const references = existsSync(path.join(directory, 'references')) ? (await readdir(path.join(directory, 'references'))).filter(entry => entry.endsWith('.md')) : []
  const documents = [['SKILL.md', source], ...await Promise.all(references.map(async entry => [`references/${entry}`, await readFile(path.join(directory, 'references', entry), 'utf8')]))]
  for (const [label, text] of documents) {
    if (/\]\(\.\.\//.test(text) || /`\.\.\//.test(text)) errors.push(`${name}/${label}: cross-folder skill link`)
    const engine = text.split('\n').find(line => engines.test(line))
    if (engine) errors.push(`${name}/${label}: names another engine: ${engine.trim().slice(0, 80)}`)
    for (const [, target] of text.matchAll(/\]\((references\/[\w.-]+\.md)\)/g)) if (!existsSync(path.join(directory, target))) errors.push(`${name}/${label}: missing ${target}`)
  }
  for (const entry of references) if (!source.includes(`references/${entry}`)) errors.push(`${name}: references/${entry} is not linked from SKILL.md`)
}
for (const entry of await readdir(root)) if (!names.includes(entry)) errors.push(`Unexpected skill: ${entry}`)
if (errors.length) { for (const error of errors) process.stderr.write(`${error}\n`); process.exitCode = 1 }
else process.stdout.write(`${names.length} skill valid\n`)
