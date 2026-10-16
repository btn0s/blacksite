import type { Showcase } from '../registry'

export const showcase: Showcase = {
  tool: 'destruction',
  title: 'Air Strike',
  thumbnail: 'thumbs/destruction.webp',
  keyboard: [{ action: 'Mark a target', keys: ['Click'] }, { action: 'Strike the centre', keys: ['Space'] }, { action: 'Orbit', keys: ['Drag'] }, { action: 'Zoom', keys: ['Wheel'] }, { action: 'Rebuild', keys: ['R'] }],
  touch: [{ action: 'Mark a target', keys: ['Tap'] }, { action: 'Orbit', keys: ['Drag'] }, { action: 'Zoom', keys: ['Pinch'] }, { action: 'Strike or rebuild', keys: ['Buttons'] }],
}
