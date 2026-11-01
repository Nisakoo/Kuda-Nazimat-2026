import type { IncomingMessage, ServerResponse } from 'node:http';
import { AUTH_STATUS, AuthError, type AdminCheck, type AuthService } from '../auth/AuthService.ts';
import type { Logger } from '../common/logger.ts';
import { MetricsRegistry, type Metrics } from '../common/metrics.ts';
import { TokenBucket } from '../common/TokenBucket.ts';
import type { Clock } from '../common/time.ts';
import { ContentError, type NpcCatalog } from '../content/NpcCatalog.ts';
import type { NpcRecord } from '../content/ports.ts';
import { ADMIN_PAGE } from './adminPage.ts';
import { BodyError, bearer, body, clientIp, error, fields, json, type RequestContext } from './util.ts';

export interface AdminDeps {
  readonly auth: AuthService; readonly logger: Logger; readonly clock: Clock; readonly metrics?: Metrics;
  /** CONTENT catalogue; absent until the game has loaded its maps. */
  readonly catalog: () => NpcCatalog | undefined;
  /** ADMIN-004–006 snapshot assembled by the composition root. */
  readonly status: () => Record<string, unknown>;
}
const CONTENT_STATUS = { INVALID: 400, NOT_FOUND: 404, FORBIDDEN: 403, CONFLICT: 409 } as const;

/** One NPC for the panel: definition, state, revision and why some actions are refused (CONTENT-009). */
function npcView(catalog: NpcCatalog, record: NpcRecord) {
  const { definition, state, revision, updatedAt, updatedBy } = record;
  return { ...definition, state, revision, updatedAt, updatedBy, restrictions: catalog.restrictions(definition.id) };
}

/** ADMIN-001–010 and AUTH-018/019: `/admin` and `/api/admin/*`; false when the path is not ours. */
export function adminHandler(deps: AdminDeps) {
  const metrics = deps.metrics ?? new MetricsRegistry();
  const actions = metrics.counter('admin_actions_total', 'Действия администратора по виду и результату');
  const buckets = new Map<string, TokenBucket>();
  const log = deps.logger.child('admin');

  const audit = (check: Extract<AdminCheck, { ok: true }>, req: IncomingMessage, action: string, target: string | null, result: string) => {
    actions.inc({ action, result });
    log.info('admin.action', 'Действие администратора', { action, target, result, accountId: check.identity.accountId, sessionId: check.sessionId, ip: clientIp(req) });
  };

  async function signIn(req: IncomingMessage, res: ServerResponse, action: string): Promise<void> {
    if (action === 'logout') { req.resume(); const token = bearer(req); if (token) deps.auth.logout(token); res.writeHead(204); res.end(); return; }
    let input: Record<string, unknown> | null;
    try { input = fields(await body(req), action === 'login' ? ['name', 'password'] : []); }
    catch (cause) { if (!(cause instanceof BodyError)) throw cause; input = null; }
    if (!input) { error(res, 400, 'INVALID', 'Некорректный запрос входа.'); return; }
    try {
      const session = action === 'login' ? await deps.auth.adminLogin(input.name, input.password, clientIp(req)) : await deps.auth.adminDev(clientIp(req));
      json(res, 200, { token: session.token, expiresAt: session.expiresAt });
    } catch (cause) {
      if (!(cause instanceof AuthError)) throw cause;
      error(res, AUTH_STATUS[cause.code], cause.code, cause.message, cause.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: cause.retryAfterSeconds });
    }
  }

  async function npcAction(req: IncomingMessage, res: ServerResponse, check: Extract<AdminCheck, { ok: true }>, id: string, verb: string): Promise<void> {
    const catalog = deps.catalog();
    if (!catalog) { error(res, 503, 'UNAVAILABLE', 'Каталог NPC ещё не загружен.'); return; }
    const allowed: Record<string, readonly string[]> = { update: ['revision', 'persona', 'topic', 'greeting', 'interactionRadius'], move: ['revision', 'x', 'z', 'rotationY'], disable: ['revision'], enable: ['revision'], delete: ['revision'] };
    let input: Record<string, unknown> | null;
    try { input = fields(await body(req, 4096), ['revision'], allowed[verb]!.filter((key) => key !== 'revision')); }
    catch (cause) { if (!(cause instanceof BodyError)) throw cause; input = null; }
    if (!input) { audit(check, req, `npc.${verb}`, id, 'INVALID'); error(res, 400, 'INVALID', 'Некорректный запрос.'); return; }
    const actor = { id: check.identity.accountId, name: check.identity.displayName, ip: clientIp(req) };
    const { revision, ...rest } = input;
    try {
      const record = verb === 'update' ? catalog.update(id, revision, rest, actor)
        : verb === 'move' ? catalog.move(id, revision, rest, actor)
        : verb === 'delete' ? catalog.remove(id, revision, actor)
        : catalog.setEnabled(id, revision, verb === 'enable', actor);
      audit(check, req, `npc.${verb}`, id, 'ok');
      json(res, 200, { npc: npcView(catalog, record) });
    } catch (cause) {
      if (!(cause instanceof ContentError)) throw cause;
      audit(check, req, `npc.${verb}`, id, cause.code);
      json(res, CONTENT_STATUS[cause.code], { error: { code: cause.code, message: cause.message }, ...(cause.current ? { current: npcView(catalog, cause.current) } : {}) });
    }
  }

  return async (req: IncomingMessage, res: ServerResponse, path: string, context: RequestContext): Promise<boolean> => {
    if (path === '/admin') {
      context.route = '/admin';
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(404); res.end(); return true; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'" });
      res.end(req.method === 'HEAD' ? undefined : ADMIN_PAGE); return true;
    }
    if (!path.startsWith('/api/admin/')) return false;
    const parts = path.slice('/api/admin/'.length).split('/');
    context.route = `/api/admin/${parts[0]}${parts.length > 1 ? '/*' : ''}`;
    if (req.method === 'POST' && parts.length === 1 && ['login', 'dev', 'logout'].includes(parts[0]!)) { await signIn(req, res, parts[0]!); return true; }

    // Everything else needs an admin session (ADMIN-003): 401 without it, 403 for a game session.
    const token = bearer(req);
    const check = token ? await deps.auth.verifyAdmin(token) : { ok: false as const };
    if (!check.ok) {
      req.resume();
      if (token && (await deps.auth.verify(token)).ok) error(res, 403, 'FORBIDDEN', 'Нужна сессия администратора: войдите на странице /admin.');
      else error(res, 401, 'UNAUTHORIZED', 'Требуется вход администратора.');
      return true;
    }
    context.sessionId = check.sessionId;
    let bucket = buckets.get(check.sessionId); if (!bucket) { if (buckets.size > 200) buckets.clear(); bucket = new TokenBucket(deps.clock, 20, 40); buckets.set(check.sessionId, bucket); }
    if (!bucket.take()) { req.resume(); error(res, 429, 'RATE_LIMIT', 'Слишком частые запросы.', { retryAfterSeconds: 1 }); return true; }
    const catalog = deps.catalog();
    const [section, id, verb] = parts;

    if (req.method === 'GET' && section === 'status' && parts.length === 1) { json(res, 200, { admin: check.identity.displayName, ...deps.status() }); return true; }
    if (req.method === 'GET' && section === 'npcs' && parts.length === 1) {
      const deleted = new URL(req.url ?? '/', 'http://x').searchParams.get('deleted') === '1';
      json(res, 200, { npcs: catalog ? catalog.list(deleted).map((record) => npcView(catalog, record)) : [] }); return true;
    }
    if (req.method === 'GET' && section === 'changes' && parts.length === 1) {
      const query = new URL(req.url ?? '/', 'http://x').searchParams;
      const limit = Number(query.get('limit') ?? 50);
      json(res, 200, { changes: catalog ? catalog.changes(query.get('npcId') || null, Number.isFinite(limit) ? limit : 50) : [] }); return true;
    }
    if (section === 'npcs' && id && /^[A-Za-z0-9_-]{1,80}$/.test(id)) {
      if (req.method === 'PATCH' && parts.length === 2) { await npcAction(req, res, check, id, 'update'); return true; }
      if (req.method === 'POST' && parts.length === 3 && ['move', 'disable', 'enable', 'delete'].includes(verb!)) { await npcAction(req, res, check, id, verb!); return true; }
    }
    if (req.method === 'POST' && section === 'accounts' && id && ['reset-password', 'revoke', 'unlock'].includes(id) && parts.length === 2) {
      let input: Record<string, unknown> | null;
      try { input = fields(await body(req), ['name']); } catch (cause) { if (!(cause instanceof BodyError)) throw cause; input = null; }
      if (!input) { error(res, 400, 'INVALID', 'Некорректный запрос.'); return true; }
      try {
        const result = id === 'reset-password' ? await deps.auth.operator.resetPassword(input.name) : id === 'revoke' ? { revoked: deps.auth.operator.revoke(input.name) } : { unlocked: deps.auth.operator.unlock(input.name) };
        audit(check, req, `account.${id}`, String(input.name), 'ok');
        json(res, 200, result);
      } catch (cause) {
        if (!(cause instanceof AuthError)) throw cause;
        audit(check, req, `account.${id}`, String(input.name), cause.code);
        error(res, AUTH_STATUS[cause.code], cause.code, cause.message);
      }
      return true;
    }
    req.resume(); res.writeHead(404); res.end(); return true;
  };
}
