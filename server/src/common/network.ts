import { networkInterfaces } from 'node:os';
import type { NetworkInterfaceInfo } from 'node:os';

/** OFFLINE-002: one non-loopback IPv4 per interface; private ranges first, link-local last. */
export interface LanAddress { readonly name: string; readonly address: string; readonly kind: 'private' | 'other' | 'link-local' }

const RANK = { private: 0, other: 1, 'link-local': 2 } as const;

export function addressKind(address: string): LanAddress['kind'] {
  const [a = 0, b = 0] = address.split('.').map(Number);
  if (a === 169 && b === 254) return 'link-local';
  if (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return 'private';
  return 'other';
}

export function lanAddresses(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): LanAddress[] {
  const result: LanAddress[] = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) if (!entry.internal && entry.family === 'IPv4') result.push({ name, address: entry.address, kind: addressKind(entry.address) });
  }
  return result.sort((a, b) => RANK[a.kind] - RANK[b.kind]);
}

export function isLoopback(address: string | undefined): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/** OFFLINE-006: the server never changes the firewall itself, it only explains what to allow. */
export function firewallHint(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return 'Windows: при первом запуске разрешите Node.js для частных сетей; профиль сети роутера должен быть «Частная».';
  if (platform === 'darwin') return 'macOS: разрешите входящие подключения для Node в «Системные настройки → Сеть → Брандмауэр».';
  return 'Linux: откройте TCP-порт сервера, например `sudo ufw allow <порт>/tcp`.';
}

export interface Connection { readonly local: string; readonly lan: readonly (LanAddress & { readonly url: string })[]; readonly operator: string; readonly warnings: readonly string[] }

/** Addresses players and the operator use for a server listening on host:port. */
export function connectionInfo(host: string, port: number, addresses: readonly LanAddress[], platform: NodeJS.Platform = process.platform): Connection {
  const url = (address: string) => `http://${address.includes(':') ? `[${address}]` : address}:${port}/`;
  const warnings: string[] = [];
  let lan: LanAddress[] = [];
  if (host === '127.0.0.1' || host === 'localhost' || host === '::1') warnings.push(`host = ${host}: другие устройства не подключатся, доступен только этот компьютер.`);
  else if (host === '0.0.0.0' || host === '::') {
    lan = [...addresses];
    if (!lan.some((entry) => entry.kind !== 'link-local')) warnings.push('Нет подключённой сети: доступен только режим одного компьютера (http://localhost).');
  } else lan = [{ name: 'host', address: host, kind: addressKind(host) }];
  if (lan.length) warnings.push(firewallHint(platform).replace('<порт>', String(port)));
  return { local: url('localhost'), lan: lan.map((entry) => ({ ...entry, url: url(entry.address) })), operator: `${url('localhost')}operator`, warnings };
}

/** The block printed at startup; it is meant to be read from across the room. */
export function connectionBlock(info: Connection): string {
  const line = '='.repeat(64);
  const lan = info.lan.length
    ? info.lan.map((entry) => `    ${entry.url.padEnd(30)} ${entry.name}${entry.kind === 'link-local' ? ' (нет сети)' : ''}`)
    : ['    —'];
  return [line, '  ВАВИЛОН ЗАПУЩЕН', '', `  Этот компьютер:     ${info.local}`, '  Другие устройства:', ...lan, `  Администратор:      ${info.operator}`,
    ...(info.warnings.length ? ['', ...info.warnings.map((warning) => `  ! ${warning}`)] : []), line].join('\n');
}
