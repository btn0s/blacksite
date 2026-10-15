import { startMatchServer } from '@blacksite/relay/server'

const port = Number(process.env.PORT ?? 2567)
await startMatchServer(port)
process.stdout.write(`Match server listening on ${port}\n`)
