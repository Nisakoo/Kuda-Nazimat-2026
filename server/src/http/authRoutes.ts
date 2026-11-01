import type { IncomingMessage, ServerResponse } from 'node:http';
import { AUTH_STATUS, AuthError, type AuthService } from '../auth/AuthService.ts';
import type { Logger } from '../common/logger.ts';
import { BodyError, bearer, body, clientIp, error, fields, json, type RequestContext } from './util.ts';

type Handler = (input: Record<string, unknown>, ip: string) => Promise<{ token: string; expiresAt: number }>;

/** AUTH-006: `/api/auth/*`. Returns false when the path is not an auth route. */
export async function handleAuth(req: IncomingMessage, res: ServerResponse, path: string, auth: AuthService, log: Logger, context: RequestContext): Promise<boolean> {
  if (!path.startsWith('/api/auth/')) return false;
  const action = path.slice('/api/auth/'.length);
  context.route = `/api/auth/${action}`;
  if (action === 'mode' && req.method === 'GET') { json(res, 200, auth.mode()); return true; }
  if (req.method !== 'POST') { res.writeHead(404); res.end(); return true; }
  if (action === 'logout') {
    req.resume();
    const token = bearer(req); if (token) auth.logout(token);
    res.writeHead(204); res.end(); return true;
  }
  const handlers: Record<string, { required: string[]; optional?: string[]; run: Handler; status?: number }> = {
    guest: { required: ['name'], run: (input, ip) => auth.guest(input.name, ip) },
    dev: { required: [], optional: ['name'], run: (input, ip) => auth.dev(input.name, ip) },
    register: { required: ['name', 'password'], run: (input, ip) => auth.register(input.name, input.password, ip), status: 201 },
    login: { required: ['name', 'password'], run: (input, ip) => auth.login(input.name, input.password, ip) },
    password: { required: ['name', 'password', 'newPassword'], run: (input, ip) => auth.changePassword(input.name, input.password, input.newPassword, ip) },
  };
  const handler = Object.hasOwn(handlers, action) ? handlers[action] : undefined;
  if (!handler) { req.resume(); res.writeHead(404); res.end(); return true; }
  let input: Record<string, unknown> | null;
  try { input = fields(await body(req), handler.required, handler.optional); }
  catch (cause) { if (!(cause instanceof BodyError)) throw cause; input = null; }
  if (!input) { error(res, 400, 'INVALID', 'Некорректный запрос входа.'); return true; }
  try {
    const session = await handler.run(input, clientIp(req));
    // PROTO-008 §7: exactly {token, expiresAt}.
    json(res, handler.status ?? 200, { token: session.token, expiresAt: session.expiresAt });
  } catch (cause) {
    if (!(cause instanceof AuthError)) { log.error('http.failed', 'Ошибка входа', { route: context.route, error: cause }); error(res, 503, 'UNAVAILABLE', 'Сервис входа временно недоступен.'); return true; }
    error(res, AUTH_STATUS[cause.code], cause.code, cause.message, cause.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: cause.retryAfterSeconds });
  }
  return true;
}
