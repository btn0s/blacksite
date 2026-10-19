import { appendFile, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

export function valleyTelemetry(directory) {
  const file = resolve(directory, 'telemetry/snapshots.jsonl')
  return {
    name: 'valley-telemetry',
    configureServer(server) {
      server.middlewares.use('/__valley/telemetry', async (request, response) => {
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
            response.end(JSON.stringify({ error: 'Invalid Valley snapshot' }))
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
