import { useEffect, useRef, useState } from 'react'
import { PerfOverlay } from '@blacksite/ui/perf-overlay'
import type { Control } from './content'
import { Keys } from './components'
import { asset } from './links'

const coarse = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches

type Demo = { title: string; frame: string; thumbnail?: string; keyboard: Control[]; touch: Control[] }

export default function DemoFrame({ demo, autoplay }: { demo: Demo; autoplay: boolean }) {
  const iframe = useRef<HTMLIFrameElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [source, setSource] = useState<Window | null>(null)
  const [started, setStarted] = useState(autoplay)
  const [fullscreen, setFullscreen] = useState(false)
  const [help, setHelp] = useState(false)
  const controls = coarse() && demo.touch.length ? demo.touch : demo.keyboard
  useEffect(() => {
    const sync = () => { if (!document.fullscreenElement) setFullscreen(false) }
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  useEffect(() => {
    document.body.classList.toggle('stage-fullscreen-open', fullscreen)
    return () => document.body.classList.remove('stage-fullscreen-open')
  }, [fullscreen])
  const toggleFullscreen = async () => {
    if (fullscreen) {
      if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
      setFullscreen(false)
      return
    }
    if (document.fullscreenEnabled && stage.current?.requestFullscreen) {
      try { await stage.current.requestFullscreen(); setFullscreen(true); return } catch {}
    }
    setFullscreen(true)
  }
  return <div ref={stage} className={`stage${fullscreen ? ' stage--fullscreen' : ''}`}>
    {started
      ? <iframe ref={iframe} title={demo.title} src={asset(`frames/${demo.frame}.html`)} allow="fullscreen; gamepad; autoplay" onLoad={() => setSource(iframe.current?.contentWindow ?? null)} />
      : <button type="button" className="stage-poster" style={demo.thumbnail ? { backgroundImage: `url(${asset(demo.thumbnail)})` } : undefined} onClick={() => setStarted(true)}><span className="stage-play">Play</span></button>}
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
