import { loadServerConfig } from '../app/config.ts';
import { createAuthService, AuthError } from '../auth/AuthService.ts';
import { systemClock } from '../common/time.ts';
import { openDatabase, sqliteStores } from '../persistence/database.ts';

/**
 * AUTH-010 from the server's console: `npm --prefix server run auth -- <list|reset-password|revoke|unlock> [имя] [--env …]`.
 * Live sockets of a running server are closed by its own operator screen; the CLI changes the database,
 * so revoked sessions are refused at their next request. `unlock` affects only a server started afterwards.
 */
const USAGE = 'Использование: npm --prefix server run auth -- list | reset-password <имя> | revoke <имя> | unlock <имя> [--env production]';
try {
  const { config, args } = await loadServerConfig();
  const [command, name, ...extra] = args.rest;
  if (!command || extra.length || (command !== 'list' && !name)) throw new AuthError('INVALID', USAGE);
  const db = openDatabase(config.dbPath);
  try {
    const stores = sqliteStores(db);
    const auth = createAuthService({ accounts: stores.accounts, sessions: stores.sessions, clock: systemClock, ttlMs: config.sessionTtlMs, passwordless: config.auth.passwordless });
    if (command === 'list') console.table(auth.operator.list().map((a) => ({ имя: a.name, пароль: a.hasPassword, сменить: a.mustChangePassword, сессий: a.activeSessions, вход: a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString() : '—' })));
    else if (command === 'reset-password') { const reset = await auth.operator.resetPassword(name); console.log(`Временный пароль для «${reset.name}»: ${reset.temporaryPassword}\nДействует до ${new Date(reset.expiresAt).toLocaleString()}. Игрок войдёт с ним и сразу задаст свой.`); }
    else if (command === 'revoke') console.log(`Завершено сессий: ${auth.operator.revoke(name)}`);
    else if (command === 'unlock') console.log('Блокировка хранится в памяти работающего сервера: снимите её на экране ведущего /operator.');
    else throw new AuthError('INVALID', USAGE);
  } finally { db.close(); }
} catch (error) { console.error(error instanceof Error ? error.message : USAGE); process.exitCode = 1; }
