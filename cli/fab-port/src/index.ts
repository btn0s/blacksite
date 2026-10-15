import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadBuildPatch } from './buildpatch.js';
import { downloadDirect, type FabDownloadDescriptor } from './direct.js';
type LibraryItem = { id: string; source: string; owned: boolean; assetId?: string; namespace?: string; title: string; [key: string]: unknown };
type AssetFormat = { id: string; name: string; available: boolean; [key: string]: unknown };


export interface FabClientOptions {
  signal?: AbortSignal;
  libraryDir?: string;
  syncScript?: string;
  cacheDir?: string;
  authBroker?: string | false;
}

export class FabClient {
  private readonly options: FabClientOptions;
  private pending: Promise<unknown> = Promise.resolve();

  constructor(options: FabClientOptions = {}) {
    this.options = options;
  }

  private run<T>(operation: string, item?: LibraryItem, formatId?: string, destination?: string): Promise<T> {
    const request = JSON.stringify({ operation, item, formatId, destination });
    const broker = this.options.authBroker === false ? undefined : this.options.authBroker ?? process.env.FAB_AUTH_BROKER;
    if (broker) return this.brokerRequest<T>(broker, request);
    const run = (): Promise<T> => new Promise((accept, reject) => {
      const helper = process.env.FAB_BRIDGE_SCRIPT ?? fileURLToPath(new URL('./scripts/bridge.py', import.meta.url));
      const child = execFile(process.env.FAB_PYTHON ?? 'python3', [helper], {
        env: { ...process.env, FAB_SYNC_SCRIPT: this.options.syncScript ?? process.env.FAB_SYNC_SCRIPT ?? 'fab-sync', FAB_LIBRARY_DIR: this.options.libraryDir ?? process.env.FAB_LIBRARY_DIR, FAB_CACHE_DIR: this.options.cacheDir ?? process.env.FAB_CACHE_DIR ?? resolve('.runtime/fab') },
        maxBuffer: 16 * 1024 * 1024,
        signal: this.options.signal,
        timeout: 30 * 60 * 1000,
      }, (error, stdout) => {
        if (error) { reject(new Error('Fab adapter unavailable. Check Python and the existing fab-sync session on this host.')); return; }
        try {
          const result = JSON.parse(stdout) as { value?: T; error?: string };
          if (result.error) reject(new Error(result.error));
          else if (result.value === undefined) reject(new Error('Fab adapter returned no result.'));
          else accept(result.value);
        } catch { reject(new Error('Fab adapter returned an invalid response.')); }
      });
      child.stdin?.end(request);
    });
    const result = this.pending.then(run, run);
    this.pending = result.catch(() => undefined);
    return result;
  }

  private async brokerRequest<T>(broker: string, request: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(new URL('/api/fab', broker), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: request, signal: this.options.signal ? AbortSignal.any([this.options.signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000), redirect: 'error' });
    } catch { throw new Error('Fab authentication broker is unreachable. Start it on the Mac over Tailscale.'); }
    const result = await response.json() as { value?: T; error?: string };
    if (!response.ok || result.value === undefined) throw new Error(result.error ?? 'Fab authentication broker request failed.');
    return result.value;
  }

  listLibrary(): Promise<LibraryItem[]> { return this.run('library'); }
  sessionStatus(): Promise<{ signedIn: boolean }> { return this.run('session-status'); }
  secureSession(): Promise<boolean> { return this.run('session-secure'); }
  removeSession(): Promise<boolean> { return this.run('session-remove'); }
  listFormats(item: LibraryItem): Promise<AssetFormat[]> { return this.run('formats', item); }
  download(item: LibraryItem, formatId: string | undefined, destination: string): Promise<string> {
    if (!item.owned || item.source !== 'fab') return Promise.reject(new Error('Select an owned Fab item.'));
    return this.resolveDownload(item, formatId).then(descriptor => descriptor.kind === 'buildpatch' ? downloadBuildPatch(descriptor, resolve(destination), this.options.signal) : downloadDirect(descriptor, resolve(destination), this.options.signal));
  }
  resolveDownload(item: LibraryItem, formatId?: string): Promise<FabDownloadDescriptor> { return this.run('descriptor', item, formatId); }
  claimFree(_item: LibraryItem): Promise<void> {
    return Promise.reject(new Error('Free claims require confirmation of a specific item in Fab. Direct claim API is not verified; use the Fab website.'));
  }
}
