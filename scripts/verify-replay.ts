import { readFile } from 'node:fs/promises';
import { verifyReplay } from '@blacksite/ai-runtime';
if (!process.argv[2]) throw new Error('Usage: corepack pnpm replay:verify -- path/to/replay.json');
const result = verifyReplay(JSON.parse(await readFile(process.argv[2], 'utf8')));
console.log(JSON.stringify(result, null, 2));
if (!result.valid) process.exitCode = 1;
