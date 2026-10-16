import { readdir } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('..', import.meta.url))
const args = process.argv.slice(2)
const at = args.indexOf('--jobs')
const jobs = at < 0 ? 1 : Number(args.splice(at, 2)[1])
if (!Number.isInteger(jobs) || jobs < 1 || jobs > 4) throw new Error('--jobs must be an integer from 1 to 4')
const queue = (await readdir(path.join(root, 'library'))).filter(file => file.endsWith('.json')).sort()
const failures: string[] = []
async function worker() {
  while (queue.length) {
    const file = queue.shift()!
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/bake.ts', `library/${file}`, '--out', 'baked', '--budget', 'proof/budget.config.json', ...args], { cwd: root, stdio: 'inherit' })
      child.once('error', reject)
      child.once('exit', code => resolve(code ?? 1))
    })
    if (code !== 0) failures.push(file)
  }
}
await Promise.all(Array.from({ length: jobs }, worker))
if (failures.length) {
  process.stderr.write(`Failed material bakes: ${failures.join(', ')}\n`)
  process.exitCode = 1
}
