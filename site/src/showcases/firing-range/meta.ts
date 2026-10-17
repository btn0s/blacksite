import type { Showcase } from '../registry'

export const showcase: Showcase = {
  tool: 'weapons',
  title: 'Firing Range',
  thumbnail: 'thumbs/weapons.webp',
  keyboard: [
    { action: 'Fire', keys: ['Left mouse'] },
    { action: 'Aim down sights', keys: ['Right mouse'] },
    { action: 'Reload', keys: ['R'] },
    { action: 'Swap weapon', keys: ['1', '2', 'Q', 'Wheel'] },
    { action: 'Inspect weapon', keys: ['F'] },
    { action: 'Jump', keys: ['Space'] },
    { action: 'Compare arms (found / Blacksite / ALS body)', keys: ['V'] },
    { action: 'Move', keys: ['W', 'A', 'S', 'D'] },
    { action: 'Sprint', keys: ['Shift'] },
    { action: 'Release mouse', keys: ['Esc'] },
  ],
  touch: [
    { action: 'Move', keys: ['Left stick'] },
    { action: 'Look', keys: ['Drag right side'] },
    { action: 'Fire', keys: ['Fire'] },
    { action: 'Aim down sights', keys: ['Aim'] },
    { action: 'Reload', keys: ['Reload'] },
    { action: 'Swap weapon', keys: ['Swap'] },
  ],
}
