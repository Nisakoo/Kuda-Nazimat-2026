import { randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto';

/** AUTH-008 parameters; stored with every hash so they can be raised later without a migration. */
export const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keyLength: 32, saltLength: 16 } as const;
const MAX_MEMORY = 128 * SCRYPT.N * SCRYPT.r * 2;

export class HashQueueFullError extends Error {}

/**
 * At most `concurrency` scrypt computations run at once (they occupy libuv threads, not the game loop);
 * a computation that cannot start within `waitMs` fails instead of piling up (AUTH-008).
 */
export class PasswordHasher {
  private active = 0;
  private readonly waiting: { start: () => void; timer: ReturnType<typeof setTimeout> }[] = [];
  private dummy: Promise<string> | null = null;
  private readonly concurrency: number;
  private readonly waitMs: number;
  constructor(concurrency = 2, waitMs = 5000) { this.concurrency = concurrency; this.waitMs = waitMs; }

  async hash(password: string): Promise<string> {
    const salt = randomBytes(SCRYPT.saltLength);
    const key = await this.derive(password, salt, SCRYPT);
    return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
  }

  /** `stored` null (unknown account) still costs one derivation, so timing does not reveal existence. */
  async verify(password: string, stored: string | null): Promise<{ ok: boolean; needsRehash: boolean }> {
    const parsed = stored ? parse(stored) : null;
    if (!parsed) { await this.verify(password, await (this.dummy ??= this.hash('dummy-password'))); return { ok: false, needsRehash: false }; }
    const key = await this.derive(password, parsed.salt, parsed);
    const ok = key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
    return { ok, needsRehash: ok && (parsed.N < SCRYPT.N || parsed.r < SCRYPT.r || parsed.p < SCRYPT.p) };
  }

  private derive(password: string, salt: Buffer, params: { N: number; r: number; p: number }): Promise<Buffer> {
    return this.slot(() => new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, SCRYPT.keyLength, { N: params.N, r: params.r, p: params.p, maxmem: Math.max(MAX_MEMORY, 256 * params.N * params.r) }, (error, key) => error ? reject(error) : resolve(key));
    }));
  }

  private async slot<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      await new Promise<void>((resolve, reject) => {
        const entry = { start: () => { clearTimeout(entry.timer); resolve(); }, timer: setTimeout(() => { this.waiting.splice(this.waiting.indexOf(entry), 1); reject(new HashQueueFullError('Очередь проверки паролей переполнена')); }, this.waitMs) };
        this.waiting.push(entry);
      });
    }
    this.active++;
    try { return await work(); }
    finally { this.active--; this.waiting.shift()?.start(); }
  }
}

function parse(stored: string): { N: number; r: number; p: number; salt: Buffer; key: Buffer } | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (![N, r, p].every((value) => Number.isSafeInteger(value) && value! > 0)) return null;
  return { N: N!, r: r!, p: p!, salt: Buffer.from(parts[4]!, 'base64url'), key: Buffer.from(parts[5]!, 'base64url') };
}

/** AUTH-007: 6–128 characters after NFC, no control characters, not the name itself. Returns an error text or the normalized password. */
export function checkPassword(raw: unknown, name: string): { ok: true; password: string } | { ok: false; message: string } {
  if (typeof raw !== 'string') return { ok: false, message: 'Введите пароль.' };
  const password = raw.normalize('NFC');
  const length = [...password].length;
  if (length < 6 || length > 128) return { ok: false, message: 'Пароль должен быть длиной от 6 до 128 символов.' };
  if (/[\x00-\x1f\x7f-\x9f]/.test(password)) return { ok: false, message: 'Пароль содержит недопустимые символы.' };
  if (password.toLocaleLowerCase() === name.toLocaleLowerCase()) return { ok: false, message: 'Пароль не должен совпадать с именем.' };
  return { ok: true, password };
}

/** AUTH-010: 10 characters without look-alikes (0/O, 1/l/I). */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function temporaryPassword(): string { return Array.from({ length: 10 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(''); }
