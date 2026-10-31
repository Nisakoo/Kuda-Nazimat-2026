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
