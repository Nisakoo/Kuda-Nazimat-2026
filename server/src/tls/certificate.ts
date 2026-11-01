import { X509Certificate, createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { isIP } from 'node:net';
import { bitString, boolean, explicit, integer, octetString, oid, sequence, set, time, tlv, utf8String } from './der.ts';

/** TLS-003: Apple accepts at most 825 days for a TLS server certificate, even a locally trusted one. */
export const VALIDITY_DAYS = 825;
/** Clock skew between the server and player laptops must not make a fresh certificate "not yet valid". */
const BACKDATE_MS = 3600_000;
const DAY_MS = 86_400_000;

const ECDSA_SHA256 = '1.2.840.10045.4.3.2';
const COMMON_NAME = '2.5.4.3';
const ORGANIZATION = '2.5.4.10';
const SUBJECT_KEY_ID = '2.5.29.14';
const KEY_USAGE = '2.5.29.15';
const SUBJECT_ALT_NAME = '2.5.29.17';
const BASIC_CONSTRAINTS = '2.5.29.19';
const EXT_KEY_USAGE = '2.5.29.37';
const SERVER_AUTH = '1.3.6.1.5.5.7.3.1';

export interface CertificateRequest {
  /** DNS names and IP literals for subjectAltName; the first one also becomes the common name. */
  readonly names: readonly string[];
  readonly now: Date;
  readonly days?: number;
}
export interface IssuedCertificate { readonly cert: string; readonly key: string }

const extension = (id: string, critical: boolean, value: Buffer) => sequence(oid(id), ...(critical ? [boolean(true)] : []), octetString(value));

function ipBytes(address: string): Buffer {
  if (isIP(address) === 4) return Buffer.from(address.split('.').map(Number));
  // Expand "::" so the address has eight groups of 16 bits.
  const [head = '', tail] = address.split('::');
  const parts = (value: string) => (value ? value.split(':') : []);
  const groups = tail === undefined ? parts(head) : [...parts(head), ...Array<string>(8 - parts(head).length - parts(tail).length).fill('0'), ...parts(tail)];
  return Buffer.from(groups.flatMap((group) => { const n = parseInt(group, 16); return [n >> 8, n & 0xff]; }));
}

function alternativeName(name: string): Buffer {
  return isIP(name) ? tlv(0x87, ipBytes(name)) : tlv(0x82, Buffer.from(name, 'ascii'));
}

/** TLS-001, 003, 006: a self-signed ECDSA P-256 server certificate built with node:crypto only. */
export function issueCertificate(request: CertificateRequest): IssuedCertificate {
  if (!request.names.length) throw new Error('Сертификату нужно хотя бы одно имя');
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const spki = publicKey.export({ type: 'spki', format: 'der' });
  const name = sequence(
    set(sequence(oid(ORGANIZATION), utf8String('Вавилон LAN'))),
    set(sequence(oid(COMMON_NAME), utf8String(request.names[0]!))),
  );
  const serial = randomBytes(16); serial[0] = (serial[0]! & 0x7f) | 0x01;
  const notBefore = new Date(Math.floor((request.now.getTime() - BACKDATE_MS) / 1000) * 1000);
  const notAfter = new Date(notBefore.getTime() + (request.days ?? VALIDITY_DAYS) * DAY_MS);
  // The key identifier is the SHA-1 of the subjectPublicKey bits, after the 26-byte P-256 SPKI header.
  const keyId = createHash('sha1').update(spki.subarray(spki.length - 65)).digest();
  const algorithm = sequence(oid(ECDSA_SHA256));
  const tbs = sequence(
    explicit(0, integer(2)),
    integer(serial),
    algorithm,
    name,
    sequence(time(notBefore), time(notAfter)),
    name,
    spki,
    explicit(3, sequence(
      extension(BASIC_CONSTRAINTS, true, sequence()),
      // digitalSignature only (ECDHE handshake); RFC 5280 forbids keyCertSign without CA:TRUE.
      extension(KEY_USAGE, true, tlv(0x03, Buffer.from([0x07, 0x80]))),
      extension(EXT_KEY_USAGE, false, sequence(oid(SERVER_AUTH))),
      extension(SUBJECT_ALT_NAME, false, sequence(...request.names.map(alternativeName))),
      extension(SUBJECT_KEY_ID, false, octetString(keyId)),
    )),
  );
  const signature = sign('sha256', tbs, { key: privateKey, dsaEncoding: 'der' });
  const der = sequence(tbs, algorithm, bitString(signature));
  const cert = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`;
  return { cert, key: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string };
}

export interface CertificateInfo {
  /** SHA-256 of the DER certificate, "AB12 CD34 …" for comparing by eye (TLS-011). */
  readonly fingerprint: string;
  /** SHA-1 as well: Windows shows only this one in its trust prompt. */
  readonly fingerprintSha1: string;
  readonly notBefore: Date;
  readonly notAfter: Date;
  readonly names: readonly string[];
}

/** Reads back a certificate and checks it matches the key and its own signature (TLS-005, 009). */
export function describeCertificate(cert: string, key?: string): CertificateInfo {
  const x509 = new X509Certificate(cert);
  if (!x509.verify(x509.publicKey)) throw new Error('Подпись сертификата не сходится');
  if (key !== undefined && !x509.checkPrivateKey(createPrivateKey(key))) throw new Error('Ключ не подходит к сертификату');
  const names = (x509.subjectAltName ?? '').split(', ').filter(Boolean).map((entry) => entry.replace(/^(?:DNS|IP Address):/, '').toLowerCase());
  return {
    fingerprint: x509.fingerprint256.replace(/:/g, '').match(/.{4}/g)!.join(' '), fingerprintSha1: x509.fingerprint.replace(/:/g, '').match(/.{4}/g)!.join(' '),
    notBefore: new Date(x509.validFrom), notAfter: new Date(x509.validTo), names,
  };
}

/** Addresses from `wanted` the certificate does not cover; IPv6 is compared in its expanded form. */
export function uncoveredNames(info: CertificateInfo, wanted: readonly string[]): string[] {
  const canonical = (name: string) => (isIP(name) === 6 ? ipBytes(name).toString('hex') : name.toLowerCase());
  const covered = new Set(info.names.map(canonical));
  return wanted.filter((name) => !covered.has(canonical(name)));
}
