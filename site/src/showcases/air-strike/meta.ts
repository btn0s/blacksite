import type { Showcase } from '../registry'

export const showcase: Showcase = {
  tool: 'destruction',
  title: 'Air Strike',
  summary: 'Call in strikes on a concrete block one at a time; damage adds up until it falls.',
  tryThis: 'Click the block to call in a strike, press Q to switch between missile and bomb, then press R to rebuild.',
  thumbnail: 'thumbs/destruction.webp',
  keyboard: [{ action: 'Call in a strike', keys: ['Click'] }, { action: 'Strike the centre', keys: ['Space'] }, { action: 'Switch munition', keys: ['Q'] }, { action: 'Orbit', keys: ['Drag'] }, { action: 'Zoom', keys: ['Wheel'] }, { action: 'Rebuild', keys: ['R'] }],
  touch: [{ action: 'Call in a strike', keys: ['Tap'] }, { action: 'Orbit', keys: ['Drag'] }, { action: 'Zoom', keys: ['Pinch'] }, { action: 'Strike, switch munition or rebuild', keys: ['Buttons'] }],
}
