import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { assetUrl, type BuildPatchDescriptor } from './buildpatch.js';

export interface DirectDescriptor {
  kind: 'http';
  itemId: string;
  filename: string;
  size: number | null;
  url: string;
  expires: string | null;
}
export type FabDownloadDescriptor = BuildPatchDescriptor | DirectDescriptor;

export async function downloadDirect(descriptor: DirectDescriptor, directory: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  assetUrl(descriptor.url);
  const maxBytes = Number(process.env.FAB_MAX_DOWNLOAD_BYTES ?? 10 * 1024 ** 3);
  if (descriptor.size && descriptor.size > maxBytes) throw new Error('File exceeds FAB_MAX_DOWNLOAD_BYTES.');
  const response = await fetch(descriptor.url, { redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30 * 60 * 1000)]) : AbortSignal.timeout(30 * 60 * 1000) });
  if (!response.ok || !response.body) throw new Error(`Fab CDN download returned HTTP ${response.status}.`);
  const expected = descriptor.size ?? Number(response.headers.get('Content-Length'));
  if (expected > maxBytes) throw new Error('File exceeds FAB_MAX_DOWNLOAD_BYTES.');
  const filename = basename(descriptor.filename.replaceAll('\\', '/')).replace(/[^a-zA-Z0-9._ -]/g, '_');
  if (!filename || filename.startsWith('.') || /login|token|secret|key|credential/i.test(filename)) throw new Error('Fab returned a restricted or invalid filename.');
  await mkdir(directory, { recursive: true });
  const target = resolve(directory, filename);
  const temporary = resolve(directory, `${randomUUID()}.partial`);
  const hash = createHash('sha256');
  let size = 0;
  try {
    const reader = response.body.getReader();
    const source = Readable.from((async function* () {
      try { for (;;) { const next = await reader.read(); if (next.done) return; yield next.value; } }
      finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    })());
    await pipeline(source, new Transform({ transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length;
      if (size > maxBytes) { callback(new Error('Download exceeded FAB_MAX_DOWNLOAD_BYTES.')); return; }
      hash.update(chunk);
      callback(null, chunk);
    } }), createWriteStream(temporary, { flags: 'wx' }), { signal });
    if (expected && size !== expected) throw new Error('Fab download length did not match the file metadata.');
    signal?.throwIfAborted();
    await rename(temporary, target);
    await writeFile(`${target}.fab-proof.json`, JSON.stringify({ itemId: descriptor.itemId, filename, bytes: size, sha256: hash.digest('hex'), downloadedAt: new Date().toISOString(), authenticationSentToCdn: false }, null, 2));
    return target;
  } catch { await rm(temporary, { force: true }); signal?.throwIfAborted(); throw new Error('Fab CDN download failed or did not pass its length check.'); }
}
