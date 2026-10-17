import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { LibraryAsset } from '../cli/library.mjs';

let scratch: string;
let origin: string;
let library: typeof import('../cli/library.mjs');
let server: ReturnType<typeof createServer>;
const served = new Map<string, Buffer>();
const requests: string[] = [];
const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const entry = (id: string, names = ['one.txt']): LibraryAsset => ({ id, title: id, category: 'sound', tags: [], source: { url: 'https://example.com/library' }, author: 'Fixture', licence: 'CC0-1.0', use: 'test', files: names.map(name => ({ name, url: `${origin}/${name}` })) });

beforeAll(async () => {
  scratch = await mkdtemp(path.join(tmpdir(), 'blacksite-fetch-'));
  served.set('/one.txt', Buffer.from('first'));
  served.set('/two.txt', Buffer.from('second'));
  server = createServer((request, response) => {
    const name = request.url ?? '';
    requests.push(name);
    const content = served.get(name);
    response.writeHead(content ? 200 : 404).end(content);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.BLACKSITE_LIBRARY_CACHE_DIR = path.join(scratch, 'cache');
  library = await import('../cli/library.mjs');
});

afterAll(async () => { server?.close(); await rm(scratch, { recursive: true, force: true }); });

it('refetches when files are added or the source cache is missing', async () => {
  await library.fetchAsset(entry('cache-added'));
  const added = await library.fetchAsset(entry('cache-added', ['one.txt', 'two.txt']));
  expect(added.cached).toBe(false);
  expect(await readFile(path.join(added.directory, 'two.txt'), 'utf8')).toBe('second');
  await rm(added.directory, { recursive: true });
  expect((await library.fetchAsset(entry('cache-added', ['one.txt', 'two.txt']))).cached).toBe(false);
});

it('preserves the last verified cache after a replacement fails', async () => {
  const original = await library.fetchAsset(entry('cache-preserved'));
  await expect(library.fetchAsset(entry('cache-preserved', ['missing.txt']), { force: true })).rejects.toThrow('HTTP 404');
  expect(await readFile(path.join(original.directory, 'one.txt'), 'utf8')).toBe('first');
});

it('bypasses the cache for an explicit upstream update', async () => {
  await library.fetchAsset(entry('cache-update'));
  const before = requests.length;
  expect((await library.fetchAsset(entry('cache-update'), { update: true })).cached).toBe(false);
  expect(requests.length).toBe(before + 1);
});

it('repairs source corruption even when the file size is unchanged', async () => {
  const asset = entry('cache-corrupt');
  const first = await library.fetchAsset(asset);
  await writeFile(path.join(first.directory, 'one.txt'), 'other');
  const repaired = await library.fetchAsset(asset);
  expect(repaired.cached).toBe(false);
  expect(await readFile(path.join(repaired.directory, 'one.txt'), 'utf8')).toBe('first');
});

it('imports a manually downloaded file and records its actual hash', async () => {
  const from = path.join(scratch, 'manual.wav');
  await writeFile(from, 'manual fixture');
  const asset = { ...entry('manual-file', ['original.wav']), acquire: 'manual' as const };
  const result = await library.fetchAsset(asset, { from });
  expect(await readFile(path.join(result.directory, 'original.wav'), 'utf8')).toBe('manual fixture');
  expect(result.files[0].sha256).toBe(hash(Buffer.from('manual fixture')));
  await expect(library.fetchAsset({ ...asset, files: entry('unused', ['one.txt', 'two.txt']).files }, { from, force: true })).rejects.toThrow(/folder|directory/i);
});

it('enforces licence and safe file names before acquisition', async () => {
  const before = requests.length;
  await expect(library.fetchAsset({ ...entry('unlicensed'), licence: 'CC-BY-NC-4.0' })).rejects.toThrow(/allowlist/);
  await expect(library.fetchAsset(entry('../outside'))).rejects.toThrow(/id/);
  await expect(library.fetchAsset(entry('bad-path', ['../outside.txt']))).rejects.toThrow(/file name/i);
  expect(requests.length).toBe(before);
});

it.each(['zip', '7z'])('extracts selected regular %s files and invalidates a changed filter', async format => {
  const SevenZip = (await import('7z-wasm')).default;
  const sz = await SevenZip({ print: () => {}, printErr: () => {} });
  sz.FS.mkdir('/fixture');
  sz.FS.writeFile('/fixture/one.txt', 'first');
  sz.FS.writeFile('/fixture/two.txt', 'second');
  sz.FS.symlink('/outside', '/fixture/link.txt');
  expect(sz.callMain(['a', `/archive.${format}`, '/fixture', '-snl', '-bd'])).toBe(0);
  const bytes = Buffer.from(sz.FS.readFile(`/archive.${format}`));
  served.set(`/archive.${format}`, bytes);
  const asset = { ...entry(`archive-${format}`), files: [{ name: `archive.${format}`, url: `${origin}/archive.${format}`, sha256: hash(bytes), extract: true, include: 'one\\.txt$' }] };
  const first = await library.fetchAsset(asset);
  expect(await readFile(path.join(first.directory, 'fixture/one.txt'), 'utf8')).toBe('first');
  expect(existsSync(path.join(first.directory, 'fixture/two.txt'))).toBe(false);
  asset.files[0].include = '(two|link)\\.txt$';
  const next = await library.fetchAsset(asset);
  expect(next.cached).toBe(false);
  expect(await readFile(path.join(next.directory, 'fixture/two.txt'), 'utf8')).toBe('second');
  expect(existsSync(path.join(next.directory, 'fixture/one.txt'))).toBe(false);
  expect(existsSync(path.join(next.directory, 'fixture/link.txt'))).toBe(false);
  expect((await stat(path.join(next.directory, 'fixture/two.txt'))).isFile()).toBe(true);
});

it('fails explicitly when archive selection matches no files', async () => {
  const bytes = served.get('/archive.zip');
  expect(bytes).toBeDefined();
  const asset = { ...entry('archive-empty'), files: [{ name: 'archive.zip', url: `${origin}/archive.zip`, extract: true, include: 'absent\\.txt$' }] };
  await expect(library.fetchAsset(asset)).rejects.toThrow(/no .*files/i);
});
