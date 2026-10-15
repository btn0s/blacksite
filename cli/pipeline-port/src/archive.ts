import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { open, type ZipFile } from 'yauzl';

export async function extractZip(source: string, destination: string): Promise<void> {
  const zip = await new Promise<ZipFile>((accept, reject) => open(source, { lazyEntries: true }, (error, result) => error || !result ? reject(new Error('Could not open the downloaded ZIP')) : accept(result)));
  let count = 0;
  let bytes = 0;
  await new Promise<void>((accept, reject) => {
    const fail = (error: unknown) => { zip.close(); reject(error); };
    zip.on('error', fail);
    zip.on('end', accept);
    zip.on('entry', (entry) => {
      void (async () => {
        if (++count > 50000 || (bytes += entry.uncompressedSize) > 5_000_000_000) throw new Error('Archive exceeds extraction limits');
        const name = entry.fileName.replaceAll('\\', '/');
        if (name.split('/').some((part: string) => /login|token|secret|key|credential/i.test(part) || part.startsWith('.env'))) throw new Error('Archive contains a restricted filename');
        if (((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000) throw new Error('Archive links are not supported');
        const target = resolve(destination, name);
        if (!target.startsWith(`${resolve(destination)}${sep}`)) throw new Error('Archive path escapes its destination');
        if (name.endsWith('/')) await mkdir(target, { recursive: true });
        else {
          await mkdir(dirname(target), { recursive: true });
          const stream = await new Promise<NodeJS.ReadableStream>((acceptStream, rejectStream) => zip.openReadStream(entry, (error, result) => error || !result ? rejectStream(new Error('Could not read archive entry')) : acceptStream(result)));
          await pipeline(stream, createWriteStream(target, { flags: 'wx' }));
        }
        zip.readEntry();
      })().catch(fail);
    });
    zip.readEntry();
  });
}
