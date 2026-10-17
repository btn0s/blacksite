export const repo = 'https://github.com/btn0s/blacksite'
export const alsRepo = 'https://github.com/btn0s/als-web'
export const installLine = 'curl -fsSL https://raw.githubusercontent.com/btn0s/blacksite/main/install.sh | sh'

export type Status = 'Usable' | 'Usable v0' | 'Experimental' | 'In progress'

export const statusLabel: Record<Status, string> = {
  Usable: 'Usable',
  'Usable v0': 'Early version',
  Experimental: 'Experimental',
  'In progress': 'In progress',
}

export type Control = { action: string; keys: string[] }

export type ShowcaseDemo = {
  id: string
  frame?: string
  title: string
  summary: string
  keyboard: Control[]
  touch: Control[]
  tryThis: string
  live: boolean
}

export type Guide = { label: string; path: string }

export type Tool = {
  slug: string
  name: string
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
    status: 'Usable',
    tagline: 'A player character that walks, sprints, mantles, rolls and ragdolls, in first or third person.',
    pitch: 'A player character that walks, sprints, crouches, mantles, rolls, ragdolls and aims, in first or third person. It is ALS Web, a three.js port of the open-source ALS Refactored animation system.',
    packages: ['@blacksite/subject', '@blacksite/subject-fpp'],
    demos: [],
    agent: {
      reads: [{ label: 'Characters reference', path: 'skills/blacksite/references/characters.md' }, { label: 'Character animation reference', path: 'skills/blacksite/references/als.md' }, { label: 'Character guide', path: 'vendor/als-web/docs/guide/overview.md' }],
      commands: [
        { label: 'Start a third-person game', code: 'blacksite scaffold --profile tpp --name "My Game" --dir /absolute/path' },
        { label: 'Prototype a mechanic on the character', code: 'blacksite prototype new traversal --with tpp' },
      ],
      note: 'The third-person template gives your game this character and its camera. The character guide has tested recipes for adding an action, an overlay or a remote player.',
    },
    statusNote: 'Usable. Walking, sprinting, mantling, rolling, ragdoll, aiming and both cameras work. The body is one mannequin, coloured per game; your own skinned character isn’t supported yet.',
    guides: [
      { label: 'Character guide', path: 'vendor/als-web/docs/guide/overview.md' },
      { label: 'Player templates', path: 'docs/player-templates.md' },
      { label: 'Character animation reference', path: 'skills/blacksite/references/als.md' },
    ],
  },
  {
    slug: 'world',
    name: 'World',
    status: 'Experimental',
    tagline: 'Open country to the horizon: terrain, grass, forests, wind and sky.',
    pitch: 'Open country that holds up from the grass at your feet to mountains 16 km away: terrain built from real elevation data, scanned ground materials, grass and flowers, forests that hand over to flat cut-outs in the distance, one wind for everything that moves, and a sky with clouds and haze.',
    packages: ['@blacksite/landscape', '@blacksite/look'],
    demos: [],
    agent: {
      reads: [{ label: 'Terrain to the horizon', path: 'skills/blacksite/references/far-field.md' }, { label: 'Grass and trees', path: 'skills/blacksite/references/foliage.md' }, { label: 'Wind', path: 'skills/blacksite/references/wind.md' }, { label: 'Sky and haze', path: 'skills/blacksite/references/atmosphere.md' }, { label: 'Materials', path: 'skills/blacksite/references/materials.md' }],
      commands: [{ label: 'Find a real terrain and ground materials', code: 'blacksite assets suggest --idea "alpine meadow above a forested valley" --json' }],
      note: 'The agent builds an open world from the landscape package, using Valley as its model: real elevation data for the ground, grass and flowers by mask, three tree species, and an outdoor sky.',
    },
    statusNote: 'Experimental. Terrain, ground cover, forests, wind and the sky work on desktop and phone. Ground cover runs on WebGL2. A WebGPU path, baked lighting and volumetric clouds are next.',
    guides: [{ label: 'Landscape package', path: 'packages/landscape/README.md' }, { label: 'Look package', path: 'packages/look/README.md' }],
  },
  {
    slug: 'destruction',
    name: 'Destruction',
    status: 'Experimental',
    tagline: 'Concrete buildings that crack, lose their supports and fall.',
    pitch: 'Buildings made of walls, slabs and columns joined by bonds that crack and break. When a building loses its supports it falls under its own weight. The physics runs in a web worker, so the game keeps its frame rate.',
    packages: ['@blacksite/cascade'],
    demos: [],
    agent: {
      reads: [{ label: 'Destruction reference', path: 'skills/blacksite/references/destruction.md' }, { label: 'Destruction guide', path: 'docs/cascade.md' }, { label: 'Package rules', path: 'packages/cascade/AGENTS.md' }],
      commands: [{ label: 'Prototype a destructible building', code: 'blacksite prototype new collapse --with cascade' }],
      note: 'The agent describes a building as boxes, hands it to the destruction worker and draws the pieces with the package’s renderer. Impacts and charges are messages sent to the worker.',
    },
    statusNote: 'Experimental. Collapse, charges and walking inside a destructible building work. Very large buildings still slow the physics worker down. Bullet-sized chips and city-sized collapse are on the roadmap.',
    guides: [{ label: 'Destruction guide', path: 'docs/cascade.md' }, { label: 'Package rules', path: 'packages/cascade/AGENTS.md' }],
  },
  {
    slug: 'weapons',
    name: 'Weapons',
    status: 'Usable',
    tagline: 'A rifle and a pistol that fire, reload, aim and recoil, held by rigged first-person arms.',
    pitch: 'Rigged first-person arms with a rifle and a pistol: fire, reload, aim and recoil. The weapon simulation decides every shot, and a server can run it again to check hits in multiplayer.',
    packages: ['@blacksite/subject-fpp', '@blacksite/armory'],
    demos: [],
    agent: {
      reads: [{ label: 'Weapons reference', path: 'skills/blacksite/references/weapons.md' }, { label: 'First-person arms', path: 'docs/arms.md' }, { label: 'Package rules', path: 'packages/armory/AGENTS.md' }],
      commands: [{ label: 'Start a first-person game', code: 'blacksite scaffold --profile fpp --name "My Game" --dir /absolute/path' }],
      note: 'The first-person template connects the arms, the weapons and the controls. The agent adds the targets, impacts and hit reactions your game needs.',
    },
    statusNote: 'Usable. Rifle and pistol with fire, reload, aim and recoil. A weapon beyond those two needs new animation.',
    guides: [{ label: 'First-person arms', path: 'docs/arms.md' }, { label: 'Package rules', path: 'packages/armory/AGENTS.md' }],
  },
  {
    slug: 'multiplayer',
    name: 'Multiplayer',
    status: 'Usable v0',
    tagline: 'Rooms where each player moves their own character and the server checks the hits.',
    pitch: 'Rooms on a Colyseus server, or inside one browser tab for demos and tests. Each player moves their own character, the server checks hits, and other players animate the same way the local one does.',
    packages: ['@blacksite/relay', '@blacksite/subject'],
    demos: [],
    agent: {
      reads: [{ label: 'Multiplayer reference', path: 'skills/blacksite/references/multiplayer.md' }, { label: 'Player templates', path: 'docs/player-templates.md' }, { label: 'What the early version can’t do', path: 'packages/relay/AGENTS.md' }],
      commands: [{ label: 'Start a multiplayer game', code: 'blacksite scaffold --profile mp --name "My Game" --dir /absolute/path' }],
      note: 'The multiplayer template runs a local server under `pnpm dev`, plus a room inside the tab, so the agent can test two players without a network.',
    },
    statusNote: 'Early version. Full snapshots, players moving their own characters, and hits checked by the server. Sending only what changed, sending each player only what they can see, and lag compensation are on the roadmap.',
    guides: [{ label: 'Player templates', path: 'docs/player-templates.md' }, { label: 'What the early version can’t do', path: 'packages/relay/AGENTS.md' }],
  },
  {
    slug: 'ai',
    name: 'AI',
    status: 'Experimental',
    tagline: 'Enemy squads that see, hear, take cover and flank as a team.',
    pitch: 'Enemy squads that pick cover, flank and work together. The simulation runs in a worker and gives the same result every time, so any fight can be replayed.',
    packages: ['@blacksite/warden', '@blacksite/warden-react'],
    demos: [],
    agent: {
      reads: [{ label: 'Enemy AI reference', path: 'skills/blacksite/references/ai.md' }, { label: 'AI guide', path: 'docs/warden.md' }, { label: 'Package rules', path: 'packages/warden/AGENTS.md' }],
      commands: [{ label: 'Prototype a squad fight', code: 'blacksite prototype new firefight --with warden' }],
      note: 'The agent starts the squad simulation in a worker and draws each soldier with the game’s own characters.',
    },
    statusNote: 'Experimental. Squad decisions and the simulation work. The package doesn’t drive the shared character yet; each game draws its own soldiers.',
    guides: [{ label: 'AI guide', path: 'docs/warden.md' }, { label: 'Package rules', path: 'packages/warden/AGENTS.md' }],
  },
  {
    slug: 'input',
    name: 'Input and UI',
    status: 'Usable',
    tagline: 'Keyboard, mouse, gamepad and touch, plus menus a controller can drive.',
    pitch: 'One input layer for keyboard, mouse, gamepad and touch, bound to actions the game names. Plus menus, pause and settings screens that work with a controller.',
    packages: ['@blacksite/input', '@blacksite/ui'],
    demos: [],
    agent: {
      reads: [{ label: 'Input reference', path: 'skills/blacksite/references/input.md' }, { label: 'Input guide', path: 'packages/input/README.md' }, { label: 'UI guide', path: 'packages/ui/README.md' }],
      commands: [{ label: 'Every template includes both', code: 'blacksite scaffold --profile blank --name "My Game" --dir /absolute/path' }],
      note: 'Every template includes input and menus. The agent binds the game’s actions to keys, buttons and touch controls, and builds menus a gamepad can drive.',
    },
    statusNote: 'Usable. Keyboard, mouse, gamepad and touch. Touch controls for the player templates are in progress.',
    guides: [{ label: 'Input guide', path: 'packages/input/README.md' }, { label: 'UI guide', path: 'packages/ui/README.md' }],
  },
]

export const toolBySlug = (slug: string) => tools.find(tool => tool.slug === slug)

export const featured = [
  { showcase: 'breach', kind: 'First-person shooter', status: 'In progress' as Status },
  { showcase: 'traverse', kind: 'Third-person action', status: 'In progress' as Status },
  { showcase: 'valley', kind: 'Open world', status: 'Experimental' as Status },
  { showcase: 'firing-range', kind: 'Weapons demo', status: 'Usable' as Status },
]

export const parts = [
  { name: 'The skill', text: '`SKILL.md` and 26 reference files. Your agent reads `SKILL.md` for anything about a game and opens a reference when the work calls for it.', path: 'skills/blacksite/SKILL.md' },
  { name: 'Building blocks', text: 'Finished game systems the agent puts together instead of writing from scratch: characters, weapons, enemy AI, destruction, multiplayer, open worlds, input and menus.', path: 'packages' },
  { name: 'Templates', text: 'Four starting projects: first person, third person, multiplayer and blank. Each one passes every desktop check on its first build.', path: 'docs/player-templates.md' },
  { name: 'Open asset library', text: '146 textures, props, skies, plants, sounds and room reverbs under CC0, CC BY, MIT or public-domain licences. `blacksite assets library` lists them; the agent fetches only what the game uses and writes the credits.', path: 'assets/README.md' },
  { name: 'Checks', text: '`blacksite check` measures a running game on desktop and phone: frame time, hitches, pop-in, movement speed, repeated sounds and z-fighting, plus screenshots to review.', path: 'skills/blacksite/references/verify.md' },
  { name: 'Example games', text: 'Breach, Traverse and Valley, each built only on the public packages. The agent opens the closest one before it starts yours.', path: 'examples/README.md' },
]

export const limits = [
  'Desktop browsers are the main target. Phones get a 60 fps budget and no ambient occlusion or bloom.',
  'Destruction, enemy AI and open worlds are experimental. Multiplayer is an early version with no lag compensation yet.',
  'Breach and Traverse are still in progress. The horror and multiplayer example games aren’t built yet.',
  'A Slice takes a day or a few sessions, not minutes. The agent builds one space properly before it adds another.',
  'Purchased assets aren’t included. The agent can install packs you own from Fab or itch.io into your game, but never copies them into a shared repository.',
  'The checks run in a headless browser. Only you can confirm 120 fps on your display, touch on your phone and the mix in your headphones.',
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
  'guides/als': 'tools/characters',
}

export function resolveLegacy(route: string) {
  const clean = route.replace(/\/+$/, '')
  if (clean in legacyRoutes) return legacyRoutes[clean]!
  if (clean.startsWith('demos/') || clean.startsWith('docs/')) return ''
  return null
}
