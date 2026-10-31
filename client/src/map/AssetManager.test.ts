import { expect, it, vi } from 'vitest';
import { AssetManager, HttpAssetSource } from './AssetManager';
import { WorldBudget } from './WorldBudget';

it('deduplicates in-flight data and keeps the budget until a decoder releases its lease', async () => {
  let resolve!: (data: ArrayBuffer) => void;
  const load = vi.fn(() => new Promise<ArrayBuffer>((done) => { resolve = done; }));
  const budget = new WorldBudget(1000);
  const assets = new AssetManager({ resolve: (path) => path, load }, budget, () => ({ bytes: 60, memory: 80 }));
  const a = assets.acquire('model'); const b = assets.acquire('model');
  await Promise.resolve();
  expect(budget.stats.bytes).toBe(60);
  resolve(new ArrayBuffer(60));
  const [first, second] = await Promise.all([a, b]);
  expect(load).toHaveBeenCalledTimes(1);
  assets.dispose(); first.release();
  expect(budget.stats.bytes).toBe(60);
  second.release();
  expect(budget.stats.bytes).toBe(0);
});
it('rejects oversized or unknown resources and restores reservations on error', async () => {
  const budget = new WorldBudget(1000);
  const source = { resolve: (path: string) => path, load: vi.fn(async () => new ArrayBuffer(61)) };
  const assets = new AssetManager(source, budget, (url) => url === 'known' ? { bytes: 60, memory: 60 } : undefined);
  await expect(assets.acquire('unknown')).rejects.toThrow('Unknown');
  await expect(assets.acquire('known')).rejects.toThrow('size');
  expect(source.load).toHaveBeenCalledTimes(1);
  expect(budget.stats.bytes).toBe(0);
});
it('confines URLs to the configured HTTP source', () => {
  const source = new HttpAssetSource('http://school.local/world/');
  expect(source.resolve('./a.glb')).toBe('http://school.local/world/a.glb');
  for (const path of ['../secret', '//remote.test/model', 'https://school.local/world/a', 'http://user:pass@school.local/world/a']) expect(() => source.resolve(path)).toThrow();
});
it('requires server credentials for protected HTTP and reports expiry without a public fallback', async () => {
  const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 401 }));
  const access = { token: vi.fn((): string | null => null), unauthorized: vi.fn() };
  const source = new HttpAssetSource('http://school.local/world/', access);
  try {
    await expect(source.load(source.resolve('a.glb'), new AbortController().signal)).rejects.toThrow('сессия');
    expect(fetcher).not.toHaveBeenCalled();
    access.token.mockReturnValue('server-issued');
    await expect(source.load(source.resolve('a.glb'), new AbortController().signal)).rejects.toThrow('401');
    expect(access.unauthorized).toHaveBeenCalledOnce();
    expect(fetcher).toHaveBeenCalledWith('http://school.local/world/a.glb', expect.objectContaining({ cache: 'no-store', credentials: 'omit', redirect: 'error', headers: { Authorization: 'Bearer server-issued' } }));
  } finally { fetcher.mockRestore(); }
});
