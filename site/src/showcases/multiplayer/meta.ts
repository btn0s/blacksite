import type { Control } from '../../content'
import type { Showcase } from '../registry'

const keyboard: Control[] = [
  { action: 'Take a side', keys: ['Click'] },
  { action: 'Move', keys: ['W', 'A', 'S', 'D'] },
  { action: 'Sprint', keys: ['Shift'] },
  { action: 'Walk', keys: ['Alt'] },
  { action: 'Crouch', keys: ['Ctrl'] },
  { action: 'Jump · climb a ledge', keys: ['Space'] },
  { action: 'Fire', keys: ['Left mouse'] },
  { action: 'Aim', keys: ['Right mouse'] },
  { action: 'Reload', keys: ['R'] },
  { action: 'Rifle or pistol', keys: ['1', '2'] },
  { action: 'First or third person', keys: ['V'] },
  { action: 'Hand the side back to its bot', keys: ['Esc'] },
]

const touch: Control[] = [
  { action: 'Move', keys: ['Left stick'] },
  { action: 'Look', keys: ['Drag right side'] },
  { action: 'Fire', keys: ['Fire'] },
  { action: 'Aim', keys: ['Aim'] },
  { action: 'Jump · climb', keys: ['Jump'] },
  { action: 'Crouch', keys: ['Crouch'] },
  { action: 'Sprint', keys: ['Sprint'] },
  { action: 'First or third person', keys: ['View'] },
]

export const showcase: Showcase = { tool: 'multiplayer', title: 'Arena', summary: 'Two players in one room inside this tab. A bot plays each side, the server checks every hit, and both characters run the full animation.', tryThis: 'Click a side to take it over from its bot; press Esc to hand it back.', thumbnail: 'thumbs/multiplayer.webp', keyboard, touch }
