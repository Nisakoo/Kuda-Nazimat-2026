import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AUTH_STATUS, AuthError, type AuthService } from '../auth/AuthService.ts';
import type { Logger, LogRecord } from '../common/logger.ts';
import type { MetricsRegistry } from '../common/metrics.ts';
import { connectionInfo, isLoopback, lanAddresses } from '../common/network.ts';
import type { GameRuntime } from '../contracts.ts';
import type { Health } from '../obs/health.ts';
import { OPERATOR_PAGE } from './operatorPage.ts';
import type { ContentAdmin } from '../content/ContentAdmin.ts';
import { handleAdminContent } from './adminContentRoutes.ts';
import { BodyError, body, error, fields, json, type RequestContext } from './util.ts';

export interface OperatorDeps {
  readonly auth: AuthService; readonly game: GameRuntime; readonly metrics: MetricsRegistry; readonly logger: Logger;
  readonly host: string; readonly configPort: number; readonly maxPlayers: number;
  readonly npcReady: () => boolean; readonly languageReady: () => boolean;
  readonly health: () => Health;
  readonly warnings: () => readonly LogRecord[];
  readonly dump: (reason: string) => string | null;
  /** OBS-008: bearer for `/metrics` from the network; null keeps it loopback-only. */
  readonly monitoringToken: string | null;
  /** ADMIN-SRV: NPC, world, journal and account routes; absent in tests that do not need them. */
  readonly content?: ContentAdmin;
}

const startedAt = Date.now();

/** AUTH-010 CSRF guard: same loopback origin as the server and the custom header a cross-site form cannot set. */
export function trustedAction(req: IncomingMessage): boolean {
  const port = req.socket.localPort;
  const origins = ['localhost', '127.0.0.1', '[::1]'].map((host) => `http://${host}:${port}`);
  return req.headers['x-operator'] === '1' && origins.includes(req.headers.origin ?? '');
}
const sameToken = (given: string, expected: string): boolean => given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));

/** OBS-008/010, OFFLINE-010, AUTH-010; `/metrics` and `/operator`, `/api/operator/*`. False when not ours. */
export async function handleOperator(req: IncomingMessage, res: ServerResponse, path: string, deps: OperatorDeps, context: RequestContext): Promise<boolean> {
  if (path === '/metrics') {
    context.route = '/metrics';
    const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
    const allowed = isLoopback(req.socket.remoteAddress) || (deps.monitoringToken !== null && token !== undefined && sameToken(token, deps.monitoringToken));
    if (!allowed || req.method !== 'GET') { res.writeHead(404); res.end(); return true; }
    res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' }); res.end(deps.metrics.prometheus());
    return true;
  }
  if (path !== '/operator' && !path.startsWith('/api/operator/')) return false;
  context.route = path.startsWith('/api/operator/actions/') ? '/api/operator/actions' : path;
  if (!isLoopback(req.socket.remoteAddress)) { req.resume(); res.writeHead(404); res.end(); return true; }
  if (deps.content && await handleAdminContent(req, res, path, deps.content, () => trustedAction(req), deps.logger, context)) return true;
  if (req.method === 'GET' && path === '/operator') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'" });
    res.end(OPERATOR_PAGE); return true;
  }
  if (req.method === 'GET' && path === '/api/operator/status') {
    const info = connectionInfo(deps.host, req.socket.localPort ?? deps.configPort, lanAddresses());
    const players = deps.game.presence();
    json(res, 200, {
      addresses: [info.local, ...info.lan.filter((entry) => entry.kind !== 'link-local').map((entry) => entry.url)],
      health: deps.health(), players, seats: { used: players.length, max: deps.maxPlayers },
      npc: deps.npcReady() ? 'ready' : 'unavailable', language: deps.languageReady() ? 'ready' : 'unavailable',
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
      warnings: deps.warnings().map((record) => ({ ts: record.ts, level: record.level, event: record.event, msg: record.msg })).reverse(),
    });
    return true;
  }
  if (req.method === 'GET' && path === '/api/operator/metrics') { json(res, 200, deps.metrics.snapshot()); return true; }
  if (req.method === 'GET' && path === '/api/operator/accounts') { json(res, 200, { accounts: deps.auth.operator.list() }); return true; }
  if (req.method === 'POST' && path.startsWith('/api/operator/actions/')) {
    if (!trustedAction(req)) { req.resume(); deps.logger.warn('auth.operator.rejected', 'Действие ведущего без правильного Origin или X-Operator', { origin: req.headers.origin ?? null }); error(res, 403, 'FORBIDDEN', 'Действие доступно только со страницы ведущего.'); return true; }
    const action = path.slice('/api/operator/actions/'.length);
    let input: Record<string, unknown> | null;
    try { input = fields(await body(req), action === 'dump' ? [] : ['name']); }
    catch (cause) { if (!(cause instanceof BodyError)) throw cause; input = null; }
    if (!input) { error(res, 400, 'INVALID', 'Некорректный запрос.'); return true; }
    try {
      if (action === 'reset-password') json(res, 200, await deps.auth.operator.resetPassword(input.name));
      else if (action === 'revoke') json(res, 200, { revoked: deps.auth.operator.revoke(input.name) });
      else if (action === 'unlock') json(res, 200, { unlocked: deps.auth.operator.unlock(input.name) });
      else if (action === 'dump') {
        const file = deps.dump('operator');
        deps.logger.info('obs.incident.dumped', 'Ведущий сохранил отчёт', { file });
        if (file) json(res, 200, { file }); else error(res, 503, 'UNAVAILABLE', 'Отчёт не сохранён: запись журнала выключена или диск недоступен.');
      } else error(res, 404, 'INVALID', 'Неизвестное действие.');
    } catch (cause) {
      if (cause instanceof AuthError) error(res, AUTH_STATUS[cause.code], cause.code, cause.message);
      else throw cause;
    }
    return true;
  }
  req.resume(); res.writeHead(404); res.end(); return true;
}
