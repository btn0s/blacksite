import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const games = new Set<string>();
const platforms = new Set(['ai-schema', 'sim-core', 'client-r3f', 'input', 'ui', 'look', 'materials']);
const cognition = new Set(['ai-belief', 'ai-tactics', 'ai-nav', 'ai-planning', 'ai-squad', 'ai-execution', 'ai-motor', 'ai-policy']);
async function files(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(resolve(path, entry.name)) : /\.tsx?$/.test(entry.name) ? [resolve(path, entry.name)] : []))).flat();
}
export async function checkBoundaries(root = resolve('packages')): Promise<string[]> {
  const violations: string[] = [];
  const packages = new Set((await readdir(root, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name));
  for (const file of await files(root)) {
    const owner = relative(root, file).split('/')[0];
    const source = await readFile(file, 'utf8');
    const imports = [...source.matchAll(/(?:from\s*|import\s*\(|import\s*)['"]([^'"]+)['"]/g)].map(match => match[1]);
    for (const specifier of imports) {
      const dependency = specifier.startsWith('@blacksite/') ? specifier.slice('@blacksite/'.length).split('/')[0] : specifier.startsWith('.') ? relative(root, resolve(file, '..', specifier)).split('/')[0] : undefined;
      if (!dependency || dependency === owner || !packages.has(dependency)) continue;
      if ((games.has(dependency) && !games.has(owner)) || (platforms.has(owner) && !platforms.has(dependency))) {
        violations.push(`${relative(root, file)} imports forbidden ${dependency}`);
        continue;
      }
      if (owner === 'ai-schema' || (owner === 'client-r3f' && dependency !== 'ai-schema')
        || (cognition.has(owner) && ['sim-core', 'ai-runtime', 'server', 'client-r3f', 'ai-worker', 'ai-services', 'subject'].includes(dependency))) {
        violations.push(`${relative(root, file)} imports forbidden ${dependency}`);
      }
    }
    if (cognition.has(owner) && /(?:Date\.now\(|Math\.random\(|performance\.now\()/.test(source)) violations.push(`${relative(root, file)} uses an uncontrolled clock or RNG in cognition`);
  }
  return violations;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const violations = await checkBoundaries();
  if (violations.length) { console.error(violations.join('\n')); process.exitCode = 1; }
  else console.log('Package boundaries and deterministic cognition checks passed.');
}
