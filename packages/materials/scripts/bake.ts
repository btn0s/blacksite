#!/usr/bin/env -S node --import tsx
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { bake } from '../src/bake'
import { readGraph } from '../src/node'
import { validate } from '../src/graph'

const args = process.argv.slice(2)
const option = (name: string) => {
  const i = args.indexOf(name)
  if (i < 0) return undefined
  const value = args[i + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} needs a value`)
  args.splice(i, 2)
  return value
}
const out = path.resolve(option('--out') ?? 'src/materials')
const sizes = (option('--sizes') ?? '512,1024').split(',').map(Number)
const formats = (option('--formats') ?? 'ktx2,webp').split(',') as Array<'ktx2' | 'webp'>
const weatherArg = option('--weather')
const budgetFile = option('--budget')
const unknown = args.find(arg => arg.startsWith('--'))
if (unknown) throw new Error(`unknown option ${unknown}`)
const maxAssetBytes = budgetFile ? (JSON.parse(await readFile(budgetFile, 'utf8')) as { maxAssetBytes?: number }).maxAssetBytes : undefined
if (!args.length) {
  process.stderr.write('usage: bake <graph.json...> [--out dir] [--sizes 512,1024] [--formats ktx2,webp] [--weather json|none] [--budget budget.config.json]\n')
  process.exit(2)
}
let failed = false
for (const file of args) {
  const graph = await readGraph(file)
  const problems = validate(graph)
  if (problems.length) { process.stderr.write(`${file}: ${problems.join('; ')}\n`); failed = true; continue }
  const weather = weatherArg === 'none' ? null : weatherArg ? JSON.parse(weatherArg) : undefined
  const report = await bake(graph, path.resolve(file), out, { sizes, formats, weather, maxAssetBytes, log: line => process.stdout.write(`  ${line}\n`) })
  const total = report.files.reduce((sum, entry) => sum + entry.bytes, 0)
  const byFormat = formats.map(format => `${format} ${(report.files.filter(entry => entry.file.endsWith(format)).reduce((sum, entry) => sum + entry.bytes, 0) / 1024).toFixed(0)} KB`).join(', ')
  process.stdout.write(`${report.name}: ${(report.ms / 1000).toFixed(1)} s, ${report.files.length} files, ${(total / 1024).toFixed(0)} KB (${byFormat}) → ${path.relative(process.cwd(), report.dir)}\n`)
  for (const error of report.errors) { process.stderr.write(`  ${error}\n`); failed = true }
}
if (failed) process.exitCode = 1
