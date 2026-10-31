import { createHash, randomBytes } from 'node:crypto';
import type { Clock } from '../common/time.ts';
import type { SessionVerifier } from '../contracts.ts';
import type { AccountStore, SessionStore } from './ports.ts';

export function hashToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }
export function validName(value: unknown): string | null {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f-\x9f]/.test(value)) return null;
  const name = value.trim();
  return name.length >= 1 && name.length <= 32 ? name : null;
}
export function createAuthService(accounts: AccountStore, sessions: SessionStore, clock: Clock, ttlMs: number): SessionVerifier & {
  guest(name: string): { token: string; expiresAt: number };
} {
  return {
    guest(name) {
      const normalized = validName(name);
      if (!normalized) throw new Error('Неверное имя');
      const now = clock.now();
      const identity = accounts.findOrCreate(normalized, normalized.toLowerCase(), now);
      const token = randomBytes(32).toString('base64url');
      const expiresAt = now + ttlMs;
      sessions.create({ tokenHash: hashToken(token), accountId: identity.accountId, createdAt: now, expiresAt });
      return { token, expiresAt };
    },
    async verify(token) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return { ok: false };
      const session = sessions.find(hashToken(token));
      if (!session || session.expiresAt <= clock.now()) return { ok: false };
      return { ok: true, ...session };
    },
  };
}
