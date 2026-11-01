import { afterEach, expect, it, vi } from 'vitest';
import { EquipmentClient, type EquipmentView } from './EquipmentClient';

const clients: EquipmentClient[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.dispose()); vi.unstubAllGlobals(); });
function fixture() {
  const views: EquipmentView[] = []; const unauthorized = vi.fn();
  const client = new EquipmentClient('http://local/', { token: 'token', expiresAt: Date.now() + 60000 }, view => views.push(view), unauthorized);
  clients.push(client); return { client, views, unauthorized, get view() { return views.at(-1)!; } };
}
const ok = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

it('sends exact authenticated GET, POST and unequip without optimistic state', async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn().mockResolvedValueOnce(ok({ tool: null })).mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })).mockResolvedValueOnce(ok({ tool: null }));
  vi.stubGlobal('fetch', fetcher); const f = fixture(); expect(await f.client.load()).toBe(true);
  const pending = f.client.save('jug'); expect(f.view).toMatchObject({ busy: true, state: { tool: null }, error: null });
  expect(await f.client.save('bag')).toBe(false); expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[0]![0]).toBe('http://local/api/equipment');
  expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer token' }, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: expect.any(AbortSignal) });
  expect(fetcher.mock.calls[1]![1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body: '{"tool":"jug"}' });
  finish(ok({ tool: 'jug' })); expect(await pending).toBe(true); expect(f.view.state).toEqual({ tool: 'jug' });
  expect(await f.client.save(null)).toBe(true); expect(fetcher.mock.calls[2]![1].body).toBe('{"tool":null}'); expect(f.view.state).toEqual({ tool: null });
});

it('rejects unauthorized, HTTP errors, malformed JSON and invalid tools without changing state', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(ok({ tool: 'bag' })).mockResolvedValueOnce(new Response('', { status: 401 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Не сохранено' } }), { status: 503 }))
    .mockResolvedValueOnce(new Response('{', { status: 200 })).mockResolvedValueOnce(ok({ tool: 'apple' })).mockResolvedValueOnce(ok({ tool: 'jug', extra: true }));
  vi.stubGlobal('fetch', fetcher); const f = fixture(); await f.client.load();
  expect(await f.client.save('jug')).toBe(false); expect(f.unauthorized).toHaveBeenCalledOnce();
  expect(await f.client.save('jug')).toBe(false); expect(f.view.error).toBe('Не сохранено');
  for (let i = 0; i < 3; i++) { expect(await f.client.save('jug')).toBe(false); expect(f.view.error).toBeTruthy(); }
  expect(f.view.state).toEqual({ tool: 'bag' });
});

it('ignores a late unauthorized response after disposal even when fetch ignores abort', async () => {
  let finish!: (response: Response) => void; let signal!: AbortSignal;
  vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => { signal = options.signal!; return new Promise<Response>(resolve => { finish = resolve; }); }));
  const f = fixture(); const pending = f.client.load(); const count = f.views.length;
  f.client.dispose(); expect(signal.aborted).toBe(true); finish(new Response('', { status: 401 }));
  expect(await pending).toBe(false); expect(f.unauthorized).not.toHaveBeenCalled(); expect(f.views).toHaveLength(count);
});

it('rejects an oversized UTF-8 body by bytes without changing confirmed state', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok({ tool: 'bag' })).mockResolvedValueOnce(ok({ tool: 'а'.repeat(2100) })));
  const f = fixture(); expect(await f.client.load()).toBe(true); expect(await f.client.save('jug')).toBe(false);
  expect(f.view.state).toEqual({ tool: 'bag' }); expect(f.view.error).toContain('превышает допустимый размер');
});

it('aborts on dispose and suppresses late success and further requests', async () => {
  let finish!: (response: Response) => void; let signal!: AbortSignal;
  const fetcher = vi.fn((_url: string, options: RequestInit) => { signal = options.signal!; return new Promise<Response>(resolve => { finish = resolve; }); });
  vi.stubGlobal('fetch', fetcher); const f = fixture(); const pending = f.client.save('jug'); const count = f.views.length;
  f.client.dispose(); expect(signal.aborted).toBe(true); finish(ok({ tool: 'jug' }));
  expect(await pending).toBe(false); expect(f.views).toHaveLength(count); expect(await f.client.load()).toBe(false); expect(fetcher).toHaveBeenCalledOnce();
});
