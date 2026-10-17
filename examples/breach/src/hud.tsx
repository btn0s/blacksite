import { useEffect, useRef, useState } from 'react'
import { MENU, useConsoleNavigation, useInputContext } from '@blacksite/input'
import { Status } from '@blacksite/ui/hud'
import { hud, useHud } from './store'
import { FEEDBACK, PLAYER } from './model'
import creditsUrl from '../CREDITS.md?url'

const ROOMS = ['Lobby', 'Hall', 'Records']

function Reticle() {
  const view = useHud('marker', 'markerKind', 'aiming')
  const reticle = useRef<HTMLDivElement>(null)
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    let gap = -1
    const apply = () => {
      const next = Math.round((4 + hud.get().spread * 7) * 4) / 4
      if (next === gap || !reticle.current) return
      gap = next
      reticle.current.style.setProperty('--gap', `${next}px`)
    }
    apply()
    return hud.subscribe(apply)
  }, [])
  useEffect(() => {
    if (!view.marker) return
    setFlash(true)
    const timer = setTimeout(() => setFlash(false), 1000 * (view.markerKind === 'kill' ? FEEDBACK.killMarkerSeconds : FEEDBACK.hitMarkerSeconds))
    return () => clearTimeout(timer)
  }, [view.marker, view.markerKind])
  return <div ref={reticle} className={`breach-reticle${view.aiming ? ' breach-reticle--aim' : ''}${flash ? ` breach-reticle--${view.markerKind}` : ''}`} aria-hidden="true"><i /><i /><i /><i /><b /></div>
}

function Damage() {
  const view = useHud('health', 'damage')
  const hurt = 1 - view.health / PLAYER.health
  return <>
    <div className="breach-vignette" style={{ opacity: Math.min(0.85, hurt * 1.1) }} aria-hidden="true" />
    {view.damage.map(item => <div key={item.id} className="breach-damage" style={{ transform: `translate(-50%, -50%) rotate(${item.angle}rad)` }} aria-hidden="true"><i /></div>)}
  </>
}

function Subtitles() {
  const view = useHud('subtitles')
  if (!view.subtitles.length) return null
  return <div className="breach-subtitles" role="status" aria-live="polite">
    {view.subtitles.map(line => <p key={line.id}><b>{line.speaker}</b>{line.text}</p>)}
  </div>
}

function Ending({ onRestart }: { onRestart: () => void }) {
  const view = useHud('phase')
  return view.phase === 'play' ? null : <Summary onRestart={onRestart} />
}

function Summary({ onRestart }: { onRestart: () => void }) {
  const view = useHud('phase', 'shots', 'hits', 'kills', 'time', 'restartIn')
  const navigation = useConsoleNavigation()
  useInputContext(MENU)
  const accuracy = view.shots ? Math.round(view.hits / view.shots * 100) : 0
  const minutes = Math.floor(view.time / 60), seconds = Math.floor(view.time % 60)
  return <div ref={navigation.root} className={`breach-ending breach-ending--${view.phase}`} role="dialog" aria-label="Round over">
    <strong>{view.phase === 'dead' ? 'You are down' : 'Exfiltrated'}</strong>
    <span>{view.kills} kills · {accuracy}% hits · {minutes}:{String(seconds).padStart(2, '0')}</span>
    <button type="button" onClick={onRestart}>Restart now</button>
    <em>Restarting in {Math.max(0, Math.ceil(view.restartIn))}</em>
  </div>
}

export function Hud({ touch, onRestart }: { touch: boolean; onRestart: () => void }) {
  const view = useHud('cleared', 'exfil', 'objective', 'health', 'weapon', 'reloading', 'magazine', 'reserve')
  const done = view.cleared.filter(Boolean).length
  return <div className="breach-hud">
    <a className="breach-credits" href={creditsUrl} target="_blank" rel="noreferrer">Credits</a>
    <Damage />
    <Status label={view.exfil ? 'Exfil' : `Rooms ${done}/3`} value={view.objective} />
    <div className="breach-pips" aria-hidden="true">
      {view.cleared.map((cleared, index) => <span key={index} className={cleared ? 'breach-pip breach-pip--on' : 'breach-pip'}>{ROOMS[index]}</span>)}
    </div>
    <Reticle />
    <Subtitles />
    <div className={`breach-health${touch ? ' breach-health--touch' : ''}`}>
      <span>Health</span>
      <strong className={view.health < 35 ? 'breach-low' : undefined}>{Math.ceil(view.health)}</strong>
    </div>
    <div className={`breach-ammo${touch ? ' breach-ammo--touch' : ''}`}>
      <span>{view.weapon === 'rifle' ? 'Rifle' : 'Pistol'}{view.reloading ? ' · reloading' : ''}</span>
      <strong className={view.magazine === 0 ? 'breach-low' : undefined}>{view.magazine}<small>/{view.reserve}</small></strong>
    </div>
    <Ending onRestart={onRestart} />
  </div>
}
