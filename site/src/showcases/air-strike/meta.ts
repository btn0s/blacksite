import type { Showcase } from '../registry'

export const showcase: Showcase = {
  tool: 'destruction',
  title: 'Air Strike',
  summary: 'A six-storey concrete block that cracks where it is hit and falls when it loses its supports.',
  tryThis: 'Click the block to call in a strike, watch the floors above the hit give way, then press R to rebuild.',
  thumbnail: 'thumbs/destruction.webp',
  keyboard: [{ action: 'Mark a target', keys: ['Click'] }, { action: 'Strike the centre', keys: ['Space'] }, { action: 'Orbit', keys: ['Drag'] }, { action: 'Zoom', keys: ['Wheel'] }, { action: 'Rebuild', keys: ['R'] }],
  touch: [{ action: 'Mark a target', keys: ['Tap'] }, { action: 'Orbit', keys: ['Drag'] }, { action: 'Zoom', keys: ['Pinch'] }, { action: 'Strike or rebuild', keys: ['Buttons'] }],
}
