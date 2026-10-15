import { useRef, useState } from 'react'
import { PerfOverlay } from '@blacksite/ui/perf-overlay'
import type { Demo } from './registry'

export default function DemoFrame({ demo }: { demo: Demo }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const [source, setSource] = useState<Window | null>(null)
  return <div className="demo-stage">
    <iframe ref={ref} title={demo.title} src={`${import.meta.env.BASE_URL}frames/${demo.frame}.html`} onLoad={() => setSource(ref.current?.contentWindow ?? null)} />
    <PerfOverlay source={source} />
  </div>
}
