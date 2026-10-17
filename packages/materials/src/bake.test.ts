import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bake } from './bake'
import { compile, type MaterialGraph } from './graph'
import { evaluate } from './cpu'
import { readImage } from './node'

const run = promisify(execFile)
const packageDir = fileURLToPath(new URL('../', import.meta.url))
const graph: MaterialGraph = {
  name: 'bake-contract', size: 1.5, depth: 0.02, seed: 91,
  nodes: { height: { op: 'wave', period: 1.5 } },
  outputs: { color: '#789', height: 'height', roughness: 0.8, metalness: 0.2 },
  weather: { damage: { chips: 0.5 } },
}
let directory: string

beforeAll(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'blacksite-materials-test-')) })
afterAll(async () => { await rm(directory, { recursive: true, force: true }) })

describe('baked material delivery', () => {
  it('writes every requested map, resolution and descriptor with valid KTX2 mip and channel metadata', async () => {
    const report = await bake(graph, path.join(directory, 'graph.json'), directory, { sizes: [16, 32], formats: ['ktx2', 'webp'] })
    expect(report.errors).toEqual([])
    expect(report.files).toHaveLength(16)
    const manifest = JSON.parse(await readFile(path.join(report.dir, 'material.json'), 'utf8'))
    expect(manifest).toMatchObject({ name: graph.name, size: graph.size, depth: graph.depth, sizes: [16, 32], formats: ['ktx2', 'webp'] })
    for (const format of ['ktx2', 'webp']) {
      const all = await readFile(path.join(report.dir, format === 'ktx2' ? 'index.ts' : 'webp.ts'), 'utf8')
      for (const size of [16, 32]) {
        const single = await readFile(path.join(report.dir, `${size}${format === 'ktx2' ? '' : '.webp'}.ts`), 'utf8')
        expect(single.match(/new URL\(/g)).toHaveLength(4)
        expect(single).toContain(`format: '${format}'`)
        expect(single).not.toContain(`'./${size === 16 ? 32 : 16}/`)
        for (const map of ['color', 'normal', 'orm', 'masks']) {
          const relative = `${size}/${map}.${format}`
          expect(all).toContain(`new URL('./${relative}', import.meta.url).href`)
          expect(single).toContain(`new URL('./${relative}', import.meta.url).href`)
          const file = path.join(report.dir, relative)
          expect((await stat(file)).size).toBeGreaterThan(0)
          if (format === 'webp') {
            const info = await sharp(file).metadata()
            expect([info.width, info.height]).toEqual([size, size])
            if (map === 'normal' || map === 'masks') expect(info.hasAlpha).toBe(true)
            continue
          }
          const bytes = await readFile(file)
          expect([...bytes.subarray(0, 12)]).toEqual([171, 75, 84, 88, 32, 50, 48, 187, 13, 10, 26, 10])
          expect([bytes.readUInt32LE(20), bytes.readUInt32LE(24)]).toEqual([size, size])
          const levels = bytes.readUInt32LE(40)
          expect(levels).toBe(Math.log2(size) + 1)
          for (let level = 0; level < levels; level++) {
            const offset = Number(bytes.readBigUInt64LE(80 + level * 24))
            const length = Number(bytes.readBigUInt64LE(88 + level * 24))
            expect(length).toBeGreaterThan(0)
            expect(offset + length).toBeLessThanOrEqual(bytes.length)
          }
          const dfd = bytes.readUInt32LE(48)
          expect(bytes[dfd + 14]).toBe(map === 'color' ? 2 : 1)
          if (map === 'normal') {
            expect(bytes[dfd + 12]).toBe(166)
            expect(bytes[dfd + 31]).toBe(3)
          }
          if (map === 'masks') {
            expect(bytes[dfd + 12]).toBe(166)
            expect(bytes[dfd + 31]).toBe(3)
          }
        }
      }
    }
    const repeated = await bake(graph, path.join(directory, 'graph.json'), path.join(directory, 'repeated'), { sizes: [16], formats: ['ktx2'] })
    for (const map of ['color', 'normal', 'orm', 'masks']) {
      expect(await readFile(path.join(repeated.dir, `16/${map}.ktx2`))).toEqual(await readFile(path.join(report.dir, `16/${map}.ktx2`)))
    }
  }, 30000)

  it('fingerprints decoded image content and keeps repeated bakes deterministic', async () => {
    const input = path.join(directory, 'source.png')
    const imageGraph: MaterialGraph = { ...graph, name: 'image-fingerprint', weather: undefined, nodes: { source: { op: 'image', src: 'source.png' } }, outputs: { color: 'source', height: 0.4 } }
    const write = (red: number) => sharp({ create: { width: 16, height: 16, channels: 3, background: { r: red, g: 60, b: 90 } } }).png().toFile(input)
    const read = async () => {
      const report = await bake(imageGraph, path.join(directory, 'graph.json'), directory, { sizes: [16], formats: ['webp'] })
      return { hash: JSON.parse(await readFile(path.join(report.dir, 'material.json'), 'utf8')).hash, bytes: await readFile(path.join(report.dir, '16/color.webp')) }
    }
    await write(40)
    const first = await read()
    const repeated = await read()
    expect(repeated).toEqual(first)
    await write(180)
    const changed = await read()
    expect(changed.hash).not.toBe(first.hash)
    expect(changed.bytes).not.toEqual(first.bytes)
  })

  it('reports byte-budget violations while preserving inspectable bake outputs', async () => {
    const result = await bake({ ...graph, name: 'over-budget' }, path.join(directory, 'graph.json'), directory, { sizes: [16], formats: ['webp'], maxAssetBytes: 1 })
    expect(result.errors).toHaveLength(4)
    expect(result.files.every(file => file.bytes > 1)).toBe(true)
    expect(await readdir(result.dir)).toContain('material.json')
  })

  it('preserves every packed WebP data byte, including RGB beneath zero damage alpha', async () => {
    const dataGraph: MaterialGraph = { ...graph, name: 'exact-data', weather: { moisture: 0.2, dirt: 0.45, damage: { chips: 0.8 } } }
    const cpu = evaluate(compile(dataGraph, 32))
    const result = await bake(dataGraph, path.join(directory, 'graph.json'), directory, { sizes: [32], formats: ['webp'] })
    expect(cpu.masks.data.some((value, i) => i % 4 === 3 && value === 0 && cpu.masks.data[i - 1]! > 0)).toBe(true)
    for (const name of ['normal', 'orm', 'masks'] as const) {
      const decoded = await readImage(path.join(result.dir, `32/${name}.webp`))
      const expected = Uint8Array.from(cpu[name].data, value => Math.max(0, Math.min(255, Math.round(value * 255))))
      const actual = Uint8Array.from(decoded.data, value => Math.round(value * 255))
      expect(actual, name).toEqual(expected)
    }
  })

  it.each([
    { name: '../escape' }, { name: '/escape' }, { sizes: [] }, { sizes: [0] }, { sizes: [30] },
    { sizes: [8192] }, { formats: [] }, { formats: ['png'] }, { maxAssetBytes: -1 },
  ])('rejects unsafe bake options before writing %#', async options => {
    const destination = path.join(directory, 'rejected')
    await expect(Reflect.apply(bake, undefined, [graph, path.join(directory, 'graph.json'), destination, options])).rejects.toThrow()
    await expect(stat(destination)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    { args: ['--out'], error: '--out needs a value' },
    { args: ['--unknown'], error: 'unknown option --unknown' },
    { args: ['--sizes', '--formats', 'webp'], error: '--sizes needs a value' },
  ])('fails malformed CLI arguments without starting a bake: $error', async ({ args, error }) => {
    await expect(run(process.execPath, ['--import', 'tsx', path.join(packageDir, 'scripts/bake.ts'), ...args], { cwd: packageDir })).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining(error) })
  })

  it('runs the CLI with explicit graph/output paths and a byte budget', async () => {
    const graphPath = path.join(directory, 'cli-graph.json')
    const budgetPath = path.join(directory, 'budget.json')
    await writeFile(graphPath, JSON.stringify({ ...graph, name: 'cli-material' }))
    await writeFile(budgetPath, JSON.stringify({ maxAssetBytes: 1 }))
    await expect(run(process.execPath, ['--import', 'tsx', path.join(packageDir, 'scripts/bake.ts'), graphPath, '--out', path.join(directory, 'cli'), '--sizes', '16', '--formats', 'webp', '--budget', budgetPath], { cwd: packageDir })).rejects.toMatchObject({ code: 1 })
    const manifest = JSON.parse(await readFile(path.join(directory, 'cli/cli-material/material.json'), 'utf8'))
    expect(manifest.sizes).toEqual([16])
    expect(manifest.formats).toEqual(['webp'])
  })

})
