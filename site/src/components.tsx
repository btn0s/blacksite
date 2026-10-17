import { Fragment, useState } from 'react'

export function CopyLine({ code, prompt = '$' }: { code: string; prompt?: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1600) } catch {}
  }
  return <div className="copyline">
    <div className="copyline-row"><code><span className="prompt" aria-hidden="true">{prompt}</span>{code}</code><button type="button" onClick={() => void copy()} aria-label="Copy command">{copied ? 'Copied' : 'Copy'}</button></div>
  </div>
}

export function Keys({ keys }: { keys: string[] }) {
  return <span className="keys">{keys.map(key => <kbd key={key}>{key}</kbd>)}</span>
}

export function Inline({ text }: { text: string }) {
  return <>{text.split('`').map((part, index) => index % 2 ? <code key={index}>{part}</code> : <Fragment key={index}>{part}</Fragment>)}</>
}
