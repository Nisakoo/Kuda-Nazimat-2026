import { describe, expect, it, vi } from 'vitest';
import { GameLoop } from './GameLoop';
import type { FrameScheduler, LoopOptions } from './GameLoop';

function setup(options: LoopOptions = {}) {
  const frames = new Map<number, (timestamp: number) => void>();
  let serial = 0;
  const scheduler: FrameScheduler = {
    request: (callback) => { frames.set(++serial, callback); return serial; },
    cancel: (id) => { frames.delete(id); },
  };
  const calls: string[] = [];
  const callbacks = {
    beforeUpdate: vi.fn(() => { calls.push('input/commands'); }),
    update: vi.fn((_delta: number) => { calls.push('session/network'); }),
    afterUpdate: vi.fn(() => { calls.push('schedule-map'); }),
    render: vi.fn((_alpha: number, _elapsed: number) => { calls.push('sync/render'); }),
    onError: vi.fn(),
  };
  const loop = new GameLoop(scheduler, callbacks, options);
  const advance = (timestamp: number) => {
    const pending = [...frames.values()];
    frames.clear();
    for (const frame of pending) frame(timestamp);
  };
  return { loop, frames, callbacks, calls, advance };
}

describe('fixed-step GameLoop with controlled clocks', () => {
  it.each([30, 60, 120, 144])('performs the same simulation time at %s FPS', (fps) => {
    const { loop, callbacks, advance } = setup();
    loop.start();
    advance(0);
    for (let frame = 1; frame <= fps; frame++) advance(frame * 1000 / fps);
    expect(callbacks.update).toHaveBeenCalledTimes(60);
    expect(callbacks.update).toHaveBeenLastCalledWith(1 / 60);
    expect(callbacks.render).toHaveBeenCalledTimes(fps + 1);
    for (const [alpha] of callbacks.render.mock.calls) {
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
    loop.dispose();
  });

  it('preserves a fractional step and the input/session/map/render order', () => {
    const { loop, callbacks, advance, calls } = setup({ stepSeconds: 0.01 });
    loop.start();
    advance(0);
    calls.length = 0;
    advance(15);
    expect(calls).toEqual(['input/commands', 'session/network', 'schedule-map', 'sync/render']);
    expect(callbacks.render).toHaveBeenLastCalledWith(expect.closeTo(0.5), 0.015);
    loop.dispose();
  });

  it('bounds long frames and drops excess catch-up work instead of replaying it', () => {
    const { loop, callbacks, advance } = setup({ stepSeconds: 0.01, maxFrameSeconds: 0.1, maxStepsPerFrame: 3 });
    loop.start();
    advance(0);
    advance(100_000);
    expect(callbacks.update).toHaveBeenCalledTimes(3);
    callbacks.update.mockClear();
    advance(100_001);
    expect(callbacks.update).not.toHaveBeenCalled();
    loop.dispose();
  });

  it('does not accumulate hidden or stopped time and owns only one frame', () => {
    const { loop, frames, callbacks, advance } = setup();
    loop.start();
    loop.start();
    expect(frames.size).toBe(1);
    advance(0);
    advance(20);
    const before = callbacks.update.mock.calls.length;
    loop.setSuspended(true);
    expect(frames.size).toBe(0);
    advance(10_000);
    loop.setSuspended(false);
    loop.setSuspended(false);
    expect(frames.size).toBe(1);
    advance(20_000);
    expect(callbacks.update).toHaveBeenCalledTimes(before);
    loop.stop();
    loop.stop();
    expect(frames.size).toBe(0);
    loop.start();
    advance(40_000);
    expect(callbacks.update).toHaveBeenCalledTimes(before);
    loop.dispose();
    expect(frames.size).toBe(0);
    expect(() => loop.start()).toThrow('disposed');
  });

  it('stops and reports callback failures without leaving a frame', () => {
    const { loop, frames, callbacks, advance } = setup();
    callbacks.update.mockImplementation(() => { throw new Error('failed'); });
    loop.start();
    advance(0);
    advance(20);
    expect(callbacks.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'failed' }));
    expect(frames.size).toBe(0);
    expect(callbacks.render).toHaveBeenCalledTimes(1);
    loop.dispose();
  });

  it('honors stop during input without performing another update', () => {
    const { loop, frames, callbacks, advance } = setup();
    callbacks.beforeUpdate.mockImplementation(() => { loop.stop(); });
    loop.start();
    advance(0);
    advance(20);
    expect(callbacks.update).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
    loop.dispose();
  });

  it('does not wait for scheduled asynchronous work inside a frame', () => {
    const { loop, calls, callbacks, advance } = setup();
    callbacks.afterUpdate.mockImplementation(() => new Promise<void>(() => {}));
    loop.start();
    advance(0);
    calls.length = 0;
    advance(20);
    expect(calls.at(-1)).toBe('sync/render');
    expect(callbacks.onError).not.toHaveBeenCalled();
    loop.dispose();
  });

  it.each<LoopOptions>([{ stepSeconds: 0 }, { maxFrameSeconds: Infinity }, { maxStepsPerFrame: 0 }])('rejects invalid timing limits: %j', (options) => {
    expect(() => setup(options)).toThrow('limits');
  });
});
