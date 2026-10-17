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
  { title: 'Planning and building the game', names: ['design', 'setup', 'prototype', 'combine', 'ship'] },
  { title: 'Making it look right', names: ['craft', 'materials', 'atmosphere', 'far-field', 'foliage', 'wind'] },
  { title: 'Making it feel and sound right', names: ['feel', 'sound'] },
  { title: 'Making it run fast', names: ['performance', 'optimise', 'verify'] },
  { title: 'Using the building blocks', names: ['characters', 'als', 'weapons', 'ai', 'destruction', 'multiplayer', 'input', 'architecture', 'assets', 'catalog'] },
]

export const referenceNotes: Record<string, ReferenceNote> = {
  design: { label: 'Interview and plan', summary: 'Asks you one question at a time, sizes the game, and writes the design and the parts list you approve.' },
  setup: { label: 'Create the project', summary: 'Starts the game from a template and proves a fresh build passes every check.' },
  prototype: { label: 'Build one mechanic alone', summary: 'Builds one risky mechanic on its own, playable from a developer menu, to answer one question about it.' },
  combine: { label: 'Join the prototypes', summary: 'Joins the mechanics that worked into one loop you reach from the main menu.' },
  ship: { label: 'Deploy', summary: 'Deploys only when you ask, to a host you name, after the checks pass on the production build.' },
  craft: { label: 'Light, materials and props', summary: 'One key light, a fill at about a third of it, lamps that explain the light, props in groups of 3 to 7, and fog on every outdoor shot.' },
  materials: { label: 'Materials', summary: 'Builds weathered concrete, metal and plaster from node graphs or photos, compares them side by side, then saves them as image textures.' },
  atmosphere: { label: 'Sky and haze', summary: 'A sky lit by the sun, distance that turns pale and blue, haze in the valleys, and clouds with shape.' },
  'far-field': { label: 'Terrain to the horizon', summary: 'Terrain and forests that carry on past where you can walk, with no visible change in detail as you move.' },
  foliage: { label: 'Grass and trees', summary: 'Ground cover that is dense at your feet and thins with distance without a line, and trees that glow when the sun is behind them.' },
  wind: { label: 'Wind', summary: 'One wind that the grass, trees, particles and ambience all follow, so you see and hear a gust cross the meadow.' },
  feel: { label: 'Movement and aim', summary: 'How fast the player walks and sprints, how high they jump and how the camera moves, which the checks then measure in the running game.' },
  sound: { label: 'Sound', summary: 'Room tone, sounds placed in the world, footsteps, event cues, and a reverb that tells you which room you are in.' },
  performance: { label: 'Speed targets', summary: '120 fps on desktop, 60 on phones, no frame over 33 ms, playable within 5 seconds of opening the link, and what to cut first when a frame runs over.' },
  optimise: { label: 'Fixing a slow game', summary: 'Measures, finds the slow thread, and fixes the largest cost first, keeping a change only if the frame time moves.' },
  verify: { label: 'Checking the game', summary: 'Runs `blacksite check` on desktop and phone and reads its results and screenshots before anyone else plays.' },
  characters: { label: 'Characters', summary: 'Which character package to use for first person, third person or multiplayer, and how the body, camera and actions fit together.' },
  als: { label: 'Character animation', summary: 'Where the animation system’s own guide lives, with recipes for the camera, weapons, actions and remote players.' },
  weapons: { label: 'Weapons', summary: 'Fire modes, fire rate, magazines, reloads, spread and recoil, and how to turn each shot into effects and sound.' },
  ai: { label: 'Enemy AI', summary: 'Squads that see, hear and remember, bound, flank and breach as a team, and aim with a human reaction delay.' },
  destruction: { label: 'Destruction', summary: 'Buildings that break where their structure fails, simulated in a worker so the game keeps its frame rate.' },
  multiplayer: { label: 'Multiplayer', summary: 'Rooms with client prediction and smoothing, on a server or inside one browser tab, and what it can’t do yet.' },
  input: { label: 'Input', summary: 'Keyboard, mouse, gamepad and touch bound to named actions, and menus a controller can drive.' },
  architecture: { label: 'Where state lives', summary: 'Which library owns entities, game states, services, the frame tick and network messages, so two systems never fight over one value.' },
  assets: { label: 'Your own assets', summary: 'Finds packs you already own on Fab or itch.io and installs them into your game, never into a shared repository.' },
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
