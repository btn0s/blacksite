import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const vendor = dirname(fileURLToPath(import.meta.url));
const revision = 'f072e6efa75f4f61a290bd0b58b61c443685ec01';
const forkRevision = '1aa7b55e4dff84582335d20c8939b3c1db83c756';
const previousForkRevision = '1fa92269c0dc14e4dbe1d804f3854e20715de1fb';
const coreVersion = '0.30.1';
const coreArchiveSha256 = '5bd27b8eb36d0833fa0f2aea40164fabfad0fc34b9932286ae9e84f3452f5364';
const buildRoot = resolve(vendor, '../../artifacts/per-body-cost');
const packageRevision = '0.19.2-rupture.4';
const offline = process.argv.includes('--offline');
const skipPackage = process.argv.includes('--skip-package');
const sourceArg = process.argv.indexOf('--source');
const source = sourceArg < 0
  ? join(buildRoot, 'rapier.js')
  : resolve(process.argv[sourceArg + 1]);
const packageOnly = process.argv.includes('--package-only');
const builds = ['3d', '3d-simd'];
const localEnv = {
  TMPDIR: join(buildRoot, 'tmp'),
  npm_config_cache: join(buildRoot, 'npm-cache'),
  npm_config_logs_max: '0',
  ...(offline ? {
    CARGO_HOME: join(buildRoot, 'cargo-home'),
    CARGO_NET_OFFLINE: 'true',
    npm_config_offline: 'true',
    WASM_PACK_CACHE: join(buildRoot, 'wasm-pack-cache'),
  } : {}),
};
mkdirSync(localEnv.TMPDIR, { recursive: true });

// Offline builds copy cached inputs into the worktree before invoking tools.
// Native/cargo/npm/wasm-pack can then write only to these local build caches.
function seedOfflineCaches() {
  const copy = (from, to) => {
    if (existsSync(to)) return;
    if (!existsSync(from)) throw new Error(`Missing offline build input: ${from}`);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { recursive: true, mode: constants.COPYFILE_FICLONE });
  };
  for (const part of ['cache', 'index', 'src']) copy(
    join(homedir(), '.cargo', 'registry', part), join(localEnv.CARGO_HOME, 'registry', part));
  const wasmCache = process.env.WASM_PACK_CACHE ?? join(homedir(), 'Library', 'Caches', '.wasm-pack');
  copy(wasmCache, localEnv.WASM_PACK_CACHE);
  const lock = JSON.parse(readFileSync(join(source, 'rapier-compat/package-lock.json'), 'utf8'));
  for (const dependency of Object.values(lock.packages ?? {})) {
    if (!dependency.integrity) continue;
    const [algorithm, encoded] = dependency.integrity.split(' ')[0].split('-');
    const digest = Buffer.from(encoded, 'base64').toString('hex');
    const path = join('_cacache', 'content-v2', algorithm, digest.slice(0, 2), digest.slice(2, 4), digest.slice(4));
    copy(join(homedir(), '.npm', path), join(localEnv.npm_config_cache, path));
  }
}


function run(command, args, cwd = source, env = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...localEnv, ...env },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
}

function output(command, args, cwd = source) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, ...localEnv } });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

if (!existsSync(source)) {
  mkdirSync(dirname(source), { recursive: true });
  run('git', ['clone', '--no-checkout', 'https://github.com/dimforge/rapier.js.git', source], vendor);
  run('git', ['checkout', '--detach', revision]);
}
if ([revision, previousForkRevision].includes(output('git', ['rev-parse', 'HEAD']))) {
  run('git', ['fetch', join(vendor, 'rupture-bindings.bundle'), forkRevision]);
  run('git', ['checkout', '--detach', forkRevision]);
}
if (![revision, forkRevision].includes(output('git', ['rev-parse', 'HEAD']))) {
  throw new Error(`Expected Rapier.js revision ${revision}`);
}

if (!packageOnly) {
  const patch = join(vendor, 'applied-impulses.patch');
  // The pinned fork already commits this patch. Checking its reverse against
  // a checkout carrying additive bindings can fail on overlapping context.
  if (output('git', ['rev-parse', 'HEAD']) !== forkRevision) {
    const alreadyApplied = spawnSync('git', ['apply', '--reverse', '--check', patch], { cwd: source });
    if (alreadyApplied.status !== 0) run('git', ['apply', patch]);
  }
  const snapshotPatch = join(vendor, 'contact-snapshot.patch');
  const snapshotApplied = spawnSync('git', ['apply', '--reverse', '--check', snapshotPatch], { cwd: source });
  if (snapshotApplied.status !== 0) run('git', ['apply', snapshotPatch]);
  if (offline) seedOfflineCaches();

  // Rapier 0.30.1 exposes its persistent contact graph read-only. A tiny core
  // extension resets only warmstart state through safe mutable graph access.
  // Keep the registry source untouched and build this pinned local copy.
  const coreArchive = join(vendor, `rapier3d-${coreVersion}.crate`);
  if (createHash('sha256').update(readFileSync(coreArchive)).digest('hex') !== coreArchiveSha256) {
    throw new Error('Pinned Rapier core archive checksum mismatch');
  }
  const core = join(source, 'vendor', 'rapier3d');
  if (!existsSync(join(core, 'Cargo.toml'))) {
    mkdirSync(core, { recursive: true });
    run('tar', ['-xzf', coreArchive, '--strip-components=1', '-C', core]);
  }
  const corePatch = join(vendor, 'contact-warmstart.patch');
  const corePatched = spawnSync('git', ['apply', '--reverse', '--check',
    '--directory=vendor/rapier3d', corePatch], { cwd: source });
  if (corePatched.status !== 0) run('git', ['apply', '--directory=vendor/rapier3d', corePatch]);

  // The upstream workspace lock lists generated projects absent from a fresh
  // clone. Generate the two projects before restoring our complete pinned lock.
  run('cargo', ['run', '-p', 'prepare_builds', '--', '-d', 'dim3', '-f', 'non-deterministic'], source, {
    CARGO_TARGET_DIR: join(source, 'target'),
  });
  run(join(source, 'target/debug/prepare_builds'), ['-d', 'dim3', '-f', 'simd']);
  cpSync(join(vendor, 'Cargo.lock'), join(source, 'Cargo.lock'));
  run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], join(source, 'rapier-compat'));

  for (const build of builds) {
    run('wasm-pack', [
      'build', ...(offline ? ['--mode', 'no-install'] : []), '--target', 'web', '--out-dir',
      `../../rapier-compat/builds/${build}/wasm-build`, `builds/rapier${build}`, '--locked',
    ], source, {
      RUSTFLAGS: build.endsWith('simd') ? '-C target-feature=+simd128' : '',
      CARGO_TARGET_DIR: join(source, `target-rupture-${build}`),
    });
  }
}

function strip2d(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) {
      strip2d(path);
    } else if (item.name.endsWith('.ts')) {
      let discard = false;
      const lines = readFileSync(path, 'utf8').split('\n').filter((line) => {
        if (line.includes('#if DIM2')) discard = true;
        if (discard && line.includes('#endif')) { discard = false; return false; }
        return !discard;
      });
      writeFileSync(path, lines.join('\n'));
    }
  }
}

const compat = join(source, 'rapier-compat');
for (const build of builds) {
  const directory = join(compat, 'builds', build);
  const pkg = join(directory, 'pkg');
  const generated = join(directory, 'gen3d');
  mkdirSync(pkg, { recursive: true });
  cpSync(join(source, 'src.ts'), generated, { recursive: true });
  cpSync(join(compat, 'src3d'), generated, { recursive: true });
  strip2d(generated);
  for (const item of readdirSync(join(directory, 'wasm-build'))) {
    if (!item.startsWith('rapier_wasm')) continue;
    cpSync(join(directory, 'wasm-build', item), join(pkg, item));
  }
  const wasmJs = join(pkg, 'rapier_wasm3d.js');
  writeFileSync(wasmJs, readFileSync(wasmJs, 'utf8').replaceAll('import.meta.url', '"<deleted>"'));
  const tsconfig = JSON.parse(readFileSync(join(compat, 'tsconfig.common.json'), 'utf8'));
  // This standalone browser package must not load ambient @types from its
  // containing application's node_modules (which may require a newer TS).
  tsconfig.compilerOptions.types = [];
  writeFileSync(join(directory, 'tsconfig.common.json'), `${JSON.stringify(tsconfig, null, 2)}\n`);
  cpSync(join(compat, 'tsconfig.json'), join(directory, 'tsconfig.json'));
  cpSync(join(compat, 'tsconfig.pkg3d.json'), join(directory, 'tsconfig.pkg.json'));
}

// Use the upstream bundler and pinned npm lock, restricted to the two required
// compatibility packages; this retains the existing default/ESM/CJS APIs.
const config = readFileSync(join(compat, 'rollup.config.js'), 'utf8')
  .replace(/export default \[[\s\S]*?\];\s*$/, 'export default [config("3d", "3d"), config("3d", "3d-simd")];\n');
writeFileSync(join(compat, 'rollup-rupture.config.js'), config);
run('npm', ['exec', '--', 'rollup', '--config', 'rollup-rupture.config.js', '--bundleConfigAsCjs'], compat);

for (const build of builds) {
  const pkg = join(compat, 'builds', build, 'pkg');
  const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
  // Keep upstream peer compatibility; the local file pin identifies our fork.
  manifest.version = '0.19.2';
  manifest.rupture = {
    packageRevision,
    revision,
    forkRevision,
    patch: 'applied-impulses.patch',
    coreVersion,
    coreArchiveSha256,
    corePatch: 'contact-warmstart.patch',
    contactSnapshotPatch: 'contact-snapshot.patch',
    contactSnapshotPatchSha256: createHash('sha256').update(readFileSync(join(vendor, 'contact-snapshot.patch'))).digest('hex'),
    rust: output('rustc', ['--version']),
    wasmPack: output('wasm-pack', ['--version']),
  };
  writeFileSync(join(pkg, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(join(pkg, 'raw.d.ts'), 'export * from "./rapier_wasm3d";\n');
  cpSync(join(source, 'LICENSE'), join(pkg, 'LICENSE'));
  cpSync(join(source, 'README.md'), join(pkg, 'README.md'));
  if (!skipPackage) {
    const packed = JSON.parse(output('npm', ['pack', '--json', '--pack-destination', vendor], pkg));
    renameSync(join(vendor, packed[0].filename), join(vendor, `rapier${build}-compat-${packageRevision}.tgz`));
  }
}
console.log(`Built Rapier scalar and SIMD ${skipPackage ? 'outputs (tarballs skipped)' : 'packages'} from ${revision}`);
