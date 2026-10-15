import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { Canvas } from '@react-three/fiber'
import { Physics } from '@react-three/rapier'
import { GameFrame } from '@blacksite/ui/game-frame'
import { Button } from '@blacksite/ui/components/button'
import { registerWarmup, runWarmup } from '../scripts/warmup'
import { createSession } from './architecture'
import '@blacksite/ui/globals.css'
import './style.css'

type Mode = { default: ComponentType }
const modes = import.meta.glob<Mode>('./prototypes/*/mode.tsx')
const prototypes = Object.entries(modes).map(([path, load]) => ({ name: path.split('/')[2], Component: lazy(load) }))
const loadGame = import.meta.glob<Mode>('./game/mode.tsx')['./game/mode.tsx']
const Game = loadGame ? lazy(loadGame) : null

function BlankScene() {
  return <Canvas camera={{ position: [4, 3, 6] }}><ambientLight intensity={1.4} /><directionalLight position={[4, 8, 5]} intensity={2} /><Physics gravity={[0, -9.8, 0]}><mesh><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#8295a3" /></mesh></Physics></Canvas>
}

function App() {
  const session = useMemo(createSession, [])
  const [screen, setScreen] = useState<'menu' | 'play' | 'pause' | 'settings'>('menu')
  const [mode, setMode] = useState<string | null>(null)
  const [audio, setAudio] = useState(true)
  useEffect(() => session.start(), [session])
  useEffect(() => { if (screen === 'play') session.phase.send({ type: session.phase.getSnapshot().matches('paused') ? 'RESUME' : 'PLAY' }); else if (screen === 'pause') session.phase.send({ type: 'PAUSE' }); else if (screen === 'menu') session.phase.send({ type: 'MENU' }) }, [screen, session])
  const chosen = prototypes.find(item => item.name === mode)
  const Active = chosen?.Component || Game
  return <GameFrame className="game-frame"><div className="game-shell">
    {(screen === 'play' || screen === 'pause') && <div className="scene"><Suspense fallback={<main className="panel"><h1>Loading…</h1></main>}>{Active ? <Active /> : <BlankScene />}</Suspense></div>}
    {screen === 'menu' && <main className="panel"><h1>New game</h1><p>Choose Play or open a prototype from the developer menu.</p><Button onClick={() => { setMode(null); setScreen('play') }}>Play</Button><Button variant="outline" onClick={() => setScreen('settings')}>Settings</Button><h2>Prototypes</h2>{prototypes.length ? prototypes.map(item => <Button key={item.name} variant="secondary" onClick={() => { setMode(item.name); setScreen('play') }}>{item.name}</Button>) : <p>No prototypes yet.</p>}</main>}
    {screen === 'play' && <Button className="pause-button" onClick={() => setScreen('pause')}>Pause</Button>}
    {screen === 'pause' && <main className="panel"><h1>Paused</h1><Button onClick={() => setScreen('play')}>Resume</Button><Button variant="outline" onClick={() => setScreen('settings')}>Settings</Button><Button variant="outline" onClick={() => setScreen('menu')}>Main menu</Button></main>}
    {screen === 'settings' && <main className="panel"><h1>Settings</h1><label><input type="checkbox" checked={audio} onChange={event => setAudio(event.target.checked)} /> Audio</label><Button onClick={() => setScreen('menu')}>Back</Button></main>}
  </div></GameFrame>
}

registerWarmup({ name: 'fonts', stage: 'boot', scope: 'game', run: () => document.fonts.ready })
await runWarmup({ scope: 'game' })
createRoot(document.getElementById('root')!).render(<App />)
