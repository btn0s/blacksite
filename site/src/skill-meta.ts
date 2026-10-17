export type Invocation = 'user' | 'both' | 'model'
export type Skill = { name: string; description: string; summary: string; invocation: Invocation; argument?: string; path: string }
export type Reference = { name: string; title: string; summary: string; path: string }
export type ReferenceNote = { label: string; summary: string }

export const steps = [
  { title: 'It asks, then sizes the job', text: 'One question at a time: single-player or multiplayer, which camera, what the player does. Then it picks a size. The default is one finished space with 5 to 10 minutes of play: a start, a way to lose and an end.' },
  { title: 'It writes the numbers down first', text: 'Walk speed 1.75 m/s, sprint 6.5 m/s, fire rate, damage, ranges and how long a frame may take go into one file, `src/game/model.ts`. The rest of the game reads from it, so a wrong number has one place to fix.' },
  { title: 'It lists the parts before it builds', text: 'For a ruined yard that means at least 3 light sources, 4 surface materials, 12 kinds of prop in clusters and 3 layers of sound. You approve the list, and nothing goes in that isn’t on it.' },
  { title: 'It builds the risky parts alone, then joins them', text: 'A gun, a jump or an enemy is built in its own prototype from the building blocks, played, and kept only if it works. The ones that work are joined into one loop.' },
  { title: 'It makes the scene move and make sound', text: 'Wind in the grass, dust in the light, a flickering lamp, distant ambience, and for every player action a sound, something to see and a camera response.' },
  { title: 'It checks its own work and hands you a link', text: '`blacksite check` runs the game on desktop and on a slowed-down phone profile. It checks that no frame takes longer than 33 ms, that objects don’t appear late as you approach, that the player moves at the speeds in the numbers file and that no sound repeats back to back, and saves screenshots that the agent reviews. It fixes what fails, then gives you a URL to play.' },
]

export const examples = [
  { ask: 'Footsteps', quick: 'One sample on a timer', built: '3 to 5 samples per surface, triggered by the animation’s foot plants, never the same one twice in a row, with a landing sound scaled by fall speed' },
  { ask: 'A gun', quick: 'A ray and a muzzle flash', built: 'A 600 RPM weapon with recoil the view recovers from, a kick in the arms on screen, a visible tracer on one round in three, bullet marks and dust that match the surface, and an echo that matches the room' },
  { ask: 'Smart enemies', quick: 'A chase in a straight line with perfect aim', built: 'Vision cones and hearing, a 0.2 s reaction delay, cover, squad roles, callouts that tell you what they’re doing, and aim that starts wide and tightens' },
  { ask: 'A jump', quick: 'Upward velocity on a key press', built: 'About 0.9 m high, still allowed 0.1 s after you run off a ledge, a press up to 0.1 s before landing still counts, a dip in the camera on landing and a landing sound' },
]

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
  feel: { label: 'Movement and aim', summary: 'Speeds, acceleration, jump height, jump timing and camera numbers, which the checks then measure in the running game.' },
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
