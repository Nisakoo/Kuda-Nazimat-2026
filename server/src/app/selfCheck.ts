import { existsSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Config } from './config.ts';
import { firewallHint, lanAddresses, type LanAddress } from '../common/network.ts';
import { loadMigrations } from '../persistence/migrate.ts';
import { loadWorld } from '../world/loader.ts';

/** One diagnostic line; `ok: false` means the server cannot start as configured. */
export interface Check { readonly name: string; readonly ok: boolean; readonly detail: string }

export function nodeCheck(version = process.versions.node): Check {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return { name: 'Node', ok: major === 24 && minor >= 15, detail: `${version} (нужна 24.15+ в ветке 24)` };
}

export function portCheck(host: string, port: number): Promise<Check> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', (error: NodeJS.ErrnoException) => resolve({ name: 'Порт', ok: false, detail: error.code === 'EADDRINUSE' ? `${host}:${port} занят — возможно, сервер уже запущен; другой порт: --port <номер>`
      : error.code === 'EACCES' ? `${host}:${port} недоступен — его занимает другая программа или он закрыт системой; другой порт: --port <номер>`
      : `${host}:${port} недоступен (${error.code ?? 'ошибка'})` }));
    probe.listen(port, host, () => probe.close(() => resolve({ name: 'Порт', ok: true, detail: `${host}:${port} свободен` })));
  });
}

export function databaseCheck(path: string, migrations = loadMigrations().length): Check {
  if (!existsSync(path)) return { name: 'БД', ok: true, detail: `${path} будет создана при первом запуске` };
  try {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const version = Number((db.prepare('SELECT max(version) AS version FROM schema_migrations').get() as { version: number | null }).version ?? 0);
      if (version > migrations) return { name: 'БД', ok: false, detail: `${path}: версия схемы ${version} новее сервера (${migrations})` };
      return { name: 'БД', ok: true, detail: `${path} открывается, схема ${version}/${migrations}${version < migrations ? ' — миграции применятся при запуске' : ''}` };
    } finally { db.close(); }
  } catch { return { name: 'БД', ok: false, detail: `${path} не открывается — проверьте файл или восстановите копию` }; }
}

function interfacesCheck(addresses: readonly LanAddress[]): Check {
  const usable = addresses.filter((a) => a.kind !== 'link-local');
  const listed = addresses.map((a) => `${a.name} ${a.address}${a.kind === 'link-local' ? ' (нет сети)' : a.kind === 'private' ? ' (частная)' : ''}`).join('; ');
  return { name: 'Сеть', ok: true, detail: usable.length ? listed : `${listed || 'нет интерфейсов'} — доступен только режим одного компьютера` };
}

/** OFFLINE-008: everything a start needs, without starting the game. */
export async function lanCheck(config: Config, options: { addresses?: readonly LanAddress[]; platform?: NodeJS.Platform; node?: string } = {}): Promise<Check[]> {
  const checks: Check[] = [nodeCheck(options.node), interfacesCheck(options.addresses ?? lanAddresses()), await portCheck(config.host, config.port)];
  const index = join(config.clientDir, 'index.html');
  checks.push({ name: 'Клиент', ok: existsSync(index) && statSync(index).isFile(), detail: existsSync(index) ? index : `нет ${index} — выполните make prepare` });
  try {
    const world = await loadWorld({ worldDir: config.worldDir, maps: config.maps, contentDir: config.contentDir });
    checks.push({ name: 'Мир', ok: true, detail: [...world.maps.keys()].join(', ') });
  } catch (error) { checks.push({ name: 'Мир', ok: false, detail: `${error instanceof Error ? error.message : 'ошибка'} — выполните make prepare` }); }
  checks.push(databaseCheck(config.dbPath));
  checks.push({ name: 'Брандмауэр', ok: true, detail: firewallHint(options.platform).replace('<порт>', String(config.port)) });
  return checks;
}
