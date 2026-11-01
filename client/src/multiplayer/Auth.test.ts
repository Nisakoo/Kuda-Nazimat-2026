import { afterEach, expect, it, vi } from 'vitest';
import { requestAuthMode } from './Auth';

afterEach(() => vi.unstubAllGlobals());
it('discovers supported methods and rejects invalid mode responses', async () => {
  const signal = new AbortController().signal;
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ password: true, guest: false, dev: false })).mockResolvedValueOnce(Response.json({ password: true, guest: 'yes', dev: true }));
  vi.stubGlobal('fetch', fetcher);
  expect(await requestAuthMode('http://school/game/', signal)).toEqual({ password: true, guest: false, dev: false });
  expect(fetcher).toHaveBeenCalledWith('http://school/game/api/auth/mode', expect.objectContaining({ signal, credentials: 'omit' }));
  await expect(requestAuthMode('http://school', signal)).rejects.toThrow();
});
