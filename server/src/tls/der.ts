/** Minimal DER encoder for the X.509 fields TLS-006 needs; no parsing (node:crypto reads certificates back). */

function length(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let rest = n; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

export function tlv(tag: number, value: Buffer): Buffer { return Buffer.concat([Buffer.from([tag]), length(value.length), value]); }
export const sequence = (...items: Buffer[]): Buffer => tlv(0x30, Buffer.concat(items));
export const set = (...items: Buffer[]): Buffer => tlv(0x31, Buffer.concat(items));
/** Context-specific constructed [n] EXPLICIT. */
export const explicit = (n: number, value: Buffer): Buffer => tlv(0xa0 | n, value);
export const octetString = (value: Buffer): Buffer => tlv(0x04, value);
export const bitString = (value: Buffer): Buffer => tlv(0x03, Buffer.concat([Buffer.from([0]), value]));
export const boolean = (value: boolean): Buffer => tlv(0x01, Buffer.from([value ? 0xff : 0]));
export const utf8String = (value: string): Buffer => tlv(0x0c, Buffer.from(value, 'utf8'));

/** Unsigned big-endian integer; a leading zero keeps it positive. */
export function integer(value: Buffer | number): Buffer {
  let bytes = typeof value === 'number' ? Buffer.from([value]) : value;
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0 && bytes[start + 1]! < 0x80) start++;
  bytes = bytes.subarray(start);
  return tlv(0x02, bytes[0]! >= 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
}

export function oid(dotted: string): Buffer {
  const [first = 0, second = 0, ...rest] = dotted.split('.').map(Number);
  const bytes = [first * 40 + second];
  for (const arc of rest) {
    const chunk = [arc & 0x7f];
    for (let value = Math.floor(arc / 128); value > 0; value = Math.floor(value / 128)) chunk.unshift((value & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

/** RFC 5280: UTCTime through 2049, GeneralizedTime afterwards; always whole seconds in UTC. */
export function time(date: Date): Buffer {
  const iso = date.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
  return date.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(iso.slice(2), 'ascii')) : tlv(0x18, Buffer.from(iso, 'ascii'));
}
