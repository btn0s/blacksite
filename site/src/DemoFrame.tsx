import { useEffect, useRef, useState } from 'react'
import { PerfOverlay } from '@blacksite/ui/perf-overlay'
import { asset } from './links'

export default function DemoFrame({ frame, title, poster, autoplay }: { frame: string; title: string; poster?: string; autoplay: boolean }) {
  const iframe = useRef<HTMLIFrameElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [source, setSource] = useState<Window | null>(null)
  const [started, setStarted] = useState(autoplay)
  const [fullscreen, setFullscreen] = useState(false)
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
  return <div className="demo">
    <div ref={stage} className={`stage${fullscreen ? ' stage--fullscreen' : ''}`}>
      {started
        ? <iframe ref={iframe} title={title} src={asset(`frames/${frame}.html`)} allow="fullscreen; gamepad; autoplay" onLoad={() => setSource(iframe.current?.contentWindow ?? null)} />
        : <button type="button" className="stage-poster" style={poster ? { backgroundImage: `url(${asset(poster)})` } : undefined} onClick={() => setStarted(true)}><span className="stage-play">Play {title}</span></button>}
      {started && <PerfOverlay source={source} corner="top-right" />}
      {fullscreen && <button type="button" className="stage-exit" onClick={() => void toggleFullscreen()}>Exit fullscreen</button>}
    </div>
    <div className="stage-bar">
      <span className="stage-actions">
        <a href={asset(`frames/${frame}.html`)} target="_blank" rel="noreferrer">Open in new tab</a>
        <button type="button" onClick={() => void toggleFullscreen()}>{fullscreen ? 'Exit fullscreen' : 'Fullscreen'}</button>
      </span>
    </div>
  </div>
}
