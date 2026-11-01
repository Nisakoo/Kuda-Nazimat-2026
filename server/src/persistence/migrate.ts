import type { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';

export interface Migration { version: number; sql: string }

/** Older development branches used versions 3–5 for hand items. Preserve their
 * data while reconciling the additive account fields required by this client. */
export function applyApplicationMigrations(db: DatabaseSync, now: number): void {
  const migrations = loadMigrations();
  // Upstream used version 3 for auth; this branch used it for appearance.
  // Reconcile each auth column independently, even on partially upgraded DBs.
  const authSql = migrations.find(m => m.version === 7)!.sql;
  function reconcileAuth(): void {
    for (const statement of authSql.split(';').map(s => s.trim()).filter(Boolean)) {
      const alter = /ALTER TABLE (\w+) ADD COLUMN (\w+)/.exec(statement);
      if (alter && db.prepare(`PRAGMA table_info(${alter[1]})`).all().some(row => row.name === alter[2])) continue;
      db.exec(statement.replace('CREATE UNIQUE INDEX ', 'CREATE UNIQUE INDEX IF NOT EXISTS ').replace('CREATE INDEX ', 'CREATE INDEX IF NOT EXISTS '));
    }
  }
  const exists = (version: number): boolean => {
    if (version === 6) return db.prepare('PRAGMA table_info(babel_profiles)').all().some(row => row.name === 'party_id' && row.notnull === 0);
    if (version === 4) return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'account_credentials'").get();
    const column = version === 3 ? 'avatar_id' : 'equipped_tool';
    return db.prepare('PRAGMA table_info(players)').all().some(row => row.name === column);
  };
  const additive = [3, 4, 5, 6];
  applyMigrations(db, migrations.map(migration => migration.version === 7 || migration.version === 9 || additive.includes(migration.version) && exists(migration.version)
    ? { ...migration, sql: 'SELECT 1;' } : migration), now);
  // Version numbers alone do not prove the schema of an old development DB.
  for (const version of additive) if (!exists(version)) db.exec(migrations[version - 1]!.sql);
  reconcileAuth();
  // Version 4 on the NPC branch already installed these objects. Reconcile each
  // object independently, including partially upgraded databases, without moving rows.
  const npcSql = migrations.find(m => m.version === 9)!.sql.replace(/^\s*--.*$/gm, '');
  for (const statement of npcSql.split(';').map(s => s.trim()).filter(Boolean)) {
    if (/^ALTER TABLE npc_dialogue ADD COLUMN session_id\b/.test(statement) &&
        db.prepare('PRAGMA table_info(npc_dialogue)').all().some(row => row.name === 'session_id')) continue;
    db.exec(statement.replace(/^CREATE TABLE /, 'CREATE TABLE IF NOT EXISTS ').replace(/^CREATE INDEX /, 'CREATE INDEX IF NOT EXISTS '));
  }
  // Preserve the old scrypt parameters and raw password semantics. No plaintext needed.
  for (const row of db.prepare('SELECT account_id, salt, password_hash FROM account_credentials').all()) {
    const salt = Buffer.from(String(row.salt), 'hex').toString('base64url');
    const key = Buffer.from(String(row.password_hash), 'hex').subarray(0, 32).toString('base64url');
    db.prepare('UPDATE accounts SET password_hash = ? WHERE id = ? AND password_hash IS NULL')
      .run(`scrypt-legacy$32768$8$1$${salt}$${key}`, String(row.account_id));
  }
}

export function loadMigrations(directory = new URL('./migrations/', import.meta.url)): Migration[] {
  return readdirSync(directory).filter((name) => name.endsWith('.sql')).map((name) => {
    if (!/^[0-9]{3}\.sql$/.test(name)) throw new Error(`Неверное имя миграции: ${name}`);
    return { version: Number(name.slice(0, 3)), sql: readFileSync(new URL(name, directory), 'utf8') };
  }).sort((a, b) => a.version - b.version);
}

/** Runs inside the startup transaction, before any game requests are accepted. */
export function applyMigrations(db: DatabaseSync, migrations: readonly Migration[], now: number): void {
  if (!migrations.length || migrations.some((migration, index) => migration.version !== index + 1 || !migration.sql.trim())) {
    throw new Error('Миграции должны иметь непрерывные версии от 1 и непустой SQL');
  }
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const applied = db.prepare('SELECT version FROM schema_migrations ORDER BY version').all();
  if (applied.some((row, index) => row.version !== index + 1 || Number(row.version) > migrations.length)) {
    throw new Error('Неизвестная версия БД или нарушена последовательность миграций');
  }
  const record = db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)');
  for (const migration of migrations.slice(applied.length)) {
    db.exec(migration.sql);
    record.run(migration.version, now);
  }
}
