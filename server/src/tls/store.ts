import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { hostname as osHostname } from 'node:os';
import { join } from 'node:path';
import type { LanAddress } from '../common/network.ts';
import { describeCertificate, issueCertificate, uncoveredNames, type CertificateInfo } from './certificate.ts';

export interface TlsConfig { readonly dir: string; readonly extraNames: readonly string[] }
export interface ServerCertificate {
  readonly cert: string; readonly key: string; readonly info: CertificateInfo;
  readonly certPath: string; readonly keyPath: string;
  /** True when this call generated the certificate: every device has to trust it (again). */
  readonly created: boolean;
  /** Current addresses the certificate does not cover; players there get a name mismatch (TLS-004). */
  readonly uncovered: readonly string[];
}

/** Days before expiry when the connection block, `/operator` and `lan:check` start warning (TLS-004). */
export const EXPIRY_WARNING_DAYS = 30;
const RENEW = 'npm --prefix server run tls -- renew';

export class TlsError extends Error {
  readonly code: 'invalid' | 'expired' | 'permissions';
  constructor(code: 'invalid' | 'expired' | 'permissions', message: string) { super(message); this.code = code; }
}

export const certificatePaths = (config: TlsConfig) => ({ certPath: join(config.dir, 'server.crt'), keyPath: join(config.dir, 'server.key') });

/** `<hostname>.local` when the host name is a plain DNS label; this name survives IP changes (TLS-013). */
export function localName(hostname = osHostname()): string | null {
  const label = hostname.toLowerCase().replace(/\.local\.?$/, '').split('.')[0] ?? '';
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label) ? `${label}.local` : null;
}

/** TLS-003: localhost, loopback, `<hostname>.local`, every current IPv4 and the configured extra names. */
export function certificateNames(config: TlsConfig, addresses: readonly LanAddress[], hostname?: string): string[] {
  const local = localName(hostname);
  return [...new Set(['localhost', ...(local ? [local] : []), '127.0.0.1', '::1', ...addresses.map((entry) => entry.address), ...config.extraNames.map((name) => name.toLowerCase())])];
}

/** Atomic create with 0600 for the key: temp file, then rename over the target (TLS-005). */
async function writePrivate(path: string, content: string, mode: number): Promise<void> {
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, content, { mode, flag: 'w' });
  await chmod(temp, mode);
  await rename(temp, path);
}

async function issue(config: TlsConfig, names: readonly string[], now: Date): Promise<{ cert: string; key: string }> {
  const issued = issueCertificate({ names, now });
  const { certPath, keyPath } = certificatePaths(config);
  await mkdir(config.dir, { recursive: true, mode: 0o700 });
  await writePrivate(keyPath, issued.key, 0o600);
  await writePrivate(certPath, issued.cert, 0o644);
  return issued;
}

async function read(config: TlsConfig): Promise<{ cert: string; key: string } | null> {
  const { certPath, keyPath } = certificatePaths(config);
  let key: string;
  try { key = await readFile(keyPath, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new TlsError('invalid', `Ключ ${keyPath} не читается — проверьте права или выполните ${RENEW}`);
    try { await stat(certPath); } catch { return null; }
    throw new TlsError('invalid', `Есть ${certPath}, но нет ключа ${keyPath}: выполните ${RENEW} и заново установите сертификат на устройствах`);
  }
  // POSIX only: Windows has no mode bits, its ACL already limits the user's profile.
  if (process.platform !== 'win32' && ((await stat(keyPath)).mode & 0o077) !== 0) {
    throw new TlsError('permissions', `Ключ ${keyPath} доступен другим пользователям: выполните chmod 600 "${keyPath}"`);
  }
  try { return { cert: await readFile(certPath, 'utf8'), key }; }
  catch { throw new TlsError('invalid', `Нет сертификата ${certPath} рядом с ключом: выполните ${RENEW} и заново установите сертификат на устройствах`); }
}

function result(config: TlsConfig, pair: { cert: string; key: string }, names: readonly string[], created: boolean): ServerCertificate {
  let info: CertificateInfo;
  try { info = describeCertificate(pair.cert, pair.key); }
  catch { throw new TlsError('invalid', `Сертификат в ${config.dir} повреждён или не подходит к ключу: выполните ${RENEW} и заново установите сертификат на устройствах`); }
  return { ...pair, ...certificatePaths(config), info, created, uncovered: uncoveredNames(info, names) };
}

/**
 * TLS-001, 004, 009: reads the certificate or creates it on the first run. An existing certificate is never
 * replaced silently, because every device trusts exactly this one; an expired or broken one stops the start.
 */
export async function loadCertificate(config: TlsConfig, names: readonly string[], now: Date): Promise<ServerCertificate> {
  const existing = await read(config);
  if (!existing) return result(config, await issue(config, names, now), names, true);
  const certificate = result(config, existing, names, false);
  if (certificate.info.notAfter.getTime() <= now.getTime()) {
    throw new TlsError('expired', `Сертификат истёк ${certificate.info.notAfter.toISOString().slice(0, 10)}: выполните ${RENEW} и заново установите его на устройствах игроков (страница /setup)`);
  }
  return certificate;
}

/** TLS-014: a new certificate for the current names; the previous trust on devices stops working. */
export async function renewCertificate(config: TlsConfig, names: readonly string[], now: Date): Promise<ServerCertificate> {
  return result(config, await issue(config, names, now), names, true);
}

/** Days left, rounded down; negative once expired. */
export function daysLeft(info: CertificateInfo, now: Date): number { return Math.floor((info.notAfter.getTime() - now.getTime()) / 86_400_000); }
