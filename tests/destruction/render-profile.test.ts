import { expect, it } from 'vitest';
import { RenderProfile } from '../../packages/cascade/src/render-profile';

it('exports real elapsed FPS, overlapping scopes and independent worker/GPU samples without inventing unavailable GPU time', () => {
  const profile = new RenderProfile();
  profile.reset(100);
  profile.record('workerMessageMs', 40);
  profile.frame(200, { frameIntervalMs: 100, callbackMs: 80, 'renderer.edgesMs': 60 }, { tick: 6 });
  profile.frame(1100, { frameIntervalMs: 900, callbackMs: 10, 'renderer.edgesMs': 0 }, { tick: 60 });
  const exported = JSON.parse(JSON.stringify(profile.export(1200, { gpuTimerSupported: false })));
  expect(exported.windows[0]).toMatchObject({ durationMs: 1000, frames: 2, fps: 2,
    metrics: { workerMessageMs: { count: 1, max: 40 }, callbackMs: { mean: 45, p95: 80 } } });
  expect(exported.windows[0].metrics.gpuMs).toBeUndefined();
  expect(exported.recentFrames[0]).toMatchObject({ tick: 6, atMs: 100, 'renderer.edgesMs': 60 });
  profile.record('gpuMs', 12);
  expect(profile.export(1250, {}).currentWindow.metrics).toHaveProperty('gpuMs');
  // Exporting does not erase the current window.
  expect(profile.export(1300, {}).currentWindow.metrics).toHaveProperty('gpuMs');
});

it('bounds capture memory, keeps chronological windows/frames, and clears the previous scene on reset', () => {
  const profile = new RenderProfile();
  profile.reset(0);
  for (let i = 1; i <= 3700; i++) {
    profile.frame(i * 1000, { frameIntervalMs: 1000 }, { tick: i });
    profile.event(i * 1000, 'command', { tick: i });
  }
  const exported = profile.export(3700100, {});
  expect(exported.windows).toHaveLength(600);
  expect(exported.recentFrames).toHaveLength(3600);
  expect(exported.events).toHaveLength(256);
  expect(exported.recentFrames[0]).toMatchObject({ tick: 101 });
  expect(exported.recentFrames.at(-1)).toMatchObject({ tick: 3700 });
  expect(exported.windows[0]).toMatchObject({ fromMs: 3100000 });
  profile.reset(4000000);
  const fresh = profile.export(4000100, {});
  expect(fresh.recentFrames).toEqual([]);
  expect(fresh.windows).toEqual([]);
  expect(fresh.events).toEqual([]);
  expect(fresh.currentWindow.metrics).toEqual({});
  expect(fresh.retention.totalFrames).toBe(0);
});
