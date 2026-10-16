import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const catalog = JSON.parse(readFileSync(path.join(root, 'assets/catalog.json'), 'utf8'));
const scratch = mkdtempSync(path.join(tmpdir(), 'blacksite-library-'));
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
type Library = typeof import('../cli/library.mjs');
let library: Library;
let server: ReturnType<typeof createServer>;
let origin = '';

async function png(colour: [number, number, number], size = 64) {
  return sharp({ create: { width: size, height: size, channels: 3, background: { r: colour[0], g: colour[1], b: colour[2] } } }).png().toBuffer();
}

beforeAll(async () => {
  const files = new Map<string, Buffer>([
    ['/Test_Color.png', await png([150, 140, 120])],
    ['/Test_NormalDX.png', await png([128, 100, 255])],
    ['/Test_Roughness.png', await png([200, 200, 200])],
  ]);
  server = createServer((request, response) => {
    const body = files.get(request.url ?? '');
    if (!body) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'content-type': 'image/png' }).end(body);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const fixture = { version: 1, packs: { test: { description: 'fixture', assets: ['test-concrete'] } }, assets: [{ id: 'test-concrete', title: 'Test Concrete', category: 'material', tags: ['concrete'], source: { site: 'fixture', url: 'https://example.com/concrete' }, author: 'Fixture', licence: 'CC0-1.0', attribution: '"Test Concrete" by Fixture, CC0 1.0', use: 'test', scale: { tile: 2 }, files: ['Test_Color.png', 'Test_NormalDX.png', 'Test_Roughness.png'].map(name => ({ url: `${origin}/${name}`, name })) }] };
  writeFileSync(path.join(scratch, 'catalog.json'), JSON.stringify(fixture));
  process.env.BLACKSITE_LIBRARY_CATALOG = path.join(scratch, 'catalog.json');
  process.env.BLACKSITE_LIBRARY_CACHE_DIR = path.join(scratch, 'cache');
  process.env.BLACKSITE_LIBRARY_BUILD_DIR = path.join(scratch, 'build');
  library = await import('../cli/library.mjs');
});

afterAll(() => { server?.close(); rmSync(scratch, { recursive: true, force: true }); });

it('ships a catalog that passes the licence rules', () => {
  expect(library.validate(catalog)).toEqual([]);
  for (const asset of catalog.assets) expect(Object.keys(library.LICENCES)).toContain(asset.licence);
});

it('pins a hash for every scriptable starter asset', () => {
  const starter = new Set(catalog.packs.starter.assets);
  for (const asset of catalog.assets.filter((a: { id: string; acquire?: string }) => starter.has(a.id) && a.acquire !== 'manual')) {
    expect(asset.files.length, asset.id).toBeGreaterThan(0);
    for (const file of asset.files) expect(file.sha256, `${asset.id} ${file.name}`).toMatch(/^[0-9a-f]{64}$/);
  }
});

it('rejects licences and hosts outside the allowlist', () => {
  const base = { id: 'bad-asset', title: 'Bad', category: 'sound', tags: [], source: { url: 'https://example.com' }, author: 'Someone', use: 'x', files: [{ url: 'https://example.com/a.wav', name: 'a.wav' }] };
  expect(library.validate({ assets: [{ ...base, licence: 'CC-BY-NC-4.0' }] }).join()).toMatch(/not on the allowlist/);
  expect(library.validate({ assets: [{ ...base, licence: 'CC-BY-4.0' }] }).join()).toMatch(/needs attribution/);
  expect(library.validate({ assets: [{ ...base, licence: 'CC0-1.0', files: [{ url: 'https://www.fab.com/x.zip', name: 'x.zip' }] }] }).join()).toMatch(/denied host/);
});

it('writes credits grouped by licence with attribution for CC BY', () => {
  const markdown = library.creditsMarkdown([
    { id: 'a', title: 'A', category: 'sound', author: 'Ann', licence: 'CC-BY-4.0', attribution: '"A" by Ann, CC BY 4.0', source: { url: 'https://example.com/a' } },
    { id: 'b', title: 'B', category: 'material', author: 'Ben', licence: 'CC0-1.0', attribution: '', source: { url: 'https://example.com/b' } },
  ]);
  expect(markdown.indexOf('## CC0 1.0')).toBeLessThan(markdown.indexOf('## CC BY 4.0'));
  expect(markdown).toContain('"A" by Ann, CC BY 4.0');
});

it('adds a material to a project with web-ready maps and credits', async () => {
  const project = path.join(scratch, 'game');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(project, { recursive: true });
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try { await library.runLibrary('add', ['test-concrete', '--project', project, '--no-ktx2']); } finally { process.stdout.write = write; }
  const target = path.join(project, 'public/assets/library/test-concrete');
  const manifest = JSON.parse(readFileSync(path.join(target, 'asset.json'), 'utf8'));
  expect(manifest.withinBudget).toBe(true);
  for (const file of ['1k/c.webp', '1k/n.webp', '1k/orm.webp', '512/c.webp']) expect(existsSync(path.join(target, file)), file).toBe(true);
  const normal = await sharp(path.join(target, '1k/n.webp')).raw().toBuffer();
  expect(normal[1]).toBeGreaterThan(140);
  const orm = await sharp(path.join(target, '1k/orm.webp')).raw().toBuffer();
  expect(orm[0]).toBeGreaterThan(245);
  expect(Math.abs(orm[1] - 200)).toBeLessThan(6);
  expect(orm[2]).toBeLessThan(6);
  expect(readFileSync(path.join(project, 'CREDITS.md'), 'utf8')).toContain('test-concrete');
  expect(JSON.parse(readFileSync(path.join(project, 'assets.credits.json'), 'utf8')).assets[0].files).toHaveLength(3);
}, 60_000);

it.skipIf(!hasFfmpeg)('splits a recording into takes and encodes Opus and AAC', async () => {
  const { processAsset } = await import('../assets/scripts/process.mjs');
  const source = path.join(scratch, 'steps');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(source, { recursive: true });
  const expression = '0.8*sin(2*PI*180*t)*exp(-30*mod(t\\,0.5))*lt(mod(t\\,0.5)\\,0.15)';
  expect(spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc=${expression}:s=48000:d=2.5`, path.join(source, 'steps.wav')]).status).toBe(0);
  const manifest = await processAsset({ id: 'test-steps', category: 'footstep', process: { split: true } }, source, path.join(scratch, 'steps-out'));
  expect(manifest.variations.length).toBe(5);
  expect(manifest.withinBudget).toBe(true);
  for (const take of manifest.variations) {
    expect(take.seconds).toBeGreaterThan(0.1);
    expect(take.seconds).toBeLessThan(0.7);
    expect(existsSync(path.join(scratch, 'steps-out', take.fallback))).toBe(true);
  }
}, 60_000);
