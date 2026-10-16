import { useEffect, useRef, useState } from 'react'
import { PerfOverlay } from '@blacksite/ui/perf-overlay'
import type { Demo } from './registry'

export default function DemoFrame({ demo }: { demo: Demo }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [source, setSource] = useState<Window | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const sync = () => { if (document.fullscreenElement !== stage.current) setFullscreen(false) }
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  useEffect(() => {
    document.body.classList.toggle('demo-fullscreen-open', fullscreen)
    return () => document.body.classList.remove('demo-fullscreen-open')
  }, [fullscreen])
  const toggleFullscreen = async () => {
    if (fullscreen) {
      if (document.fullscreenElement) await document.exitFullscreen()
      setFullscreen(false)
    } else {
      if (!/iPhone|iPod/.test(navigator.userAgent) && document.fullscreenEnabled) {
        try { await stage.current?.requestFullscreen(); setFullscreen(true); return } catch {}
      }
      setFullscreen(true)
    }
  }
  return <div ref={stage} className={`demo-stage${fullscreen ? ' demo-stage--fullscreen' : ''}${demo.perfCorner === 'bottom-right' ? ' demo-stage--secondary' : ''}`}>
    <iframe ref={ref} title={demo.title} src={`${import.meta.env.BASE_URL}frames/${demo.frame}.html`} onLoad={() => setSource(ref.current?.contentWindow ?? null)} />
    <button className="demo-fullscreen-button" type="button" onClick={() => void toggleFullscreen()}>{fullscreen ? 'Exit fullscreen' : 'Fullscreen'}</button>
    <PerfOverlay source={source} corner={demo.perfCorner} />
  </div>
}
