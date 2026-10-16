import { useEffect, useRef, useState, type ReactNode } from 'react'
import '@fontsource/barlow/latin-400.css'
import '@fontsource/barlow-condensed/latin-600.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import './hud.css'

let grainUrl = ''
function grain() {
  if (grainUrl) return grainUrl
  const size = 160
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const context = canvas.getContext('2d')!
  const image = context.createImageData(size, size)
  for (let index = 0; index < size * size; index++) {
    const value = Math.random() * 255
    image.data.set([value, value, value, 255], index * 4)
  }
  context.putImageData(image, 0, 0)
  grainUrl = canvas.toDataURL('image/png')
  return grainUrl
}

export function Screen({ children }: { children: ReactNode }) {
  return <div className="hud-screen">
    {children}
    <div className="hud-vignette" aria-hidden="true" />
    <div className="hud-grain" aria-hidden="true" style={{ backgroundImage: `url(${grain()})` }} />
  </div>
}

export function TitleCard({ kicker, title, line }: { kicker: string; title: string; line?: string }) {
  return <div className="hud-title"><span>{kicker}</span><strong>{title}</strong>{line && <em>{line}</em>}</div>
}

export function Loading({ title, detail, progress, done }: { title: string; detail: string; progress?: number; done: boolean }) {
  const [gone, setGone] = useState(false)
  useEffect(() => { if (done) { const timer = setTimeout(() => setGone(true), 700); return () => clearTimeout(timer) } }, [done])
  if (gone) return null
  return <div className={`hud-loading${done ? ' hud-loading--done' : ''}`} role="status">
    <div>
      <span className="hud-loading-kicker">Blacksite</span>
      <strong>{title}</strong>
      <div className="hud-meter"><i style={{ transform: `scaleX(${progress ?? 0.08})` }} /></div>
      <span className="hud-loading-detail">{detail}</span>
    </div>
  </div>
}

export function Hints({ items, visible = true }: { items: Array<[string, string]>; visible?: boolean }) {
  if (!visible) return null
  return <div className="hud-hints">{items.map(([key, label]) => <span key={label}><kbd>{key}</kbd>{label}</span>)}</div>
}

export function Prompt({ text, visible }: { text: string; visible: boolean }) {
  return <div className={`hud-prompt${visible ? '' : ' hud-prompt--hidden'}`} aria-hidden={!visible}>{text}</div>
}

export type TouchButton = { id: string; label: string; hold?: boolean }

export function TouchPad({ onMove, onLook, buttons, onButton, lookTarget }: {
  onMove: (x: number, y: number) => void
  onLook: (dx: number, dy: number) => void
  buttons: TouchButton[]
  onButton: (id: string, pressed: boolean) => void
  lookTarget?: 'zone' | 'none'
}) {
  const stick = useRef<HTMLDivElement>(null)
  const knob = useRef<HTMLSpanElement>(null)
  const stickPointer = useRef<number | null>(null)
  const lookPointer = useRef<{ id: number; x: number; y: number } | null>(null)
  const moveTo = (clientX: number, clientY: number) => {
    const rect = stick.current!.getBoundingClientRect()
    const radius = rect.width / 2
    let x = (clientX - rect.left - radius) / radius
    let y = (clientY - rect.top - radius) / radius
    const length = Math.hypot(x, y)
    if (length > 1) { x /= length; y /= length }
    knob.current!.style.transform = `translate(calc(-50% + ${x * radius * 0.55}px), calc(-50% + ${y * radius * 0.55}px))`
    onMove(x, y)
  }
  const release = () => {
    stickPointer.current = null
    knob.current!.style.transform = 'translate(-50%, -50%)'
    onMove(0, 0)
  }
  return <div className="hud-touch">
    {lookTarget !== 'none' && <div className="hud-touch-look"
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); lookPointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY } }}
      onPointerMove={event => { const last = lookPointer.current; if (!last || last.id !== event.pointerId) return; onLook(event.clientX - last.x, event.clientY - last.y); last.x = event.clientX; last.y = event.clientY }}
      onPointerUp={() => { lookPointer.current = null }}
      onPointerCancel={() => { lookPointer.current = null }} />}
    <div ref={stick} className="hud-stick"
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); stickPointer.current = event.pointerId; moveTo(event.clientX, event.clientY) }}
      onPointerMove={event => { if (stickPointer.current === event.pointerId) moveTo(event.clientX, event.clientY) }}
      onPointerUp={release}
      onPointerCancel={release}><span ref={knob} /></div>
    <div className="hud-buttons">{buttons.map(button => <button key={button.id} type="button"
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.dataset.pressed = 'true'; onButton(button.id, true) }}
      onPointerUp={event => { delete event.currentTarget.dataset.pressed; onButton(button.id, false) }}
      onPointerCancel={event => { delete event.currentTarget.dataset.pressed; onButton(button.id, false) }}
      onContextMenu={event => event.preventDefault()}>{button.label}</button>)}</div>
  </div>
}

export function useTouch() {
  const [touch, setTouch] = useState(() => matchMedia('(pointer: coarse)').matches)
  useEffect(() => {
    const query = matchMedia('(pointer: coarse)')
    const update = () => setTouch(query.matches)
    const onTouch = () => setTouch(true)
    query.addEventListener('change', update)
    addEventListener('touchstart', onTouch, { once: true, passive: true })
    return () => { query.removeEventListener('change', update); removeEventListener('touchstart', onTouch) }
  }, [])
  return touch
}
