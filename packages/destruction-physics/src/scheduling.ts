import { FIXED_DT } from '../../destruction-domain/src/index';

export function advanceBudgeted(
  accumulator: number,
  advance: () => boolean,
  now: () => number,
  dt = FIXED_DT,
): { dropped: number; remainder: number; steps: number } {
  const started = now();
  let steps = 0;
  while (accumulator >= dt && steps < 2) {
    accumulator -= dt;
    steps++;
    if (!advance()) {
      return { dropped: 0, remainder: 0, steps };
    }
    if (now() - started >= 8) {
      break;
    }
  }
  const dropped = Math.floor(accumulator / dt);
  return { dropped, remainder: accumulator % dt, steps };
}

export function nextSnapshotDeadline(deadline: number, now: number, period = 1000 / 30): number {
  return deadline + (Math.floor(Math.max(0, now - deadline) / period) + 1) * period;
}
