import { describe, expect, it } from "vitest";
import {
  advanceBudgeted,
  nextSnapshotDeadline,
} from "../../packages/destruction-physics/src/scheduling";
import { FIXED_DT } from "../../packages/destruction-domain/src";

describe("worker responsiveness", () => {
  it("yields after one expensive tick instead of blocking input for an eight-tick catch-up", () => {
    let wallTime = 0;
    const ticks: number[] = [];
    const result = advanceBudgeted(
      0.2,
      () => {
        wallTime += 25;
        ticks.push(ticks.length + 1);
        return true;
      },
      () => wallTime,
    );
    expect(ticks).toEqual([1]);
    expect(wallTime).toBe(25);
    expect(result.steps).toBe(1);
    expect(result.remainder).toBeLessThan(FIXED_DT);
    expect(result.dropped).toBeGreaterThan(0);
  });
  it("bounds fast catch-up too, and immediately stops at a replay endpoint", () => {
    let ticks = 0;
    const result = advanceBudgeted(
      FIXED_DT * 8,
      () => {
        ticks++;
        return true;
      },
      () => 0,
    );
    expect(ticks).toBe(2);
    expect(result.dropped).toBe(6);
    const stopped = advanceBudgeted(
      FIXED_DT * 8,
      () => false,
      () => 0,
    );
    expect(stopped).toEqual({ steps: 1, remainder: 0, dropped: 0 });
  });
  it("keeps a 30Hz deadline aligned when steps finish late, without accumulating timer drift", () => {
    let deadline = 1000 / 30;
    const emitted: number[] = [];
    for (let time = 8; time <= 1000; time += 8) {
      const afterStep = time + 4;
      if (afterStep >= deadline) {
        emitted.push(afterStep);
        deadline = nextSnapshotDeadline(deadline, afterStep);
      }
    }
    expect(emitted).toHaveLength(30);
    expect(nextSnapshotDeadline(100, 205)).toBeCloseTo(233.3333, 3);
  });
});
