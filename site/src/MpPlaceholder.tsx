import type { Demo } from './registry'

export default function MpPlaceholder({ demo }: { demo: Demo }) {
  return <div className="demo-placeholder"><h2>{demo.title}</h2><p>The Relay loopback demo is being built. This registry entry is ready for its loader and scene.</p></div>
}
