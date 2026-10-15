import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrikeClock, walkInput } from './walk-client';

afterEach(() => vi.useRealTimers());

describe('walk input', () => {
  it('maps movement and look to the worker contract', () => {
    const input = walkInput(new Set(['KeyW', 'KeyD', 'Space', 'ShiftLeft', 'KeyC']), Math.PI / 2, 0, 'cutter');
    expect(input).toMatchObject({ forward: 1, right: 1, jump: true, sprint: true, crouch: true, yaw: Math.PI / 2, tool: 'cutter' });
    expect(input.aim?.[0]).toBeCloseTo(-1);
    expect(input.aim?.[2]).toBeCloseTo(0);
  });
  it('releases opposing keys independently', () => {
    expect(walkInput(new Set(['KeyW', 'KeyS', 'KeyA']), 0, 0, 'hammer')).toMatchObject({ forward: 0, right: -1 });
  });
});

describe('strike clock', () => {
  it('contacts after windup and repeats only after recovery while held', () => {
    vi.useFakeTimers();
    let held = true;
    const contact = vi.fn();
    const clock = new StrikeClock(() => 'sledge', contact, () => held);
    expect(clock.start({ contactMs: 300, totalMs: 680 })).toBe(true);
    expect(clock.start({ contactMs: 300, totalMs: 680 })).toBe(false);
    vi.advanceTimersByTime(299);
    expect(contact).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(contact).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(680);
    expect(contact).toHaveBeenCalledTimes(2);
    held = false;
    clock.cancel();
  });
  it('drops the pending blow when the tool changes', () => {
    vi.useFakeTimers();
    let tool = 'sledge';
    const contact = vi.fn();
    const clock = new StrikeClock(() => tool, contact, () => false);
    clock.start({ contactMs: 300, totalMs: 680 });
    tool = 'cutter';
    clock.check();
    vi.runAllTimers();
    expect(contact).not.toHaveBeenCalled();
  });
});
