import type { IncomingMessage, ServerResponse } from 'node:http';
import { AUTH_STATUS, AuthError } from '../auth/AuthService.ts';
import { TokenBucket } from '../common/TokenBucket.ts';
import type { Clock } from '../common/time.ts';
import { handleOperator, type OperatorDeps } from './operatorRoutes.ts';
import { OPERATOR_PAGE } from './operatorPage.ts';
import { BodyError, bearer, body, clientIp, error, fields, json, type RequestContext } from './util.ts';

const PAGE_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const SIGN_IN = ['login', 'dev', 'logout', 'password'];

/** Labels are a closed set even for malformed or unknown URLs. */
function route(rest: string): string {
  if (/^(?:login|dev|logout|password|status|metrics|history|npcs|world|journal|journal\.csv|accounts|account)$/.test(rest)) return `/api/admin/${rest}`;
  if (/^npcs\/[A-Za-z0-9_-]{1,80}(?:\/(?:restore|reset))?$/.test(rest)) return `/api/admin/npcs/:id${rest.endsWith('/restore') ? '/restore' : rest.endsWith('/reset') ? '/reset' : ''}`;
  if (/^world\/[A-Za-z0-9_-]{1,80}\/reset-scene$/.test(rest)) return '/api/admin/world/:mapId/reset-scene';
  if (/^actions\/(?:reset-password|revoke|unlock|dump)$/.test(rest)) return '/api/admin/actions/:action';
  return '/api/admin/other';
}

/**
 * ADMIN-ACCESS-001–005: the same administrator screen for any laptop of the network, behind an administrator
 * session (AUTH-017–020). `/admin` serves the page; `/api/admin/login|dev|logout` give and end the session;
 * every other `/api/admin/<path>` is exactly `/api/operator/<path>` once the session is verified.
 * False when the path is not ours.
 */
export async function handleAdminAccess(req: IncomingMessage, res: ServerResponse, path: string, deps: OperatorDeps & { readonly clock: Clock }, context: RequestContext, buckets: Map<string, TokenBucket>): Promise<boolean> {
  if (path === '/admin') {
    context.route = '/admin';
    if (req.method !== 'GET' && req.method !== 'HEAD') { req.resume(); res.writeHead(404); res.end(); return true; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PAGE_CSP, 'Cache-Control': 'no-store' });
    const page = OPERATOR_PAGE.replace('<body>', '<body class="admin-signed-out">').replace('id="admin-login" hidden', 'id="admin-login"');
    res.end(req.method === 'HEAD' ? undefined : page); return true;
  }
  if (!path.startsWith('/api/admin/')) return false;
  const rest = path.slice('/api/admin/'.length);
  context.route = route(rest);
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'POST' && SIGN_IN.includes(rest)) {
    if (rest === 'logout') { req.resume(); const token = bearer(req); if (token && (await deps.auth.verifyAdmin(token)).ok) deps.auth.logout(token); res.writeHead(204); res.end(); return true; }
    let input: Record<string, unknown> | null;
    try { input = fields(await body(req, 8192), rest === 'password' ? ['name', 'password', 'newPassword'] : rest === 'login' ? ['name', 'password'] : []); }
    catch (cause) { if (!(cause instanceof BodyError)) throw cause; input = null; }
    if (!input) { error(res, 400, 'INVALID', 'Некорректный запрос входа.'); return true; }
    try {
      const session = rest === 'password' ? await deps.auth.changePassword(input.name, input.password, input.newPassword, clientIp(req), 'admin')
        : rest === 'login' ? await deps.auth.adminLogin(input.name, input.password, clientIp(req)) : await deps.auth.adminDev(clientIp(req));
      json(res, 200, { token: session.token, expiresAt: session.expiresAt });
    } catch (cause) {
      if (!(cause instanceof AuthError)) throw cause;
      error(res, AUTH_STATUS[cause.code], cause.code, cause.message, cause.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: cause.retryAfterSeconds });
    }
    return true;
  }

  // Everything else needs an administrator session: 401 without it, 403 for a game session.
  const token = bearer(req);
  const check = token ? await deps.auth.verifyAdmin(token) : { ok: false as const };
  if (!check.ok) {
    req.resume();
    if (token && (await deps.auth.verify(token)).ok) error(res, 403, 'FORBIDDEN', 'Нужна сессия администратора: войдите на странице /admin.');
    else error(res, 401, 'UNAUTHORIZED', 'Требуется вход администратора.');
    return true;
  }
  context.sessionId = check.sessionId;
  let bucket = buckets.get(check.sessionId);
  if (!bucket) { if (buckets.size > 200) buckets.clear(); bucket = new TokenBucket(deps.clock, 20, 40); buckets.set(check.sessionId, bucket); }
  if (!bucket.take()) { req.resume(); error(res, 429, 'RATE_LIMIT', 'Слишком частые запросы.', { retryAfterSeconds: 1 }); return true; }

  const who = { ip: clientIp(req), accountId: check.identity.accountId, name: check.identity.displayName };
  const operatorPath = `/api/operator/${rest}`;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    // ADMIN-ACCESS-005: every change is counted and logged with the administrator, never with its content.
    const actions = deps.metrics.counter('admin_actions_total', 'Изменения администратора по маршруту и результату');
    res.once('finish', () => {
      const result = res.statusCode < 400 ? 'ok' : res.statusCode === 409 ? 'conflict' : res.statusCode < 500 ? 'rejected' : 'error';
      const route = context.route.replace('/api/operator/', '/api/admin/');
      actions.inc({ route, method: req.method ?? '', result });
      deps.logger.child('admin').info('admin.action', 'Действие администратора', { method: req.method, route, status: res.statusCode, accountId: who.accountId, sessionId: check.sessionId, ip: who.ip });
    });
  }
  try {
    if (await handleOperator(req, res, operatorPath, deps, context, { kind: 'admin', who })) return true;
    req.resume(); res.writeHead(404); res.end(); return true;
  } finally { context.route = route(rest); }
}
