import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

function git(args, cwd) {
  const result = spawnSync('git', ['-c', 'protocol.file.allow=always', ...args], { cwd, encoding: 'utf8' })
  if (result.error || result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${(result.stderr || result.error?.message || '').trim().slice(-3000)}`)
  return result.stdout.trim()
}

async function localSubmoduleSources(target, source) {
  const modulesFile = path.join(source, '.gitmodules')
  if (!existsSync(modulesFile)) return
  const entries = git(['config', '--file', modulesFile, '--get-regexp', '^submodule\\..*\\.path$'], source)
  for (const entry of entries.split('\n').filter(Boolean)) {
    const separator = entry.indexOf(' ')
    const name = entry.slice(0, separator).slice('submodule.'.length, -'.path'.length)
    const relativePath = entry.slice(separator + 1)
    const local = path.resolve(source, relativePath)
    if (!existsSync(path.join(local, '.git'))) throw new Error(`Initialize local submodule before scaffolding: ${local}`)
    git(['config', `submodule.${name}.url`, pathToFileURL(local).href], target)
  }
}

export async function initializeSubmodule(root, url, target, ref) {
  const full = path.join(root, target)
  const modules = existsSync(path.join(root, '.gitmodules')) ? await readFile(path.join(root, '.gitmodules'), 'utf8') : ''
  if (!modules.includes(`path = ${target}`)) {
    if (existsSync(full)) throw new Error(`${target} exists but is not a registered Git submodule`)
    git(['submodule', 'add', url, target], root)
  }
  git(['submodule', 'update', '--init', '--', target], root)
  if (!existsSync(path.join(full, '.git'))) throw new Error(`${target} could not be initialized`)
  if (ref) {
    git(['fetch', 'origin', ref], full)
    git(['checkout', '--detach', 'FETCH_HEAD'], full)
  }
  if (url.startsWith('file://')) await localSubmoduleSources(full, fileURLToPath(url))
  git(['submodule', 'update', '--init', '--recursive'], full)
}
