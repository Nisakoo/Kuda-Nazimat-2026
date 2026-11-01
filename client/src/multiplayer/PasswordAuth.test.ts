import { afterEach, expect, it, vi } from 'vitest';
import { requestPasswordSession, revokeSession } from './PasswordAuth';

afterEach(() => { vi.unstubAllGlobals(); });
const session = () => ({ token: 't'.repeat(43), expiresAt: Date.now() + 60000 });
const ok = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
const done = () => new Response(null, { status: 204 });
const request = (mode: 'login' | 'register' = 'login', signal = new AbortController().signal) => requestPasswordSession('http://local/', mode, '  Alice  ', 'secret', signal);
function boundary(auth: () => Response | Promise<Response>, state: () => Response | Promise<Response>, logout: () => Response | Promise<Response> = done) {
  const fetcher = vi.fn((url: string, _options?: RequestInit) => {
    if (url.endsWith('/api/auth/state')) return Promise.resolve().then(state);
    if (url.endsWith('/api/auth/logout')) return Promise.resolve().then(logout);
    return Promise.resolve().then(auth);
  });
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
function expectCleanup(fetcher: ReturnType<typeof boundary>, token: string, originalSignal?: AbortSignal) {
  const calls = fetcher.mock.calls.filter(([url]) => url.endsWith('/api/auth/logout'));
  expect(calls).toHaveLength(1);
  expect(calls[0]![1]).toMatchObject({ method: 'POST', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: expect.any(AbortSignal) });
  expect(calls[0]![1]?.signal).not.toBe(originalSignal);
  expect(calls[0]![1]?.signal?.aborted).toBe(false);
}

it.each(['login', 'register'] as const)('%s sends credentials then waits for strict authenticated account state', async mode => {
  const auth = session(); let finish!: (response: Response) => void;
  const fetcher = boundary(() => ok(auth), () => new Promise<Response>(resolve => { finish = resolve; }));
  const controller = new AbortController(); let settled = false;
  const pending = request(mode, controller.signal).then(value => { settled = true; return value; });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2)); expect(settled).toBe(false);
  expect(fetcher.mock.calls[0]).toEqual([`http://local/api/auth/${mode}`, expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"name":"Alice","password":"secret"}', cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal })]);
  expect(fetcher.mock.calls[1]).toEqual(['http://local/api/auth/state', expect.objectContaining({ headers: { Authorization: `Bearer ${auth.token}` }, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: controller.signal })]);
  finish(ok({ requiresAvatar: mode === 'register' }));
  expect(await pending).toEqual({ session: auth, requiresAvatar: mode === 'register' });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it.each([404, 405])('claims no account only for explicit unsupported registration HTTP %i', async status => {
  const fetcher = boundary(() => new Response('', { status }), () => { throw new Error('Must not request state'); });
  await expect(request('register')).rejects.toThrow('Аккаунт не создан');
  await expect(request('login')).rejects.toThrow('Гостевой вход выполняется отдельно');
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.every(([url]) => !url.includes('guest') && !url.endsWith('logout'))).toBe(true);
});

it.each([
  ['invalid state', () => ok({ requiresAvatar: 'yes' })],
  ['extra state field', () => ok({ requiresAvatar: false, extra: true })],
  ['state HTTP failure', () => new Response(JSON.stringify({ error: { message: 'private value' } }), { status: 401 })],
  ['malformed state', () => new Response('{')],
  ['oversized state', () => ok({ requiresAvatar: true, extra: 'а'.repeat(2100) })],
  ['state network failure', () => Promise.reject(new Error('private network detail'))],
] as const)('revokes the exact issued token after %s', async (_label, state) => {
  const auth = session(), signal = new AbortController().signal;
  const fetcher = boundary(() => ok(auth), state);
  await expect(request('login', signal)).rejects.toThrow('состояние аккаунта');
  expectCleanup(fetcher, auth.token, signal);
});

it('keeps the state error and registration recovery hint when background revocation fails', async () => {
  const auth = session();
  const fetcher = boundary(() => ok(auth), () => Promise.reject(new Error(auth.token)), () => Promise.reject(new Error('cleanup secret: ' + auth.token)));
  const error = await request('register').catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(Error);
  const message = (error as Error).message;
  expect(message).toContain('состояние аккаунта');
  expect(message).toContain('Аккаунт мог быть создан');
  expect(message).toContain('Попробуйте войти');
  expect(message).toContain('а не регистрироваться повторно');
  expect(message).not.toContain(auth.token);
  expect(message).not.toContain('cleanup');
  expectCleanup(fetcher, auth.token);
  await Promise.resolve(); // The rejected cleanup is handled, not a second UI failure.
});

it('does not wait for the separate logout timeout before reporting a state failure', async () => {
  const auth = session(); let finish!: (response: Response) => void;
  const fetcher = boundary(() => ok(auth), () => ok({ invalid: true }), () => new Promise<Response>(resolve => { finish = resolve; }));
  await expect(request()).rejects.toThrow('состояние аккаунта');
  expectCleanup(fetcher, auth.token);
  // The request has already rejected while revocation is still unresolved.
  finish(done()); await Promise.resolve();
});

it.each(['auth', 'state'] as const)('cleans up a cancelled late valid %s response instead of returning its session', async stage => {
  const auth = session(), controller = new AbortController(); let finish!: (response: Response) => void;
  const late = () => new Promise<Response>(resolve => { finish = resolve; });
  const fetcher = boundary(stage === 'auth' ? late : () => ok(auth), stage === 'state' ? late : () => ok({ requiresAvatar: false }));
  const pending = request('register', controller.signal);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(stage === 'auth' ? 1 : 2));
  controller.abort(new Error('abort detail: ' + auth.token));
  finish(stage === 'auth' ? ok(auth) : ok({ requiresAvatar: false }));
  const error = await pending.catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain('состояние аккаунта');
  expect((error as Error).message).toContain('Попробуйте войти');
  expect((error as Error).message).not.toContain(auth.token);
  expectCleanup(fetcher, auth.token, controller.signal);
  if (stage === 'auth') expect(fetcher.mock.calls.some(([url]) => url.endsWith('/api/auth/state'))).toBe(false);
});

it('revokes after a state fetch abort and uses an independent cleanup signal', async () => {
  const auth = session(), controller = new AbortController();
  const fetcher = vi.fn((url: string, options?: RequestInit): Promise<Response> => {
    if (url.endsWith('/logout')) return Promise.resolve(done());
    if (url.endsWith('/state')) return new Promise((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(new Error('aborted'))));
    return Promise.resolve(ok(auth));
  });
  vi.stubGlobal('fetch', fetcher);
  const pending = request('login', controller.signal);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2)); controller.abort();
  await expect(pending).rejects.toThrow('состояние аккаунта');
  expectCleanup(fetcher, auth.token, controller.signal);
});

it.each([
  ['network failure', () => Promise.reject(new Error('private network detail'))],
  ['malformed success', () => new Response('{')],
  ['invalid session', () => ok({ token: 'short', expiresAt: 0 })],
  ['oversized success', () => ok({ token: 'а'.repeat(2100), expiresAt: Date.now() + 60000 })],
  ['server failure', () => new Response(JSON.stringify({ error: { message: 'secret echoed' } }), { status: 503 })],
] as const)('treats initial registration %s as ambiguous and suggests login', async (_label, auth) => {
  const fetcher = boundary(auth, () => { throw new Error('Must not request state'); });
  const error = await request('register').catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).message).toContain('Аккаунт мог быть создан');
  expect((error as Error).message).toContain('Попробуйте войти');
  expect((error as Error).message).not.toContain('Аккаунт не создан');
  expect((error as Error).message).not.toContain('secret echoed');
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('preserves bounded-read errors and maps auth errors without echoing server secrets', async () => {
  boundary(() => ok({ token: 'а'.repeat(2100), expiresAt: Date.now() + 60000 }), () => ok({ requiresAvatar: false }));
  await expect(request()).rejects.toThrow('превышает допустимый размер');
  boundary(() => new Response(JSON.stringify({ error: { code: 'INVALID_CREDENTIALS', message: 'secret token' } }), { status: 401 }), () => ok({ requiresAvatar: false }));
  await expect(request()).rejects.toThrow('Неверное имя или пароль');
});

it('sends authenticated logout and requires HTTP 204', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 })).mockResolvedValueOnce(new Response('', { status: 401 })); vi.stubGlobal('fetch', fetcher);
  await expect(revokeSession('http://local/', 'token')).resolves.toBeUndefined();
  expect(fetcher.mock.calls[0]).toEqual(['http://local/api/auth/logout', expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer token' }, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: expect.any(AbortSignal) })]);
  await expect(revokeSession('http://local', 'token')).rejects.toThrow('Не удалось подтвердить выход');
});
