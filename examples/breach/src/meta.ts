export type Control = { action: string; keys: string[] }

const keyboard: Control[] = [
  { action: 'Look', keys: ['Click', 'Mouse'] },
  { action: 'Fire', keys: ['Left mouse'] },
  { action: 'Aim down sights', keys: ['Right mouse'] },
  { action: 'Move', keys: ['W', 'A', 'S', 'D'] },
  { action: 'Sprint', keys: ['Shift'] },
  { action: 'Crouch', keys: ['C', 'Ctrl'] },
  { action: 'Jump', keys: ['Space'] },
  { action: 'Reload', keys: ['R'] },
  { action: 'Swap weapon', keys: ['1', '2', 'Q', 'Wheel'] },
  { action: 'Release mouse', keys: ['Esc'] },
]

const touch: Control[] = [
  { action: 'Move', keys: ['Left stick'] },
  { action: 'Sprint', keys: ['Push the stick fully'] },
  { action: 'Look', keys: ['Drag right side'] },
  { action: 'Fire', keys: ['Fire'] },
  { action: 'Aim down sights', keys: ['Aim'] },
  { action: 'Reload', keys: ['Reload'] },
  { action: 'Crouch', keys: ['Crouch'] },
  { action: 'Jump', keys: ['Jump'] },
  { action: 'Swap weapon', keys: ['Swap'] },
]

export const meta = { name: 'breach', title: 'Breach', summary: 'Fight room by room through a ruined works against a squad that calls out its moves, takes cover and flanks, then get out by the carrier.', keyboard, touch }
