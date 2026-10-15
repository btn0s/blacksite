import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, copyFile, cp, lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
type AssetJob = { stage: 'queued' | 'fetching' | 'extracting' | 'exporting' | 'optimizing' | 'installing' | 'complete' | 'failed' };
type LibraryItem = { id: string; source: string; title: string; owned: boolean };
type ProjectManifest = { version: 1; assets: Array<{ id: string; title: string; source: string; url: string; sha256: string; installedAt: string }> };
import { extractZip } from './archive.js';

export interface PipelineOptions { projectDir: string; scriptsDir: string; runtimeDir?: string; signal?: AbortSignal; encodeTexture: (image: Uint8Array, options: { srgb: boolean; normal: boolean }) => Promise<Uint8Array>; }
export type Progress = (stage: AssetJob['stage'], progress: number, message: string) => void;
const exists = async (path: string): Promise<boolean> => { try { await access(path); return true; } catch { return false; } };

function safePath(path: string): string {
  if (!isAbsolute(path)) throw new Error('An absolute host path is required');
  const resolved = resolve(path);
  const configRoot = process.env.BLACKSITE_CONFIG_DIR ? resolve(process.env.BLACKSITE_CONFIG_DIR) : undefined;
  const restricted = resolved.split(/[\\/]/).some((part) => /login|token|secret|key|credential/i.test(part) || (part.startsWith('.') && !['.cache', '.local', '.bb'].includes(part)));
  if (restricted || (configRoot && (resolved === configRoot || resolved.startsWith(`${configRoot}${sep}`)))) throw new Error('Restricted paths cannot be used by the asset pipeline');
  return resolved;
}

async function existingPath(path: string): Promise<string> { return safePath(await realpath(safePath(path))); }

async function projectDirectory(path: string): Promise<string> {
  const project = await existingPath(path);
  if (!(await stat(project)).isDirectory()) throw new Error('The target project directory does not exist');
  for (const child of ['public', join('public', 'assets')]) {
    const target = join(project, child);
    await mkdir(target, { recursive: true });
    if (await existingPath(target) !== target) throw new Error('Project asset directories cannot be symbolic links');
  }
  return project;
}

export async function filesUnder(root: string, extension: string[], depth = 0): Promise<string[]> {
  if (depth > 14) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const rows = await Promise.all(entries.filter((entry) => !/(login|token|secret|key|credential)/i.test(entry.name) && !entry.name.startsWith('.env')).map(async (entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return filesUnder(path, extension, depth + 1);
    return entry.isFile() && extension.includes(extname(entry.name).toLowerCase()) ? [path] : [];
  }));
  return rows.flat().sort();
}

async function run(command: string, args: string[], options: { cwd?: string; timeout?: number; env?: NodeJS.ProcessEnv; signal?: AbortSignal } = {}): Promise<void> {
  await new Promise<void>((accept, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: 'ignore', ...options });
    child.once('error', () => reject(new Error('Required conversion tool is unavailable')));
    child.once('exit', (code) => code === 0 ? accept() : reject(new Error(`Asset conversion failed with exit code ${code ?? 'unknown'}`)));
  });
}

async function validateResources(path: string): Promise<void> {
  const data = await readFile(path);
  let json: { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
  if (extname(path).toLowerCase() === '.glb') {
    if (data.length < 20 || data.toString('ascii', 0, 4) !== 'glTF' || data.readUInt32LE(4) !== 2 || data.readUInt32LE(16) !== 0x4e4f534a) throw new Error('Downloaded file is not a valid glTF 2 GLB');
    json = JSON.parse(data.toString('utf8', 20, 20 + data.readUInt32LE(12)).trim());
  } else json = JSON.parse(data.toString('utf8'));
  const root = await realpath(dirname(path));
  for (const reference of [...(json.buffers ?? []), ...(json.images ?? [])]) {
    if (!reference.uri || reference.uri.startsWith('data:')) continue;
    const uri = decodeURIComponent(reference.uri);
    if (isAbsolute(uri) || uri.includes(':') || uri.includes('\\') || uri.split('/').some((part) => part === '..' || /(login|token|secret|key|credential)/i.test(part) || part.startsWith('.env'))) throw new Error('Model references an unsafe external resource');
    const resource = await realpath(resolve(root, uri));
    if (!resource.startsWith(`${root}${sep}`)) throw new Error('Model resource escapes its asset folder');
  }
}

async function exportUnreal(source: string, scratch: string, progress: Progress, options: PipelineOptions): Promise<string> {
  let unreal = process.env.UNREAL_EDITOR_CMD ?? '';
  if (!unreal && process.platform === 'win32') {
    for (const version of ['5.8', '5.7']) {
      const candidate = `C:\\Program Files\\Epic Games\\UE_${version}\\Engine\\Binaries\\Win64\\UnrealEditor-Cmd.exe`;
      if (await exists(candidate)) { unreal = candidate; break; }
    }
  }
  if (!unreal || !await exists(unreal)) throw new Error('UE pack downloaded. UnrealEditor-Cmd is required to export this asset.');
  const contentCandidates = [join(source, 'Content'), join(source, 'data', 'Content')];
  const folders = await readdir(source, { withFileTypes: true });
  for (const entry of folders.filter((entry) => entry.isDirectory())) contentCandidates.push(join(source, entry.name, 'Content'));
  let content: string | undefined;
  for (const candidate of contentCandidates) if (await exists(candidate)) { content = candidate; break; }
  if (!content) throw new Error('UE pack has no Content folder. Add it to a project in the Epic launcher, then retry with that Content pack.');
  progress('exporting', 48, 'Exporting a mesh with UnrealEditor-Cmd · nullrhi');
  const project = join(scratch, 'unreal');
  await mkdir(project, { recursive: true });
  await cp(content, join(project, 'Content'), { recursive: true, filter: async (path) => !relative(content, path).split(sep).some((part) => /login|token|secret|key|credential/i.test(part) || part.startsWith('.env')) && !(await lstat(path)).isSymbolicLink() });
  const projectFile = join(project, 'FabExport.uproject');
  await writeFile(projectFile, JSON.stringify({ FileVersion: 3, Plugins: [{ Name: 'PythonScriptPlugin', Enabled: true }, { Name: 'EditorScriptingUtilities', Enabled: true }, { Name: 'GLTFExporter', Enabled: true }] }));
  const script = join(options.scriptsDir, 'export-unreal.py');
  await run(unreal, [projectFile, '-run=pythonscript', `-script=${script}`, '-unattended', '-nullrhi', '-nosplash', '-nosound'], { cwd: project, timeout: 20 * 60_000, signal: options.signal });
  const exports = await filesUnder(join(project, 'exports'), ['.glb']);
  if (!exports[0]) throw new Error('UE export completed without a GLB; this pack needs a project-specific exporter');
  return exports[0];
}

async function convertModel(source: string, scratch: string, progress: Progress, options: PipelineOptions): Promise<string> {
  let blender = process.env.BLENDER_BIN ?? '';
  const candidates = process.platform === 'win32'
    ? ['4.5', '4.4', '4.3', '4.2', '5.0'].map((version) => `C:\\Program Files\\Blender Foundation\\Blender ${version}\\blender.exe`)
    : ['/Applications/Blender.app/Contents/MacOS/Blender', '/usr/bin/blender'];
  if (!blender) for (const candidate of candidates) if (await exists(candidate)) { blender = candidate; break; }
  if (!blender || !await exists(blender)) throw new Error('FBX/USD downloaded. An existing Blender install is required to convert it to GLB. Set BLENDER_BIN.');
  progress('exporting', 50, 'Converting the model and textures with Blender');
  const output = join(scratch, 'converted.glb');
  const script = join(options.scriptsDir, 'convert-model.py');
  await run(blender, ['--background', '--factory-startup', '--disable-autoexec', '--python', script, '--', source, output], { cwd: scratch, timeout: 20 * 60_000, signal: options.signal });
  if (!await exists(output)) throw new Error('Blender completed without an exported GLB');
  return output;
}

export async function installAsset(item: LibraryItem, source: string, scratch: string, progress: Progress, manifest: ProjectManifest, options: PipelineOptions): Promise<ProjectManifest> {
  if (!item.owned || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,149}$/.test(item.id)) throw new Error('Only owned assets with valid IDs may be installed');
  const projectDir = await projectDirectory(options.projectDir);
  source = await existingPath(source);
  scratch = await existingPath(scratch);
  const runtimeRequire = createRequire(options.runtimeDir ? join(options.runtimeDir, 'package.json') : import.meta.url);
  const { NodeIO } = runtimeRequire('@gltf-transform/core') as typeof import('@gltf-transform/core');
  const { ALL_EXTENSIONS, KHRTextureBasisu } = runtimeRequire('@gltf-transform/extensions') as typeof import('@gltf-transform/extensions');
  const { dedup, meshopt, prune, weld } = runtimeRequire('@gltf-transform/functions') as typeof import('@gltf-transform/functions');
  const { MeshoptDecoder, MeshoptEncoder } = runtimeRequire('meshoptimizer') as typeof import('meshoptimizer');
  options.signal?.throwIfAborted();
  let model = source;
  const info = await stat(source);
  if (extname(source).toLowerCase() === '.zip') {
    progress('extracting', 30, 'Extracting downloaded archive');
    model = join(scratch, 'extracted');
    await mkdir(model, { recursive: true });
    await extractZip(source, model);
  }
  if (info.isDirectory() || extname(source).toLowerCase() === '.zip') {
    const candidates = await filesUnder(model, ['.glb', '.gltf']);
    if (candidates.length) model = candidates.find((candidate) => extname(candidate).toLowerCase() === '.glb') ?? candidates[0];
    else {
      const convertible = await filesUnder(model, ['.fbx', '.usd', '.usda', '.usdc', '.usdz']);
      if (convertible.length) model = await convertModel(convertible.find((candidate) => /_LOD0\.fbx$/i.test(candidate)) ?? convertible[0], scratch, progress, options);
      else model = await exportUnreal(model, scratch, progress, options);
    }
  }
  if (['.fbx', '.usd', '.usda', '.usdc', '.usdz'].includes(extname(model).toLowerCase())) model = await convertModel(model, scratch, progress, options);
  if (!['.glb', '.gltf'].includes(extname(model).toLowerCase())) throw new Error('This file needs conversion. Download GLB/glTF, FBX/USD, a ZIP containing one, or a UE Content pack.');
  await validateResources(model);
  progress('optimizing', 66, 'Optimizing glTF geometry with meshopt');
  await MeshoptEncoder.ready;
  await MeshoptDecoder.ready;
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  const document = await io.read(model);
  await document.transform(dedup(), prune(), weld(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  const textures = document.getRoot().listTextures();
  let compressedCount = 0;
  if (!process.env.HOMED_GLTF_TRANSFORM) {
    for (const texture of textures) {
      const image = texture.getImage();
      if (!image || texture.getMimeType() === 'image/ktx2') continue;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(texture.getMimeType())) throw new Error('Unsupported texture encoding; export PNG or JPEG textures first');
      progress('optimizing', 72, 'Encoding KTX2 textures with Basis Universal');
      const materials = document.getRoot().listMaterials();
      const srgb = materials.some((material) => material.getBaseColorTexture() === texture || material.getEmissiveTexture() === texture);
      const normal = materials.some((material) => material.getNormalTexture() === texture);
      const bytes = await options.encodeTexture(image, { srgb, normal });
      texture.setImage(bytes).setMimeType('image/ktx2');
      compressedCount++;
    }
    if (compressedCount) document.createExtension(KHRTextureBasisu).setRequired(true);
  }
  const optimized = join(scratch, 'optimized.glb');
  await io.write(optimized, document);
  let finalModel = optimized;
  let textureNote = compressedCount ? `Meshopt + KTX2 ready · ${compressedCount} textures` : textures.length ? 'Meshopt ready; KTX2 textures retained' : 'Meshopt ready · no image textures in this model';
  if (process.env.HOMED_GLTF_TRANSFORM) {
    const compressed = join(scratch, 'compressed.glb');
    progress('optimizing', 80, 'Encoding KTX2 textures with gltf-transform');
    await run(process.env.HOMED_GLTF_TRANSFORM, ['etc1s', optimized, compressed, '--quality', '128'], { timeout: 10 * 60_000, signal: options.signal });
    finalModel = compressed;
    textureNote = 'Meshopt + KTX2 ready';
  }
  options.signal?.throwIfAborted();
  progress('installing', 90, 'Installing into the game project');
  const output = join(projectDir, 'public', 'assets', item.id);
  await mkdir(output, { recursive: true });
  if (await existingPath(output) !== output) throw new Error('Asset destination cannot be a symbolic link');
  const hash = createHash('sha256').update(await readFile(finalModel)).digest('hex');
  const filename = `model-${hash.slice(0, 12)}.glb`;
  const temporary = join(output, `.asset-${randomUUID()}.partial`);
  try {
    await copyFile(finalModel, temporary, constants.COPYFILE_EXCL);
    options.signal?.throwIfAborted();
    await rename(temporary, join(output, filename));
  } finally { await rm(temporary, { force: true }); }
  const installed = { id: item.id, title: item.title, source: item.source, url: `/assets/${item.id}/${filename}`, sha256: hash, installedAt: new Date().toISOString() };
  const next: ProjectManifest = { version: 1, assets: [...manifest.assets.filter((asset) => asset.id !== item.id), installed] };
  const data = JSON.stringify(next, null, 2);
  for (const target of [join(projectDir, 'assets.lock.json'), join(projectDir, 'public', 'assets.lock.json')]) {
    const temporaryManifest = join(dirname(target), `.manifest-${randomUUID()}.partial`);
    try { await writeFile(temporaryManifest, data, { flag: 'wx' }); await rename(temporaryManifest, target); }
    finally { await rm(temporaryManifest, { force: true }); }
  }
  progress('complete', 100, textureNote);
  return next;
}
