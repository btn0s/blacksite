import type { ComponentType } from 'react'

export type Demo = {
  id: string
  title: string
  description: string
  loader: () => Promise<{ default: ComponentType<{ demo: Demo }> }>
  static: boolean
  frame?: string
  doc: string
  perfCorner?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  showcase?: boolean
}

const frame = () => import('./DemoFrame')
export const demos: Demo[] = [
  { id: 'movement', title: 'Movement · The Yard', description: 'A character reads the space: sprint, crouch, mantle, roll, ragdoll and switch views.', loader: frame, static: true, frame: 'movement', doc: 'readme', showcase: true, perfCorner: 'bottom-right' },
  { id: 'demolition', title: 'Demolition · Last Light', description: 'Worker-driven concrete destruction, from a charge at a distance to a sledge up close.', loader: frame, static: true, frame: 'demolition', doc: 'cascade', showcase: true, perfCorner: 'bottom-right' },
  { id: 'cascade', title: 'Cascade · large structure', description: 'Demolish an eight-storey concrete frame with the worker-backed destruction system.', loader: frame, static: true, frame: 'large-structure', doc: 'cascade' },
  { id: 'cascade-worker', title: 'Cascade · worker', description: 'Compare 30 and 60 Hz physics in the smaller worker demo.', loader: frame, static: true, frame: 'cascade-worker', doc: 'cascade' },
  { id: 'warden', title: 'Warden Tactical AI Lab', description: 'Inspect deterministic squad decisions and tactical simulation.', loader: frame, static: true, frame: 'warden', doc: 'warden', perfCorner: 'bottom-right' },
  { id: 'fpp', title: 'First-person player', description: 'Play the arms-only Subject FPP and Armory prototype.', loader: frame, static: true, frame: 'fpp', doc: 'readme', perfCorner: 'bottom-right' },
  { id: 'tpp', title: 'Third-person player', description: 'Play the ALS body and camera prototype.', loader: frame, static: true, frame: 'tpp', doc: 'readme', perfCorner: 'bottom-right' },
  { id: 'mp', title: 'Multiplayer loopback', description: 'Two players in one local Relay room with switchable first- and third-person cameras.', loader: frame, static: true, frame: 'mp', doc: 'readme', perfCorner: 'bottom-right' },
]

export const demoById = (id: string) => demos.find(demo => demo.id === id)
