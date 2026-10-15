import { useEffect, useState } from 'react'
import { MultiplayerSubject } from '@blacksite/subject'
import { createLoopbackRoom } from '@blacksite/relay'
import { createColyseusTransport } from '@blacksite/relay/colyseus'
import type { Connection } from '@blacksite/relay'

export default function Mode() {
  const [offline, setOffline] = useState(false)
  const [connection, setConnection] = useState<Connection | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    let joined: Connection | null = null
    const endpoint = import.meta.env.VITE_RELAY_URL || `${location.origin}/relay`
    const transport = offline ? createLoopbackRoom() : createColyseusTransport(endpoint)
    transport.connect().then(peer => { joined = peer; if (active) setConnection(peer); else peer.close() }).catch(reason => { if (active) setError(String(reason)) })
    return () => { active = false; joined?.close() }
  }, [offline])
  if (error) return <main className="panel"><h1>Room unavailable</h1><p>{error}</p><button onClick={() => { setError(''); setOffline(true) }}>Offline</button></main>
  return <>{connection ? <MultiplayerSubject key={connection.id} connection={connection} offline={offline} /> : <main className="panel"><h1>Joining room…</h1></main>}<button className="offline-button" onClick={() => { setConnection(null); setOffline(value => !value) }}>{offline ? 'Play online' : 'Offline'}</button></>
}
