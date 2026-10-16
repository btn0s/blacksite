export const repo = 'https://github.com/btn0s/blacksite'
export const alsRepo = 'https://github.com/btn0s/als-web'
export const installLine = 'curl -fsSL https://raw.githubusercontent.com/btn0s/blacksite/main/install.sh | sh'

export type Status = 'Usable' | 'Usable v0' | 'Experimental' | 'In progress'

export type Control = { action: string; keys: string[] }

export type ShowcaseDemo = {
  id: string
  frame?: string
  title: string
  setting: string
  summary: string
  keyboard: Control[]
  touch: Control[]
  tryThis: string[]
  live: boolean
}

export type Guide = { label: string; path: string }

export type Tool = {
  slug: string
  name: string
  codename?: string
  status: Status
  tagline: string
  pitch: string
  packages: string[]
  thumbnail?: string
  material: string
  demos: ShowcaseDemo[]
  agent: { reads: Guide[]; commands: { label: string; code: string }[]; note: string }
  statusNote: string
  guides: Guide[]
}

const moveKeys: Control[] = [
  { action: 'Look', keys: ['Click', 'Mouse'] },
  { action: 'Move', keys: ['W', 'A', 'S', 'D'] },
  { action: 'Sprint · tap to roll', keys: ['Shift'] },
  { action: 'Walk or run', keys: ['Alt'] },
  { action: 'Crouch', keys: ['Ctrl'] },
  { action: 'Jump · mantle a ledge', keys: ['Space'] },
  { action: 'Aim', keys: ['Right mouse'] },
  { action: 'Ragdoll · get up', keys: ['X'] },
  { action: 'First or third person', keys: ['V'] },
  { action: 'Swap shoulder', keys: ['C'] },
]

const moveTouch: Control[] = [
  { action: 'Move', keys: ['Left stick'] },
  { action: 'Look', keys: ['Drag right side'] },
  { action: 'Jump · mantle', keys: ['Jump'] },
  { action: 'Sprint · tap to roll', keys: ['Sprint'] },
  { action: 'Crouch', keys: ['Crouch'] },
  { action: 'Ragdoll', keys: ['Ragdoll'] },
  { action: 'First or third person', keys: ['View'] },
]

export const tools: Tool[] = [
  {
    slug: 'characters',
    name: 'Characters',
    codename: 'ALS Web',
    status: 'Usable',
    tagline: 'A full animated body that moves like a modern shooter character.',
    pitch: 'Your game gets a character that walks, runs, sprints, crouches, mantles over ledges, rolls, ragdolls and aims, with first- and third-person cameras. It is a port of ALS Refactored, the Unreal locomotion system, to three.js.',
    packages: ['als-ue5-r3f', '@blacksite/subject'],
    thumbnail: 'thumbs/characters.webp',
    material: 'cast',
    demos: [{
      id: 'checkpoint',
      frame: 'characters',
      title: 'Checkpoint',
      setting: 'An abandoned zone checkpoint on an overcast afternoon.',
      summary: 'Run the yard, vault the barriers, climb onto the loading dock and the rooftops, and drop into a ragdoll whenever you like.',
      keyboard: moveKeys,
      touch: moveTouch,
      tryThis: ['Sprint at the low concrete barriers and press Space to vault them.', 'Climb the containers and the loading dock: every ledge you can reach is a mantle.', 'Tap Shift while running to roll, then press X to go limp.', 'Press V to see the same body from first person.'],
      live: true,
    }],
    agent: {
      reads: [{ label: 'als skill', path: 'skills/als/SKILL.md' }, { label: 'ALS agent guide', path: 'vendor/als-web/docs/guide/overview.md' }],
      commands: [
        { label: 'Start a third-person game', code: 'blacksite scaffold --profile tpp --name "My Game" --dir /absolute/path' },
        { label: 'Prototype a mechanic on the character', code: 'blacksite prototype new traversal --with tpp' },
      ],
      note: 'The skill tells the agent how the character, camera, overlays and actions fit together, and the guide has tested recipes for common jobs such as adding an action, an overlay or a remote player.',
    },
    statusNote: 'Usable. Locomotion, mantling, rolling, ragdoll, aiming and both cameras work today. The body is the ALS mannequin, coloured per game; bringing your own skinned character is not supported yet.',
    guides: [
      { label: 'ALS agent guide', path: 'vendor/als-web/docs/guide/overview.md' },
      { label: 'Player templates', path: 'docs/player-templates.md' },
      { label: 'als skill', path: 'skills/als/SKILL.md' },
    ],
  },
  {
    slug: 'destruction',
    name: 'Destruction',
    codename: 'Cascade',
    status: 'Experimental',
    tagline: 'Concrete buildings that crack, lose their supports and come down.',
    pitch: 'Your game gets buildings made of real structure: columns, slabs and walls joined by bonds that crack and break. When a building loses its supports it collapses under its own weight, and the physics runs in a web worker so the game keeps its frame rate.',
    packages: ['@blacksite/cascade'],
    material: 'panel',
    demos: [{
      id: 'air-strike',
      title: 'Air Strike',
      setting: 'A Soviet apartment block at the edge of an industrial zone.',
      summary: 'Call in an air strike on a multi-storey concrete block and watch it come apart from a safe distance.',
      keyboard: [],
      touch: [],
      tryThis: [],
      live: false,
    }],
    agent: {
      reads: [{ label: 'Cascade guide', path: 'docs/cascade.md' }, { label: 'Package rules', path: 'packages/cascade/AGENTS.md' }],
      commands: [{ label: 'Prototype a destructible structure', code: 'blacksite prototype new collapse --with cascade' }],
      note: 'The agent authors a structure as boxes, hands it to a destruction session, and renders the fragments with the package renderer. Impacts, charges and tools are commands sent to the worker.',
    },
    statusNote: 'Experimental. Structural collapse, charges and walk-in tools work. Very large buildings still slow the physics worker down; bullet-scale chipping and city-scale collapse are on the roadmap.',
    guides: [{ label: 'Cascade guide', path: 'docs/cascade.md' }, { label: 'Package rules', path: 'packages/cascade/AGENTS.md' }],
  },
  {
    slug: 'weapons',
    name: 'Weapons',
    codename: 'Armory',
    status: 'Usable',
    tagline: 'First-person arms and guns that feel right.',
    pitch: 'Your game gets rigged first-person arms holding a rifle or a pistol, with firing, reloading, aiming and recoil. Shots are resolved by a weapon runtime the server can re-run, so hits can be checked in multiplayer.',
    packages: ['@blacksite/subject-fpp', '@blacksite/armory'],
    material: 'metal',
    demos: [{
      id: 'range', frame: 'fpp', title: 'Firing range', setting: 'First-person arms with a rifle and a pistol.', summary: 'Fire, reload, aim down sights and switch weapons.',
      keyboard: [{ action: 'Look', keys: ['Click', 'Mouse'] }, { action: 'Move', keys: ['W', 'A', 'S', 'D'] }, { action: 'Fire', keys: ['Left mouse'] }, { action: 'Aim', keys: ['Right mouse'] }, { action: 'Reload', keys: ['R'] }],
      touch: [], tryThis: [], live: true,
    }],
    agent: {
      reads: [{ label: 'First-person arms', path: 'docs/arms.md' }, { label: 'Package rules', path: 'packages/armory/AGENTS.md' }],
      commands: [{ label: 'Start a first-person game', code: 'blacksite scaffold --profile fpp --name "My Game" --dir /absolute/path' }],
      note: 'The fpp template wires the arms, the weapon runtime and input together; the agent adds targets and hit reactions.',
    },
    statusNote: 'Usable. Rifle and pistol with fire, reload, aim and recoil. Weapon swaps beyond the two defaults need new animation.',
    guides: [{ label: 'First-person arms', path: 'docs/arms.md' }, { label: 'Package rules', path: 'packages/armory/AGENTS.md' }],
  },
  {
    slug: 'multiplayer',
    name: 'Multiplayer',
    codename: 'Relay',
    status: 'Usable v0',
    tagline: 'Rooms where other players animate exactly like you do.',
    pitch: 'Your game gets rooms on Colyseus, or in one browser tab for demos and tests. Each player moves their own body, the server checks hits, and remote players replay the full character animation.',
    packages: ['@blacksite/relay', '@blacksite/subject'],
    material: 'corrugated',
    demos: [{
      id: 'arena', frame: 'mp', title: 'Arena', setting: 'Two players in one in-browser room, side by side.', summary: 'Each half of the screen is a separate player connected to the same room.',
      keyboard: [{ action: 'Look', keys: ['Click', 'Mouse'] }, { action: 'Move', keys: ['W', 'A', 'S', 'D'] }, { action: 'First or third person', keys: ['V'] }],
      touch: [], tryThis: [], live: true,
    }],
    agent: {
      reads: [{ label: 'Player templates', path: 'docs/player-templates.md' }, { label: 'Relay limits', path: 'packages/relay/AGENTS.md' }],
      commands: [{ label: 'Start a multiplayer game', code: 'blacksite scaffold --profile mp --name "My Game" --dir /absolute/path' }],
      note: 'The mp template runs a local Colyseus room under pnpm dev and an offline loopback room, so the agent can test two players in one tab.',
    },
    statusNote: 'Usable v0. Full snapshots, owner movement and server-checked hits. Interest management, delta snapshots and lag compensation are on the roadmap.',
    guides: [{ label: 'Player templates', path: 'docs/player-templates.md' }, { label: 'Relay limits', path: 'packages/relay/AGENTS.md' }],
  },
  {
    slug: 'ai',
    name: 'AI',
    codename: 'Warden',
    status: 'Experimental',
    tagline: 'Squads that take cover, flank and work together.',
    pitch: 'Your game gets enemy squads that read the space, pick cover, flank and coordinate, simulated deterministically in a worker so every fight can be replayed.',
    packages: ['@blacksite/warden', '@blacksite/warden-react'],
    material: 'brick',
    demos: [{
      id: 'squad', frame: 'warden', title: 'Squad', setting: 'A tactical simulation of two squads.', summary: 'Watch the squads move, take cover and trade fire.',
      keyboard: [], touch: [], tryThis: [], live: true,
    }],
    agent: {
      reads: [{ label: 'Warden guide', path: 'docs/warden.md' }, { label: 'Package rules', path: 'packages/warden/AGENTS.md' }],
      commands: [{ label: 'Prototype squad AI', code: 'blacksite prototype new firefight --with warden' }],
      note: 'The agent mounts a Warden session, which runs the squads in a worker, and draws the agents with its own characters.',
    },
    statusNote: 'Experimental. Squad decisions and the tactical simulation work; the agents are not yet driven through ALS characters.',
    guides: [{ label: 'Warden guide', path: 'docs/warden.md' }, { label: 'Package rules', path: 'packages/warden/AGENTS.md' }],
  },
  {
    slug: 'input',
    name: 'Input and UI',
    status: 'Usable',
    tagline: 'Every device, and the menus around the game.',
    pitch: 'Your game gets one input layer for keyboard, mouse, gamepad and touch, with actions the game names itself, plus menus, pause and settings screens that work with a controller.',
    packages: ['@blacksite/input', '@blacksite/ui'],
    material: 'rust',
    demos: [],
    agent: {
      reads: [{ label: 'Input guide', path: 'packages/input/README.md' }, { label: 'UI guide', path: 'packages/ui/README.md' }],
      commands: [{ label: 'Every template includes both', code: 'blacksite scaffold --profile blank --name "My Game" --dir /absolute/path' }],
      note: 'The agent binds game actions to controls in an input context, and builds menus from the UI components so they work with a gamepad as well as a mouse.',
    },
    statusNote: 'Usable. Keyboard, mouse, gamepad and touch. Touch controls for the player templates are in progress.',
    guides: [{ label: 'Input guide', path: 'packages/input/README.md' }, { label: 'UI guide', path: 'packages/ui/README.md' }],
  },
]

export const toolBySlug = (slug: string) => tools.find(tool => tool.slug === slug)

export const extras = [
  { name: 'Player templates', text: 'Ready-to-play starting points: fpp, tpp, mp and blank.', path: 'docs/player-templates.md' },
  { name: 'Assets', text: 'Use art you already own from Fab or itch.io, compressed for the web.', path: 'skills/game-assets/SKILL.md' },
]

export const flow = [
  { skill: 'design-game', title: 'Design', text: 'The agent interviews you one question at a time: fantasy, core loop, camera, scope and performance budget.' },
  { skill: 'setup-project', title: 'Set up', text: 'It creates the game from a player template and checks that it runs.' },
  { skill: 'build-prototype', title: 'Prototype', text: 'It builds each risky mechanic on its own, playable from a developer menu.' },
  { skill: 'combine-prototypes', title: 'Combine', text: 'It joins the mechanics that worked into one core loop.' },
  { skill: 'optimize-game', title: 'Optimise', text: 'It measures the game and brings it within its budget.' },
  { skill: 'ship-game', title: 'Ship', text: 'It deploys the game, only when you ask.' },
]

export const legacyRoutes: Record<string, string> = {
  'demos/movement': 'tools/characters',
  'demos/tpp': 'tools/characters',
  'demos/demolition': 'tools/destruction',
  'demos/cascade': 'tools/destruction',
  'demos/cascade-worker': 'tools/destruction',
  'demos/fpp': 'tools/weapons',
  'demos/mp': 'tools/multiplayer',
  'demos/warden': 'tools/ai',
  'docs/cascade': 'tools/destruction',
  'docs/warden': 'tools/ai',
  'docs/input': 'tools/input',
  'docs/ui': 'tools/input',
  'docs/roadmap': 'roadmap',
  'docs/readme': '',
}

export function resolveLegacy(route: string) {
  const clean = route.replace(/\/+$/, '')
  if (clean in legacyRoutes) return legacyRoutes[clean]!
  if (clean.startsWith('demos/') || clean.startsWith('docs/')) return ''
  return null
}
