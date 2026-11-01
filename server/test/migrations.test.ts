import { afterEach, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyMigrations, loadMigrations } from '../src/persistence/migrate.ts';
import { openDatabase, sqliteStores, transaction } from '../src/persistence/database.ts';

const databases: DatabaseSync[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function memory() { const db = new DatabaseSync(':memory:'); databases.push(db); return db; }
it('upgrades main v8 and NPC branch v4 without exposing legacy history or losing scoped rows', () => {
  const migrations = loadMigrations();
  for (const branch of ['main', 'npc'] as const) {
    const directory = mkdtempSync(join(tmpdir(), 'npc-schema-')); directories.push(directory);
    const path = join(directory, 'game.sqlite'); const old = new DatabaseSync(path);
    const history = branch === 'main' ? migrations.slice(0, 8) : [
      ...migrations.slice(0, 2), { version: 3, sql: migrations[6]!.sql }, { version: 4, sql: migrations[8]!.sql },
    ];
    transaction(old, () => applyMigrations(old, history, 1));
    old.exec("INSERT INTO accounts(id,name,name_key,created_at) VALUES ('a','Saved','saved',1); INSERT INTO players(id,account_id,updated_at) VALUES ('p','a',1)");
    old.prepare('INSERT INTO npc_dialogue(player_id,npc_id,question,answer,created_at) VALUES (?,?,?,?,?)').run('p', 'n', 'legacy', 'private', 1);
    if (branch === 'npc') old.prepare('INSERT INTO npc_dialogue(player_id,npc_id,question,answer,created_at,session_id) VALUES (?,?,?,?,?,?)').run('p', 'n', 'scoped', 'kept', 2, 'session');
    old.close();
    const db = openDatabase(path); databases.push(db); const stores = sqliteStores(db);
    expect(stores.dialogue.history('p', 'n', 'other')).toEqual([]);
    expect(stores.dialogue.history('p', 'n', 'session')).toEqual(branch === 'npc' ? [{ question: 'scoped', answer: 'kept' }] : []);
    expect(db.prepare('SELECT count(*) AS n FROM npc_dialogue WHERE session_id IS NULL').get()!.n).toBe(1);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare('SELECT max(version) AS n FROM schema_migrations').get()!.n).toBe(9);
  }
});

const first = { version: 1, sql: 'CREATE TABLE example (value TEXT); INSERT INTO example VALUES (\'original\')' };
const second = { version: 2, sql: 'ALTER TABLE example ADD COLUMN note TEXT; UPDATE example SET note = \'preserved\'' };

it('migrates empty and old databases in order, preserving data and original timestamps on restart', () => {
  const db = memory();
  transaction(db, () => applyMigrations(db, [first], 10));
  transaction(db, () => applyMigrations(db, [first, second], 20));
  transaction(db, () => applyMigrations(db, [first, second], 30));
  expect(db.prepare('SELECT * FROM example').all()).toEqual([{ value: 'original', note: 'preserved' }]);
  expect(db.prepare('SELECT * FROM schema_migrations ORDER BY version').all()).toEqual([{ version: 1, applied_at: 10 }, { version: 2, applied_at: 20 }]);
  const fresh = memory();
  transaction(fresh, () => applyMigrations(fresh, [first, second], 30));
  expect(fresh.prepare('SELECT * FROM example').all()).toEqual(db.prepare('SELECT * FROM example').all());
});

it('upgrades existing players to null avatar and restores a saved selection on reopen', () => {
  const directory = mkdtempSync(join(tmpdir(), 'avatar-migration-')); directories.push(directory);
  const path = join(directory, 'game.sqlite'); const old = new DatabaseSync(path);
  old.exec('PRAGMA foreign_keys = ON');
  transaction(old, () => applyMigrations(old, loadMigrations().slice(0, 2), 1));
  // Seed the historical schema directly; today's adapter requires the latest migrations.
  const player = { accountId: 'a_old', playerId: 'p_old', displayName: 'Old player' };
  old.prepare('INSERT INTO accounts (id,name,name_key,created_at) VALUES (?,?,?,?)').run(player.accountId, player.displayName, 'old player', 1);
  old.prepare('INSERT INTO players (id,account_id,updated_at) VALUES (?,?,?)').run(player.playerId, player.accountId, 1);
  old.close();
  const upgraded = openDatabase(path); const store = sqliteStores(upgraded);
  expect(store.avatars.load(player.playerId)).toBeNull();
  store.avatars.save(player.playerId, 'ksu');
  expect(() => upgraded.prepare('UPDATE players SET avatar_id = ? WHERE id = ?').run('arbitrary', player.playerId)).toThrow();
  upgraded.close();
  const reopened = openDatabase(path); databases.push(reopened);
  expect(sqliteStores(reopened).avatars.load(player.playerId)).toBe('ksu');
});

it('rolls back all pending schema, data and version changes when a later migration fails', () => {
  const db = memory();
  transaction(db, () => applyMigrations(db, [first], 1));
  const bad = { version: 3, sql: 'CREATE TABLE partial (id INTEGER); INSERT INTO missing VALUES (1)' };
  expect(() => transaction(db, () => applyMigrations(db, [first, second, bad], 2))).toThrow();
  expect(db.prepare('SELECT * FROM example').all()).toEqual([{ value: 'original' }]);
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'partial'").all()).toEqual([]);
  expect(db.prepare('SELECT version FROM schema_migrations').all()).toEqual([{ version: 1 }]);
  transaction(db, () => applyMigrations(db, [first, second], 3));
  expect(db.prepare('SELECT note FROM example').get()!.note).toBe('preserved');
});

it('rejects unknown versions, gaps, duplicates, empty SQL and corrupted applied history', () => {
  const db = memory();
  for (const migrations of [[], [second], [first, first], [first, { version: 2, sql: ' ' }]]) {
    expect(() => transaction(db, () => applyMigrations(db, migrations, 1))).toThrow();
  }
  transaction(db, () => applyMigrations(db, [first, second], 1));
  expect(() => transaction(db, () => applyMigrations(db, [first], 2))).toThrow('Неизвестная версия');
  db.exec('DELETE FROM schema_migrations WHERE version = 1');
  expect(() => transaction(db, () => applyMigrations(db, [first, second], 2))).toThrow('последовательность');
});

it('upgrades and restores a separate backup with existing accounts, position and NPC history intact', () => {
  const directory = mkdtempSync(join(tmpdir(), 'babylon-migrations-')); directories.push(directory);
  const path = join(directory, 'game.sqlite'); const db = openDatabase(path); databases.push(db);
  const stores = sqliteStores(db);
  const player = stores.accounts.findOrCreate('Путник', 'путник', 1);
  stores.players.save([{ id: player.playerId, mapId: 'market', position: { x: 2, y: 0, z: 3 }, rotationY: 1 }]);
  stores.dialogue.append(player.playerId, 'shepherd', 'Вопрос', 'Ответ', 2, 'test-session');
  const migrations = loadMigrations();
  transaction(db, () => applyMigrations(db, [...migrations, { version: migrations.length + 1, sql: 'CREATE TABLE extension (id INTEGER)' }], 3));
  const backup = join(directory, 'backup.sqlite'); db.prepare('VACUUM INTO ?').run(backup);
  const copy = new DatabaseSync(backup); databases.push(copy);
  expect(copy.prepare('PRAGMA integrity_check').get()!.integrity_check).toBe('ok');
  const restored = sqliteStores(copy);
  expect(restored.accounts.findOrCreate('Путник', 'путник', 4)).toEqual(player);
  expect(restored.players.load(player.playerId)?.position).toEqual({ x: 2, y: 0, z: 3 });
  expect(restored.dialogue.history(player.playerId, 'shepherd', 'test-session')).toEqual([{ question: 'Вопрос', answer: 'Ответ' }]);
  copy.exec('DROP TABLE extension');
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'extension'").get()!.name).toBe('extension');
});

it('repairs historical branch version collisions without dropping players, hands or credentials', () => {
  for (const recordedVersion of [3, 5, 6]) {
    const directory = mkdtempSync(join(tmpdir(), 'branch-schema-')); directories.push(directory);
    const path = join(directory, 'game.sqlite'); const old = new DatabaseSync(path);
    transaction(old, () => applyMigrations(old, loadMigrations().slice(0, 2), 1));
    old.exec("INSERT INTO accounts VALUES ('a', 'Old', 'old', 1); INSERT INTO players(id,account_id,updated_at) VALUES ('p','a',1)");
    old.exec("ALTER TABLE players ADD COLUMN equipped_tool TEXT; UPDATE players SET equipped_tool='jug'; ");
    old.exec(loadMigrations()[7]!.sql);
    old.exec("INSERT INTO world_apples(id,map_id,state,x,y,z) VALUES ('apple-kept','market','world',1,0,2)");
    for (let version = 3; version <= recordedVersion; version++) old.prepare('INSERT INTO schema_migrations VALUES (?,1)').run(version);
    old.close();
    const upgraded = openDatabase(path); const stores = sqliteStores(upgraded);
    expect(stores.avatars.load('p')).toBeNull(); stores.avatars.save('p', 'dan');
    expect(stores.equipment.load('p')).toBe('jug');
    upgraded.prepare('INSERT INTO babel_profiles VALUES (?, NULL, ?)').run('p', JSON.stringify({ groupId: null, native: 'ru', learning: 'en' }));
    expect(upgraded.prepare('SELECT id FROM world_apples').all()).toEqual([{ id: 'apple-kept' }]);
    expect(upgraded.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    upgraded.close();
    const reopened = openDatabase(path); databases.push(reopened);
    expect(sqliteStores(reopened).avatars.load('p')).toBe('dan');
    expect(reopened.prepare('SELECT count(*) AS n FROM accounts').get()!.n).toBe(1);
  }
});

it('merges upstream auth schema and old branch passwords without losing accounts or raw Unicode passwords', async () => {
  const { scryptSync } = await import('node:crypto');
  const { PasswordHasher } = await import('../src/auth/password.ts');
  for (const branch of ['upstream', 'client']) {
    const directory = mkdtempSync(join(tmpdir(), 'auth-merge-')); directories.push(directory);
    const path = join(directory, 'game.sqlite'); const old = new DatabaseSync(path);
    transaction(old, () => applyMigrations(old, loadMigrations().slice(0, branch === 'client' ? 6 : 2), 1));
    old.exec("INSERT INTO accounts(id,name,name_key,created_at) VALUES ('a','Saved','saved',1); INSERT INTO players(id,account_id,updated_at) VALUES ('p','a',1)");
    const password = 'e\u0301-password';
    let expectedHash: string;
    if (branch === 'client') {
      const salt = '01'.repeat(16);
      const key = scryptSync(password, Buffer.from(salt, 'hex'), 64, { N: 32768, r: 8, p: 1, maxmem: 67108864 });
      old.prepare('INSERT INTO account_credentials(account_id,salt,password_hash) VALUES (?,?,?)').run('a', salt, key.toString('hex'));
      old.exec("UPDATE players SET avatar_id='dan', equipped_tool='jug'");
      expectedHash = `scrypt-legacy$32768$8$1$${Buffer.from(salt, 'hex').toString('base64url')}$${key.subarray(0,32).toString('base64url')}`;
    } else {
      old.exec(loadMigrations()[6]!.sql);
      old.exec('INSERT INTO schema_migrations VALUES (3,1)');
      expectedHash = await new PasswordHasher().hash(password.normalize('NFC'));
      old.prepare('UPDATE accounts SET password_hash=? WHERE id=?').run(expectedHash,'a');
    }
    old.close();
    const db = openDatabase(path); const stores = sqliteStores(db);
    const record = stores.accounts.find('saved')!;
    expect(record.identity.playerId).toBe('p'); expect(record.passwordHash).toBe(expectedHash);
    const hasher = new PasswordHasher(); expect((await hasher.verify(password, record.passwordHash)).ok).toBe(true);
    expect((await hasher.verify('wrong', record.passwordHash)).ok).toBe(false);
    if (branch === 'client') {
      expect((await hasher.verify(password.normalize('NFC'), record.passwordHash)).ok).toBe(false);
      expect(stores.avatars.load('p')).toBe('dan'); expect(stores.equipment.load('p')).toBe('jug');
    }
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]); db.close();
    const reopened = openDatabase(path); databases.push(reopened);
    expect(sqliteStores(reopened).accounts.find('saved')?.passwordHash).toBe(expectedHash);
  }
});
