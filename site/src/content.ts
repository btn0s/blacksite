export const repo = 'https://github.com/btn0s/blacksite'
export const alsRepo = 'https://github.com/btn0s/als-web'
export const installLine = 'curl -fsSL https://raw.githubusercontent.com/btn0s/blacksite/main/install.sh | sh'

export type Status = 'Usable' | 'Usable v0' | 'Experimental' | 'In progress'

export type Control = { action: string; keys: string[] }

export type ShowcaseDemo = {
  id: string
  frame?: string
  title: string
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
  demos: ShowcaseDemo[]
  agent: { reads: Guide[]; commands: { label: string; code: string }[]; note: string }
  statusNote: string
  guides: Guide[]
}

export const tools: Tool[] = [
  {
    slug: 'characters',
    name: 'Characters',
    codename: 'ALS Web',
    status: 'Usable',
    tagline: 'An animated player body with first- and third-person cameras.',
    pitch: 'A player character that walks, sprints, crouches, mantles, rolls, ragdolls and aims, in first or third person. It is a three.js port of ALS Refactored, the Unreal locomotion system.',
    packages: ['als-ue5-r3f', '@blacksite/subject'],
    demos: [],
    agent: {
      reads: [{ label: 'Characters reference', path: 'skills/blacksite/references/characters.md' }, { label: 'ALS reference', path: 'skills/blacksite/references/als.md' }, { label: 'ALS agent guide', path: 'vendor/als-web/docs/guide/overview.md' }],
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
      { label: 'ALS reference', path: 'skills/blacksite/references/als.md' },
    ],
  },
  {
    slug: 'world',
    name: 'World',
    status: 'Experimental',
    tagline: 'Terrain to the horizon, foliage, sky and atmosphere.',
    pitch: 'Open country that holds up from the grass at your feet to mountains 16 km away: terrain with continuous level of detail, scanned ground materials, grass and flowers, procedural forests with impostors, one wind field for everything that moves, and a physically based sky with clouds, aerial perspective and height fog.',
    packages: ['@blacksite/landscape', '@blacksite/look'],
    demos: [],
    agent: {
      reads: [{ label: 'Far field', path: 'skills/blacksite/references/far-field.md' }, { label: 'Foliage', path: 'skills/blacksite/references/foliage.md' }, { label: 'Wind', path: 'skills/blacksite/references/wind.md' }, { label: 'Atmosphere', path: 'skills/blacksite/references/atmosphere.md' }, { label: 'Materials', path: 'skills/blacksite/references/materials.md' }],
      commands: [{ label: 'Find a real terrain and ground materials', code: 'blacksite assets suggest --idea "alpine meadow above a forested valley" --json' }],
      note: 'The agent builds the world from the landscape package with the Valley as the reference: heightfields from real elevation data, cover families by mask, species for the forest, and the nature look for the sky.',
    },
    statusNote: 'Experimental. Terrain, ground cover, forests, wind and the physical sky work on desktop and phone. Ground cover runs on WebGL2; a WebGPU compute path, baked lighting and volumetric clouds are next.',
    guides: [{ label: 'Landscape package', path: 'packages/landscape/README.md' }, { label: 'Look package', path: 'packages/look/README.md' }],
  },
  {
    slug: 'destruction',
    name: 'Destruction',
    codename: 'Cascade',
    status: 'Experimental',
    tagline: 'Concrete buildings that crack, lose their supports and fall.',
    pitch: 'Buildings made of walls, slabs and columns joined by bonds that crack and break. When a building loses its supports it falls under its own weight. The physics runs in a web worker, so the game keeps its frame rate.',
    packages: ['@blacksite/cascade'],
    demos: [],
    agent: {
      reads: [{ label: 'Destruction reference', path: 'skills/blacksite/references/destruction.md' }, { label: 'Cascade guide', path: 'docs/cascade.md' }, { label: 'Package rules', path: 'packages/cascade/AGENTS.md' }],
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
    tagline: 'First-person arms with a rifle and a pistol.',
    pitch: 'Rigged first-person arms with a rifle and a pistol: fire, reload, aim and recoil. A weapon runtime resolves shots, and the server can re-run it to check hits in multiplayer.',
    packages: ['@blacksite/subject-fpp', '@blacksite/armory'],
    demos: [{
      id: 'range', frame: 'fpp', title: 'Firing range', summary: 'Fire, reload, aim down sights and switch weapons.',
      keyboard: [{ action: 'Look', keys: ['Click', 'Mouse'] }, { action: 'Move', keys: ['W', 'A', 'S', 'D'] }, { action: 'Fire', keys: ['Left mouse'] }, { action: 'Aim', keys: ['Right mouse'] }, { action: 'Reload', keys: ['R'] }],
      touch: [], tryThis: [], live: true,
    }],
    agent: {
      reads: [{ label: 'Weapons reference', path: 'skills/blacksite/references/weapons.md' }, { label: 'First-person arms', path: 'docs/arms.md' }, { label: 'Package rules', path: 'packages/armory/AGENTS.md' }],
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
    tagline: 'Rooms where remote players run the full character animation.',
    pitch: 'Rooms on Colyseus, or inside one browser tab for demos and tests. Each player moves their own body, the server checks hits, and remote players run the full character animation.',
    packages: ['@blacksite/relay', '@blacksite/subject'],
    demos: [],
    agent: {
      reads: [{ label: 'Multiplayer reference', path: 'skills/blacksite/references/multiplayer.md' }, { label: 'Player templates', path: 'docs/player-templates.md' }, { label: 'Relay limits', path: 'packages/relay/AGENTS.md' }],
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
    tagline: 'Enemy squads that take cover and flank.',
    pitch: 'Enemy squads that pick cover, flank and coordinate. The simulation is deterministic and runs in a worker, so every fight can be replayed.',
    packages: ['@blacksite/warden', '@blacksite/warden-react'],
    demos: [{
      id: 'squad', frame: 'warden', title: 'Squad', summary: 'Watch the squads move, take cover and trade fire.',
      keyboard: [], touch: [], tryThis: [], live: true,
    }],
    agent: {
      reads: [{ label: 'AI reference', path: 'skills/blacksite/references/ai.md' }, { label: 'Warden guide', path: 'docs/warden.md' }, { label: 'Package rules', path: 'packages/warden/AGENTS.md' }],
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
    tagline: 'Keyboard, mouse, gamepad and touch, plus menus.',
    pitch: 'One input layer for keyboard, mouse, gamepad and touch, bound to actions the game names. Plus menus, pause and settings screens that work with a controller.',
    packages: ['@blacksite/input', '@blacksite/ui'],
    demos: [],
    agent: {
      reads: [{ label: 'Input reference', path: 'skills/blacksite/references/input.md' }, { label: 'Input guide', path: 'packages/input/README.md' }, { label: 'UI guide', path: 'packages/ui/README.md' }],
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
  { name: 'Assets', text: 'Use art you already own from Fab or itch.io, compressed for the web.', path: 'skills/blacksite/references/assets.md' },
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
