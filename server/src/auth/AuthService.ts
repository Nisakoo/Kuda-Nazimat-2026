import { createHash, randomBytes } from 'node:crypto';
import type { Clock } from '../common/time.ts';
import type { Logger } from '../common/logger.ts';
import { MetricsRegistry, type Metrics } from '../common/metrics.ts';
import type { SessionCheck, SessionVerifier } from '../contracts.ts';
import { NameTakenError, type AccountStore, type RevokeReason, type SessionStore } from './ports.ts';
import { HashQueueFullError, PasswordHasher, checkPassword, temporaryPassword } from './password.ts';
import { LoginLockout, WindowLimiter } from './limits.ts';

export function hashToken(token: string): string { return createHash('sha256').update(token).digest('hex'); }
export function validName(value: unknown): string | null {
  if (typeof value !== 'string' || /[\x00-\x1f\x7f-\x9f]/.test(value)) return null;
  const name = value.trim();
  return name.length >= 1 && name.length <= 32 ? name : null;
}
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const TEMP_PASSWORD_MS = 24 * 3_600_000;

/** AUTH-006 error codes with their HTTP status; `message` is ready to show to the player. */
export const AUTH_STATUS = { INVALID: 400, CREDENTIALS: 401, NAME_TAKEN: 409, PASSWORD_REQUIRED: 403, PASSWORD_CHANGE_REQUIRED: 403, DISABLED: 403, RATE_LIMIT: 429, UNAVAILABLE: 503, FULL: 503 } as const;
export type AuthErrorCode = keyof typeof AUTH_STATUS;
export class AuthError extends Error {
  readonly code: AuthErrorCode;
  readonly retryAfterSeconds: number | undefined;
  constructor(code: AuthErrorCode, message: string, retryAfterSeconds?: number) { super(message); this.code = code; this.retryAfterSeconds = retryAfterSeconds; }
}

/** Text the closed game connection shows for each revocation reason (AUTH-012). */
export const REVOKE_MESSAGES: Readonly<Record<RevokeReason, string>> = {
  logout: 'Вы вышли из игры.',
  'password-changed': 'Пароль изменён. Войдите снова.',
  'password-reset': 'Администратор выдал новый пароль. Войдите снова.',
  operator: 'Администратор завершил сессию.',
  limit: 'Слишком много входов в этот аккаунт: старая сессия завершена.',
};

export interface ServerSession { readonly token: string; readonly expiresAt: number }
export interface AuthDeps {
  readonly accounts: AccountStore; readonly sessions: SessionStore; readonly clock: Clock; readonly ttlMs: number;
  readonly maxSessions?: number;
  readonly canAdmit?: (accountId: string | null) => boolean;
  /** AUTH-001: guest and dev login; false in production. */
  readonly passwordless?: boolean;
  readonly hasher?: PasswordHasher; readonly logger?: Logger; readonly metrics?: Metrics;
  /** ADMIN-SRV-009: journal of operator actions; never receives the temporary password. */
  readonly audit?: (entry: { readonly action: 'reset-password' | 'revoke' | 'unlock'; readonly accountId: string | null; readonly name: string; readonly result: Record<string, number | boolean> }) => void;
}
export type AuthService = ReturnType<typeof createAuthService>;

export function createAuthService(deps: AuthDeps) {
  const { accounts, sessions, clock, ttlMs } = deps;
  const maxSessions = deps.maxSessions ?? 5;
  const passwordless = deps.passwordless ?? true;
  const hasher = deps.hasher ?? new PasswordHasher();
  const log = deps.logger;
  const metrics = deps.metrics ?? new MetricsRegistry();
  const attempts = metrics.counter('auth_attempts_total', 'Попытки входа по способу и исходу');
  const revocations = metrics.counter('auth_sessions_revoked_total', 'Отозванные сессии по причине');
  const lockouts = metrics.counter('auth_locks_total', 'Блокировки имени после неудачных попыток');
  const perIp = new WindowLimiter(clock, 30, 60_000);
  const registrations = new WindowLimiter(clock, 10, 3_600_000);
  const lockout = new LoginLockout(clock);
  let revoked: (tokenHashes: readonly string[], reason: RevokeReason) => void = () => {};

  const notify = (hashes: readonly string[], reason: RevokeReason, fields: Record<string, unknown>): void => {
    if (!hashes.length) return;
    revocations.inc({ reason }, hashes.length);
    log?.info('auth.session.revoked', 'Сессии отозваны', { ...fields, reason, count: hashes.length });
    revoked(hashes, reason);
  };
  const limitIp = (ip: string, method: string): void => {
    const wait = perIp.hit(ip);
    if (wait) { attempts.inc({ method, outcome: 'rate_limited' }); log?.warn('http.rate_limited', 'Слишком частые попытки входа с адреса', { ip, method }); throw new AuthError('RATE_LIMIT', 'Слишком частые попытки. Подождите немного.', wait); }
  };
  const nameOf = (raw: unknown): string => { const name = validName(raw); if (!name) throw new AuthError('INVALID', 'Введите имя длиной 1–32 символа без управляющих символов.'); return name; };
  const passwordOf = (raw: unknown, name: string, field = 'Пароль'): string => {
    const checked = checkPassword(raw, name);
    if (!checked.ok) throw new AuthError('INVALID', field === 'Пароль' ? checked.message : `Новый пароль: ${checked.message.charAt(0).toLowerCase()}${checked.message.slice(1)}`);
    return checked.password;
  };
  const failed = (key: string, ip: string, method: string, reason: string, countFailure: boolean): never => {
    attempts.inc({ method, outcome: reason });
    if (countFailure && lockout.fail(key)) { lockouts.inc(); log?.warn('auth.locked', 'Имя временно заблокировано после неудачных попыток', { nameKey: key, ip }); }
    log?.warn('auth.login.failed', 'Неудачная попытка входа', { nameKey: key, ip, method, reason });
    throw new AuthError('CREDENTIALS', 'Неверное имя или пароль.');
  };
  const locked = (key: string, method: string): void => {
    const wait = lockout.retryAfter(key);
    if (wait) { attempts.inc({ method, outcome: 'locked' }); throw new AuthError('RATE_LIMIT', 'Слишком много неудачных попыток. Попробуйте позже или попросите администратора.', wait); }
  };
  const hashing = async <T>(work: () => Promise<T>): Promise<T> => {
    try { return await work(); }
    catch (error) { if (error instanceof HashQueueFullError) throw new AuthError('UNAVAILABLE', 'Сервер занят. Попробуйте войти через несколько секунд.'); throw error; }
  };
  const admit = (accountId: string | null): void => { if (deps.canAdmit && !deps.canAdmit(accountId)) throw new AuthError('FULL', 'Сервер заполнен: в мире уже 4 игрока.'); };
  const issue = (identity: { accountId: string; playerId: string; displayName: string }, ip: string, method: string): ServerSession => {
    admit(identity.accountId);
    const now = clock.now();
    const token = randomBytes(32).toString('base64url');
    const sessionId = randomBytes(9).toString('base64url');
    const expiresAt = now + ttlMs;
    sessions.create({ tokenHash: hashToken(token), accountId: identity.accountId, createdAt: now, expiresAt, id: sessionId, ip });
    notify(sessions.enforceLimit(identity.accountId, maxSessions, now), 'limit', { accountId: identity.accountId });
    attempts.inc({ method, outcome: 'ok' });
    log?.info(`auth.${method}`, 'Вход выполнен', { accountId: identity.accountId, playerId: identity.playerId, name: identity.displayName, ip, sessionId });
    return { token, expiresAt };
  };
  const requirePasswordless = (method: string): void => {
    if (!passwordless) { attempts.inc({ method, outcome: 'disabled' }); throw new AuthError('DISABLED', 'Вход без пароля выключен на этом сервере.'); }
  };
  const passwordlessLogin = (name: string, ip: string, method: 'guest' | 'dev'): ServerSession => {
    const key = name.toLowerCase();
    const existing = accounts.find(key);
    if (existing?.passwordHash) { attempts.inc({ method, outcome: 'password_required' }); throw new AuthError('PASSWORD_REQUIRED', 'У этого имени есть пароль. Войдите с паролем.'); }
    admit(existing?.identity.accountId ?? null);
    return issue(existing?.identity ?? accounts.findOrCreate(name, key, clock.now()), ip, method);
  };

  const service = {
    state(identity: { accountId: string }) { return { requiresAvatar: accounts.requiresAvatar?.(identity.accountId) ?? false }; },
    /** AUTH-006 `GET /api/auth/mode`. */
    mode: () => ({ password: true, guest: passwordless, dev: passwordless }),
    onRevoked(listener: (tokenHashes: readonly string[], reason: RevokeReason) => void): void { revoked = listener; },

    async guest(rawName: unknown, ip = 'unknown'): Promise<ServerSession> {
      requirePasswordless('guest'); limitIp(ip, 'guest');
      return passwordlessLogin(nameOf(rawName), ip, 'guest');
    },
    /** AUTH-016: development/test autologin; `dev` when no name is given. */
    async dev(rawName: unknown, ip = 'unknown'): Promise<ServerSession> {
      requirePasswordless('dev');
      return passwordlessLogin(rawName === undefined ? 'dev' : nameOf(rawName), ip, 'dev');
    },
    async register(rawName: unknown, rawPassword: unknown, ip = 'unknown'): Promise<ServerSession> {
      limitIp(ip, 'register');
      const name = nameOf(rawName); const password = passwordOf(rawPassword, name);
      const wait = registrations.hit(ip);
      if (wait) { attempts.inc({ method: 'register', outcome: 'rate_limited' }); throw new AuthError('RATE_LIMIT', 'Слишком много регистраций с этого устройства. Подождите.', wait); }
      if (accounts.find(name.toLowerCase())) { attempts.inc({ method: 'register', outcome: 'name_taken' }); throw new AuthError('NAME_TAKEN', 'Это имя уже занято. Выберите другое.'); }
      admit(null);
      const hash = await hashing(() => hasher.hash(password));
      admit(null);
      try { return issue(accounts.create(name, name.toLowerCase(), hash, clock.now()), ip, 'register'); }
      catch (error) { if (error instanceof NameTakenError) throw new AuthError('NAME_TAKEN', 'Это имя уже занято. Выберите другое.'); throw error; }
    },
    async login(rawName: unknown, rawPassword: unknown, ip = 'unknown'): Promise<ServerSession> {
      limitIp(ip, 'login');
      const name = nameOf(rawName); const key = name.toLowerCase();
      if (typeof rawPassword !== 'string' || !rawPassword) throw new AuthError('INVALID', 'Введите пароль.');
      locked(key, 'login');
      const record = accounts.find(key);
      const result = await hashing(() => hasher.verify(rawPassword, record?.passwordHash ?? null));
      if (!record || !result.ok) return failed(key, ip, 'login', record ? 'credentials' : 'unknown', true);
      if (record.mustChangePassword) {
        if ((record.tempPasswordExpiresAt ?? 0) <= clock.now()) return failed(key, ip, 'login', 'temp_expired', false);
        attempts.inc({ method: 'login', outcome: 'change_required' });
        throw new AuthError('PASSWORD_CHANGE_REQUIRED', 'Это временный пароль. Придумайте свой.');
      }
      lockout.succeed(key);
      if (result.needsRehash) accounts.setPassword(record.identity.accountId, await hashing(() => hasher.hash(rawPassword.normalize('NFC'))), { mustChange: false, tempExpiresAt: null }, clock.now());
      return issue(record.identity, ip, 'login');
    },
    /** Own password with the current (or temporary) one; ends every other session of the account. */
    async changePassword(rawName: unknown, rawPassword: unknown, rawNew: unknown, ip = 'unknown'): Promise<ServerSession> {
      limitIp(ip, 'password');
      const name = nameOf(rawName); const key = name.toLowerCase();
      if (typeof rawPassword !== 'string' || !rawPassword) throw new AuthError('INVALID', 'Введите текущий пароль.');
      const next = passwordOf(rawNew, name, 'Новый пароль');
      locked(key, 'password');
      const record = accounts.find(key);
      const result = await hashing(() => hasher.verify(rawPassword, record?.passwordHash ?? null));
      if (!record || !result.ok) return failed(key, ip, 'password', record ? 'credentials' : 'unknown', true);
      if (record.mustChangePassword && (record.tempPasswordExpiresAt ?? 0) <= clock.now()) return failed(key, ip, 'password', 'temp_expired', false);
      lockout.succeed(key);
      accounts.setPassword(record.identity.accountId, await hashing(() => hasher.hash(next)), { mustChange: false, tempExpiresAt: null }, clock.now());
      log?.info('auth.password.changed', 'Пароль изменён', { accountId: record.identity.accountId, ip });
      notify(sessions.revoke({ accountId: record.identity.accountId }, 'password-changed', clock.now()), 'password-changed', { accountId: record.identity.accountId });
      return issue(record.identity, ip, 'login');
    },
    /** AUTH-009: idempotent; never reveals whether the token was valid. */
    logout(token: string): void {
      if (!TOKEN.test(token)) return;
      const hash = hashToken(token);
      const session = sessions.find(hash);
      const hashes = sessions.revoke({ tokenHash: hash }, 'logout', clock.now());
      if (hashes.length) log?.info('auth.logout', 'Выход из игры', { accountId: session?.identity.accountId, sessionId: session?.sessionId });
      notify(hashes, 'logout', { accountId: session?.identity.accountId });
    },
    isActive(sessionId: string, playerId: string): boolean {
      return typeof sessionId === 'string' && sessionId.length > 0 && sessions.isActive(sessionId, playerId, clock.now());
    },
    async verify(token: string): Promise<SessionCheck> {
      if (!TOKEN.test(token)) return { ok: false };
      const session = sessions.find(hashToken(token));
      if (!session || session.revokedAt !== null || session.expiresAt <= clock.now()) return { ok: false };
      return { ok: true, identity: session.identity, expiresAt: session.expiresAt, sessionId: session.sessionId };
    },

    /** AUTH-010 operator actions; the caller has already checked loopback and CSRF. */
    operator: {
      async resetPassword(rawName: unknown): Promise<{ name: string; temporaryPassword: string; expiresAt: number }> {
        const record = accounts.find(nameOf(rawName).toLowerCase());
        if (!record) throw new AuthError('INVALID', 'Аккаунт не найден.');
        const password = temporaryPassword(); const now = clock.now();
        accounts.setPassword(record.identity.accountId, await hashing(() => hasher.hash(password)), { mustChange: true, tempExpiresAt: now + TEMP_PASSWORD_MS }, now);
        lockout.unlock(record.identity.displayName.toLowerCase());
        log?.info('auth.operator.action', 'Администратор выдал временный пароль', { action: 'reset-password', name: record.identity.displayName, accountId: record.identity.accountId });
        const revoked = sessions.revoke({ accountId: record.identity.accountId }, 'password-reset', now);
        deps.audit?.({ action: 'reset-password', accountId: record.identity.accountId, name: record.identity.displayName, result: { revoked: revoked.length } });
        notify(revoked, 'password-reset', { accountId: record.identity.accountId });
        return { name: record.identity.displayName, temporaryPassword: password, expiresAt: now + TEMP_PASSWORD_MS };
      },
      revoke(rawName: unknown): number {
        const record = accounts.find(nameOf(rawName).toLowerCase());
        if (!record) throw new AuthError('INVALID', 'Аккаунт не найден.');
        const hashes = sessions.revoke({ accountId: record.identity.accountId }, 'operator', clock.now());
        log?.info('auth.operator.action', 'Администратор завершил сессии', { action: 'revoke', name: record.identity.displayName, accountId: record.identity.accountId, count: hashes.length });
        deps.audit?.({ action: 'revoke', accountId: record.identity.accountId, name: record.identity.displayName, result: { revoked: hashes.length } });
        notify(hashes, 'operator', { accountId: record.identity.accountId });
        return hashes.length;
      },
      unlock(rawName: unknown): boolean {
        const name = nameOf(rawName);
        const unlocked = lockout.unlock(name.toLowerCase());
        log?.info('auth.operator.action', 'Администратор снял блокировку входа', { action: 'unlock', name, unlocked });
        deps.audit?.({ action: 'unlock', accountId: accounts.find(name.toLowerCase())?.identity.accountId ?? null, name, result: { unlocked } });
        return unlocked;
      },
      /** ADMIN-SRV-010: when the name may try to log in again, null when not locked. */
      lockedUntil(name: string): number | null { const wait = lockout.retryAfter(name.toLowerCase()); return wait ? clock.now() + wait * 1000 : null; },
      list: () => accounts.list(clock.now()),
    },
  };
  return service satisfies SessionVerifier;
}
