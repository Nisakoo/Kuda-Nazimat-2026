import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Clock } from '../common/time.ts';
import type { PlayerIdentity, SessionVerifier } from '../contracts.ts';
import type { AccountStore, PasswordCredential, SessionStore } from './ports.ts';

export function hashToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }
export function validName(value: unknown): string | null {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f-\x9f]/.test(value)) return null;
  const name = value.trim();
  return name.length >= 1 && name.length <= 32 ? name : null;
}
/** Do not trim, normalize, truncate, or echo passwords. Bound UTF-8 work as well as length. */
export function validPassword(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 8 && value.length <= 128 && Buffer.byteLength(value, 'utf8') <= 512;
}
export class AuthError extends Error {
  readonly code: 'INVALID' | 'INVALID_CREDENTIALS' | 'NAME_TAKEN' | 'RATE_LIMIT' | 'FULL';
  readonly status: number;
  constructor(code: AuthError['code']) {
    const messages = {
      INVALID: 'Введите имя длиной 1–32 символа и пароль длиной 8–128 символов',
      INVALID_CREDENTIALS: 'Неверное имя или пароль',
      NAME_TAKEN: 'Имя уже занято',
      RATE_LIMIT: 'Слишком частые попытки. Повторите позже',
      FULL: 'Сервер заполнен: в мире уже 4 игрока.',
    };
    super(messages[code]); this.name = 'AuthError'; this.code = code;
    this.status = { INVALID: 400, INVALID_CREDENTIALS: 401, NAME_TAKEN: 409, RATE_LIMIT: 429, FULL: 503 }[code];
  }
}
export function parseCredentials(value: unknown): { name: string; password: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AuthError('INVALID');
  const record = value as Record<string, unknown>;
  const name = validName(record.name);
  if (Object.keys(record).length !== 2 || !Object.hasOwn(record, 'name') || !Object.hasOwn(record, 'password') || !name || !validPassword(record.password)) throw new AuthError('INVALID');
  return { name, password: record.password };
}

/** Fixed windows, bounded key memory, fail closed instead of evicting active limits. */
class AttemptLimits {
  private readonly entries = new Map<string, { start: number; attempts: number }>();
  private readonly clock: Clock;
  constructor(clock: Clock) { this.clock = clock; }
  take(source: string, nameKey: string): void {
    const now = this.clock.now();
    for (const [key, entry] of this.entries) if (now - entry.start >= 60_000 || now < entry.start) this.entries.delete(key);
    // Digest caller strings so neither IP length nor name length can grow stored keys.
    const keys = [[`s:${hashToken(source)}`, 20], [`n:${hashToken(nameKey)}`, 10]] as const;
    for (const [key, limit] of keys) {
      const entry = this.entries.get(key);
      if (entry && entry.attempts >= limit) throw new AuthError('RATE_LIMIT');
    }
    const missing = keys.filter(([key]) => !this.entries.has(key)).length;
    if (this.entries.size + missing > 2048) throw new AuthError('RATE_LIMIT');
    for (const [key] of keys) {
      const entry = this.entries.get(key);
      if (entry) entry.attempts++;
      else this.entries.set(key, { start: now, attempts: 1 });
    }
  }
}

// scrypt-v1: 32 MiB nominal memory; maxmem includes implementation overhead.
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, Buffer.from(salt, 'hex'), 64, SCRYPT, (error, key) => error ? reject(error) : resolve(key));
  });
}
const dummyCredential: PasswordCredential = { salt: '00'.repeat(16), passwordHash: '00'.repeat(64) };
export interface AuthSession { readonly token: string; readonly expiresAt: number }
export interface AuthService extends SessionVerifier {
  guest(name: string, clientKey?: string): AuthSession;
  register(name: string, password: string, clientKey?: string): Promise<AuthSession>;
  login(name: string, password: string, clientKey?: string): Promise<AuthSession>;
  logout(token: string): void;
  state(identity: PlayerIdentity): { requiresAvatar: boolean };
  onRevoked(listener: (sessionKey: string) => void): () => void;
}
export function createAuthService(accounts: AccountStore, sessions: SessionStore, clock: Clock, ttlMs: number, options: { canAdmit?(accountId: string | null): boolean } = {}): AuthService {
  const limits = new AttemptLimits(clock);
  const revoked = new Set<(sessionKey: string) => void>();
  function admit(identity: PlayerIdentity | null): void {
    if (options.canAdmit && !options.canAdmit(identity?.accountId ?? null)) throw new AuthError('FULL');
  }
  let hashing = 0;
  async function passwordKey(password: string, salt: string): Promise<Buffer> {
    // No unbounded queue of expensive crypto work, even across many source addresses.
    if (hashing >= 2) throw new AuthError('RATE_LIMIT');
    hashing++;
    try { return await derive(password, salt); }
    finally { hashing--; }
  }
  function attempt(name: unknown, clientKey: string): string {
    const normalized = validName(name);
    limits.take(clientKey, normalized?.toLowerCase() ?? '');
    if (!normalized) throw new AuthError('INVALID');
    return normalized;
  }
  function issue(identity: PlayerIdentity): AuthSession {
    admit(identity);
    const now = clock.now();
    const token = randomBytes(32).toString('base64url');
    const expiresAt = now + ttlMs;
    sessions.create({ tokenHash: hashToken(token), accountId: identity.accountId, createdAt: now, expiresAt });
    return { token, expiresAt };
  }
  return {
    guest(name, clientKey = 'local') {
      const normalized = attempt(name, clientKey);
      const found = accounts.findByName(normalized.toLowerCase());
      if (found?.credential) throw new AuthError('INVALID_CREDENTIALS');
      admit(found?.identity ?? null);
      const identity = found?.identity ?? accounts.findOrCreate(normalized, normalized.toLowerCase(), clock.now());
      return issue(identity);
    },
    async register(name, password, clientKey = 'local') {
      const normalized = attempt(name, clientKey);
      if (!validPassword(password)) throw new AuthError('INVALID');
      const nameKey = normalized.toLowerCase();
      if (accounts.findByName(nameKey)) throw new AuthError('NAME_TAKEN');
      admit(null);
      const salt = randomBytes(16).toString('hex');
      const passwordHash = (await passwordKey(password, salt)).toString('hex');
      admit(null);
      const identity = accounts.createPassword(normalized, nameKey, clock.now(), { salt, passwordHash });
      if (!identity) throw new AuthError('NAME_TAKEN');
      return issue(identity);
    },
    async login(name, password, clientKey = 'local') {
      const normalized = attempt(name, clientKey);
      if (!validPassword(password)) throw new AuthError('INVALID');
      const found = accounts.findByName(normalized.toLowerCase());
      // Unknown names and guests perform the same KDF as password accounts.
      const credential = found?.credential ?? dummyCredential;
      if (!/^[a-f0-9]{32}$/.test(credential.salt) || !/^[a-f0-9]{128}$/.test(credential.passwordHash)) throw new Error('Invalid stored credential');
      const actual = await passwordKey(password, credential.salt);
      const matches = timingSafeEqual(actual, Buffer.from(credential.passwordHash, 'hex'));
      if (!found?.credential || !matches) throw new AuthError('INVALID_CREDENTIALS');
      return issue(found.identity);
    },
    logout(token) {
      if (/^[A-Za-z0-9_-]{43}$/.test(token)) {
        const key = hashToken(token);
        sessions.revoke(key);
        for (const listener of revoked) listener(key);
      }
    },
    onRevoked(listener) { revoked.add(listener); return () => { revoked.delete(listener); }; },
    state(identity) { return { requiresAvatar: accounts.requiresAvatar(identity.accountId) }; },
    async verify(token) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { ok: false };
      const session = sessions.find(hashToken(token));
      if (!session || session.expiresAt <= clock.now()) return { ok: false };
      return { ok: true, ...session };
    },
  };
}
