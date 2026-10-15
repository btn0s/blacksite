import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'protocol.file.allow=always', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const initialize = (directory: string) => { mkdirSync(directory, { recursive: true }); git(directory, 'init'); git(directory, 'config', 'user.name', 'Fixture'); git(directory, 'config', 'user.email', 'fixture@example.invalid'); };

it('scaffolds unpublished nested pins from the supplied local checkout', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'blacksite-scaffold-'));
  try {
    const upstream = path.join(scratch, 'upstream');
    const source = path.join(scratch, 'source');
    const game = path.join(scratch, 'game');
    initialize(upstream);
    writeFileSync(path.join(upstream, 'mesh.glb'), 'initial');
    git(upstream, 'add', '.');
    git(upstream, 'commit', '-m', 'Initial');
    initialize(source);
    git(source, 'submodule', 'add', pathToFileURL(upstream).href, 'vendor/als-web');
    const localAls = path.join(source, 'vendor/als-web');
    git(localAls, 'config', 'user.name', 'Fixture');
    git(localAls, 'config', 'user.email', 'fixture@example.invalid');
    writeFileSync(path.join(localAls, 'mesh.glb'), 'unpublished');
    git(localAls, 'add', '.');
    git(localAls, 'commit', '-m', 'Local arms');
    const pin = git(localAls, 'rev-parse', 'HEAD');
    git(source, 'add', '.');
    git(source, 'commit', '-m', 'Pin local ALS');
    initialize(game);
    const helper = pathToFileURL(path.resolve('cli/scaffold-git.mjs')).href;
    execFileSync(process.execPath, ['--input-type=module', '--eval', `import { initializeSubmodule } from ${JSON.stringify(helper)}; await initializeSubmodule(process.argv[1], process.argv[2], 'vendor/blacksite');`, game, pathToFileURL(source).href], { stdio: ['ignore', 'pipe', 'pipe'] });
    const installed = path.join(game, 'vendor/blacksite');
    expect(git(path.join(installed, 'vendor/als-web'), 'rev-parse', 'HEAD')).toBe(pin);
    expect(readFileSync(path.join(installed, '.gitmodules'), 'utf8')).toBe(readFileSync(path.join(source, '.gitmodules'), 'utf8'));
    expect(git(installed, 'status', '--porcelain')).toBe('');
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});

it('ships MIT ALS assets alongside game manifests without replacing game overrides', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'blacksite-public-'));
  try {
    const assets = path.join(scratch, 'vendor/blacksite/vendor/als-web/public/assets');
    const actionAssets = path.join(scratch, 'vendor/blacksite/packages/subject-fpp/assets');
    const output = path.join(scratch, 'dist/assets');
    mkdirSync(assets, { recursive: true });
    mkdirSync(actionAssets, { recursive: true });
    mkdirSync(output, { recursive: true });
    writeFileSync(path.join(assets, 'skm-als.glb'), 'MIT mannequin');
    writeFileSync(path.join(assets, 'arms.json'), 'engine defaults');
    writeFileSync(path.join(output, 'arms.json'), 'game overrides');
    writeFileSync(path.join(actionAssets, 'LICENSE'), 'MIT original arms actions');
    const helper = pathToFileURL(path.resolve('cli/serve-assets.mjs')).href;
    execFileSync(process.execPath, ['--input-type=module', '--eval', `import { blacksiteAssets } from ${JSON.stringify(helper)}; const plugin = blacksiteAssets(); plugin.configResolved({root:process.argv[1],publicDir:process.argv[1]+'/public',build:{outDir:'dist'}}); await plugin.writeBundle();`, scratch]);
    expect(readFileSync(path.join(output, 'skm-als.glb'), 'utf8')).toBe('MIT mannequin');
    expect(readFileSync(path.join(output, 'arms.json'), 'utf8')).toBe('game overrides');
    expect(readFileSync(path.join(output, 'LICENSE-Blacksite-Arms.md'), 'utf8')).toBe('MIT original arms actions');
    execFileSync(process.execPath, ['--input-type=module', '--eval', `
      import { createServer } from 'node:http';
      import { blacksiteAssets } from ${JSON.stringify(helper)};
      const plugin = blacksiteAssets();
      plugin.configResolved({root:process.argv[1],publicDir:process.argv[1]+'/public',build:{outDir:'dist'}});
      let middleware;
      plugin.configureServer({middlewares:{use(value){middleware=value}}});
      const server = createServer((request,response)=>middleware(request,response,()=>{response.statusCode=404;response.end()}));
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
      try {
        const response = await fetch('http://127.0.0.1:'+server.address().port+'/assets/LICENSE-Blacksite-Arms.md', {headers:{Connection:'close'}});
        if (!response.ok || await response.text() !== 'MIT original arms actions') throw new Error('Missing served action license');
      } finally { await new Promise(resolve=>server.close(resolve)); }
    `, scratch]);
  } finally { rmSync(scratch, { recursive: true, force: true }); }
});
