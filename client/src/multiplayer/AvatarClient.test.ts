import { afterEach, expect, it, vi } from 'vitest';
import { AvatarClient, type AvatarView } from './AvatarClient';

const clients: AvatarClient[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.dispose()); vi.unstubAllGlobals(); });
function fixture() {
  const views: AvatarView[] = []; const unauthorized = vi.fn();
  const client = new AvatarClient('http://local/', { token: 'token', expiresAt: Date.now() + 60000 }, view => views.push(view), unauthorized);
  clients.push(client); return { client, views, unauthorized, get view() { return views.at(-1)!; } };
}
const ok = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });

it('sends exact authenticated GET and POST and waits for confirmed state', async () => {
  let finish!: (response: Response) => void;
  const fetcher = vi.fn().mockResolvedValueOnce(ok({ avatarId: null })).mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  vi.stubGlobal('fetch', fetcher); const f = fixture();
  expect(await f.client.load()).toBe(true); expect(f.view.state).toEqual({ avatarId: null });
  const pending = f.client.save('dan'); expect(f.view).toMatchObject({ busy: true, state: { avatarId: null }, error: null });
  expect(await f.client.save('nic')).toBe(false); expect(fetcher).toHaveBeenCalledTimes(2);
  const [url, options] = fetcher.mock.calls[0]!; expect(url).toBe('http://local/api/avatar');
  expect(options).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer token' }, cache: 'no-store', redirect: 'error', credentials: 'omit', signal: expect.any(AbortSignal) });
  expect(options.body).toBeUndefined();
  expect(fetcher.mock.calls[1]![1]).toMatchObject({ method: 'POST', headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body: '{"avatarId":"dan"}' });
  finish(ok({ avatarId: 'dan' })); expect(await pending).toBe(true); expect(f.view).toMatchObject({ busy: false, state: { avatarId: 'dan' } });
});

it('rejects unauthorized, HTTP errors, malformed JSON and unknown IDs without changing state', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(ok({ avatarId: 'nic' })).mockResolvedValueOnce(new Response('', { status: 401 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'Сохранение недоступно' } }), { status: 503 }))
    .mockResolvedValueOnce(new Response('{', { status: 200 })).mockResolvedValueOnce(ok({ avatarId: 'other' })).mockResolvedValueOnce(ok({ avatarId: 'dan', extra: true }));
  vi.stubGlobal('fetch', fetcher); const f = fixture(); await f.client.load();
  expect(await f.client.save('dan')).toBe(false); expect(f.unauthorized).toHaveBeenCalledOnce();
  expect(await f.client.save('dan')).toBe(false); expect(f.view.error).toBe('Сохранение недоступно');
  for (let i = 0; i < 3; i++) { expect(await f.client.save('dan')).toBe(false); expect(f.view.error).toBeTruthy(); }
  expect(f.view.state).toEqual({ avatarId: 'nic' });
});

it('ignores a late unauthorized response after disposal even when fetch ignores abort', async () => {
  let finish!: (response: Response) => void; let signal!: AbortSignal;
  vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => { signal = options.signal!; return new Promise<Response>(resolve => { finish = resolve; }); }));
  const f = fixture(); const pending = f.client.load(); const count = f.views.length;
  f.client.dispose(); expect(signal.aborted).toBe(true); finish(new Response('', { status: 401 }));
  expect(await pending).toBe(false); expect(f.unauthorized).not.toHaveBeenCalled(); expect(f.views).toHaveLength(count);
});

it('rejects an oversized UTF-8 body by bytes without changing confirmed state', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok({ avatarId: 'nic' })).mockResolvedValueOnce(ok({ avatarId: 'а'.repeat(2100) })));
  const f = fixture(); expect(await f.client.load()).toBe(true); expect(await f.client.save('dan')).toBe(false);
  expect(f.view.state).toEqual({ avatarId: 'nic' }); expect(f.view.error).toContain('превышает допустимый размер');
});

it('aborts on dispose and suppresses late success and further requests', async () => {
  let finish!: (response: Response) => void; let signal!: AbortSignal;
  const fetcher = vi.fn((_url: string, options: RequestInit) => { signal = options.signal!; return new Promise<Response>(resolve => { finish = resolve; }); });
  vi.stubGlobal('fetch', fetcher); const f = fixture(); const pending = f.client.load(); const count = f.views.length;
  f.client.dispose(); expect(signal.aborted).toBe(true); finish(ok({ avatarId: 'ksu' }));
  expect(await pending).toBe(false); expect(f.views).toHaveLength(count); expect(await f.client.load()).toBe(false); expect(fetcher).toHaveBeenCalledOnce();
});
