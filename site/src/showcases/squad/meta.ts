import type { Control } from '../../content'
import type { Showcase } from '../registry'

const keyboard: Control[] = [
  { action: 'Orbit the yard', keys: ['Drag'] },
  { action: 'Pan', keys: ['Right drag'] },
  { action: 'Zoom', keys: ['Scroll'] },
  { action: 'Follow a soldier', keys: ['Click'] },
  { action: 'Next soldier', keys: ['F'] },
  { action: 'Tactical view', keys: ['T'] },
  { action: 'Intel: Alpha, Bravo or off', keys: ['I'] },
  { action: 'New round', keys: ['R'] },
]

const touch: Control[] = [
  { action: 'Orbit', keys: ['Drag'] },
  { action: 'Zoom · pan', keys: ['Pinch'] },
  { action: 'Follow a soldier', keys: ['Tap'] },
  { action: 'Follow or tactical', keys: ['Follow'] },
  { action: 'Intel: Alpha, Bravo or off', keys: ['Intel'] },
]

export const showcase: Showcase = { tool: 'ai', title: 'Squad', summary: 'Watch two squads take cover and flank each other across a container yard.', tryThis: 'Click a soldier to follow them, or press T for the tactical view.', thumbnail: 'thumbs/ai.webp', keyboard, touch }
