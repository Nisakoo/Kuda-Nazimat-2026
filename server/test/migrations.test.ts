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
  stores.dialogue.append(player.playerId, 'shepherd', 'Вопрос', 'Ответ', 2);
  const migrations = loadMigrations();
  transaction(db, () => applyMigrations(db, [...migrations, { version: migrations.length + 1, sql: 'CREATE TABLE extension (id INTEGER)' }], 3));
  const backup = join(directory, 'backup.sqlite'); db.prepare('VACUUM INTO ?').run(backup);
  const copy = new DatabaseSync(backup); databases.push(copy);
  expect(copy.prepare('PRAGMA integrity_check').get()!.integrity_check).toBe('ok');
  const restored = sqliteStores(copy);
  expect(restored.accounts.findOrCreate('Путник', 'путник', 4)).toEqual(player);
  expect(restored.players.load(player.playerId)?.position).toEqual({ x: 2, y: 0, z: 3 });
  expect(restored.dialogue.history(player.playerId, 'shepherd')).toEqual([{ question: 'Вопрос', answer: 'Ответ' }]);
  copy.exec('DROP TABLE extension');
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'extension'").get()!.name).toBe('extension');
});
