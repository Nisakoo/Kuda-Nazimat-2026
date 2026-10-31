import { expect, it, vi } from 'vitest';
import { ChunkManager } from './ChunkManager';
import type { ChunkData, ChunkEntry, MapSource, WorldManifest } from './types';
import { BudgetExhausted } from './WorldBudget';

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
it('uses the authoritative saved position and retries deferred work only on release or explicit retry', async () => {
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
