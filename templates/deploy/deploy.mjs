import { spawnSync } from 'node:child_process'
const result = spawnSync(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['build'], { stdio: 'inherit', shell: process.platform === 'win32' })
if (result.status !== 0) process.exit(result.status || 1)
