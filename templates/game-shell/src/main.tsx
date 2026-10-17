import { lazy, Suspense, useEffect, useMemo, useState, type ComponentType } from 'react'
import { createRoot } from 'react-dom/client'
import { GameFrame } from '@blacksite/ui/game-frame'
import { Button } from '@blacksite/ui/components/button'
import { MENU, InputProvider, useActionEvents, useConsoleNavigation, useInputContext } from '@blacksite/input'
import { registerWarmup, runWarmup } from '../scripts/warmup'
import { createSession } from './architecture'
import { clearPresses, input } from './game/input'
import { sound } from './game/sound'
import '@blacksite/ui/globals.css'
import './style.css'

type Mode = { default: ComponentType<{ paused?: boolean }> }
type Screen = 'play' | 'pause' | 'menu' | 'settings'
const modes = import.meta.glob<Mode>('./prototypes/*/mode.tsx')
const prototypes = Object.entries(modes).map(([path, load]) => ({ name: path.split('/')[2], Component: lazy(load) }))
const loadGame = import.meta.glob<Mode>('./game/mode.tsx')['./game/mode.tsx']
const Game = loadGame ? lazy(loadGame) : null

function Shell() {
  const session = useMemo(createSession, [])
  const [screen, setScreen] = useState<Screen>('play')
  const [back, setBack] = useState<Screen>('menu')
  const [mode, setMode] = useState<string | null>(null)
  const [audio, setAudio] = useState(true)
  const [aspect, setAspect] = useState(() => innerWidth / Math.max(innerHeight, 1))
  const navigation = useConsoleNavigation()
  const playing = screen === 'play'
  useEffect(() => {
    const resize = () => setAspect(innerWidth / Math.max(innerHeight, 1))
    addEventListener('resize', resize)
    return () => removeEventListener('resize', resize)
  }, [])
  useInputContext(MENU, !playing)
  useEffect(() => session.start(), [session])
  useEffect(() => {
    input.setGameplay(playing)
    clearPresses()
    if (screen === 'play') session.phase.send({ type: session.phase.getSnapshot().matches('paused') ? 'RESUME' : 'PLAY' })
    else if (screen === 'pause') session.phase.send({ type: 'PAUSE' })
    else if (screen === 'menu') session.phase.send({ type: 'MENU' })
    if (!playing && document.pointerLockElement) document.exitPointerLock()
  }, [screen, playing, session])
  useEffect(() => sound.setBusVolume('master', audio ? 1 : 0), [audio])
  useEffect(() => {
    let locked = false
    const change = () => {
      if (locked && !document.pointerLockElement) setScreen(current => current === 'play' ? 'pause' : current)
      locked = Boolean(document.pointerLockElement)
    }
    const gesture = () => { void sound.start() }
    document.addEventListener('pointerlockchange', change)
    addEventListener('pointerdown', gesture, { once: true })
    addEventListener('keydown', gesture, { once: true })
    return () => { document.removeEventListener('pointerlockchange', change); removeEventListener('pointerdown', gesture); removeEventListener('keydown', gesture) }
  }, [])
  useActionEvents(event => {
    if (screen === 'play' && event.action === 'pause') setScreen('pause')
    else if (screen === 'pause' && (event.action === 'back' || event.action === 'pause')) setScreen('play')
    else if (screen === 'settings' && event.action === 'back') setScreen(back)
  })
  const settings = (from: Screen) => { setBack(from); setScreen('settings') }
  const chosen = prototypes.find(item => item.name === mode)
  const Active = chosen?.Component || Game
  return <GameFrame className="game-frame" ratio={aspect}><div className="game-shell">
    {(screen === 'play' || screen === 'pause') && <div className="scene"><Suspense fallback={<main className="panel"><h1>Loading…</h1></main>}>{Active ? <Active key={mode ?? 'game'} paused={screen === 'pause'} /> : <main className="panel"><h1>No game mode</h1><p>Add src/game/mode.tsx.</p></main>}</Suspense></div>}
    {screen === 'menu' && <main ref={navigation.root} className="panel"><h1>New game</h1><p>Play the game or open a prototype.</p><Button onClick={() => { setMode(null); setScreen('play') }}>Play</Button><Button variant="outline" onClick={() => settings('menu')}>Settings</Button><h2>Prototypes</h2>{prototypes.length ? prototypes.map(item => <Button key={item.name} variant="secondary" onClick={() => { setMode(item.name); setScreen('play') }}>{item.name}</Button>) : <p>No prototypes yet.</p>}</main>}
    {screen === 'play' && <Button className="pause-button" onClick={() => setScreen('pause')}>Pause</Button>}
    {screen === 'pause' && <main ref={navigation.root} className="panel"><h1>Paused</h1><Button onClick={() => setScreen('play')}>Resume</Button><Button variant="outline" onClick={() => settings('pause')}>Settings</Button><Button variant="outline" onClick={() => setScreen('menu')}>Main menu</Button></main>}
    {screen === 'settings' && <main ref={navigation.root} className="panel"><h1>Settings</h1><label><input type="checkbox" checked={audio} onChange={event => setAudio(event.target.checked)} /> Audio</label><Button onClick={() => setScreen(back)}>Back</Button></main>}
  </div></GameFrame>
}

registerWarmup({ name: 'fonts', stage: 'boot', scope: 'game', run: () => document.fonts.ready })
registerWarmup({ name: 'sound', stage: 'boot', scope: 'game', run: async () => sound.prepare() })
await runWarmup({ scope: 'game' })
createRoot(document.getElementById('root')!).render(<InputProvider runtime={input}><Shell /></InputProvider>)
