import { afterEach, expect, it, vi } from 'vitest';
import { requestRuntimeConfig } from './RuntimeConfig';

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('uses the configured server and restrictive fetch options', async () => {
  const fetcher = vi.fn(async () => new Response('{"npcTimeoutMs":60000}'));
  vi.stubGlobal('fetch', fetcher);
  await expect(requestRuntimeConfig('http://server.local:1234', new AbortController().signal)).resolves.toBe(60000);
  const [url, options] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
  expect(url.href).toBe('http://server.local:1234/api/game-config');
  expect(options).toMatchObject({ credentials: 'omit', redirect: 'error', cache: 'no-store', signal: expect.any(AbortSignal) });
});

it('keeps a configured server path prefix, matching auth and socket routing', async () => {
  const fetcher = vi.fn(async () => new Response('{"npcTimeoutMs":60000}'));
  vi.stubGlobal('fetch', fetcher);
  await expect(requestRuntimeConfig('http://server.local:1234/nazimat/', new AbortController().signal)).resolves.toBe(60000);
  expect((fetcher.mock.calls[0] as unknown as [URL])[0].href).toBe('http://server.local:1234/nazimat/api/game-config');
});

it.each(['{}', '{"npcTimeoutMs":0}', '{"npcTimeoutMs":300001}', '{"npcTimeoutMs":60000,"extra":true}', 'not json', ' '.repeat(1025)])('rejects bad or oversized responses', async (body) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body)));
  await expect(requestRuntimeConfig('http://server.local', new AbortController().signal)).rejects.toThrow();
});

it('times out a nonresponsive fetch and aborts it', async () => {
  vi.useFakeTimers(); let inner!: AbortSignal;
  vi.stubGlobal('fetch', vi.fn((_url: URL, options: RequestInit) => { inner = options.signal!; return new Promise(() => {}); }));
  const promise = requestRuntimeConfig('http://server.local', new AbortController().signal);
  const failure = expect(promise).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(5000); await failure; expect(inner.aborted).toBe(true);
});

it('aborts a stalled response body at 5 seconds and cleans up its reader and timer', async () => {
  vi.useFakeTimers();
  const cancel = vi.fn(async () => {}); let inner!: AbortSignal;
  vi.stubGlobal('fetch', vi.fn(async (_url: URL, options: RequestInit) => {
    inner = options.signal!;
    return { ok: true, body: { getReader: () => ({
      read: () => new Promise((_resolve, reject) => inner.addEventListener('abort', () => reject(new Error('aborted')), { once: true })),
      cancel,
    }) } };
  }));
  const controller = new AbortController(); const remove = vi.spyOn(controller.signal, 'removeEventListener');
  const result = requestRuntimeConfig('http://server.local', controller.signal);
  const failure = expect(result).rejects.toThrow(); await Promise.resolve();
  await vi.advanceTimersByTimeAsync(5000); await failure; await Promise.resolve();
  expect(inner.aborted).toBe(true); expect(cancel).toHaveBeenCalledOnce();
  expect(remove).toHaveBeenCalledWith('abort', expect.any(Function)); expect(vi.getTimerCount()).toBe(0);
});

it('cancels a nonresponsive fetch when its caller aborts', async () => {
  const controller = new AbortController(); let inner!: AbortSignal;
  vi.stubGlobal('fetch', vi.fn((_url: URL, options: RequestInit) => { inner = options.signal!; return new Promise(() => {}); }));
  const result = requestRuntimeConfig('http://server.local', controller.signal); controller.abort();
  await expect(result).rejects.toThrow(); expect(inner.aborted).toBe(true);
});
