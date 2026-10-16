export type DocEntry = { slug: string; title: string; path: string; tool?: string }

export const docList: DocEntry[] = [
  { slug: 'roadmap', title: 'Roadmap', path: 'ROADMAP.md' },
  { slug: 'als', title: 'ALS agent guide', path: 'vendor/als-web/docs/guide/overview.md', tool: 'characters' },
  { slug: 'player-templates', title: 'Player templates', path: 'docs/player-templates.md', tool: 'multiplayer' },
  { slug: 'cascade', title: 'Cascade guide', path: 'docs/cascade.md', tool: 'destruction' },
  { slug: 'arms', title: 'First-person arms', path: 'docs/arms.md', tool: 'weapons' },
  { slug: 'warden', title: 'Warden guide', path: 'docs/warden.md', tool: 'ai' },
  { slug: 'input', title: 'Input guide', path: 'packages/input/README.md', tool: 'input' },
  { slug: 'ui', title: 'UI guide', path: 'packages/ui/README.md', tool: 'input' },
]
