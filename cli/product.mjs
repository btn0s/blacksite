import { readFileSync } from 'node:fs'

export const product = JSON.parse(readFileSync(new URL('../product.json', import.meta.url), 'utf8'))
