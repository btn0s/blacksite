import { readFile, stat } from 'node:fs/promises';
import { expect, it } from 'vitest';

it('lists source packages and ALS in the pnpm workspace', async () => {
  const workspace = await readFile('pnpm-workspace.yaml', 'utf8');
  expect(workspace).toContain('packages/*');
  expect(workspace).toContain('vendor/als-web');
  expect((await stat('vendor/als-web/src/app/AlsPlayer.ts')).isFile()).toBe(true);
});
