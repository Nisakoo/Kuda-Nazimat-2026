import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { lanAddresses } from '../src/common/network.ts';
import { loadCertificate, type ServerCertificate } from '../src/tls/store.ts';
import type { Config } from '../src/app/config.ts';

/**
 * Tests talk to real https servers with a self-signed certificate, so the process has to trust it, like a player
 * does once. Node keeps the first trusted set for the rest of the process, so every test shares one certificate
 * (created by the same code the server uses) instead of generating its own.
 */
// LAN tests connect through the machine's real addresses, so the certificate has to cover them.
const names = ['localhost', '127.0.0.1', '::1', ...lanAddresses().map((entry) => entry.address)];
let shared: Promise<ServerCertificate & { dir: string }> | undefined;

function sharedCertificate(): Promise<ServerCertificate & { dir: string }> {
  shared ??= (async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kuda-tls-'));
    process.once('exit', () => rmSync(dir, { force: true, recursive: true }));
    const certificate = await loadCertificate({ dir, extraNames: [] }, names, new Date());
    setDefaultCACertificates([...getCACertificates('default'), certificate.cert]);
    return { ...certificate, dir };
  })();
  return shared;
}

/** The certificate for direct `createHttpServer` tests. */
export const testCertificate = (): Promise<ServerCertificate> => sharedCertificate();

/** `startApplication` with the shared, trusted certificate directory. */
export async function startTrusted<T>(start: (config: Config, ...rest: any[]) => Promise<T>, config: Config, ...rest: unknown[]): Promise<T> {
  const { dir } = await sharedCertificate();
  return start({ ...config, tls: { ...config.tls, dir } }, ...rest);
}
