import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export function sceneTelemetry(directory) {
  const file = resolve(directory, 'telemetry/snapshots.jsonl')
  return {
    name: 'scene-telemetry',
    configureServer(server) {
      server.middlewares.use('/__inspect/look', async (request, response) => {
        response.setHeader('Content-Type', 'application/json')
        response.setHeader('Cache-Control', 'no-store')
        if (request.method !== 'POST') {
          response.statusCode = 405
          response.end(JSON.stringify({ error: 'Use POST' }))
          return
        }
        try {
          const chunks = []
          let bytes = 0
          for await (const chunk of request) {
            bytes += chunk.length
            if (bytes > 16 * 1024) {
              response.statusCode = 413
              response.end(JSON.stringify({ error: 'Look exceeds 16 KB' }))
              return
            }
            chunks.push(chunk)
          }
          const look = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (!look || typeof look !== 'object' || Array.isArray(look) || !Object.values(look).every(value => typeof value === 'number' && Number.isFinite(value))) {
            response.statusCode = 400
            response.end(JSON.stringify({ error: 'A look is an object of numbers' }))
            return
          }
          const folder = resolve(directory, 'looks')
          const body = `${JSON.stringify(look, null, 2)}\n`
          const stamp = new Date().toISOString().replace(/[:.]/g, '-')
          await mkdir(folder, { recursive: true })
          await writeFile(resolve(folder, `look-${stamp}.json`), body)
          await writeFile(resolve(folder, 'latest.json'), body)
          response.end(JSON.stringify({ saved: resolve(folder, 'latest.json') }))
        } catch (error) {
          response.statusCode = error instanceof SyntaxError ? 400 : 500
          response.end(JSON.stringify({ error: error instanceof SyntaxError ? 'Invalid JSON' : 'Could not save look' }))
        }
      })
      server.middlewares.use('/__inspect/telemetry', async (request, response) => {
        response.setHeader('Content-Type', 'application/json')
        response.setHeader('Cache-Control', 'no-store')
        if (request.method !== 'POST') {
          response.statusCode = 405
          response.end(JSON.stringify({ error: 'Use POST' }))
          return
        }
        try {
          const chunks = []
          let bytes = 0
          for await (const chunk of request) {
            bytes += chunk.length
            if (bytes > 1024 * 1024) {
              response.statusCode = 413
              response.end(JSON.stringify({ error: 'Snapshot exceeds 1 MB' }))
              return
            }
            chunks.push(chunk)
          }
          const snapshot = JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if (snapshot?.version !== 1 || snapshot?.renderer !== 'WebGPU' || !snapshot?.device || !snapshot?.stats || !snapshot?.player) {
            response.statusCode = 400
            response.end(JSON.stringify({ error: 'Invalid scene snapshot' }))
            return
          }
          const receivedAt = new Date().toISOString()
          await mkdir(resolve(directory, 'telemetry'), { recursive: true })
          await appendFile(file, JSON.stringify({ ...snapshot, receivedAt }) + '\n')
          response.end(JSON.stringify({ saved: true, receivedAt }))
        } catch (error) {
          response.statusCode = error instanceof SyntaxError ? 400 : 500
          response.end(JSON.stringify({ error: error instanceof SyntaxError ? 'Invalid JSON' : 'Could not save snapshot' }))
        }
      })
    },
  }
}
