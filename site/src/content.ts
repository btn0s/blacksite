export const repo = 'https://github.com/btn0s/blacksite'
export const alsRepo = 'https://github.com/btn0s/als-web'
export const skillsLine = 'npx skills add btn0s/blacksite'
export const installLine = 'curl -fsSL https://raw.githubusercontent.com/btn0s/blacksite/main/install.sh | sh'

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
  tagline: string
  pitch: string
  packages: string[]
  demos: ShowcaseDemo[]
  agent: { reads: Guide[]; commands: { label: string; code: string }[]; note: string }
  guides: Guide[]
}

export const tools: Tool[] = [
  {
    slug: 'characters',
    name: 'Characters',
    tagline: 'A player character that walks, sprints, climbs over ledges, rolls and falls limp when hit, in first or third person.',
    pitch: 'A player character that walks, sprints, crouches, climbs over ledges, rolls, falls limp when hit and aims, in first or third person. It is ALS Web, a three.js port of the open-source ALS Refactored animation system.',
    packages: ['@blacksite/subject', '@blacksite/subject-fpp'],
    demos: [],
    agent: {
      reads: [{ label: 'Movement and camera', path: 'skills/blacksite/references/feel.md' }, { label: 'Character wiring', path: 'skills/blacksite/references/building-blocks.md' }, { label: 'Character guide', path: 'vendor/als-web/docs/guide/overview.md' }],
      commands: [
        { label: 'Start a third-person game', code: 'blacksite scaffold --profile tpp --name "My Game" --dir /absolute/path' },
        { label: 'Prototype a mechanic on the character', code: 'blacksite prototype new traversal --with tpp' },
      ],
      note: 'The third-person template gives your game this character and its camera. The character guide has tested recipes for adding an action, an overlay or a remote player.',
    },
    guides: [
      { label: 'Character guide', path: 'vendor/als-web/docs/guide/overview.md' },
      { label: 'Player templates', path: 'docs/player-templates.md' },
      { label: 'Character wiring', path: 'skills/blacksite/references/building-blocks.md' },
    ],
  },
  {
    slug: 'world',
    name: 'World',
    tagline: 'Open country to the horizon: terrain, grass, forests, wind and sky.',
    pitch: 'Open country that holds up from the grass at your feet to mountains 16 km away: terrain built from real elevation data, scanned ground materials, grass and flowers, forests that hand over to flat cut-outs in the distance, one wind for everything that moves, and a sky with clouds and haze.',
    packages: ['@blacksite/landscape', '@blacksite/look'],
    demos: [],
    agent: {
      reads: [{ label: 'Sky, terrain and forests', path: 'skills/blacksite/references/worlds.md' }, { label: 'Light and materials', path: 'skills/blacksite/references/craft.md' }],
      commands: [{ label: 'Find a real terrain and ground materials', code: 'blacksite assets suggest --idea "alpine meadow above a forested valley" --json' }],
      note: 'The agent builds an open world from the landscape package, using Valley as its model: real elevation data for the ground, grass and flowers by mask, three tree species, and an outdoor sky.',
    },
    guides: [{ label: 'Landscape package', path: 'packages/landscape/README.md' }, { label: 'Look package', path: 'packages/look/README.md' }],
  },
  {
    slug: 'destruction',
    name: 'Destruction',
    tagline: 'Concrete buildings that crack, lose their supports and fall.',
    pitch: 'Buildings made of walls, slabs and columns joined by bonds that crack and break. When a building loses its supports it falls under its own weight. The physics runs in a web worker, so the game keeps its frame rate.',
    packages: ['@blacksite/cascade'],
    demos: [],
    agent: {
      reads: [{ label: 'Destruction reference', path: 'skills/blacksite/references/combat.md' }, { label: 'Destruction guide', path: 'docs/cascade.md' }, { label: 'Package rules', path: 'packages/cascade/AGENTS.md' }],
      commands: [{ label: 'Prototype a destructible building', code: 'blacksite prototype new collapse --with cascade' }],
      note: 'The agent describes a building as boxes, hands it to the destruction worker and draws the pieces with the package’s renderer. Impacts and charges are messages sent to the worker.',
    },
    guides: [{ label: 'Destruction guide', path: 'docs/cascade.md' }, { label: 'Package rules', path: 'packages/cascade/AGENTS.md' }],
  },
  {
    slug: 'weapons',
    name: 'Weapons',
    tagline: 'A rifle and a pistol that fire, reload, aim and recoil, held by rigged first-person arms.',
    pitch: 'Rigged first-person arms with a rifle and a pistol: fire, reload, aim and recoil. The weapon simulation decides every shot, and a server can run it again to check hits in multiplayer.',
    packages: ['@blacksite/subject-fpp', '@blacksite/armory'],
    demos: [],
    agent: {
      reads: [{ label: 'Weapons reference', path: 'skills/blacksite/references/combat.md' }, { label: 'First-person arms', path: 'docs/arms.md' }, { label: 'Package rules', path: 'packages/armory/AGENTS.md' }],
      commands: [{ label: 'Start a first-person game', code: 'blacksite scaffold --profile fpp --name "My Game" --dir /absolute/path' }],
      note: 'The first-person template connects the arms, the weapons and the controls. The agent adds the targets, impacts and hit reactions your game needs.',
    },
    guides: [{ label: 'First-person arms', path: 'docs/arms.md' }, { label: 'Package rules', path: 'packages/armory/AGENTS.md' }],
  },
  {
    slug: 'multiplayer',
    name: 'Multiplayer',
    tagline: 'Rooms where each player moves their own character and the server checks the hits.',
    pitch: 'Rooms on a Colyseus server, or inside one browser tab for demos and tests. Each player moves their own character, the server checks hits, and other players animate the same way the local one does.',
    packages: ['@blacksite/relay', '@blacksite/subject'],
    demos: [],
    agent: {
      reads: [{ label: 'Multiplayer reference', path: 'skills/blacksite/references/multiplayer.md' }, { label: 'Player templates', path: 'docs/player-templates.md' }, { label: 'Multiplayer limits', path: 'packages/relay/AGENTS.md' }],
      commands: [{ label: 'Start a multiplayer game', code: 'blacksite scaffold --profile mp --name "My Game" --dir /absolute/path' }],
      note: 'The multiplayer template runs a local server under `pnpm dev`, plus a room inside the tab, so the agent can test two players without a network.',
    },
    guides: [{ label: 'Player templates', path: 'docs/player-templates.md' }, { label: 'Multiplayer limits', path: 'packages/relay/AGENTS.md' }],
  },
  {
    slug: 'ai',
    name: 'AI',
    tagline: 'Enemy squads that see, hear, take cover and flank as a team.',
    pitch: 'Enemy squads that pick cover, flank and work together. The simulation runs in a worker and gives the same result every time, so any fight can be replayed.',
    packages: ['@blacksite/warden', '@blacksite/warden-react'],
    demos: [],
    agent: {
      reads: [{ label: 'Enemy AI reference', path: 'skills/blacksite/references/enemies.md' }, { label: 'AI guide', path: 'docs/warden.md' }, { label: 'Package rules', path: 'packages/warden/AGENTS.md' }],
      commands: [{ label: 'Prototype a squad fight', code: 'blacksite prototype new firefight --with warden' }],
      note: 'The agent starts the squad simulation in a worker and draws each soldier with the game’s own characters.',
    },
    guides: [{ label: 'AI guide', path: 'docs/warden.md' }, { label: 'Package rules', path: 'packages/warden/AGENTS.md' }],
  },
  {
    slug: 'input',
    name: 'Input and UI',
    tagline: 'Keyboard, mouse, gamepad and touch, plus menus a controller can drive.',
    pitch: 'One input layer for keyboard, mouse, gamepad and touch, bound to actions the game names. Plus menus, pause and settings screens that work with a controller.',
    packages: ['@blacksite/input', '@blacksite/ui'],
    demos: [],
    agent: {
      reads: [{ label: 'Input reference', path: 'skills/blacksite/references/feel.md' }, { label: 'Input guide', path: 'packages/input/README.md' }, { label: 'UI guide', path: 'packages/ui/README.md' }],
      commands: [{ label: 'Every template includes both', code: 'blacksite scaffold --profile blank --name "My Game" --dir /absolute/path' }],
      note: 'Every template includes input and menus. The agent binds the game’s actions to keys, buttons and touch controls, and builds menus a gamepad can drive.',
    },
    guides: [{ label: 'Input guide', path: 'packages/input/README.md' }, { label: 'UI guide', path: 'packages/ui/README.md' }],
  },
]

export const toolBySlug = (slug: string) => tools.find(tool => tool.slug === slug)

export const featured = [
  { showcase: 'breach', kind: 'First-person shooter' },
  { showcase: 'traverse', kind: 'Third-person action' },
  { showcase: 'valley', kind: 'Open world' },
  { showcase: 'firing-range', kind: 'Weapons demo' },
]

export const limits = [
  'Desktop browsers come first. Phones aim for 60 fps and leave out two lighting effects.',
  'Characters share one mannequin body. Your own rigged character isn’t supported yet.',
  'Weapons cover a rifle and a pistol. Any other weapon needs new animation.',
  'Multiplayer has no lag compensation yet.',
  'The checks run in a headless browser, so only you can confirm 120 fps on your display and the mix in your headphones.',
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
