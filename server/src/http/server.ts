import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { Config } from '../app/config.ts';
import type { AvatarStore, EquipmentStore, GameRuntime } from '../contracts.ts';
import type { Logger } from '../common/logger.ts';
import { MS_BUCKETS, MetricsRegistry } from '../common/metrics.ts';
import { TokenBucket } from '../common/TokenBucket.ts';
import type { Clock } from '../common/time.ts';
import { hashToken, type AuthService } from '../auth/AuthService.ts';
import { parseAvatarSelection } from '../../../shared/avatar/validate.ts';
import { AVATAR_IDS } from '../../../shared/avatar/types.ts';
import { parseEquipmentState } from '../../../shared/equipment/validate.ts';
import { parseBabylonRequest } from '../../../shared/babylon/validate.ts';
import { BabylonError, type BabylonService } from '../babylon/BabylonService.ts';
import { handleAuth } from './authRoutes.ts';
import { handleOperator, type OperatorDeps } from './operatorRoutes.ts';
import { telemetryHandler } from './telemetry.ts';
import type { PerfReport } from '../obs/clientPerf.ts';
import { bearer, body, clientIp, error, json, type RequestContext } from './util.ts';

const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const BABEL_STATUS = { INVALID: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, CONFLICT: 409, NOT_READY: 409, RATE_LIMIT: 429, UNAVAILABLE: 503 } as const;
/** Routes logged at debug: high-volume polling and static files (OBS-012). */
const QUIET = new Set(['/world/*', 'static', '/api/operator/status', '/api/operator/history', '/api/babylon:state']);

export interface HttpDeps {
  avatars?: AvatarStore; equipment?: EquipmentStore;
  readonly auth: AuthService; readonly game: GameRuntime; readonly logger: Logger; readonly clock: Clock;
  readonly metrics?: MetricsRegistry;
  npcReady(): boolean;
  readonly babylon?: BabylonService; cancelBabylon?(connectionId: string): void;
  /** Operator screen pieces that live outside HTTP (health, recorder); absent in tests that do not need them. */
  readonly operator?: Pick<OperatorDeps, 'languageReady' | 'health' | 'warnings' | 'dump' | 'overview' | 'version'> & Partial<Pick<OperatorDeps, 'content'>>;
  /** OBS-011 perf reports for the admin screen. */
  readonly clientPerf?: (playerId: string, report: PerfReport) => void;
}

/** AUTH-014: per-session token buckets; the map is cleared when it grows past any realistic session count. */
function sessionLimiter(clock: Clock, rate: number, burst: number) {
  const buckets = new Map<string, TokenBucket>();
  return (key: string): boolean => {
    if (buckets.size > 1000) buckets.clear();
    let bucket = buckets.get(key); if (!bucket) { bucket = new TokenBucket(clock, rate, burst); buckets.set(key, bucket); }
    return bucket.take();
  };
}

export function createHttpServer(config: Config, deps: HttpDeps) {
  let stopping = false;
  const log = deps.logger.child('http');
  const metrics = deps.metrics ?? new MetricsRegistry();
  const requests = metrics.counter('http_requests_total', 'HTTP-запросы по маршруту и статусу');
  const latency = metrics.histogram('http_request_ms', 'Длительность HTTP-запроса', MS_BUCKETS);
  const worldBytes = metrics.counter('http_world_bytes_total', 'Байты, отданные из /world/*');
  const limited = metrics.counter('http_rate_limited_total', 'HTTP-запросы, отклонённые лимитом сессии');
  const babylonLimit = sessionLimiter(deps.clock, 10, 20);
  const worldLimit = sessionLimiter(deps.clock, 50, 300);
  const telemetry = telemetryHandler({ sessions: deps.auth, clock: deps.clock, logger: deps.logger, metrics, ...(deps.clientPerf ? { perf: deps.clientPerf } : {}) });
  const operator: OperatorDeps = {
    auth: deps.auth, game: deps.game, metrics, logger: log, host: config.host, configPort: config.port, maxPlayers: config.maxPlayers,
    npcReady: deps.npcReady, environment: config.env,
    languageReady: () => true, health: () => ({ level: 'green', reasons: [] }), warnings: () => [], dump: () => null,
    ...deps.operator,
  };

  async function babel(req: IncomingMessage, res: ServerResponse, babylon: BabylonService, context: RequestContext): Promise<void> {
    const token = bearer(req);
    const session = token ? await deps.auth.verify(token) : { ok: false as const };
    if (!session.ok || !session.sessionId || deps.auth.isActive(session.sessionId, session.identity.playerId) !== true) { req.resume(); error(res, 401, 'UNAUTHORIZED', 'Требуется вход'); return; }
    context.sessionId = session.sessionId; context.playerId = session.identity.playerId;
    const sessionKey = hashToken(token!);
    if (!babylonLimit(sessionKey)) { req.resume(); limited.inc({ route: '/api/babylon' }); error(res, 429, 'RATE_LIMIT', 'Слишком частые запросы', { retryAfterSeconds: 1 }); return; }
    let packet;
    try { packet = parseBabylonRequest(await body(req, 262144)); }
    catch { error(res, 400, 'INVALID', 'Некорректное действие BABEL v2'); return; }
    const type = packet.action.type;
    if (type === 'state') context.route = '/api/babylon:state';
    const gameplay = ['buy', 'feed', 'npc', 'chat', 'carve'].includes(type);
    if (gameplay && !deps.game.canAct?.(session.identity.accountId, sessionKey)) { error(res, 403, 'FORBIDDEN', 'Войдите в мир в этом окне, чтобы выполнить действие'); return; }
    const controlId = deps.game.controlId?.(session.identity.accountId, sessionKey) ?? null;
    if (gameplay && !controlId) { error(res, 403, 'FORBIDDEN', 'Нет управляющего соединения'); return; }
    const connectionId = controlId ? 'babel:socket:' + controlId : 'babel:' + sessionKey;
    // AUTH expiry also cancels language actions that do not require a controlling socket.
    const expiry = setTimeout(() => deps.cancelBabylon?.(connectionId), Math.max(0, session.expiresAt - deps.clock.now()));
    const close = () => { if (!res.writableEnded) deps.cancelBabylon?.(connectionId); };
    res.once('close', close);
    const began = performance.now();
    let result = 'ok';
    try {
      const scope = { sessionId: session.sessionId, isActive: () => deps.auth.isActive(session.sessionId!, session.identity.playerId) };
      const authorized = () => scope.isActive() && (!gameplay || (!!deps.game.canAct?.(session.identity.accountId, sessionKey) && deps.game.controlId?.(session.identity.accountId, sessionKey) === controlId));
      const value = await babylon.handle(session.identity, packet, connectionId, async () => authorized(), scope);
      // The service promise can settle before this continuation runs. Check again without another await before delivery.
      if (!authorized()) throw new BabylonError('UNAUTHORIZED', 'Сессия истекла или управление утрачено');
      if (packet.action.type === 'npc') babylon.checkNpcAccess(session.identity, packet.action.targetId);
      if (!res.destroyed) json(res, 200, value);
    } catch (cause) {
      const failure = cause instanceof BabylonError ? cause : new BabylonError('UNAVAILABLE', 'Сервис временно недоступен');
      result = failure.code;
      if (!(cause instanceof BabylonError)) log.error('http.failed', 'Ошибка BABEL', { route: '/api/babylon', type, error: cause });
      if (!res.destroyed) json(res, BABEL_STATUS[failure.code], { v: 2, requestId: packet.requestId, error: { code: failure.code, message: failure.message } });
    } finally { res.off('close', close); clearTimeout(expiry); }
    if (type !== 'state') log.info('babylon.action', 'Действие BABEL', { playerId: session.identity.playerId, sessionId: session.sessionId, requestId: packet.requestId, type, result, durationMs: Math.round(performance.now() - began) });
  }

  async function world(req: IncomingMessage, res: ServerResponse, path: string, context: RequestContext): Promise<void> {
    const token = bearer(req);
    const session = token ? await deps.auth.verify(token) : { ok: false as const };
    if (!session.ok) { error(res, 401, 'UNAUTHORIZED', 'Требуется вход'); return; }
    context.sessionId = session.sessionId; context.playerId = session.identity.playerId;
    if (!worldLimit(hashToken(token!))) { limited.inc({ route: '/world/*' }); error(res, 429, 'RATE_LIMIT', 'Слишком частые запросы', { retryAfterSeconds: 1 }); return; }
    const access = deps.game.worldFile(path.slice('/world/'.length), session.identity.accountId);
    let data: Buffer | undefined;
    let failed = false;
    // SERVER-WORLD-005: a vanished or unreadable allowlisted file is a server error, reported without the disk path.
    if (access.ok) { try { data = await readFile(access.file.absolutePath); } catch (cause) { failed = true; log.error('world.file.read_failed', 'Файл мира не прочитан', { path, error: cause }); } }
    const status = data ? 200 : failed ? 500 : 404;
    if (data) worldBytes.inc({}, data.byteLength);
    if (config.logWorldAccess) log.info('world.access', 'Выдача файла мира', { playerId: session.identity.playerId, path, status, bytes: data?.byteLength ?? 0 });
    res.writeHead(status, data && access.ok ? { 'Content-Type': access.file.contentType, 'Content-Length': data.byteLength } : {});
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  async function handle(req: IncomingMessage, res: ServerResponse, context: RequestContext): Promise<void> {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    if (stopping) { error(res, 503, 'UNAVAILABLE', 'Сервер останавливается'); return; }
    const origin = req.headers.origin;
    if (origin && config.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    }
    let path: string;
    try { path = decodeURIComponent((req.url ?? '/').split('?')[0]!); }
    catch { res.writeHead(404); res.end(); return; }
    if (!path.startsWith('/') || path.includes('//') || path.includes('\\') || path.includes('\0') || path.split('/').some((part) => part === '..' || part === '.')) { res.writeHead(404); res.end(); return; }
    if (path === '/api/auth/state' && req.method === 'GET') {
      const session = await deps.auth.verify(bearer(req) ?? '');
      if (!session.ok) { error(res, 401, 'UNAUTHORIZED', 'Требуется вход'); return; }
      json(res, 200, deps.auth.state(session.identity)); return;
    }
    if (path === '/api/equipment' && (req.method === 'GET' || req.method === 'POST') && deps.equipment) {
      const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '');
      const session = bearer ? await deps.auth.verify(bearer[1]!) : { ok: false as const };
      if (!session.ok) { req.resume(); error(res, 401, 'UNAUTHORIZED', 'Требуется вход'); return; }
      if (req.method === 'GET') { json(res, 200, { tool: deps.equipment.load(session.identity.playerId) }); return; }
      let selection;
      try { selection = parseEquipmentState(await body(req)); }
      catch { error(res, 400, 'INVALID', 'Некорректный предмет экипировки'); return; }
      if (!(await deps.auth.verify(bearer![1]!)).ok) { error(res, 401, 'UNAUTHORIZED', 'Требуется вход'); return; }
      deps.equipment.save(session.identity.playerId, selection.tool);
      deps.game.setEquipment?.(session.identity.playerId, selection.tool);
      json(res, 200, selection); return;
    }
    if (path.startsWith('/api/avatar/models/') && (req.method === 'GET' || req.method === 'HEAD')) {
      const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '');
      const session = bearer ? await deps.auth.verify(bearer[1]!) : { ok: false as const };
      if (!session.ok) { error(res, 401, 'UNAUTHORIZED', 'Требуется вход'); return; }
      const id = path.slice('/api/avatar/models/'.length).replace(/\.glb$/, '');
      if (!AVATAR_IDS.some(value => value === id) || !path.endsWith('.glb')) { res.writeHead(404); res.end(); return; }
      try {
        const root = await realpath(resolve(config.worldDir, 'assets/models/avatars'));
        const file = await realpath(resolve(root, `${id}.glb`));
        const info = await stat(file);
        if (!file.startsWith(root + sep) || !info.isFile() || info.size > 2 * 1024 * 1024) throw new Error('Invalid model asset');
        const data = await readFile(file);
        res.writeHead(200, { 'Content-Type': 'model/gltf-binary', 'Content-Length': data.byteLength }); res.end(req.method === 'HEAD' ? undefined : data);
      } catch { res.writeHead(404); res.end(); }
      return;
    }
    if (path === '/api/avatar' && (req.method === 'GET' || req.method === 'POST') && deps.avatars) {
      const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '');
      const session = bearer ? await deps.auth.verify(bearer[1]!) : { ok: false as const };
      if (!session.ok) { req.resume(); error(res, 401, 'UNAUTHORIZED', 'Требуется вход'); return; }
      if (req.method === 'GET') { json(res, 200, { avatarId: deps.avatars.load(session.identity.playerId) }); return; }
      let selection;
      try { selection = parseAvatarSelection(await body(req)); }
      catch { error(res, 400, 'INVALID', 'Некорректный облик'); return; }
      if (!(await deps.auth.verify(bearer![1]!)).ok) { error(res, 401, 'UNAUTHORIZED', 'Требуется вход'); return; }
      deps.avatars.save(session.identity.playerId, selection.avatarId);
      deps.game.setAvatar?.(session.identity.playerId, selection.avatarId);
      json(res, 200, selection); return;
    }
    if (await handleAuth(req, res, path, deps.auth, log, context)) return;
    if (await handleOperator(req, res, path, operator, context)) return;
    if (req.method === 'POST' && path === '/api/babylon' && deps.babylon) { context.route = '/api/babylon'; await babel(req, res, deps.babylon, context); return; }
    if (req.method === 'POST' && path === '/api/telemetry/client') { await telemetry(req, res, context); return; }
    if (!['GET', 'HEAD'].includes(req.method ?? '')) { req.resume(); res.writeHead(404); res.end(); return; }
    if (path === '/api/health') { res.setHeader('Access-Control-Allow-Origin', '*'); context.route = path; json(res, 200, { status: 'ok', protocol: 3, npc: deps.npcReady() ? 'ready' : 'unavailable' }); return; }
    if (path === '/api/game-config') { context.route = path; json(res, 200, { npcTimeoutMs: config.npc.timeoutMs }); return; }
    if (path === '/config.json') { context.route = path; json(res, 200, { session: 'online', serverUrl: null, mapId: config.defaultMap, chunkRadius: null, debug: config.clientDebug }); return; }
    if (path.startsWith('/world/')) { context.route = '/world/*'; await world(req, res, path, context); return; }
    if (/^\/(?:maps|assets\/models|api)(?:\/|$)/.test(path)) { res.writeHead(404); res.end(); return; }
    context.route = 'static';
    try {
      const root = await realpath(config.clientDir);
      const file = await realpath(resolve(root, `.${path === '/' ? '/index.html' : path}`));
      if (!file.startsWith(root + sep) || (/^(?:maps|assets\/models)(?:\/|$)/.test(file.slice(root.length + 1)) || file === resolve(root, 'config.json')) || !(await stat(file)).isFile()) throw new Error('Not a public file');
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream', 'Content-Length': data.byteLength });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch { res.writeHead(404); res.end(); }
  }

  const server = createServer((req, res) => {
    const context: RequestContext = { route: 'other' };
    const began = performance.now();
    res.once('finish', () => {
      const durationMs = performance.now() - began;
      const status = String(res.statusCode);
      requests.inc({ route: context.route, status }); latency.observe(durationMs, { route: context.route });
      const fields = { method: req.method, route: context.route, status: res.statusCode, durationMs: Math.round(durationMs * 10) / 10, bytes: Number(res.getHeader('Content-Length') ?? 0) || undefined, ip: clientIp(req), sessionId: context.sessionId, playerId: context.playerId };
      if (QUIET.has(context.route) && res.statusCode < 500) log.debug('http.request', 'HTTP-запрос', fields); else log.info('http.request', 'HTTP-запрос', fields);
    });
    void handle(req, res, context).catch((cause: unknown) => {
      log.error('http.failed', 'Необработанная ошибка HTTP-обработчика', { route: context.route, method: req.method, error: cause });
      if (!res.headersSent) error(res, 503, 'UNAVAILABLE', 'Сервис временно недоступен'); else res.destroy();
    });
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  return { server, rejectNewRequests() { stopping = true; } };
}
