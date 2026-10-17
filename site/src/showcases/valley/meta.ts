import type { Control } from '../../content'
import type { Showcase } from '../registry'

const keyboard: Control[] = [
  { action: 'Look', keys: ['Click', 'Mouse'] },
  { action: 'Move', keys: ['W', 'A', 'S', 'D'] },
  { action: 'Sprint', keys: ['Shift'] },
  { action: 'Jump', keys: ['Space'] },
  { action: 'Crouch', keys: ['Ctrl'] },
  { action: 'Walk', keys: ['Alt'] },
  { action: 'Back to the meadow', keys: ['R'] },
]

const touch: Control[] = [
  { action: 'Move', keys: ['Left stick'] },
  { action: 'Look', keys: ['Drag right side'] },
  { action: 'Jump', keys: ['Jump'] },
  { action: 'Sprint', keys: ['Full stick'] },
  { action: 'Crouch', keys: ['Crouch'] },
  { action: 'Back to the meadow', keys: ['Home'] },
]

export const showcase: Showcase = { tool: 'world', title: 'Valley',
  summary: 'A square kilometre of meadow above a forested valley, with mountains 16 km away in the haze and one wind moving the grass, the trees and the sound.',
  tryThis: 'Walk up to the ridge and look back across the valley; press R to return to the meadow.', thumbnail: 'thumbs/valley.webp', keyboard, touch }
