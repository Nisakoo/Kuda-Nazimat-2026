import { createHash, randomBytes } from 'node:crypto';
import type { Clock } from '../common/time.ts';
import type { Logger } from '../common/logger.ts';
import { MetricsRegistry, type Metrics } from '../common/metrics.ts';
import type { SessionCheck, SessionVerifier } from '../contracts.ts';
import { NameTakenError, type AccountStore, type RevokeReason, type SessionScope, type SessionStore } from './ports.ts';
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
  'password-reset': 'Ведущий выдал новый пароль. Войдите снова.',
  operator: 'Ведущий завершил сессию.',
  limit: 'Слишком много входов в этот аккаунт: старая сессия завершена.',
  'role-revoked': 'Роль администратора снята.',
};

/** AUTH-018: what an admin session proves; `verify` never accepts it. */
export type AdminCheck = { readonly ok: true; readonly identity: { accountId: string; playerId: string; displayName: string }; readonly sessionId: string; readonly expiresAt: number } | { readonly ok: false };

export interface ServerSession { readonly token: string; readonly expiresAt: number }
export interface AuthDeps {
  readonly accounts: AccountStore; readonly sessions: SessionStore; readonly clock: Clock; readonly ttlMs: number;
  readonly maxSessions?: number;
  /** AUTH-018 admin session lifetime; 8 h by default. */
  readonly adminTtlMs?: number;
  readonly canAdmit?: (accountId: string | null) => boolean;
  /** AUTH-001: guest and dev login; false in production. */
  readonly passwordless?: boolean;
  readonly hasher?: PasswordHasher; readonly logger?: Logger; readonly metrics?: Metrics;
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
    if (wait) { attempts.inc({ method, outcome: 'locked' }); throw new AuthError('RATE_LIMIT', 'Слишком много неудачных попыток. Попробуйте позже или попросите ведущего.', wait); }
  };
  const hashing = async <T>(work: () => Promise<T>): Promise<T> => {
    try { return await work(); }
    catch (error) { if (error instanceof HashQueueFullError) throw new AuthError('UNAVAILABLE', 'Сервер занят. Попробуйте войти через несколько секунд.'); throw error; }
  };
  const admit = (accountId: string | null): void => { if (deps.canAdmit && !deps.canAdmit(accountId)) throw new AuthError('FULL', 'Сервер заполнен: в мире уже 4 игрока.'); };
  const issue = (identity: { accountId: string; playerId: string; displayName: string }, ip: string, method: string, scope: SessionScope = 'game'): ServerSession => {
    // An administrator signs in even when the four seats are taken: the admin session never enters the world.
    if (scope === 'game') admit(identity.accountId);
    const now = clock.now();
    const token = randomBytes(32).toString('base64url');
    const sessionId = randomBytes(9).toString('base64url');
    const expiresAt = now + (scope === 'admin' ? deps.adminTtlMs ?? 8 * 3_600_000 : ttlMs);
    sessions.create({ tokenHash: hashToken(token), accountId: identity.accountId, createdAt: now, expiresAt, id: sessionId, ip, scope });
    notify(sessions.enforceLimit(identity.accountId, maxSessions, now, scope), 'limit', { accountId: identity.accountId });
    attempts.inc({ method, outcome: 'ok' });
    log?.info(`auth.${method}`, 'Вход выполнен', { accountId: identity.accountId, playerId: identity.playerId, name: identity.displayName, ip, sessionId, scope });
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
    async verify(token: string): Promise<SessionCheck> {
      if (!TOKEN.test(token)) return { ok: false };
      const session = sessions.find(hashToken(token));
      if (!session || session.revokedAt !== null || session.expiresAt <= clock.now() || session.scope !== 'game') return { ok: false };
      return { ok: true, identity: session.identity, expiresAt: session.expiresAt, sessionId: session.sessionId };
    },
    /** AUTH-018: admin scope and a current admin role; checked on every admin request. */
    async verifyAdmin(token: string): Promise<AdminCheck> {
      if (!TOKEN.test(token)) return { ok: false };
      const session = sessions.find(hashToken(token));
      if (!session || session.revokedAt !== null || session.expiresAt <= clock.now() || session.scope !== 'admin' || session.role !== 'admin') return { ok: false };
      return { ok: true, identity: session.identity, expiresAt: session.expiresAt, sessionId: session.sessionId };
    },
    /** AUTH-019: a non-admin gets the same answer as a wrong password; the per-name lock is shared with the game login. */
    async adminLogin(rawName: unknown, rawPassword: unknown, ip = 'unknown'): Promise<ServerSession> {
      limitIp(ip, 'admin-login');
      const name = nameOf(rawName); const key = name.toLowerCase();
      if (typeof rawPassword !== 'string' || !rawPassword) throw new AuthError('INVALID', 'Введите пароль.');
      locked(key, 'admin-login');
      const record = accounts.find(key);
      const result = await hashing(() => hasher.verify(rawPassword.normalize('NFC'), record?.passwordHash ?? null));
      if (!record || !result.ok) return failed(key, ip, 'admin-login', record ? 'credentials' : 'unknown', true);
      if (record.role !== 'admin') return failed(key, ip, 'admin-login', 'not_admin', false);
      if (record.mustChangePassword) {
        if ((record.tempPasswordExpiresAt ?? 0) <= clock.now()) return failed(key, ip, 'admin-login', 'temp_expired', false);
        throw new AuthError('PASSWORD_CHANGE_REQUIRED', 'Это временный пароль. Придумайте свой.');
      }
      lockout.succeed(key);
      return issue(record.identity, ip, 'admin.login', 'admin');
    },
    /** AUTH-020: development/test only — admin session of account `admin` without a password. */
    async adminDev(ip = 'unknown'): Promise<ServerSession> {
      requirePasswordless('admin-dev');
      const existing = accounts.find('admin');
      if (existing?.passwordHash) throw new AuthError('PASSWORD_REQUIRED', 'У аккаунта admin есть пароль. Войдите с паролем.');
      const identity = existing?.identity ?? accounts.findOrCreate('admin', 'admin', clock.now());
      if (existing?.role !== 'admin') accounts.setRole(identity.accountId, 'admin');
      return issue(identity, ip, 'admin.dev', 'admin');
    },

    /** AUTH-010 operator actions; the caller has already checked loopback and CSRF. */
    operator: {
      async resetPassword(rawName: unknown): Promise<{ name: string; temporaryPassword: string; expiresAt: number }> {
        const record = accounts.find(nameOf(rawName).toLowerCase());
        if (!record) throw new AuthError('INVALID', 'Аккаунт не найден.');
        const password = temporaryPassword(); const now = clock.now();
        accounts.setPassword(record.identity.accountId, await hashing(() => hasher.hash(password)), { mustChange: true, tempExpiresAt: now + TEMP_PASSWORD_MS }, now);
        lockout.unlock(record.identity.displayName.toLowerCase());
        log?.info('auth.operator.action', 'Ведущий выдал временный пароль', { action: 'reset-password', name: record.identity.displayName, accountId: record.identity.accountId });
        notify(sessions.revoke({ accountId: record.identity.accountId }, 'password-reset', now), 'password-reset', { accountId: record.identity.accountId });
        return { name: record.identity.displayName, temporaryPassword: password, expiresAt: now + TEMP_PASSWORD_MS };
      },
      revoke(rawName: unknown): number {
        const record = accounts.find(nameOf(rawName).toLowerCase());
        if (!record) throw new AuthError('INVALID', 'Аккаунт не найден.');
        const hashes = sessions.revoke({ accountId: record.identity.accountId }, 'operator', clock.now());
        log?.info('auth.operator.action', 'Ведущий завершил сессии', { action: 'revoke', name: record.identity.displayName, accountId: record.identity.accountId, count: hashes.length });
        notify(hashes, 'operator', { accountId: record.identity.accountId });
        return hashes.length;
      },
      unlock(rawName: unknown): boolean {
        const name = nameOf(rawName);
        const unlocked = lockout.unlock(name.toLowerCase());
        log?.info('auth.operator.action', 'Ведущий снял блокировку входа', { action: 'unlock', name, unlocked });
        return unlocked;
      },
      list: () => accounts.list(clock.now()),
      /** AUTH-020: new admin account with a one-time temporary password. */
      async createAdmin(rawName: unknown): Promise<{ name: string; temporaryPassword: string; expiresAt: number }> {
        const name = nameOf(rawName); const now = clock.now();
        const password = temporaryPassword();
        const hash = await hashing(() => hasher.hash(password));
        let identity;
        try { identity = accounts.create(name, name.toLowerCase(), hash, now); }
        catch (error) { if (error instanceof NameTakenError) throw new AuthError('NAME_TAKEN', 'Это имя уже занято: используйте grant-admin.'); throw error; }
        accounts.setRole(identity.accountId, 'admin');
        accounts.setPassword(identity.accountId, hash, { mustChange: true, tempExpiresAt: now + TEMP_PASSWORD_MS }, now);
        log?.info('auth.operator.action', 'Создан администратор', { action: 'create-admin', name, accountId: identity.accountId });
        return { name, temporaryPassword: password, expiresAt: now + TEMP_PASSWORD_MS };
      },
      grantAdmin(rawName: unknown): void {
        const record = accounts.find(nameOf(rawName).toLowerCase());
        if (!record) throw new AuthError('INVALID', 'Аккаунт не найден.');
        if (!record.passwordHash) throw new AuthError('INVALID', 'У аккаунта нет пароля: администратором может быть только аккаунт с паролем.');
        accounts.setRole(record.identity.accountId, 'admin');
        log?.info('auth.operator.action', 'Выдана роль администратора', { action: 'grant-admin', name: record.identity.displayName, accountId: record.identity.accountId });
      },
      revokeAdmin(rawName: unknown): number {
        const record = accounts.find(nameOf(rawName).toLowerCase());
        if (!record) throw new AuthError('INVALID', 'Аккаунт не найден.');
        accounts.setRole(record.identity.accountId, 'player');
        const hashes = sessions.revoke({ accountId: record.identity.accountId, scope: 'admin' }, 'role-revoked', clock.now());
        log?.info('auth.operator.action', 'Снята роль администратора', { action: 'revoke-admin', name: record.identity.displayName, accountId: record.identity.accountId, count: hashes.length });
        notify(hashes, 'role-revoked', { accountId: record.identity.accountId });
        return hashes.length;
      },
    },
  };
  return service satisfies SessionVerifier;
}
