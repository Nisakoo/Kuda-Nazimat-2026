import type { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';

export interface Migration { version: number; sql: string }

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
