import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { createAuthService, hashToken, parseCredentials, validPassword } from '../src/auth/AuthService.ts';
import { sqliteAuthStores } from '../src/persistence/authentication.ts';
import { applyMigrations, loadMigrations } from '../src/persistence/migrate.ts';

const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); });
function fixture(path = ':memory:') {
  const db = new DatabaseSync(path); cleanups.push(() => db.close());
  db.exec('PRAGMA foreign_keys = ON');
  applyMigrations(db, loadMigrations(), 0);
  let now = 100;
  const stores = sqliteAuthStores(db);
  const auth = createAuthService(stores.accounts, stores.sessions, { now: () => now }, 1000);
  return { db, ...stores, auth, advance(ms: number) { now += ms; } };
}
const password = 'correct horse battery staple';

describe('password authentication', () => {
  it('registers with salted scrypt, case-insensitive identity, strict response and hashed session', async () => {
    const { auth, db } = fixture();
    const a = await auth.register('  Аня  ', password);
    const b = await auth.register('Борис', password);
    expect(Object.keys(a).sort()).toEqual(['expiresAt', 'token']);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.expiresAt).toBe(1100);
    const rows = db.prepare('SELECT * FROM account_credentials').all();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.salt).not.toBe(rows[1]!.salt);
    expect(rows[0]!.password_hash).not.toBe(rows[1]!.password_hash);
    expect(JSON.stringify(rows)).not.toContain(password);
    expect(db.prepare('SELECT token_hash FROM sessions').all().map((r) => r.token_hash)).toContain(hashToken(a.token));
    expect(JSON.stringify(db.prepare('SELECT * FROM sessions').all())).not.toContain(a.token);
    const login = await auth.login('аня', password);
    const first = await auth.verify(a.token); const next = await auth.verify(login.token);
    expect(first.ok && next.ok && first.identity).toEqual(next.ok && next.identity);
    expect(first.ok && first.identity.displayName).toBe('Аня');
    expect(login.token).not.toBe(a.token);
    expect(await auth.verify(b.token)).toMatchObject({ ok: true });
  });

  it('rejects wrong password, unknown account, guest password login and guest bypass', async () => {
    const { auth, db, accounts } = fixture();
    await auth.register('Protected', password);
    await expect(auth.login('protected', 'wrong password')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(auth.login('unknown', password)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(() => auth.guest('PROTECTED')).toThrow('Неверное имя или пароль');
    expect(() => accounts.findOrCreate('Protected', 'protected', 100)).toThrow('Password account');
    auth.guest('Guest');
    await expect(auth.login('Guest', password)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await expect(auth.register('guest', password)).rejects.toMatchObject({ code: 'NAME_TAKEN' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()!.n).toBe(2);
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_credentials').get()!.n).toBe(1);
  });

  it('does not claim a name won by a guest while registration hashes asynchronously', async () => {
    const { auth, accounts } = fixture();
    const registration = auth.register('Race', password);
    const guest = auth.guest('race');
    await expect(registration).rejects.toMatchObject({ code: 'NAME_TAKEN' });
    expect(accounts.findByName('race')!.credential).toBeNull();
    expect(await auth.verify(guest.token)).toMatchObject({ ok: true });
  });

  it('creates only one account in concurrent same-name registrations', async () => {
    const { auth, db } = fixture();
    const outcomes = await Promise.allSettled([auth.register('Race', password), auth.register('race', password)]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((o) => o.status === 'rejected')).toMatchObject([{ reason: { code: 'NAME_TAKEN' } }]);
    for (const table of ['accounts', 'players', 'account_credentials', 'sessions']) expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()!.n).toBe(1);
  });

  it('keeps pending appearance durable and preserves completed and legacy accounts after reopening', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'babel-auth-')); cleanups.unshift(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, 'auth.sqlite');
    const first = fixture(path);
    const result = await first.auth.register('Pending', password);
    const check = await first.auth.verify(result.token);
    if (!check.ok) throw new Error('Expected authenticated session');
    expect(first.auth.state(check.identity)).toEqual({ requiresAvatar: true });
    first.auth.guest('Legacy');
    const second = fixture(path);
    expect(second.auth.state(check.identity)).toEqual({ requiresAvatar: true });
    const resumed = await second.auth.login('pending', password);
    expect(await second.auth.verify(resumed.token)).toMatchObject({ ok: true, identity: check.identity });
    second.db.prepare('UPDATE players SET avatar_id = ? WHERE id = ?').run('dan', check.identity.playerId);
    expect(second.auth.state(check.identity)).toEqual({ requiresAvatar: false });
    expect(first.auth.state(check.identity)).toEqual({ requiresAvatar: false });
    second.auth.logout(result.token);
    expect(await first.auth.verify(result.token)).toEqual({ ok: false });
    expect(await second.auth.verify(resumed.token)).toMatchObject({ ok: true });
    const legacy = second.accounts.findByName('legacy')!;
    expect(second.auth.state(legacy.identity)).toEqual({ requiresAvatar: false });
  });

  it('revokes only the requested session and rejects expiry/malformed tokens', async () => {
    const { auth, advance } = fixture();
    const a = await auth.register('Name', password);
    const b = await auth.login('name', password);
    auth.logout(a.token);
    expect(await auth.verify(a.token)).toEqual({ ok: false });
    expect(await auth.verify(b.token)).toMatchObject({ ok: true });
    auth.logout(a.token); auth.logout('invalid');
    expect(await auth.verify('invalid')).toEqual({ ok: false });
    expect(await auth.verify('x'.repeat(43))).toEqual({ ok: false });
    advance(1000);
    expect(await auth.verify(b.token)).toEqual({ ok: false });
  });

  it('validates exact bodies and password bounds without mutating the password', () => {
    expect(parseCredentials({ name: ' Name ', password: ' leading space ' })).toEqual({ name: 'Name', password: ' leading space ' });
    expect(validPassword('x'.repeat(128))).toBe(true);
    expect(validPassword('x'.repeat(129))).toBe(false);
    for (const value of [null, [], { name: 'Name' }, { name: 'Name', password: 'short' }, { name: 'Name', password, extra: true }, { name: 'x'.repeat(33), password }, { name: 'bad\nname', password }, { name: 'Name', password: 12345678 }]) expect(() => parseCredentials(value)).toThrow();
  });

  it('limits attempts per name, per source and expires windows', async () => {
    const { auth, advance } = fixture();
    for (let i = 0; i < 10; i++) auth.guest('same', `source-${i}`);
    expect(() => auth.guest('same', 'other')).toThrow('Слишком частые попытки');
    for (let i = 0; i < 20; i++) auth.guest(`different-${i}`, 'one-source');
    expect(() => auth.guest('next', 'one-source')).toThrow('Слишком частые попытки');
    advance(60_000);
    expect(auth.guest('same', 'one-source').token).toHaveLength(43);
    await expect(auth.login('same', 'too short'.slice(0, 7), 'invalid')).rejects.toMatchObject({ code: 'INVALID' });
  });

  it('bounds limiter key memory and hash concurrency with fail-closed overload', async () => {
    const { auth, advance } = fixture();
    for (let i = 0; i < 1024; i++) auth.guest(`name-${i}`, `source-${i}`);
    expect(() => auth.guest('overflow', 'overflow')).toThrow('Слишком частые попытки');
    advance(60_000);
    const one = auth.register('one', password); const two = auth.register('two', password);
    await expect(auth.register('three', password)).rejects.toMatchObject({ code: 'RATE_LIMIT' });
    await Promise.all([one, two]);
    await expect(auth.register('three', password)).resolves.toMatchObject({ token: expect.any(String) });
  });

  it('rolls back account/player creation when credential insertion fails', () => {
    const { accounts, db } = fixture();
    expect(() => accounts.createPassword('Broken', 'broken', 1, { salt: 'invalid', passwordHash: '00'.repeat(64) })).toThrow();
    expect(db.prepare('SELECT COUNT(*) AS n FROM accounts').get()!.n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM players').get()!.n).toBe(0);
  });

  it('upgrades old guests without adding passwords or changing identity and position', async () => {
    const db = new DatabaseSync(':memory:'); cleanups.push(() => db.close());
    db.exec('PRAGMA foreign_keys = ON');
    const migrations = loadMigrations(); applyMigrations(db, migrations.slice(0, 2), 1);
    db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)').run('a_old', 'Old', 'old', 1);
    db.prepare('INSERT INTO players (id,account_id,map_id,x,y,z,rotation_y,updated_at) VALUES (?,?,?,?,?,?,?,?)').run('p_old', 'a_old', 'demo', 1, 2, 3, 0.5, 1);
    applyMigrations(db, migrations, 2);
    const stores = sqliteAuthStores(db); const auth = createAuthService(stores.accounts, stores.sessions, { now: () => 3 }, 1000);
    const session = auth.guest('OLD');
    expect(await auth.verify(session.token)).toMatchObject({ ok: true, identity: { accountId: 'a_old', playerId: 'p_old', displayName: 'Old' } });
    expect(stores.accounts.requiresAvatar('a_old')).toBe(false);
    await expect(auth.register('old', password)).rejects.toMatchObject({ code: 'NAME_TAKEN' });
    expect(db.prepare('SELECT x,y,z,rotation_y FROM players').get()).toMatchObject({ x: 1, y: 2, z: 3, rotation_y: 0.5 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_credentials').get()!.n).toBe(0);
  });
});
