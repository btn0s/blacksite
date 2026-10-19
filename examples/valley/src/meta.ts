export type Control = { action: string; keys: string[] }

const keyboard: Control[] = [
  { action: 'Look', keys: ['Click', 'Mouse'] },
  { action: 'Move', keys: ['W', 'A', 'S', 'D'] },
  { action: 'Sprint', keys: ['Shift'] },
  { action: 'Jump', keys: ['Space'] },
  { action: 'Crouch', keys: ['Ctrl'] },
  { action: 'Walk', keys: ['Alt'] },
  { action: 'Back to the watchtower', keys: ['R'] },
]

const touch: Control[] = [
  { action: 'Move', keys: ['Left stick'] },
  { action: 'Look', keys: ['Drag right side'] },
  { action: 'Jump', keys: ['Jump'] },
  { action: 'Sprint', keys: ['Full stick'] },
  { action: 'Crouch', keys: ['Crouch'] },
  { action: 'Back to the watchtower', keys: ['Home'] },
]

export const meta = { name: 'valley', title: 'Valley', summary: 'Walk from the watchtower through a forested valley of ancient ruins to the temple above the gorge.', keyboard, touch }
