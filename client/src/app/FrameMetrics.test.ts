import { expect, it } from 'vitest';
import { FrameMetrics } from './FrameMetrics';

it('measures cadence separately from CPU cost and drops history across a pause', () => {
  const metrics = new FrameMetrics();
  for (let i = 0; i <= 60; i++) metrics.record(i * 1000 / 60, 2);
  expect(metrics.stats.fps).toBeCloseTo(60); expect(metrics.stats.renderMs).toBe(2);
  expect(metrics.stats.p95).toBeCloseTo(1000 / 60);
  metrics.reset(); metrics.record(100000, 2); metrics.record(100020, 2);
  expect(metrics.stats.fps).toBe(50);
});

it('reports submitted cadence instead of the loop, including a fully stalled GPU', () => {
  const metrics = new FrameMetrics();
  for (let i = 0; i <= 120; i++) metrics.record(i * 1000 / 60, 2, i % 2 === 0);
  expect(metrics.stats.fps).toBeCloseTo(30);
  expect(metrics.stats.loopFps).toBeCloseTo(60);
  expect(metrics.stats.p95).toBeCloseTo(1000 / 30);
  expect(metrics.stats.skipped).toBe(60);
  for (let i = 121; i <= 800; i++) metrics.record(i * 1000 / 60, .1, false);
  expect(metrics.stats.fps).toBe(0);
  expect(metrics.stats.skipped).toBe(600);
  expect(metrics.stats.p95).toBeGreaterThan(10000);
  metrics.reset(); metrics.record(20000, 1); metrics.record(20020, 1);
  expect(metrics.stats.fps).toBe(50); expect(metrics.stats.skipped).toBe(0);
});

it('plots one-second submissions, including zero FPS, bounds the minute and resets the bucket', () => {
  const metrics = new FrameMetrics();
  for (let i = 0; i <= 100; i++) metrics.record(i * 10, 1, i % 2 === 0);
  expect(metrics.history).toEqual([{ at: 1000, fps: 50 }]);
  for (let i = 101; i <= 200; i++) metrics.record(i * 10, 1, false);
  expect(metrics.history.at(-1)).toEqual({ at: 2000, fps: 0 });
  for (let i = 201; i <= 6500; i++) metrics.record(i * 10, 1);
  expect(metrics.history).toHaveLength(60);
  expect(metrics.history[0]!.at).toBe(6000);
  expect(metrics.history.at(-1)).toEqual({ at: 65000, fps: 100 });
  metrics.reset(); expect(metrics.history).toEqual([]);
  metrics.record(100000, 1); metrics.record(100500, 1);
  expect(metrics.history).toEqual([]);
});
