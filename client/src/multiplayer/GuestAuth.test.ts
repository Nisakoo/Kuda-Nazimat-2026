import { afterEach, expect, it, vi } from 'vitest';
import { guestName, requestGuestSession } from './GuestAuth';
afterEach(() => vi.unstubAllGlobals());
it('validates names and posts only name to the configured server path', async () => {
  const session = { token: 'x'.repeat(43), expiresAt: Date.now() + 10000 };
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(session)));
  vi.stubGlobal('fetch', fetcher); const signal = new AbortController().signal;
  expect(await requestGuestSession('http://school.local/game/', ' Аня ', signal)).toEqual(session);
  expect(fetcher).toHaveBeenCalledWith('http://school.local/game/api/auth/guest', expect.objectContaining({ method: 'POST', body: '{"name":"Аня"}', signal, credentials: 'omit', redirect: 'error' }));
  for (const name of ['', '  ', 'x'.repeat(33), 'Аня\n']) expect(() => guestName(name)).toThrow();
});
it('reports API text safely and rejects malformed, expired or unreachable responses', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); const signal = new AbortController().signal;
  fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: '<b>Ошибка имени</b>' } }), { status: 400 }));
  await expect(requestGuestSession('http://school.local', 'Аня', signal)).rejects.toThrow('<b>Ошибка имени</b>');
  for (const body of ['<html>error</html>', '{}', JSON.stringify({ token: 'x'.repeat(43), expiresAt: 0 })]) {
    fetcher.mockResolvedValueOnce(new Response(body)); await expect(requestGuestSession('http://school.local', 'Аня', signal)).rejects.toThrow(/ответ|сессию/);
  }
  fetcher.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  await expect(requestGuestSession('http://school.local', 'Аня', signal)).rejects.toThrow('Проверьте адрес');
});
