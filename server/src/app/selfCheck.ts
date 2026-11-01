import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Config } from './config.ts';
import { firewallHint, lanAddresses, type LanAddress } from '../common/network.ts';
import { loadMigrations } from '../persistence/migrate.ts';
import { loadWorld } from '../world/loader.ts';
import { describeCertificate, uncoveredNames } from '../tls/certificate.ts';
import { certificateNames, certificatePaths, daysLeft, EXPIRY_WARNING_DAYS } from '../tls/store.ts';

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

/** TLS-015: read-only look at the certificate; a missing one is fine, the first start creates it. */
export function certificateCheck(config: Config, addresses: readonly LanAddress[], now = new Date()): Check {
  const { certPath, keyPath } = certificatePaths(config.tls);
  if (!existsSync(certPath) && !existsSync(keyPath)) return { name: 'Сертификат', ok: true, detail: `${config.tls.dir}: будет создан при первом запуске (npm --prefix server run tls -- init)` };
  try {
    const info = describeCertificate(readFileSync(certPath, 'utf8'), readFileSync(keyPath, 'utf8'));
    const left = daysLeft(info, now);
    const missing = uncoveredNames(info, certificateNames(config.tls, addresses));
    const problems = [left < 0 ? `истёк ${info.notAfter.toISOString().slice(0, 10)}` : left < EXPIRY_WARNING_DAYS ? `истекает через ${left} дн.` : '', missing.length ? `не покрывает адреса: ${missing.join(', ')}` : ''].filter(Boolean);
    const mode = process.platform !== 'win32' && (statSync(keyPath).mode & 0o077) !== 0 ? `ключ доступен другим пользователям: chmod 600 "${keyPath}"` : '';
    if (mode) problems.push(mode);
    return { name: 'Сертификат', ok: left >= 0 && !mode, detail: `SHA-256 ${info.fingerprint}, до ${info.notAfter.toISOString().slice(0, 10)}${problems.length ? ` — ${problems.join('; ')}; выпустить заново: npm --prefix server run tls -- renew --yes` : ''}` };
  } catch { return { name: 'Сертификат', ok: false, detail: `${config.tls.dir}: сертификат или ключ повреждены — npm --prefix server run tls -- renew --yes` }; }
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
  checks.push(certificateCheck(config, options.addresses ?? lanAddresses()));
  checks.push({ name: 'Брандмауэр', ok: true, detail: firewallHint(options.platform).replace('<порт>', String(config.port)) });
  return checks;
}
