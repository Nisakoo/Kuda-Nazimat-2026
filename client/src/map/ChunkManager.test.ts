import { expect, it, vi } from 'vitest';
import { ChunkManager } from './ChunkManager';
import type { ChunkData, ChunkEntry, MapSource, WorldManifest } from './types';
import { BudgetExhausted, WorldBudget } from './WorldBudget';

const manifest: WorldManifest = { mapId: 'test', version: 1, worldBytes: 1000000, chunkSize: 32, collisionResolution: 4, spawn: { x: 12, y: 0, z: 12 }, origin: { x: 0, z: 0 }, models: {}, assets: {}, chunks: Array.from({ length: 5 }, (_, x) => ({ id: String(x), x, z: 0, region: x === 0 ? 'A' : 'B', url: String(x), bytes: 10, collisionUrl: 'collision', collisionBytes: 16, assets: [] })) };
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };
function setup() {
  const pending = new Map<string, { resolve(data: ChunkData): void; reject(error: Error): void; signal: AbortSignal }>();
  const source: MapSource = { bootstrap: { manifestUrl: 'manifest', worldBytes: 1000000, manifestBytes: 100, assets: {} }, budgetEpoch: 0, manifest: async () => manifest, chunk: vi.fn((entry: ChunkEntry, signal: AbortSignal) => new Promise<ChunkData>((resolve, reject) => pending.set(entry.id, { resolve, reject, signal }))), dispose: vi.fn() };
  const view = { loadChunk: vi.fn(async () => {}), unloadChunk: vi.fn() };
  const manager = new ChunkManager(source, view);
  const data = (id: string): ChunkData => ({ entry: manifest.chunks[Number(id)]!, visual: { id, objects: [] }, collision: new Uint8Array(16), release: vi.fn() });
  return { manager, source, pending, view, data };
}
it('limits concurrency, ignores late results, and releases all owners on disposal', async () => {
  const s = setup();
  s.manager.setRadius(2);
  await s.manager.start();
  expect(s.pending.size).toBe(2);
  s.manager.plan({ x: 130, y: 0, z: 8 });
  expect(s.pending.get('0')!.signal.aborted).toBe(true);
  const old = s.data('0'); s.pending.get('0')!.resolve(old);
  await flush();
  expect(old.release).toHaveBeenCalledOnce();
  expect(s.view.loadChunk).not.toHaveBeenCalledWith(old.visual);
  expect(s.manager.stats.loading).toBeLessThanOrEqual(2);
  s.manager.dispose();
  for (const [id, item] of s.pending) if (id !== '0') item.resolve(s.data(id));
  await flush();
  expect(s.source.dispose).toHaveBeenCalledOnce();
  expect(s.manager.stats.loading).toBe(0);
});
it('blocks unprepared or colliding ground, prefetches radius-zero transitions and preserves regions', async () => {
  const s = setup(); s.manager.setRadius(0);
  await s.manager.start();
  expect(s.manager.canWalk(manifest.spawn)).toBe(false);
  const first = s.data('0'); first.collision[0] = 1;
  s.pending.get('0')!.resolve(first); await flush();
  expect(s.manager.canWalk(manifest.spawn)).toBe(true);
  expect(s.manager.canWalk({ x: 2, y: 0, z: 2 })).toBe(false);
  s.manager.plan({ x: 31, y: 0, z: 8 });
  expect(s.pending.has('1')).toBe(true);
  expect(s.manager.canWalk({ x: 32, y: 0, z: 8 })).toBe(false);
  s.pending.get('1')!.resolve(s.data('1')); await flush();
  expect(s.manager.canWalk({ x: 32, y: 0, z: 8 })).toBe(true);
  s.manager.plan({ x: 34, y: 0, z: 8 });
  expect(s.manager.region({ x: 34, y: 0, z: 8 })).toBe('B');
  expect(first.release).toHaveBeenCalledOnce();
  s.manager.dispose();
});
it('uses the authoritative saved position and does not spin on unchanged deferred work', async () => {
  const s = setup(); s.manager.setRadius(0);
  await s.manager.start({ x: 100, y: 0, z: 8 });
  expect([...s.pending.keys()]).toEqual(['3']);
  s.pending.get('3')!.reject(new BudgetExhausted()); await flush();
  s.manager.plan({ x: 100, y: 0, z: 8 });
  expect(s.source.chunk).toHaveBeenCalledOnce();
  expect(s.manager.stats.deferred).toBe(1);
  Object.defineProperty(s.source, 'budgetEpoch', { value: 1 });
  s.manager.plan({ x: 100, y: 0, z: 8 });
  expect(s.source.chunk).toHaveBeenCalledTimes(2);
  s.manager.dispose(); s.pending.get('3')!.reject(new Error('cancelled')); await flush();
});

it('prepares a newly preferred neighbor without retry and preserves the current footprint within budget', async () => {
  const budget = new WorldBudget(20);
  const chunks = [{ id: 'current', x: 0, z: 0 }, { id: 'east', x: 1, z: 0 }, { id: 'south', x: 0, z: 1 }]
    .map((entry) => ({ ...manifest.chunks[0]!, ...entry }));
  const source: MapSource = {
    bootstrap: { manifestUrl: 'manifest', worldBytes: 200, manifestBytes: 0, assets: {} },
    get budgetEpoch() { return budget.epoch; },
    manifest: async () => ({ ...manifest, chunks, spawn: { x: 28, y: 0, z: 10 } }),
    chunk: vi.fn(async (entry) => {
      const lease = budget.reserve(entry.id, 10, 10);
      return { entry, visual: { id: entry.id, objects: [] }, collision: new Uint8Array(16), release: lease.release };
    }),
    dispose: vi.fn(),
  };
  const view = { loadChunk: vi.fn(async () => {}), unloadChunk: vi.fn() };
  const manager = new ChunkManager(source, view);
  await manager.start(); await flush(); await flush();
  expect(manager.preparedChunks).toEqual(['current', 'east']);
  expect(manager.stats.deferred).toBe(1);
  const approach = { x: 10, y: 0, z: 31.7 };
  manager.plan(approach); await flush(); await flush();
  expect(manager.preparedChunks).toEqual(['current', 'south']);
  expect(manager.canWalk({ ...approach, z: 31.8 })).toBe(true);
  // Settle the budget release notification, then many stationary frames must do no work.
  manager.plan(approach); await flush(); await flush();
  const calls = vi.mocked(source.chunk).mock.calls.length;
  for (let i = 0; i < 60; i++) { manager.plan(approach); await flush(); }
  expect(source.chunk).toHaveBeenCalledTimes(calls);
  expect(view.unloadChunk).not.toHaveBeenCalledWith('current');
  expect(budget.stats.peakMemory).toBeLessThanOrEqual(budget.memoryLimit);
  // The player straddles both cells: neither may be evicted by other prefetches.
  manager.plan({ ...approach, z: 32 }); await flush(); await flush();
  expect(manager.canWalk({ ...approach, z: 32 })).toBe(true);
  expect(view.unloadChunk).not.toHaveBeenCalledWith('current');
  manager.plan({ x: 31.7, y: 0, z: 10 }); await flush(); await flush();
  expect(manager.preparedChunks).toEqual(['current', 'east']);
  expect(budget.stats.peakMemory).toBeLessThanOrEqual(budget.memoryLimit);
  manager.dispose();
  expect(budget.stats.resources).toBe(0);
});

it('reconsiders a deferred priority when a lower-priority pending visual finally becomes ready', async () => {
  const s = setup();
  await s.manager.start();
  s.pending.get('0')!.reject(new BudgetExhausted()); await flush();
  expect(s.manager.stats.deferred).toBe(1);
  // No position or budget epoch change: completion itself must allow the eviction.
  s.pending.get('1')!.resolve(s.data('1')); await flush();
  expect(s.view.unloadChunk).toHaveBeenCalledWith('1');
  expect(vi.mocked(s.source.chunk).mock.calls.filter(([entry]) => entry.id === '0')).toHaveLength(2);
  s.manager.dispose();
  for (const [id, item] of s.pending) item.resolve(s.data(id));
  await flush();
});

it('settles an oversized transition without repeatedly evicting affordable neighbors', async () => {
  const budget = new WorldBudget(20);
  const chunks = [{ id: 'current', x: 0, z: 0 }, { id: 'oversized', x: 1, z: 0 }, { id: 'south', x: 0, z: 1 }]
    .map(entry => ({ ...manifest.chunks[0]!, ...entry }));
  let attempts = 0;
  const source: MapSource = {
    bootstrap: { manifestUrl: 'manifest', worldBytes: 200, manifestBytes: 0, assets: {} },
    get budgetEpoch() { return budget.epoch; },
    manifest: async () => ({ ...manifest, chunks, spawn: { x: 28, y: 0, z: 10 } }),
    chunk: async entry => {
      if (++attempts > 30) throw new Error('Unbounded retries');
      const size = entry.id === 'oversized' ? 21 : 10;
      const lease = budget.reserve(entry.id, size, size);
      return { entry, visual: { id: entry.id, objects: [] }, collision: new Uint8Array(16), release: lease.release };
    },
    dispose: vi.fn(),
  };
  const manager = new ChunkManager(source, { async loadChunk() {}, unloadChunk() {} });
  await manager.start();
  for (let i = 0; i < 60; i++) { await flush(); manager.plan({ x: 28, y: 0, z: 10 }); }
  expect(manager.preparedChunks).toEqual(['current', 'south']);
  expect(manager.stats).toMatchObject({ loading: 0, deferred: 1, errors: [] });
  expect(attempts).toBeLessThan(10);
  const settled = attempts;
  for (let i = 0; i < 60; i++) { manager.plan({ x: 28, y: 0, z: 10 }); await flush(); }
  expect(attempts).toBe(settled);
  expect(budget.stats.peakMemory).toBeLessThanOrEqual(budget.memoryLimit);
  manager.dispose();
});

it('allows a fresh eviction after another resource owner releases previously unavailable budget', async () => {
  const budget = new WorldBudget(30);
  const otherOwner = budget.reserve('dynamic-model', 10, 10);
  const chunks = [{ id: 'current', x: 0, z: 0 }, { id: 'transition', x: 1, z: 0 }, { id: 'south', x: 0, z: 1 }]
    .map(entry => ({ ...manifest.chunks[0]!, ...entry }));
  const source: MapSource = {
    bootstrap: { manifestUrl: 'manifest', worldBytes: 300, manifestBytes: 0, assets: {} },
    get budgetEpoch() { return budget.epoch; },
    manifest: async () => ({ ...manifest, chunks, spawn: { x: 28, y: 0, z: 10 } }),
    chunk: async entry => {
      const size = entry.id === 'transition' ? 20 : 10;
      const lease = budget.reserve(entry.id, size, size);
      return { entry, visual: { id: entry.id, objects: [] }, collision: new Uint8Array(16), release: lease.release };
    },
    dispose: vi.fn(),
  };
  const manager = new ChunkManager(source, { async loadChunk() {}, unloadChunk() {} });
  await manager.start(); for (let i = 0; i < 10; i++) await flush();
  expect(manager.preparedChunks).toEqual(['current', 'south']);
  otherOwner.release();
  manager.plan({ x: 28, y: 0, z: 10 }); for (let i = 0; i < 10; i++) await flush();
  expect(manager.preparedChunks).toEqual(['current', 'transition']);
  expect(budget.stats.peakMemory).toBeLessThanOrEqual(budget.memoryLimit);
  manager.dispose();
});
