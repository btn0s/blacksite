import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { inflateSync } from 'node:zlib';

export interface BuildPatchDescriptor {
  kind: 'buildpatch';
  itemId: string;
  artifactId: string;
  manifestUrls: string[];
  buildVersion: string;
}

interface Manifest {
  ManifestFileVersion: string;
  bIsFileData: boolean;
  FileManifestList: { Filename: string; FileHash: string; FileChunkParts: { Guid: string; Offset: string; Size: string }[] }[];
  ChunkHashList: Record<string, string>;
  ChunkShaList: Record<string, string>;
  DataGroupList: Record<string, string>;
  ChunkFilesizeList: Record<string, string>;
}

const bytes = (value: string): Buffer => Buffer.from(value.match(/.{3}/g)?.map(Number) ?? []);
const integer = (value: string): number => {
  const buffer = bytes(value);
  return buffer.length === 8 ? Number(buffer.readBigUInt64LE()) : buffer.readUIntLE(0, buffer.length);
};
const sha1 = (value: Buffer): string => createHash('sha1').update(value).digest('hex');

export function assetUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !['epicgames.com', 'epicgamescdn.com', 'akamaized.net', 'fastly-edge.com', 'fab.com'].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error('Fab download host is not an approved Epic CDN.');
  return url;
}

async function fetchBytes(value: string, signal?: AbortSignal, limit = 32 * 1024 * 1024): Promise<Buffer> {
  assetUrl(value);
  const response = await fetch(value, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000), redirect: 'error' });
  if (!response.ok) throw new Error(`Asset CDN returned HTTP ${response.status}.`);
  if (!response.body || Number(response.headers.get('content-length')) > limit) { await response.body?.cancel(); throw new Error('Asset CDN response exceeds its size limit'); }
  const reader = response.body.getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) return Buffer.concat(parts, size);
      size += part.value.byteLength;
      if (size > limit) throw new Error('Asset CDN response exceeds its size limit');
      parts.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function downloadBuildPatch(descriptor: BuildPatchDescriptor, destination: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  let manifest: Manifest | undefined;
  let base: URL | undefined;
  let manifestBytes: Buffer | undefined;
  for (const value of descriptor.manifestUrls) {
    try {
      const data = await fetchBytes(value, signal);
      if (data[0] !== 123) throw new Error('This POC supports JSON BuildPatch manifests; binary manifests require Epic Launcher.');
      manifest = JSON.parse(data.toString('utf8')) as Manifest;
      manifestBytes = data;
      base = new URL('.', assetUrl(value));
      break;
    } catch { signal?.throwIfAborted(); continue; }
  }
  if (!manifest || !base || !manifestBytes) throw new Error('No supported BuildPatch manifest could be downloaded. Use Epic Launcher for this format.');
  const version = integer(manifest.ManifestFileVersion);
  if (manifest.bIsFileData || version >= 22) throw new Error('This BuildPatch manifest version is not supported by the POC.');
  const root = resolve(destination, descriptor.artifactId.replace(/[^a-zA-Z0-9_-]/g, '_'));
  const cache = resolve(destination, '.chunks');
  await mkdir(cache, { recursive: true });
  await mkdir(root, { recursive: true });
  if (await realpath(cache) !== cache || await realpath(root) !== root) throw new Error('Asset cache cannot contain symbolic links');
  const chunkDir = version >= 15 ? 'ChunksV4' : version >= 6 ? 'ChunksV3' : version >= 3 ? 'ChunksV2' : 'Chunks';
  const chunks = Object.keys(manifest.ChunkHashList);
  if (chunks.length > 100000 || chunks.some((guid) => !/^[a-f0-9]{32}$/i.test(guid))) throw new Error('BuildPatch manifest contains invalid chunk IDs');
  if (!Array.isArray(manifest.FileManifestList) || manifest.FileManifestList.length > 50000 || manifest.FileManifestList.some((file) => file.Filename.split(/[\\/]/).some((part) => part === '..' || /login|token|secret|key|credential/i.test(part) || part.startsWith('.env')) || file.FileChunkParts.some((part) => !chunks.includes(part.Guid)))) throw new Error('BuildPatch manifest contains restricted paths or chunk references');
  const maxBytes = Number(process.env.FAB_MAX_DOWNLOAD_BYTES ?? 10 * 1024 ** 3);
  if (Object.values(manifest.ChunkFilesizeList).reduce((n, value) => n + integer(value), 0) > maxBytes) throw new Error('Pack exceeds FAB_MAX_DOWNLOAD_BYTES.');
  let next = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (;;) {
      signal?.throwIfAborted();
      const guid = chunks[next++];
      if (!guid) return;
      const filename = resolve(cache, `${guid}.bin`);
      const expected = manifest.ChunkShaList[guid]?.toLowerCase();
      const metadata = await lstat(filename).catch(() => undefined);
      if (metadata && !metadata.isFile()) throw new Error('Cached chunks must be regular files');
      const existing = metadata && metadata.size <= 32 * 1024 * 1024 ? await readFile(filename) : undefined;
      if (existing && sha1(existing) === expected) continue;
      const hash = bytes(manifest.ChunkHashList[guid]).readBigUInt64LE().toString(16).padStart(16, '0').toUpperCase();
      const group = integer(manifest.DataGroupList[guid]).toString().padStart(2, '0');
      const data = await fetchBytes(new URL(`${chunkDir}/${group}/${hash}_${guid}.chunk`, base).href, signal);
      if (data.readUInt32LE(0) !== 0xb1fe3aa2) throw new Error('Invalid BuildPatch chunk header.');
      const offset = data.readUInt32LE(8);
      const stored = data[40];
      if ((stored & 2) !== 0) throw new Error('Encrypted BuildPatch chunks are unsupported.');
      const body = stored & 1 ? inflateSync(data.subarray(offset), { maxOutputLength: 32 * 1024 * 1024 }) : data.subarray(offset);
      if (sha1(body) !== expected) throw new Error('BuildPatch chunk checksum mismatch.');
      await writeFile(filename, body);
    }
  }));
  let size = 0;
  const proofFiles: { path: string; bytes: number; sha256: string }[] = [];
  for (const file of manifest.FileManifestList) {
    signal?.throwIfAborted();
    const target = resolve(root, file.Filename.replaceAll('\\', '/'));
    if (!target.startsWith(root + sep)) throw new Error('BuildPatch manifest contains an unsafe path.');
    const parts: Buffer[] = [];
    for (const part of file.FileChunkParts) {
      const data = await readFile(resolve(cache, `${part.Guid}.bin`));
      const start = integer(part.Offset);
      parts.push(data.subarray(start, start + integer(part.Size)));
    }
    const content = Buffer.concat(parts);
    if (size + content.length > maxBytes) throw new Error('Extracted pack exceeds FAB_MAX_DOWNLOAD_BYTES');
    if (sha1(content) !== bytes(file.FileHash).toString('hex')) throw new Error('BuildPatch file checksum mismatch.');
    await mkdir(dirname(target), { recursive: true });
    if (!(await realpath(dirname(target))).startsWith(root + sep) && await realpath(dirname(target)) !== root) throw new Error('BuildPatch output escapes its asset directory');
    const existing = await lstat(target).catch(() => undefined);
    if (existing && !existing.isFile()) throw new Error('BuildPatch output must be a regular file');
    await writeFile(target, content);
    size += content.length;
    proofFiles.push({ path: file.Filename, bytes: content.length, sha256: createHash('sha256').update(content).digest('hex') });
  }
  await writeFile(resolve(root, 'fab-download-proof.json'), JSON.stringify({ itemId: descriptor.itemId, artifactId: descriptor.artifactId, buildVersion: descriptor.buildVersion, manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'), chunks: chunks.length, files: proofFiles, totalBytes: size, downloadedAt: new Date().toISOString(), authenticationSentToCdn: false }, null, 2));
  return root;
}
