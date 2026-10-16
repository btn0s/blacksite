import { useEffect, useState } from 'react'
import { Status } from '@blacksite/ui/hud'
import { useHud } from './store'

const ROOMS = ['Lobby', 'Hall', 'Records']

function Reticle() {
  const view = useHud()
  const [flash, setFlash] = useState(false)
  useEffect(() => {
    if (!view.marker) return
    setFlash(true)
    const timer = setTimeout(() => setFlash(false), view.markerKind === 'kill' ? 320 : 120)
    return () => clearTimeout(timer)
  }, [view.marker, view.markerKind])
  const gap = 4 + view.spread * 7
  return <div className={`breach-reticle${view.aiming ? ' breach-reticle--aim' : ''}${flash ? ` breach-reticle--${view.markerKind}` : ''}`} style={{ ['--gap' as string]: `${gap}px` }} aria-hidden="true"><i /><i /><i /><i /><b /></div>
}

function Damage() {
  const view = useHud()
  const hurt = 1 - view.health / 100
  return <>
    <div className="breach-vignette" style={{ opacity: Math.min(0.85, hurt * 1.1) }} aria-hidden="true" />
    {view.damage.map(item => <div key={item.id} className="breach-damage" style={{ transform: `translate(-50%, -50%) rotate(${item.angle}rad)` }} aria-hidden="true"><i /></div>)}
  </>
}

function Subtitles() {
  const view = useHud()
  if (!view.subtitles.length) return null
  return <div className="breach-subtitles" role="status" aria-live="polite">
    {view.subtitles.map(line => <p key={line.id}><b>{line.speaker}</b>{line.text}</p>)}
  </div>
}

function Ending() {
  const view = useHud()
  if (view.phase === 'play') return null
  const accuracy = view.shots ? Math.round(view.hits / view.shots * 100) : 0
  const minutes = Math.floor(view.time / 60), seconds = Math.floor(view.time % 60)
  return <div className={`breach-ending breach-ending--${view.phase}`}>
    <strong>{view.phase === 'dead' ? 'You are down' : 'Exfiltrated'}</strong>
    <span>{view.kills} kills · {accuracy}% hits · {minutes}:{String(seconds).padStart(2, '0')}</span>
    <em>Restarting in {Math.max(0, Math.ceil(view.restartIn))}</em>
  </div>
}

export function Hud({ touch }: { touch: boolean }) {
  const view = useHud()
  const done = view.cleared.filter(Boolean).length
  return <div className="breach-hud">
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
    <Ending />
  </div>
}
