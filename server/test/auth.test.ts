import { describe, expect, it } from 'vitest';
import { scryptSync, randomBytes } from 'node:crypto';
import { AuthError, createAuthService, hashToken } from '../src/auth/AuthService.ts';
import { HashQueueFullError, PasswordHasher, checkPassword, temporaryPassword } from '../src/auth/password.ts';
import { memoryLogger } from '../src/common/logger.ts';
import type { RevokeReason } from '../src/auth/ports.ts';
import { memoryStores } from './memory.ts';
import { setup } from './harness.ts';

function service(options: { passwordless?: boolean; maxSessions?: number } = {}) {
  const stores = memoryStores(); let now = 1_000_000; const logger = memoryLogger();
  const clock = { now: () => now };
  const auth = createAuthService({ accounts: stores.accounts, sessions: stores.sessions, clock, ttlMs: 3_600_000, logger, passwordless: options.passwordless ?? false, ...(options.maxSessions ? { maxSessions: options.maxSessions } : {}) });
  const revoked: { hashes: readonly string[]; reason: RevokeReason }[] = [];
  auth.onRevoked((hashes, reason) => revoked.push({ hashes, reason }));
  return { auth, stores, logger, revoked, advance: (ms: number) => { now += ms; } };
}
const code = async (promise: Promise<unknown>) => { try { await promise; return 'ok'; } catch (error) { return error instanceof AuthError ? error.code : String(error); } };

describe('passwords (AUTH-007, 008)', () => {
  it('checks length, control characters and the name; temporary passwords avoid look-alikes', () => {
    expect(checkPassword('12345', 'Аня').ok).toBe(false);
    expect(checkPassword('аня', 'Аня').ok).toBe(false);
    expect(checkPassword('Аня123', 'аня123').ok).toBe(false);
    expect(checkPassword('пароль\u0007', 'Аня').ok).toBe(false);
    expect(checkPassword('x'.repeat(129), 'Аня').ok).toBe(false);
    expect(checkPassword('секрет12', 'Аня')).toEqual({ ok: true, password: 'секрет12' });
    for (let i = 0; i < 20; i++) expect(temporaryPassword()).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{10}$/);
  });

  it('stores scrypt with salt and parameters, verifies in constant shape and asks to rehash weaker parameters', async () => {
    const hasher = new PasswordHasher();
    const [a, b] = [await hasher.hash('секрет12'), await hasher.hash('секрет12')];
    expect(a).toMatch(/^scrypt\$32768\$8\$1\$[\w-]{22}\$[\w-]{43}$/); expect(a).not.toBe(b);
    expect(await hasher.verify('секрет12', a)).toEqual({ ok: true, needsRehash: false });
    expect(await hasher.verify('другой12', a)).toEqual({ ok: false, needsRehash: false });
    expect(await hasher.verify('секрет12', null)).toEqual({ ok: false, needsRehash: false });
    const salt = randomBytes(16); const weak = `scrypt$16384$8$1$${salt.toString('base64url')}$${scryptSync('секрет12', salt, 32, { N: 16384, r: 8, p: 1 }).toString('base64url')}`;
    expect(await hasher.verify('секрет12', weak)).toEqual({ ok: true, needsRehash: true });
  });

  it('bounds concurrent hashing and fails fast when the queue waits too long', async () => {
    const hasher = new PasswordHasher(1, 5);
    const results = await Promise.allSettled([hasher.hash('a-password'), hasher.hash('b-password'), hasher.hash('c-password')]);
    expect(results.filter((r) => r.status === 'rejected' && r.reason instanceof HashQueueFullError).length).toBeGreaterThan(0);
    expect(results[0]!.status).toBe('fulfilled');
  });
});

describe('AuthService (AUTH-001–016)', () => {
  it('S5: registers with a password, refuses a taken name and answers unknown names like wrong passwords', async () => {
    const { auth, stores, logger } = service();
    const session = await auth.register('Аня', 'секрет12', '10.0.0.1');
    expect(Object.keys(session)).toEqual(['token', 'expiresAt']);
    expect(stores.accounts.find('аня')!.passwordHash).toMatch(/^scrypt\$/);
    expect(await code(auth.register('аня', 'другой12'))).toBe('NAME_TAKEN');
    const wrong = await auth.login('Аня', 'неверно12').catch((e: AuthError) => e);
    const unknown = await auth.login('Никто', 'неверно12').catch((e: AuthError) => e);
    expect([wrong, unknown].map((e) => (e as AuthError).code)).toEqual(['CREDENTIALS', 'CREDENTIALS']);
    expect((wrong as AuthError).message).toBe((unknown as AuthError).message);
    expect((await auth.verify((await auth.login('аня', 'секрет12')).token)).ok).toBe(true);
    const text = JSON.stringify(logger.records);
    expect(text).not.toContain('секрет12'); expect(text).not.toContain(session.token); expect(text).not.toContain(hashToken(session.token));
    expect(logger.records.map((r) => r.event)).toEqual(expect.arrayContaining(['auth.register', 'auth.login', 'auth.login.failed']));
  });

  it('AUTH-001/016: production refuses passwordless login; development offers guest and dev; a password account needs its password', async () => {
    const prod = service({ passwordless: false });
    expect(prod.auth.mode()).toEqual({ password: true, guest: false, dev: false });
    expect(await code(prod.auth.guest('Аня'))).toBe('DISABLED'); expect(await code(prod.auth.dev(undefined))).toBe('DISABLED');
    const dev = service({ passwordless: true });
    expect(dev.auth.mode()).toEqual({ password: true, guest: true, dev: true });
    const [auto, boris] = [await dev.auth.dev(undefined), await dev.auth.dev('Борис')];
    const [a, b] = [await dev.auth.verify(auto.token), await dev.auth.verify(boris.token)];
    expect(a.ok && a.identity.displayName).toBe('dev'); expect(b.ok && b.identity.displayName).toBe('Борис');
    await dev.auth.register('Вера', 'секрет12');
    expect(await code(dev.auth.guest('вера'))).toBe('PASSWORD_REQUIRED');
    expect(await code(dev.auth.dev('Вера'))).toBe('PASSWORD_REQUIRED');
  });

  it('S7: five failures lock the name even for the right password, other names still work, unlock lifts it', async () => {
    const { auth, logger, advance } = service();
    await auth.register('Аня', 'секрет12', '10.0.0.2'); await auth.register('Борис', 'секрет34', '10.0.0.3');
    for (let i = 0; i < 5; i++) expect(await code(auth.login('Аня', 'неверно12', '10.0.0.4'))).toBe('CREDENTIALS');
    const locked = await auth.login('Аня', 'секрет12', '10.0.0.5').catch((e: AuthError) => e) as AuthError;
    expect(locked.code).toBe('RATE_LIMIT'); expect(locked.retryAfterSeconds).toBe(900);
    expect(await code(auth.login('Борис', 'секрет34', '10.0.0.4'))).toBe('ok');
    expect(logger.records.some((r) => r.event === 'auth.locked')).toBe(true);
    expect(auth.operator.unlock('аня')).toBe(true);
    expect(await code(auth.login('Аня', 'секрет12'))).toBe('ok');
    // A second lock within the hour after the previous one lasts an hour.
    for (let i = 0; i < 5; i++) await code(auth.login('Аня', 'неверно12'));
    advance(16 * 60_000); for (let i = 0; i < 5; i++) await code(auth.login('Аня', 'неверно12'));
    expect(((await auth.login('Аня', 'секрет12').catch((e: AuthError) => e)) as AuthError).retryAfterSeconds).toBeGreaterThan(3000);
  });

  it('AUTH-013: per-IP requests are limited across names', async () => {
    const { auth } = service({ passwordless: true });
    for (let i = 0; i < 30; i++) expect(await code(auth.guest(`Игрок${i}`, '10.9.9.9'))).toBe('ok');
    expect(await code(auth.guest('Лишний', '10.9.9.9'))).toBe('RATE_LIMIT');
    expect(await code(auth.guest('Другой', '10.9.9.8'))).toBe('ok');
  });

  it('S8: a temporary password forces a change, then only the new password works and the temporary one expires', async () => {
    const { auth, revoked, advance } = service();
    const first = await auth.register('Вера', 'секрет12');
    const reset = await auth.operator.resetPassword('вера');
    expect(reset.name).toBe('Вера'); expect(reset.temporaryPassword).toHaveLength(10);
    expect(revoked).toEqual([{ hashes: [hashToken(first.token)], reason: 'password-reset' }]);
    expect((await auth.verify(first.token)).ok).toBe(false);
    expect(await code(auth.login('Вера', reset.temporaryPassword))).toBe('PASSWORD_CHANGE_REQUIRED');
    expect(await code(auth.changePassword('Вера', reset.temporaryPassword, 'короткий'))).toBe('ok');
    expect(await code(auth.login('Вера', reset.temporaryPassword))).toBe('CREDENTIALS');
    expect(await code(auth.login('Вера', 'короткий'))).toBe('ok');
    const again = await auth.operator.resetPassword('Вера'); advance(24 * 3_600_000 + 1);
    expect(await code(auth.login('Вера', again.temporaryPassword))).toBe('CREDENTIALS');
    expect(await code(auth.operator.resetPassword('Никто'))).toBe('INVALID');
  });

  it('AUTH-009/012: logout and password change revoke; logout is idempotent and silent for unknown tokens', async () => {
    const { auth, revoked } = service();
    const a = await auth.register('Аня', 'секрет12'); const b = await auth.login('Аня', 'секрет12');
    auth.logout(a.token); auth.logout(a.token); auth.logout('garbage'); auth.logout('x'.repeat(43));
    expect(revoked).toEqual([{ hashes: [hashToken(a.token)], reason: 'logout' }]);
    expect((await auth.verify(a.token)).ok).toBe(false); expect((await auth.verify(b.token)).ok).toBe(true);
    const c = await auth.changePassword('Аня', 'секрет12', 'новый-пароль');
    expect(revoked.at(-1)).toEqual({ hashes: [hashToken(b.token)], reason: 'password-changed' });
    expect((await auth.verify(b.token)).ok).toBe(false); expect((await auth.verify(c.token)).ok).toBe(true);
    expect(auth.operator.revoke('аня')).toBe(1); expect((await auth.verify(c.token)).ok).toBe(false);
  });

  it('AUTH-002: at most maxSessions active sessions, the oldest is revoked with reason limit', async () => {
    const { auth, revoked } = service({ maxSessions: 2 });
    const sessions = [await auth.register('Аня', 'секрет12')];
    for (let i = 0; i < 2; i++) sessions.push(await auth.login('Аня', 'секрет12'));
    expect(revoked).toEqual([{ hashes: [hashToken(sessions[0]!.token)], reason: 'limit' }]);
    expect((await Promise.all(sessions.map((s) => auth.verify(s.token)))).map((check) => check.ok)).toEqual([false, true, true]);
    const listed = auth.operator.list();
    expect(listed).toEqual([expect.objectContaining({ name: 'Аня', hasPassword: true, mustChangePassword: false, activeSessions: 2 })]);
    expect(JSON.stringify(listed)).not.toContain('scrypt');
  });
});

describe('HTTP and live sessions (AUTH-006, 009, 010, 012, 014)', () => {
  it('serves the auth API with exact bodies, codes and Retry-After', async () => {
    const { post, origin } = await setup({ auth: { passwordless: false } });
    expect(await (await fetch(`${origin}/api/auth/mode`)).json()).toEqual({ password: true, guest: false, dev: false });
    expect(await post('/api/auth/guest', { name: 'Аня' })).toMatchObject({ status: 403, body: { error: { code: 'DISABLED' } } });
    const registered = await post('/api/auth/register', { name: 'Аня', password: 'секрет12' });
    expect(registered.status).toBe(201); expect(Object.keys(registered.body!)).toEqual(['token', 'expiresAt']);
    expect(await post('/api/auth/register', { name: 'аня', password: 'секрет12' })).toMatchObject({ status: 409, body: { error: { code: 'NAME_TAKEN' } } });
    expect(await post('/api/auth/login', { name: 'Аня', password: 'секрет12', extra: 1 })).toMatchObject({ status: 400 });
    expect(await post('/api/auth/login', { name: 'Аня', password: 'плохой-пароль' })).toMatchObject({ status: 401, body: { error: { code: 'CREDENTIALS', message: 'Неверное имя или пароль.' } } });
    for (let i = 0; i < 4; i++) await post('/api/auth/login', { name: 'Аня', password: 'плохой-пароль' });
    const locked = await post('/api/auth/login', { name: 'Аня', password: 'секрет12' });
    expect(locked).toMatchObject({ status: 429, body: { error: { code: 'RATE_LIMIT', retryAfterSeconds: 900 } } }); expect(locked.headers.get('retry-after')).toBe('900');
    expect((await post('/api/auth/unknown', {})).status).toBe(404);
  });

  it('S6/S9: logout and operator revoke close the live socket with a reason; CSRF-less actions are refused', async () => {
    const { post, connect, origin, port } = await setup();
    const anya = (await post('/api/auth/dev', { name: 'Аня' })).body as { token: string };
    const client = await connect(anya.token); client.command('join', { mapId: 'test' }); await client.wait((p) => p.type === 'joined');
    const logout = await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${anya.token}` } });
    expect(logout.status).toBe(204);
    expect(await client.wait((p) => p.type === 'error' && p.requestId === 'server')).toMatchObject({ code: 'UNAUTHORIZED', message: 'Вы вышли из игры.' });
    expect((await fetch(`${origin}/world/maps/test/manifest.json`, { headers: { Authorization: `Bearer ${anya.token}` } })).status).toBe(401);
    expect((await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${anya.token}` } })).status).toBe(204);
    const boris = (await post('/api/auth/dev', { name: 'Борис' })).body as { token: string };
    const other = await connect(boris.token); other.command('join', { mapId: 'test' }); await other.wait((p) => p.type === 'joined');
    const self = `http://127.0.0.1:${port}`;
    expect((await post('/api/operator/actions/revoke', { name: 'Борис' }, { Origin: self })).status).toBe(403);
    expect((await post('/api/operator/actions/revoke', { name: 'Борис' }, { Origin: 'http://evil.test', 'X-Operator': '1' })).status).toBe(403);
    expect(other.packets.some((p) => p.type === 'error')).toBe(false);
    expect(await post('/api/operator/actions/revoke', { name: 'Борис' }, { Origin: self, 'X-Operator': '1' })).toMatchObject({ status: 200, body: { revoked: 1 } });
    expect(await other.wait((p) => p.type === 'error' && p.requestId === 'server')).toMatchObject({ message: 'Ведущий завершил сессию.' });
    const reset = await post('/api/operator/actions/reset-password', { name: 'Борис' }, { Origin: self, 'X-Operator': '1' });
    expect(reset.body).toMatchObject({ name: 'Борис', temporaryPassword: expect.stringMatching(/^\w{10}$/) });
    expect(await post('/api/auth/login', { name: 'Борис', password: reset.body!.temporaryPassword })).toMatchObject({ status: 403, body: { error: { code: 'PASSWORD_CHANGE_REQUIRED' } } });
    expect(await post('/api/auth/password', { name: 'Борис', password: reset.body!.temporaryPassword, newPassword: 'свой-пароль' })).toMatchObject({ status: 200 });
  });

  it('S10: a session that floods /world/* gets 429 and stays valid', async () => {
    const { post, connect, origin } = await setup();
    const { token } = (await post('/api/auth/dev', {})).body as { token: string };
    const client = await connect(token); client.command('join', { mapId: 'test' }); await client.wait((p) => p.type === 'joined');
    const headers = { Authorization: `Bearer ${token}` };
    // A flood must arrive concurrently: sequential requests on a busy machine can be
    // slower than the refill rate and never exercise the limiter.
    const statuses = await Promise.all(Array.from({ length: 400 }, async () =>
      (await fetch(`${origin}/world/maps/test/manifest.json`, { method: 'HEAD', headers })).status));
    expect(statuses.filter((s) => s === 200).length).toBeGreaterThanOrEqual(300); expect(statuses).toContain(429);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect((await fetch(`${origin}/world/maps/test/manifest.json`, { headers })).status).toBe(200);
  });
});
