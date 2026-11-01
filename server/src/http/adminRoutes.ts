import type { IncomingMessage, ServerResponse } from 'node:http';
import { AUTH_STATUS, AuthError, type AuthService } from '../auth/AuthService.ts';
import type { Logger } from '../common/logger.ts';
import { BodyError, bearer, body, clientIp, error, fields, json, type RequestContext } from './util.ts';

/**
 * ADMIN-002/003, AUTH-018–019: `/api/admin/login`, `/dev`, `/logout`. The rest of `/api/admin/*`
 * (status, NPC catalogue) is added by the admin panel; unknown paths answer 404 here for now.
 */
export async function handleAdmin(req: IncomingMessage, res: ServerResponse, path: string, auth: AuthService, log: Logger, context: RequestContext): Promise<boolean> {
  if (!path.startsWith('/api/admin/')) return false;
  const action = path.slice('/api/admin/'.length);
  context.route = `/api/admin/${action}`;
  if (req.method !== 'POST' || !['login', 'dev', 'logout'].includes(action)) { req.resume(); res.writeHead(404); res.end(); return true; }
  if (action === 'logout') {
    req.resume();
    const token = bearer(req); if (token) auth.logout(token);
    res.writeHead(204); res.end(); return true;
  }
  let input: Record<string, unknown> | null;
  try { input = fields(await body(req), action === 'login' ? ['name', 'password'] : []); }
  catch (cause) { if (!(cause instanceof BodyError)) throw cause; input = null; }
  if (!input) { error(res, 400, 'INVALID', 'Некорректный запрос входа.'); return true; }
  try {
    const session = action === 'login' ? await auth.adminLogin(input.name, input.password, clientIp(req)) : await auth.adminDev(clientIp(req));
    json(res, 200, { token: session.token, expiresAt: session.expiresAt });
  } catch (cause) {
    if (!(cause instanceof AuthError)) { log.error('http.failed', 'Ошибка входа администратора', { route: context.route, error: cause }); error(res, 503, 'UNAVAILABLE', 'Сервис входа временно недоступен.'); return true; }
    error(res, AUTH_STATUS[cause.code], cause.code, cause.message, cause.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: cause.retryAfterSeconds });
  }
  return true;
}
