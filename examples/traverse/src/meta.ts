export type Control = { action: string; keys: string[] }

const keyboard: Control[] = [
  { action: 'Look', keys: ['Click', 'Mouse'] },
  { action: 'Move', keys: ['W', 'A', 'S', 'D'] },
  { action: 'Sprint · tap to roll', keys: ['Shift'] },
  { action: 'Jump · mantle a ledge', keys: ['Space'] },
  { action: 'Crouch', keys: ['Ctrl'] },
  { action: 'Walk', keys: ['Alt'] },
  { action: 'Swap shoulder', keys: ['C'] },
  { action: 'Ragdoll · get up', keys: ['X'] },
  { action: 'Back to last checkpoint', keys: ['T'] },
  { action: 'Restart the run', keys: ['R'] },
  { action: 'Show or hide the ghost', keys: ['G'] },
]

const touch: Control[] = [
  { action: 'Move', keys: ['Left stick'] },
  { action: 'Look', keys: ['Drag right side'] },
  { action: 'Jump · mantle', keys: ['Jump'] },
  { action: 'Sprint', keys: ['Full stick'] },
  { action: 'Roll', keys: ['Roll'] },
  { action: 'Crouch', keys: ['Crouch'] },
  { action: 'Swap shoulder', keys: ['Shoulder'] },
  { action: 'Ragdoll · get up', keys: ['Fall / up'] },
  { action: 'Retry checkpoint · restart after finish', keys: ['Retry'] },
]

export const meta = { name: 'traverse', title: 'Traverse', summary: 'A timed third-person run across the roofs, yards and stairwells of a ruined block, racing the ghost of your best time.', keyboard, touch }
