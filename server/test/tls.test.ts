import { X509Certificate, createPublicKey, verify } from 'node:crypto';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { request as plainRequest } from 'node:http';
import { request as secureRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { parseConfig } from '../src/app/config.ts';
import { lanCheck } from '../src/app/selfCheck.ts';
import { describeCertificate, issueCertificate, uncoveredNames } from '../src/tls/certificate.ts';
import { certificateNames, daysLeft, loadCertificate, localName, renewCertificate, TlsError } from '../src/tls/store.ts';
import { setup } from './harness.ts';

const directories: string[] = [];
const temporary = async () => { const dir = await mkdtemp(join(tmpdir(), 'kuda-tls-test-')); directories.push(dir); return dir; };
afterEach(async () => { for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true }); });
const NAMES = ['localhost', '127.0.0.1', '::1'];
const NOW = new Date('2026-11-01T12:00:00Z');

describe('certificate (TLS-001, 003, 005, 006)', () => {
  it('is a self-signed ECDSA P-256 server certificate with the required fields', () => {
    const { cert, key } = issueCertificate({ names: [...NAMES, '192.168.1.96', 'babylon.local', 'fe80::1'], now: NOW });
    const x509 = new X509Certificate(cert);
    expect(x509.ca).toBe(false);
    expect(x509.verify(x509.publicKey)).toBe(true);
    expect(x509.checkPrivateKey(require_(key))).toBe(true);
    expect(x509.publicKey.asymmetricKeyDetails?.namedCurve).toBe('prime256v1');
    expect(x509.keyUsage ?? []).not.toContain('1.3.6.1.5.5.7.3.2');
    expect(x509.subjectAltName).toBe('DNS:localhost, IP Address:127.0.0.1, IP Address:0:0:0:0:0:0:0:1, IP Address:192.168.1.96, DNS:babylon.local, IP Address:FE80:0:0:0:0:0:0:1');
    expect(x509.checkHost('localhost')).toBe('localhost');
    expect(x509.checkIP('192.168.1.96')).toBe('192.168.1.96');
    expect(x509.checkIP('192.168.1.97')).toBeUndefined();
    const days = (new Date(x509.validTo).getTime() - new Date(x509.validFrom).getTime()) / 86_400_000;
    expect(days).toBeGreaterThan(824); expect(days).toBeLessThanOrEqual(825);
    expect(new Date(x509.validFrom).getTime()).toBeLessThan(NOW.getTime());
    // The self-signature really is over the TBS bytes (raw check, independent of X509Certificate.verify).
    expect(verify('sha256', tbs(x509.raw), { key: createPublicKey(x509.publicKey.export({ type: 'spki', format: 'pem' })), dsaEncoding: 'der' }, signature(x509.raw))).toBe(true);
  });

  it('reads back fingerprints and detects names it does not cover', () => {
    const { cert, key } = issueCertificate({ names: ['localhost', '192.168.1.96', '::1'], now: NOW });
    const info = describeCertificate(cert, key);
    expect(info.fingerprint).toMatch(/^([0-9A-F]{4} ){15}[0-9A-F]{4}$/); expect(info.fingerprintSha1).toMatch(/^([0-9A-F]{4} ){9}[0-9A-F]{4}$/);
    expect(uncoveredNames(info, ['localhost', '192.168.1.96', '::1', '192.168.1.97', 'Other.local'])).toEqual(['192.168.1.97', 'Other.local']);
    expect(() => describeCertificate(cert, issueCertificate({ names: NAMES, now: NOW }).key)).toThrow('Ключ не подходит');
  });

  it('rejects an empty name list', () => { expect(() => issueCertificate({ names: [], now: NOW })).toThrow(); });

  it('collects localhost, loopback, the host name, interfaces and extra names without duplicates', () => {
    const names = certificateNames({ dir: '', extraNames: ['Game.School', '192.168.1.96'] }, [{ name: 'en0', address: '192.168.1.96', kind: 'private' }], 'My-Laptop.local');
    expect(names).toEqual(['localhost', 'my-laptop.local', '127.0.0.1', '::1', '192.168.1.96', 'game.school']);
    expect(localName('Ксения-MacBook')).toBeNull(); expect(localName('host.example.org')).toBe('host.local');
  });
});

describe('certificate store (TLS-004, 005, 009, 014)', () => {
  it('creates once, keeps the key private and never replaces an existing certificate silently', async () => {
    const dir = await temporary(); const config = { dir: join(dir, 'tls'), extraNames: [] };
    const first = await loadCertificate(config, NAMES, NOW);
    expect(first.created).toBe(true);
    if (process.platform !== 'win32') expect((await stat(first.keyPath)).mode & 0o777).toBe(0o600);
    const second = await loadCertificate(config, [...NAMES, '10.9.8.7'], NOW);
    expect(second.created).toBe(false); expect(second.cert).toBe(first.cert);
    expect(second.uncovered).toEqual(['10.9.8.7']);
    const renewed = await renewCertificate(config, [...NAMES, '10.9.8.7'], NOW);
    expect(renewed.created).toBe(true); expect(renewed.cert).not.toBe(first.cert); expect(renewed.uncovered).toEqual([]);
    expect((await loadCertificate(config, NAMES, NOW)).cert).toBe(renewed.cert);
  });

  it('refuses to start with an expired, broken, half-missing or world-readable certificate', async () => {
    const dir = await temporary(); const config = { dir: join(dir, 'tls'), extraNames: [] };
    const created = await loadCertificate(config, NAMES, NOW);
    const later = new Date(NOW.getTime() + 900 * 86_400_000);
    await expect(loadCertificate(config, NAMES, later)).rejects.toMatchObject({ code: 'expired', message: expect.stringContaining('tls -- renew') });
    expect(daysLeft(created.info, NOW)).toBe(824); expect(daysLeft(created.info, later)).toBeLessThan(0);
    if (process.platform !== 'win32') {
      await chmod(created.keyPath, 0o644);
      await expect(loadCertificate(config, NAMES, NOW)).rejects.toMatchObject({ code: 'permissions', message: expect.stringContaining('chmod 600') });
      await chmod(created.keyPath, 0o600);
    }
    await writeFile(created.certPath, 'not a certificate');
    await expect(loadCertificate(config, NAMES, NOW)).rejects.toBeInstanceOf(TlsError);
    await rm(created.keyPath);
    await expect(loadCertificate(config, NAMES, NOW)).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('нет ключа') });
  });

  it('lan:check reports the certificate and fails for a broken one', async () => {
    const dir = await temporary(); const config = parseConfig({ tls: { dir: join(dir, 'tls') } }, join(dir, 'config.json'), 'test');
    const before = (await lanCheck(config, { addresses: [] })).find((check) => check.name === 'Сертификат');
    expect(before).toMatchObject({ ok: true, detail: expect.stringContaining('будет создан') });
    await loadCertificate(config.tls, NAMES, new Date());
    const ok = (await lanCheck(config, { addresses: [] })).find((check) => check.name === 'Сертификат');
    expect(ok).toMatchObject({ ok: true, detail: expect.stringContaining('SHA-256') });
    await writeFile(join(config.tls.dir, 'server.crt'), 'garbage');
    expect((await lanCheck(config, { addresses: [] })).find((check) => check.name === 'Сертификат')).toMatchObject({ ok: false });
  });

  it('validates tls configuration', () => {
    const path = '/srv/kn/server/config.json';
    expect(parseConfig({ tls: { extraNames: ['game.school', '10.1.2.3'] } }, path).tls).toEqual({ dir: '/srv/kn/server/data/tls', extraNames: ['game.school', '10.1.2.3'] });
    for (const tls of [{ extraNames: ['bad name'] }, { extraNames: ['x/y'] }, { extraNames: Array(9).fill('a.local') }, { extraNames: 'a.local' }, { dir: '' }, { enabled: false }]) expect(() => parseConfig({ tls }, path), JSON.stringify(tls)).toThrow();
  });
});

describe('transport on one port (TLS-007, 008, 009)', () => {
  it('serves login, API, world and Socket.IO polling and WebSocket only over TLS', async () => {
    const { origin, port, guest, connect } = await setup();
    const session = await guest('Аня');
    expect((await fetch(`${origin}/api/auth/state`, { headers: { Authorization: `Bearer ${session.token}` } })).status).toBe(200);
    expect(await (await fetch(`${origin}/api/health`)).json()).toMatchObject({ status: 'ok' });
    const socket = await connect(session.token);
    socket.command('join', { mapId: 'test' }); await socket.wait((p) => p.type === 'joined');
    const polled = io(`${origin}/game`, { auth: { version: 3, token: session.token }, transports: ['polling'], reconnection: false, forceNew: true });
    await new Promise<void>((resolve, reject) => { polled.once('connect', resolve); polled.once('connect_error', reject); });
    expect(polled.io.engine.transport.name).toBe('polling'); polled.disconnect();
    expect(port).toBeGreaterThan(0);
  });

  it('answers plain HTTP only with the trust page, the certificate, health and redirects (S4)', async () => {
    const { port, post, config } = await setup();
    const plain = (method: string, path: string, headers: Record<string, string> = {}, body?: string) => new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; text: string }>((resolve, reject) => {
      const req = plainRequest({ host: '127.0.0.1', port, method, path, headers: { Host: `127.0.0.1:${port}`, ...headers } }, (res) => {
        let text = ''; res.setEncoding('utf8'); res.on('data', (chunk) => { text += chunk; }); res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, text }));
      });
      req.on('error', reject); req.end(body);
    });
    const home = await plain('GET', '/?a=1');
    expect(home.status).toBe(308); expect(home.headers.location).toBe(`https://127.0.0.1:${port}/?a=1`);
    expect((await plain('GET', '/api/auth/guest', { Host: 'evil.example' })).status).toBe(400);
    expect((await plain('GET', '/', { Host: `127.0.0.1:${port}@evil.example` })).status).toBe(400);
    const health = await plain('GET', '/api/health'); expect(health.status).toBe(200); expect(JSON.parse(health.text)).toMatchObject({ status: 'ok' });
    const login = await plain('POST', '/api/auth/guest', { 'Content-Type': 'application/json' }, JSON.stringify({ name: 'Пароль' }));
    expect(login.status).toBe(426); expect(login.text).not.toContain('token');
    // The refused request did nothing: no session was created for that name over TLS either.
    expect((await post('/api/auth/guest', { name: 'Пароль' })).status).toBe(200);
    expect((await plain('GET', '/socket.io/?EIO=4&transport=polling')).status).toBe(308);
    const key = await plain('GET', '/server.key'); expect(key.status).toBe(308);
    expect(JSON.stringify(key)).not.toContain('PRIVATE KEY');
    expect(config.tls.dir).toBeTruthy();
  });

  it('shows the same trust page and certificate over http and https, never the key (S7)', async () => {
    const { origin, port, app } = await setup();
    const { certificate } = app;
    const viaHttps = await fetch(`${origin}/setup`); const html = await viaHttps.text();
    expect(viaHttps.status).toBe(200); expect(html).toContain(certificate.info.fingerprint); expect(html).toContain(certificate.info.fingerprintSha1);
    expect(html).not.toMatch(/<script/i); expect(html).not.toContain('PRIVATE KEY');
    expect(html).toContain(`https://127.0.0.1:${port}/`);
    const download = await fetch(`${origin}/server.crt`);
    expect(download.headers.get('content-type')).toBe('application/x-x509-ca-cert');
    expect(await download.text()).toBe(await readFile(certificate.certPath, 'utf8'));
    for (const path of ['/server.key', '/data/tls/server.key', '/%2e%2e/data/tls/server.key']) { const body = await (await fetch(`${origin}${path}`)).text(); expect(body).not.toContain('PRIVATE KEY'); }
    expect((await fetch(`${origin}/setup`, { method: 'POST' })).status).toBe(405);
  });

  it('counts devices that reject the certificate and shows them on the operator screen (TLS-011, 012)', async () => {
    const { origin, port } = await setup();
    const stranger = issueCertificate({ names: NAMES, now: new Date() }).cert;
    await new Promise<void>((resolve) => {
      const req = secureRequest({ host: '127.0.0.1', port, path: '/', ca: stranger }, () => resolve());
      req.on('error', () => resolve()); req.end();
    });
    const status = await (async () => {
      for (let attempt = 0; attempt < 30; attempt++) {
        const body = await (await fetch(`${origin}/api/operator/status`)).json() as { setup: string[]; tls: { fingerprint: string; untrusted: { ip: string; reason: string }[]; uncovered: string[] } };
        if (body.tls.untrusted.length) return body;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error('no untrusted device reported');
    })();
    expect(status.tls.untrusted[0]).toMatchObject({ reason: 'untrusted' }); expect(status.tls.untrusted[0]!.ip).toMatch(/127\.0\.0\.1$/);
    expect(status.tls.fingerprint).toMatch(/^([0-9A-F]{4} ){15}[0-9A-F]{4}$/);
    expect(status.setup.every((url) => url.startsWith('http://') && url.endsWith('/setup'))).toBe(true);
    const metrics = await (await fetch(`${origin}/metrics`)).text();
    expect(metrics).toMatch(/tls_handshake_failures_total\{reason="untrusted"\} [1-9]/);
  });

  it('operator actions need an https loopback origin', async () => {
    const { origin, port, post } = await setup();
    const action = (originHeader: string) => post('/api/operator/actions/dump', {}, { 'X-Operator': '1', Origin: originHeader });
    expect((await action(`http://127.0.0.1:${port}`)).status).toBe(403);
    expect((await action(origin)).status).not.toBe(403);
  });
});

function require_(pem: string) { return createPrivateKeyFromPem(pem); }
import { createPrivateKey as createPrivateKeyFromPem } from 'node:crypto';

/** Raw DER walk: the first and third element of the outer SEQUENCE. */
function elements(der: Buffer): Buffer[] {
  const read = (offset: number) => { const first = der[offset + 1]!; return first < 0x80 ? { header: 2, size: first } : { header: 2 + (first & 0x7f), size: der.subarray(offset + 2, offset + 2 + (first & 0x7f)).reduce((n, byte) => n * 256 + byte, 0) }; };
  const outer = read(0); const result: Buffer[] = []; let offset = outer.header;
  while (offset < der.length) { const { header, size } = read(offset); result.push(der.subarray(offset, offset + header + size)); offset += header + size; }
  return result;
}
const tbs = (der: Buffer) => elements(der)[0]!;
function signature(der: Buffer): Buffer { const bits = elements(der)[2]!; return bits.subarray(bits.length - (bits[1]! < 0x80 ? bits[1]! : bits.length) + 1); }
