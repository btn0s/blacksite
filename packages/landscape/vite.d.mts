import type { Plugin } from 'vite'
import type { LandscapeShape } from './src/bake'

export function blacksiteLandscape(options?: { shape?: LandscapeShape; name?: string; directory?: string; sources?: string[] }): Plugin
