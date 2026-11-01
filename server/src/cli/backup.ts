import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { loadServerConfig } from '../app/config.ts';
try {
  const { config, args } = await loadServerConfig();
  const [destination] = args.rest;
  if (!destination || args.rest.length !== 1) throw new Error('Укажите новый файл backup');
  const db = new DatabaseSync(config.dbPath, { readOnly: true });
  try { db.prepare('VACUUM INTO ?').run(resolve(destination)); console.log(`Копия: ${resolve(destination)}`); }
  finally { db.close(); }
} catch { console.error('Backup не создан: укажите новый файл и проверьте конфигурацию.'); process.exitCode = 1; }
