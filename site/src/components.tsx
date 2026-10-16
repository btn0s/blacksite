import { useState, type ReactNode } from 'react'
import type { Status, Tool } from './content'
import { asset } from './links'

export function StatusChip({ status }: { status: Status }) {
  const tone = status === 'Usable' ? 'ok' : status === 'Usable v0' ? 'v0' : 'exp'
  return <span className={`chip chip--${tone}`}>{status}</span>
}

export function CopyLine({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch {}
  }
  return <div className="copyline">
    {label && <span className="copyline-label">{label}</span>}
    <div className="copyline-row"><code><span className="prompt" aria-hidden="true">$</span>{code}</code><button type="button" onClick={() => void copy()} aria-label={`Copy ${label ?? 'command'}`}>{copied ? 'Copied' : 'Copy'}</button></div>
  </div>
}

export function Keys({ keys }: { keys: string[] }) {
  return <span className="keys">{keys.map(key => <kbd key={key}>{key}</kbd>)}</span>
}

export function Section({ eyebrow, title, children, id }: { eyebrow?: string; title: string; children: ReactNode; id?: string }) {
  return <section className="section" id={id}>
    {eyebrow && <p className="eyebrow">{eyebrow}</p>}
    <h2 className="section-title">{title}</h2>
    {children}
  </section>
}

export function Thumb({ tool }: { tool: Tool }) {
  if (tool.thumbnail) return <img src={asset(tool.thumbnail)} alt="" loading="lazy" />
  return <div className="thumb-plate" style={{ backgroundImage: `url(${asset(`look/${tool.material}_c.webp`)})` }}>
    <span>{tool.codename ?? tool.name}</span>
    <em>{tool.demos.some(demo => demo.live) ? 'New showcase in progress' : 'Showcase coming'}</em>
  </div>
}
