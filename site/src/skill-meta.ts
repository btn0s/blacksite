export type Invocation = 'user' | 'both' | 'model'
export type Skill = { name: string; description: string; summary: string; invocation: Invocation; argument?: string; path: string }
export type Reference = { name: string; title: string; summary: string; path: string }
export type ReferenceNote = { label: string; summary: string }

export const blockLinks = [
  { tool: 'characters', label: 'characters' },
  { tool: 'weapons', label: 'weapons' },
  { tool: 'ai', label: 'enemy AI' },
  { tool: 'destruction', label: 'destruction' },
  { tool: 'multiplayer', label: 'multiplayer' },
  { tool: 'world', label: 'open worlds' },
  { tool: 'input', label: 'input' },
]

export const instincts = [
  'Footsteps follow the animation’s foot plants, and the same sample never plays twice in a row.',
  'A flashlight lags the view slightly, and its beam shows in the haze.',
  'Enemies react after a fifth of a second, call out what they’re doing, and their aim starts wide.',
  'A distant explosion is heard after it’s seen, and gunfire echoes like the room it’s in.',
  'Every action gets something to see, something to hear and a camera response.',
  'Shaders and sounds are built while the level loads, so the first shot never stutters.',
  'Distant trees become lighter stand-ins, and the horizon fades into haze instead of ending.',
  'Phones get the same look with fewer pixels and without ambient occlusion or bloom.',
  'Surfaces that would flicker against each other are found and pulled apart as the level loads.',
]

export const exampleGames = ['breach', 'traverse', 'valley']

export const checkOutput = `$ blacksite check dist
pass  perf    phone   cpu p95 10.16 ms (budget 16.7)
pass  hitch   phone   0 frames over 33 ms; first playable 3732 ms (budget 5000)
pass  feel    desktop moveSpeed 3.76/3.75, sprintSpeed 6.49/6.5, jumpApex 0.9/0.9
pass  audio   desktop voices max 18/28, 150 plays, 0 back-to-back repeats
pass  pop     desktop 0 moving frames and 0 still views flagged of 71
pass  zfight  desktop 0 z-fighting pixels over 8 views
pass  critic  desktop 16 captures, 0 console errors
checks passed`

export const referenceGroups = [
  { title: 'Planning and building the game', names: ['process', 'architecture'] },
  { title: 'Making it feel and sound right', names: ['feel', 'combat', 'enemies', 'sound', 'multiplayer'] },
  { title: 'Making it look right', names: ['craft', 'worlds'] },
  { title: 'Making it run fast', names: ['performance', 'verify'] },
  { title: 'Using the building blocks', names: ['building-blocks', 'catalog'] },
]

export const referenceNotes: Record<string, ReferenceNote> = {
  process: { label: 'From idea to deploy', summary: 'Asks you one question at a time, writes the design you approve, builds each risky mechanic alone, joins them into one loop, and deploys only when you ask.' },
  architecture: { label: 'Where state lives', summary: 'Which library owns entities, game states, services, the frame tick and network messages, so two systems never fight over one value.' },
  feel: { label: 'Movement, camera and controls', summary: 'How fast the player walks and sprints, how high they jump, how the camera follows and lands, and how every control maps to an action.' },
  combat: { label: 'Weapons, hits and destruction', summary: 'What every action shows, plays and does to the camera, how weapons aim and kick, how a hit is confirmed, and how buildings break.' },
  enemies: { label: 'Enemies', summary: 'Squads that see, hear and remember, call out what they do, and aim with a human reaction delay so the player can answer.' },
  sound: { label: 'Sound', summary: 'Room tone, sounds placed in the world, footsteps, a reverb that tells you which room you are in, and a mix that keeps the important sound on top.' },
  multiplayer: { label: 'Multiplayer', summary: 'Your own movement answers at once, other players move smoothly, the server owns hits, and what it can’t do yet.' },
  craft: { label: 'Light, materials and layout', summary: 'One key light, a fill at about a third of it, surfaces that never flicker, props in groups of 3 to 7, and a space that teaches as you move through it.' },
  worlds: { label: 'Sky, terrain and forests', summary: 'A sky lit by the sun, terrain and forests to the horizon with no visible change in detail, ground cover and one wind everything follows.' },
  performance: { label: 'Speed targets', summary: '120 fps on desktop, 60 on phones, no frame over 33 ms, everything compiled before play, and what to cut first when a frame runs over.' },
  verify: { label: 'Checking the game', summary: 'Runs `blacksite check` on desktop and phone and reads its results and screenshots before anyone else plays.' },
  'building-blocks': { label: 'The building blocks', summary: 'How to wire the scaffold, characters, weapons, enemies, destruction, multiplayer, input, the look, open worlds, materials and sound.' },
  catalog: { label: 'Everything in the kit', summary: 'Every template, package and command, listed when each version is released.' },
}

export function parseFrontmatter(source: string) {
  const match = /^---\n([\s\S]*?)\n---/.exec(source)
  const fields: Record<string, string> = {}
  for (const line of match?.[1]?.split('\n') ?? []) {
    const index = line.indexOf(':')
    if (index > 0) fields[line.slice(0, index).trim()] = line.slice(index + 1).trim().replace(/^["']|["']$/g, '')
  }
  return fields
}

export function invocationOf(fields: Record<string, string>): Invocation {
  if (fields['disable-model-invocation'] === 'true') return 'user'
  if (fields['argument-hint']) return 'both'
  return 'model'
}

export function titleOf(source: string) {
  return source.split('\n').find(line => line.startsWith('# '))?.slice(2).trim() ?? ''
}
