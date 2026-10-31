import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { configArgument, loadConfig } from '../app/config.ts';
try {
  const [destination, ...args] = process.argv.slice(2);
  if (!destination || destination.startsWith('--')) throw new Error('Укажите новый файл backup');
  const config = await loadConfig(configArgument(args));
  const db = new DatabaseSync(config.dbPath, { readOnly: true });
  try { db.prepare('VACUUM INTO ?').run(resolve(destination)); console.log(`Копия: ${resolve(destination)}`); }
  finally { db.close(); }
} catch { console.error('Backup не создан: укажите новый файл и проверьте конфигурацию.'); process.exitCode = 1; }
