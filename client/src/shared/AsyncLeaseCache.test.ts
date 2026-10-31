import { describe, expect, it, vi } from 'vitest';
import { AsyncLeaseCache } from './AsyncLeaseCache';

describe('asynchronous leases', () => {
  it('deduplicates concurrent owners and frees only after the last release', async () => {
    const value = { dispose: vi.fn() };
    const load = vi.fn(async () => value);
    const cache = new AsyncLeaseCache(load, (entry) => entry.dispose());
    const [a, b] = await Promise.all([cache.acquire('a'), cache.acquire('a')]);
    expect(load).toHaveBeenCalledTimes(1);
    a.release();
    expect(value.dispose).not.toHaveBeenCalled();
    b.release(); b.release();
    expect(value.dispose).toHaveBeenCalledTimes(1);
    expect(cache.stats.resources).toBe(0);
  });
  it('cancels one waiter without aborting another, then frees a late cancelled result', async () => {
    let finish: ((entry: { dispose(): void }) => void) | undefined;
    const cache = new AsyncLeaseCache(() => new Promise<{ dispose(): void }>((resolve) => { finish = resolve; }), (entry) => entry.dispose());
    const cancel = new AbortController();
    const a = cache.acquire('a', cancel.signal);
    const rejection = expect(a).rejects.toMatchObject({ name: 'AbortError' });
    const b = cache.acquire('a');
    await Promise.resolve();
    cancel.abort();
    await rejection;
    const value = { dispose: vi.fn() };
    finish?.(value);
    const lease = await b;
    expect(value.dispose).not.toHaveBeenCalled();
    lease.release();
    expect(value.dispose).toHaveBeenCalledTimes(1);
  });
  it('rejects pending owners immediately on dispose and frees ignored-abort results later', async () => {
    let finish: ((entry: { dispose(): void }) => void) | undefined;
    const cache = new AsyncLeaseCache(() => new Promise<{ dispose(): void }>((resolve) => { finish = resolve; }), (entry) => entry.dispose());
    const request = cache.acquire('a');
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    cache.dispose();
    await rejection;
    const value = { dispose: vi.fn() };
    finish?.(value);
    await Promise.resolve(); await Promise.resolve();
    expect(value.dispose).toHaveBeenCalledTimes(1);
    expect(cache.stats.resources).toBe(0);
  });
  it('evicts failures so a retry starts a fresh load', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('failed')).mockResolvedValueOnce('ok');
    const cache = new AsyncLeaseCache<string>(load, () => {});
    await expect(cache.acquire('a')).rejects.toThrow('failed');
    const lease = await cache.acquire('a');
    expect(lease.value).toBe('ok');
    expect(load).toHaveBeenCalledTimes(2);
    lease.release();
  });
});
