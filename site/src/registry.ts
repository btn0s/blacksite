import type { ComponentType } from 'react'

export type Demo = {
  id: string
  title: string
  description: string
  loader: () => Promise<{ default: ComponentType<{ demo: Demo }> }>
  static: boolean
  frame?: string
  doc: string
}

const frame = () => import('./DemoFrame')
export const demos: Demo[] = [
  { id: 'cascade', title: 'Cascade · large structure', description: 'Demolish an eight-storey concrete frame with the worker-backed destruction system.', loader: frame, static: true, frame: 'large-structure', doc: 'cascade' },
  { id: 'cascade-worker', title: 'Cascade · worker', description: 'Compare 30 and 60 Hz physics in the smaller worker demo.', loader: frame, static: true, frame: 'cascade-worker', doc: 'cascade' },
  { id: 'warden', title: 'Warden Tactical AI Lab', description: 'Inspect deterministic squad decisions and tactical simulation.', loader: frame, static: true, frame: 'warden', doc: 'warden' },
  { id: 'fpp', title: 'First-person player', description: 'Play the arms-only Subject FPP and Armory prototype.', loader: frame, static: true, frame: 'fpp', doc: 'readme' },
  { id: 'tpp', title: 'Third-person player', description: 'Play the ALS body and camera prototype.', loader: frame, static: true, frame: 'tpp', doc: 'readme' },
  { id: 'mp', title: 'Multiplayer loopback', description: 'Two-player split view for the incoming Relay loopback transport.', loader: () => import('./MpPlaceholder'), static: true, doc: 'roadmap' },
]

export const demoById = (id: string) => demos.find(demo => demo.id === id)
