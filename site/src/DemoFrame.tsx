import { useCallback, useEffect, useRef, useState } from 'react'
import { PerfOverlay } from '@blacksite/ui/perf-overlay'
import type { Control } from './content'
import { Keys } from './components'
import { asset } from './links'

const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

type Demo = { title: string; frame: string; thumbnail?: string; keyboard: Control[]; touch: Control[] }
type Mode = 'off' | 'native' | 'pseudo'
type FullscreenDocument = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void }
type FullscreenTarget = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }

const STAGE_EVENT = 'blacksite:stage-fullscreen'
const LOCKED = 'stage-fullscreen-open'
const fullscreenDocument = () => document as FullscreenDocument
const fullscreenElement = () => document.fullscreenElement ?? fullscreenDocument().webkitFullscreenElement ?? null

function nativeRequest(target: FullscreenTarget) {
  const doc = fullscreenDocument()
  if (doc.fullscreenEnabled && typeof target.requestFullscreen === 'function') return () => target.requestFullscreen()
  if (doc.webkitFullscreenEnabled && typeof target.webkitRequestFullscreen === 'function') return () => target.webkitRequestFullscreen!()
  return null
}

async function enterNative(target: FullscreenTarget) {
  const request = nativeRequest(target)
  if (!request) return false
  try { await request() } catch { return false }
  for (let tries = 0; tries < 25 && fullscreenElement() !== target; tries++) await new Promise(resolve => setTimeout(resolve, 20))
  return fullscreenElement() === target
}

async function exitNative() {
  if (!fullscreenElement()) return
  const doc = fullscreenDocument()
  try { await (document.exitFullscreen ? document.exitFullscreen() : doc.webkitExitFullscreen?.()) } catch {}
}

const posters = new Map<HTMLElement, () => void>()
let padFrame = 0
const padHeld = new Map<number, boolean>()

function visibleArea(element: HTMLElement) {
  const rect = element.getBoundingClientRect()
  const width = Math.min(rect.right, innerWidth) - Math.max(rect.left, 0)
  const height = Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0)
  return width > 0 && height > 0 ? width * height : 0
}

function pollPads() {
  padFrame = 0
  if (!posters.size) return
  let pressed = false
  for (const pad of Array.from(navigator.getGamepads?.() ?? [])) {
    if (!pad?.connected) continue
    const down = pad.buttons.some(button => button.pressed)
    if (down && !padHeld.get(pad.index)) pressed = true
    padHeld.set(pad.index, down)
  }
  if (pressed && document.visibilityState === 'visible') {
    let best: (() => void) | null = null
    let area = 0
    for (const [element, start] of posters) {
      const visible = visibleArea(element)
      if (visible > area) { area = visible; best = start }
    }
    best?.()
  }
  padFrame = requestAnimationFrame(pollPads)
}

function usePadStart(element: HTMLElement | null, start: () => void) {
  useEffect(() => {
    if (!element || typeof navigator.getGamepads !== 'function') return
    posters.set(element, start)
    padFrame ||= requestAnimationFrame(pollPads)
    return () => {
      posters.delete(element)
      if (!posters.size && padFrame) { cancelAnimationFrame(padFrame); padFrame = 0 }
    }
  }, [element, start])
}

export default function DemoFrame({ demo, autoplay }: { demo: Demo; autoplay: boolean }) {
  const iframe = useRef<HTMLIFrameElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [source, setSource] = useState<Window | null>(null)
  const [started, setStarted] = useState(autoplay)
  const [mode, setMode] = useState<Mode>('off')
  const [help, setHelp] = useState(false)
  const [poster, setPoster] = useState<HTMLButtonElement | null>(null)
  const start = useCallback(() => setStarted(true), [])
  usePadStart(started ? null : poster, start)
  const controls = coarse() && demo.touch.length ? demo.touch : demo.keyboard
  const fullscreen = mode !== 'off'
  useEffect(() => {
    const sync = () => { if (fullscreenElement() !== stage.current) setMode(current => current === 'native' ? 'off' : current) }
    document.addEventListener('fullscreenchange', sync)
    document.addEventListener('webkitfullscreenchange', sync)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
      document.removeEventListener('webkitfullscreenchange', sync)
    }
  }, [])
  useEffect(() => {
    const other = (event: Event) => {
      if ((event as CustomEvent<HTMLElement>).detail === stage.current) return
      setStarted(false)
      setSource(null)
      setHelp(false)
    }
    addEventListener(STAGE_EVENT, other)
    return () => removeEventListener(STAGE_EVENT, other)
  }, [])
  useEffect(() => {
    if (!fullscreen) return
    const root = document.documentElement
    const top = scrollY
    root.style.setProperty('--stage-scroll', `${-top}px`)
    root.classList.add(LOCKED)
    document.body.classList.add(LOCKED)
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setMode(current => current === 'pseudo' ? 'off' : current) }
    addEventListener('keydown', escape)
    return () => {
      removeEventListener('keydown', escape)
      root.classList.remove(LOCKED)
      document.body.classList.remove(LOCKED)
      root.style.removeProperty('--stage-scroll')
      scrollTo({ top, behavior: 'instant' })
    }
  }, [fullscreen])
  const toggleFullscreen = async () => {
    if (fullscreen) {
      await exitNative()
      setMode('off')
      return
    }
    const target = stage.current
    if (!target) return
    dispatchEvent(new CustomEvent(STAGE_EVENT, { detail: target }))
    setMode(await enterNative(target) ? 'native' : 'pseudo')
  }
  return <div ref={stage} className={`stage${fullscreen ? ' stage--fullscreen' : ''}`}>
    {started
      ? <iframe ref={iframe} title={demo.title} src={asset(`frames/${demo.frame}.html`)} allow="fullscreen; gamepad; autoplay" onLoad={() => { setSource(iframe.current?.contentWindow ?? null); if (!coarse()) iframe.current?.focus({ preventScroll: true }) }} />
      : <button ref={setPoster} type="button" className="stage-poster" style={demo.thumbnail ? { backgroundImage: `url(${asset(demo.thumbnail)})` } : undefined} onClick={() => setStarted(true)}><span className="stage-play">Play</span></button>}
    {started && <PerfOverlay source={source} corner="top-right" />}
    {started && <div className="stage-tools">
      {controls.length > 0 && <button type="button" aria-label="Controls" aria-expanded={help} onClick={() => setHelp(!help)}>?</button>}
      <button type="button" aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={() => void toggleFullscreen()}>
        <svg viewBox="0 0 16 16" aria-hidden="true">{fullscreen
          ? <path d="M6 1v5H1M10 1v5h5M6 15v-5H1M10 15v-5h5" />
          : <path d="M1 6V1h5M15 6V1h-5M1 10v5h5M15 10v5h-5" />}</svg>
      </button>
    </div>}
    {help && <dl className="stage-help" onClick={() => setHelp(false)}>{controls.map(control => <div key={control.action}><dt><Keys keys={control.keys} /></dt><dd>{control.action}</dd></div>)}</dl>}
  </div>
}
