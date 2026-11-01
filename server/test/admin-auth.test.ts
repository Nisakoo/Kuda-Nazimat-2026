import { expect, it } from 'vitest';
import { AuthError, createAuthService } from '../src/auth/AuthService.ts';
import { memoryStores } from './memory.ts';
import { setup } from './harness.ts';

const code = async (promise: Promise<unknown>) => { try { await promise; return 'ok'; } catch (error) { return error instanceof AuthError ? error.code : String(error); } };

it('AUTH-017–020: create-admin, temporary password, scoped sessions and role revocation', async () => {
  const stores = memoryStores(); const revoked: string[] = [];
  const auth = createAuthService({ accounts: stores.accounts, sessions: stores.sessions, clock: { now: () => Date.now() }, ttlMs: 3_600_000, passwordless: false });
  auth.onRevoked((_hashes, reason) => revoked.push(reason));
  const created = await auth.operator.createAdmin('Вера');
  expect(await code(auth.adminLogin('Вера', created.temporaryPassword))).toBe('PASSWORD_CHANGE_REQUIRED');
  const game = await auth.changePassword('Вера', created.temporaryPassword, 'админ-пароль');
  const admin = await auth.adminLogin('вера', 'админ-пароль');
  // Scopes never cross: the admin token does not open the game, the game token does not open the admin API.
  expect((await auth.verifyAdmin(admin.token)).ok).toBe(true); expect((await auth.verify(admin.token)).ok).toBe(false);
  expect((await auth.verify(game.token)).ok).toBe(true); expect((await auth.verifyAdmin(game.token)).ok).toBe(false);
  // A player with the right password is indistinguishable from a wrong password and is not locked out of the game.
  await auth.register('Аня', 'секрет12');
  expect(await code(auth.adminLogin('Аня', 'секрет12'))).toBe('CREDENTIALS');
  expect(await code(auth.adminLogin('Аня', 'неверно12'))).toBe('CREDENTIALS');
  expect(await code(auth.login('Аня', 'секрет12'))).toBe('ok');
  expect(await code(auth.operator.createAdmin('аня'))).toBe('NAME_TAKEN');
  auth.operator.grantAdmin('Аня'); expect(await code(auth.adminLogin('Аня', 'секрет12'))).toBe('ok');
  expect(auth.operator.revokeAdmin('Вера')).toBe(1); expect(revoked).toContain('role-revoked');
  expect((await auth.verifyAdmin(admin.token)).ok).toBe(false); expect((await auth.verify(game.token)).ok).toBe(true);
  expect(auth.operator.list().find((a) => a.name === 'Вера')?.role).toBe('player');
  expect(await code(auth.adminDev())).toBe('DISABLED');
});

it('AUTH-018/019 over HTTP: admin login and dev autologin, game channel refuses admin tokens, logout ends the admin session', async () => {
  const { post, origin, connect } = await setup();
  const dev = await post('/api/admin/dev', {});
  expect(dev.status).toBe(200); expect(Object.keys(dev.body!)).toEqual(['token', 'expiresAt']);
  const token = dev.body!.token as string;
  await expect(connect(token)).rejects.toThrow();
  expect((await fetch(`${origin}/world/maps/test/manifest.json`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
  expect(await post('/api/admin/login', { name: 'Никто', password: 'неверно12' })).toMatchObject({ status: 401, body: { error: { code: 'CREDENTIALS' } } });
  expect((await post('/api/admin/login', { name: 'x' })).status).toBe(400);
  expect((await fetch(`${origin}/api/admin/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })).status).toBe(204);
  expect((await fetch(`${origin}/api/admin/unknown`)).status).toBe(401); // ADMIN-003: no admin session first
});
