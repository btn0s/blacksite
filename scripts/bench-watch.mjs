import { spawnSync, execFileSync } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { views, contendedExit } from './bench-views.mjs'

const archway = 'D:/dev/archway'
const runner = 'D:/dev/bench-runner-auto'
const ownedAssets = 'D:/dev/owned-assets'
const benchRoot = 'D:/dev/probe/bench'
const baseline = join(benchRoot, 'baseline')
const candidate = join(benchRoot, 'candidate')
const staging = join(benchRoot, 'baseline.next')
const previous = join(benchRoot, 'baseline.previous')
const lockPath = join(benchRoot, 'watcher.lock')
const targetBranch = 'btn0s/meshlet-showcase-archway'

function safePath(path) { return path.replaceAll('\\', '/') }

function git(directory, ...args) {
  return execFileSync('git', ['-c', `safe.directory=${safePath(directory)}`, '-C', directory, ...args], { encoding: 'utf8' }).trim()
}

function lockAlive(pid) {
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}

function removeWithin(target, root) {
  const resolvedTarget = resolve(target)
  const resolvedRoot = resolve(root)
  const relativeTarget = relative(resolvedRoot, resolvedTarget)
  if (relativeTarget === '..' || relativeTarget.startsWith(`..${sep}`) || isAbsolute(relativeTarget)) throw new Error(`Refusing to remove a path outside ${resolvedRoot}`)
  if (existsSync(resolvedTarget) && lstatSync(resolvedTarget).isSymbolicLink()) throw new Error(`Refusing to recursively remove a link: ${resolvedTarget}`)
  rmSync(resolvedTarget, { recursive: true, force: true })
}

function acquireLock() {
  mkdirSync(benchRoot, { recursive: true })
  const content = { pid: process.pid, worktree: runner, startedAt: new Date().toISOString() }
  try {
    writeFileSync(lockPath, JSON.stringify(content, null, 2), { flag: 'wx' })
    return content
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    let current
    try { current = JSON.parse(readFileSync(lockPath, 'utf8')) } catch { current = null }
    if (current?.pid && !lockAlive(Number(current.pid))) {
      rmSync(lockPath, { force: true })
      writeFileSync(lockPath, JSON.stringify(content, null, 2), { flag: 'wx' })
      return content
    }
    return null
  }
}

function linkDirectory(target, link) {
  if (existsSync(link)) return
  mkdirSync(dirname(link), { recursive: true })
  symlinkSync(target, link, 'junction')
}

function setupRunner(sha) {
  if (!existsSync(runner)) git(archway, 'worktree', 'add', '--detach', runner, sha)
  else {
    if (resolve(git(runner, 'rev-parse', '--show-toplevel')) !== resolve(runner)) throw new Error(`${runner} exists but is not the dedicated benchmark worktree`)
    if (git(runner, 'status', '--porcelain', '--untracked-files=normal')) throw new Error(`${runner} has uncommitted changes`)
    git(runner, 'checkout', '--detach', sha)
  }
  git(runner, 'submodule', 'update', '--init')
  linkDirectory(join(archway, 'node_modules'), join(runner, 'node_modules'))
  linkDirectory(ownedAssets, join(runner, 'owned-assets'))
  for (const group of ['packages', 'examples']) {
    const sourceGroup = join(archway, group)
    const targetGroup = join(runner, group)
    for (const entry of readdirSync(sourceGroup, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const sourceModules = join(sourceGroup, entry.name, 'node_modules')
      if (existsSync(sourceModules)) linkDirectory(sourceModules, join(targetGroup, entry.name, 'node_modules'))
    }
  }
  const exclude = git(runner, 'rev-parse', '--git-path', 'info/exclude')
  const excludePath = resolve(runner, exclude)
  if (!readFileSync(excludePath, 'utf8').split(/\r?\n/).includes('owned-assets/')) appendFileSync(excludePath, '\nowned-assets/\n')
}

function priorSha() {
  const path = join(baseline, 'sha.txt')
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : null
}

function commitQueue(baseSha, headSha) {
  if (!baseSha) return [headSha]
  try {
    git(archway, 'merge-base', '--is-ancestor', baseSha, headSha)
    return git(archway, 'rev-list', '--reverse', '--first-parent', `${baseSha}..${headSha}`).split(/\r?\n/).filter(Boolean)
  } catch { return [headSha] }
}

function recordFailure(sha, output, code) {
  mkdirSync(baseline, { recursive: true })
  const content = `Failed bench for ${sha}\nTime: ${new Date().toISOString()}\nExit code: ${code}\n\n${output}`
  writeFileSync(join(baseline, 'last-failure.log'), content)
  process.stderr.write(content)
}

function deltaTable(output) {
  const start = output.search(/\nView\s+Ready\(s\)/)
  if (start < 0) return output.trim()
  const end = output.indexOf('\nResults:', start)
  return output.slice(start + 1, end < 0 ? undefined : end).trim()
}

function replaceBaseline(sha, output) {
  for (const view of views) {
    if (!existsSync(join(candidate, `${view}.json`)) || !existsSync(join(candidate, `${view}.png`))) throw new Error(`Candidate is missing ${view} JSON or PNG`)
    const result = JSON.parse(readFileSync(join(candidate, `${view}.json`), 'utf8'))
    if (result.view !== view || result.sha !== sha || !Array.isArray(result.consoleErrors) || result.consoleErrors.length) throw new Error(`Candidate ${view} failed validation or contains console errors`)
  }
  removeWithin(staging, benchRoot)
  mkdirSync(staging, { recursive: true })
  for (const view of views) {
    cpSync(join(candidate, `${view}.json`), join(staging, `${view}.json`))
    cpSync(join(candidate, `${view}.png`), join(staging, `${view}.png`))
  }
  writeFileSync(join(staging, 'sha.txt'), `${sha}\n`)
  const oldSha = priorSha()
  const delta = oldSha ? `Baseline ${oldSha} → ${sha}\n${deltaTable(output)}\n` : `Initial baseline: ${sha}\nNo previous benchmark exists.\n`
  writeFileSync(join(staging, 'last-delta.txt'), delta)
  if (existsSync(previous)) removeWithin(previous, benchRoot)
  const movedBaseline = existsSync(baseline)
  if (movedBaseline) renameSync(baseline, previous)
  try {
    renameSync(staging, baseline)
  } catch (error) {
    if (movedBaseline && !existsSync(baseline) && existsSync(previous)) renameSync(previous, baseline)
    throw error
  }
  if (movedBaseline && existsSync(previous)) removeWithin(previous, benchRoot)
  removeWithin(candidate, benchRoot)
  process.stdout.write(delta)
}

function runCommit(sha) {
  setupRunner(sha)
  removeWithin(candidate, benchRoot)
  mkdirSync(candidate, { recursive: true })
  const args = [join(runner, 'scripts', 'bench.mjs'), '--output', candidate]
  if (existsSync(join(baseline, 'sha.txt'))) args.push('--compare')
  const run = spawnSync(process.execPath, args, { cwd: runner, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
  if (run.status === contendedExit) {
    process.stdout.write(output.slice(output.lastIndexOf('Deferred:')))
    removeWithin(candidate, benchRoot)
    return false
  }
  if (run.error || run.status !== 0) {
    recordFailure(sha, `${output}\n${run.error?.stack ?? ''}`, run.status ?? 'spawn-error')
    removeWithin(candidate, benchRoot)
    return false
  }
  try { replaceBaseline(sha, output) }
  catch (error) {
    recordFailure(sha, `${output}\n${error.stack ?? error}`, 'invalid-output')
    removeWithin(candidate, benchRoot)
    return false
  }
  return true
}

const lock = acquireLock()
if (!lock) process.exit(0)
try {
  if (!existsSync(baseline) && existsSync(previous)) renameSync(previous, baseline)
  else if (existsSync(baseline) && existsSync(previous)) removeWithin(previous, benchRoot)
  const branch = git(archway, 'branch', '--show-current')
  if (branch !== targetBranch) throw new Error(`Expected ${targetBranch}, found ${branch}`)
  const head = git(archway, 'rev-parse', 'HEAD')
  const pending = commitQueue(priorSha(), head)
  for (const sha of pending) if (!runCommit(sha)) break
} catch (error) {
  recordFailure('watcher', `${error.stack ?? error}`, 'watcher-error')
} finally {
  try {
    const current = JSON.parse(readFileSync(lockPath, 'utf8'))
    if (current.pid === lock.pid && current.worktree === lock.worktree) rmSync(lockPath, { force: true })
  } catch {}
}
