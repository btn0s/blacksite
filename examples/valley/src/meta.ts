export type Control = { action: string; keys: string[] }

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

export const meta = { name: 'valley', title: 'Valley', summary: 'Walk a kilometre of meadow above a forested valley, with mountains in the haze, wind in the grass and birds in the trees.', keyboard, touch }
