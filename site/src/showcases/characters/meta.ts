import type { Control } from '../../content'
import type { Showcase } from '../registry'

const keyboard: Control[] = [
  { action: 'Look', keys: ['Click', 'Mouse'] },
  { action: 'Move', keys: ['W', 'A', 'S', 'D'] },
  { action: 'Sprint · tap to roll', keys: ['Shift'] },
  { action: 'Walk or run', keys: ['Alt'] },
  { action: 'Crouch', keys: ['Ctrl'] },
  { action: 'Jump · climb a ledge', keys: ['Space'] },
  { action: 'Aim', keys: ['Right mouse'] },
  { action: 'Fall limp · get up', keys: ['X'] },
  { action: 'First or third person', keys: ['V'] },
  { action: 'Swap shoulder', keys: ['C'] },
]

const touch: Control[] = [
  { action: 'Move', keys: ['Left stick'] },
  { action: 'Look', keys: ['Drag right side'] },
  { action: 'Jump · climb', keys: ['Jump'] },
  { action: 'Sprint · tap to roll', keys: ['Sprint'] },
  { action: 'Crouch', keys: ['Crouch'] },
  { action: 'Fall limp', keys: ['Ragdoll'] },
  { action: 'First or third person', keys: ['View'] },
]

export const showcase: Showcase = { tool: 'characters', title: 'Checkpoint', summary: 'Walk, sprint, climb and roll through a ruined town, in first or third person.', tryThis: 'Press V to switch view, then X to fall limp and X again to get up.', thumbnail: 'thumbs/characters.webp', keyboard, touch }
