import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
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
import type { ServerCertificate } from '../tls/store.ts';
import { handleAuth } from './authRoutes.ts';
import { handleOperator, type OperatorDeps } from './operatorRoutes.ts';
import { setupPage } from './setupPage.ts';
import { telemetryHandler } from './telemetry.ts';
import { createTransport } from './transport.ts';
import { bearer, body, clientIp, error, json, type RequestContext } from './util.ts';

const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const BABEL_STATUS = { INVALID: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, CONFLICT: 409, NOT_READY: 409, RATE_LIMIT: 429, UNAVAILABLE: 503 } as const;
/** Routes logged at debug: high-volume polling and static files (OBS-012). */
const QUIET = new Set(['/world/*', 'static', '/api/operator/status', '/metrics', '/api/babylon:state']);

export interface HttpDeps {
  avatars?: AvatarStore; equipment?: EquipmentStore;
  readonly auth: AuthService; readonly game: GameRuntime; readonly logger: Logger; readonly clock: Clock;
  readonly metrics?: MetricsRegistry;
  npcReady(): boolean;
  readonly babylon?: BabylonService; cancelBabylon?(connectionId: string): void;
  /** Operator screen pieces that live outside HTTP (health, recorder); absent in tests that do not need them. */
  readonly operator?: Pick<OperatorDeps, 'languageReady' | 'health' | 'warnings' | 'dump' | 'version'>;
  /** TLS-003: the server certificate; every route is served with it (TLS-007). */
  readonly certificate: ServerCertificate;
  /** Current addresses the certificate does not cover, evaluated on demand (TLS-004). */
  readonly uncoveredNames?: () => readonly string[];
}

/**
 * TLS-012: the reason a handshake failed, from the OpenSSL code Node reports. A reset before the handshake ends is
 * what Node-like clients do after rejecting the certificate (browsers send an alert), so it counts as untrusted.
 */
export function handshakeFailure(code: string | undefined): 'untrusted' | 'protocol' | 'other' {
  if (code && /UNKNOWN_CA|CERTIFICATE_UNKNOWN|BAD_CERTIFICATE|CERTIFICATE_EXPIRED|UNSUPPORTED_CERTIFICATE|CERTIFICATE_REVOKED|ECONNRESET/.test(code)) return 'untrusted';
  if (code && /VERSION|NO_SHARED_CIPHER|UNSUPPORTED_PROTOCOL|NO_PROTOCOLS/.test(code)) return 'protocol';
  return 'other';
}
const UNTRUSTED_KEEP = 20;

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
  const tlsFailures = metrics.counter('tls_handshake_failures_total', 'Неудачные TLS-рукопожатия по причине');
  /** TLS-012: devices that rejected the certificate, newest last, one entry per IP. */
  const untrusted = new Map<string, { ts: number; reason: string }>();
  const certNames = new Set(deps.certificate.info.names);
  const telemetry = telemetryHandler({ sessions: deps.auth, clock: deps.clock, logger: deps.logger });
  const operator: OperatorDeps = {
    auth: deps.auth, game: deps.game, metrics, logger: log, host: config.host, configPort: config.port, maxPlayers: config.maxPlayers,
    npcReady: deps.npcReady, monitoringToken: config.monitoring.token, environment: config.env,
    languageReady: () => true, health: () => ({ level: 'green', reasons: [] }), warnings: () => [], dump: () => null,
    ...deps.operator,
    tls: () => ({
      fingerprint: deps.certificate.info.fingerprint, notAfter: deps.certificate.info.notAfter.getTime(), names: deps.certificate.info.names,
      uncovered: deps.uncoveredNames?.() ?? deps.certificate.uncovered, untrusted: [...untrusted].map(([ip, entry]) => ({ ip, ...entry })).reverse(),
    }),
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
    const gameplay = ['buy', 'feed', 'npc', 'chat', 'carve', 'city-start', 'city-step'].includes(type);
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

  /** Host header the visitor used, when it is a name this certificate can serve; otherwise null. */
  function knownHost(req: IncomingMessage): string | null {
    const header = req.headers.host;
    if (!header || header.length > 261) return null;
    let url: URL;
    try { url = new URL(`https://${header}`); } catch { return null; }
    const name = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (url.username || url.password || url.pathname !== '/' || (!isIP(name) && !certNames.has(name))) return null;
    return url.host;
  }

  /** TLS-010: `/setup` and `/server.crt` look the same over HTTP and HTTPS. True when handled. */
  function setupRoutes(req: IncomingMessage, res: ServerResponse, path: string, context: RequestContext): boolean {
    if (path !== '/setup' && path !== '/server.crt') return false;
    context.route = path;
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return true; }
    const { info, cert } = deps.certificate;
    const body = path === '/setup' ? setupPage({ info, host: knownHost(req) ?? `localhost:${req.socket.localPort ?? config.port}` }) : cert;
    const type = path === '/setup' ? 'text/html; charset=utf-8' : 'application/x-x509-ca-cert';
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  }

  /** TLS-008: the only things served without TLS. Nothing else is read, so no password or token is processed. */
  function plain(req: IncomingMessage, res: ServerResponse, context: RequestContext): void {
    let path: string;
    try { path = decodeURIComponent((req.url ?? '/').split('?')[0]!); } catch { path = ''; }
    if (setupRoutes(req, res, path, context)) return;
    if (path === '/api/health' && (req.method === 'GET' || req.method === 'HEAD')) {
      context.route = path; res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Cache-Control', 'no-store');
      json(res, 200, { status: 'ok', protocol: 3, npc: deps.npcReady() ? 'ready' : 'unavailable' }); return;
    }
    context.route = 'plain';
    const host = knownHost(req);
    if ((req.method === 'GET' || req.method === 'HEAD') && host && req.url?.startsWith('/') && !/[\x00-\x20\x7f\\]/.test(req.url)) {
      res.writeHead(308, { Location: `https://${host}${req.url}`, 'Cache-Control': 'no-store' }); res.end(); return;
    }
    const redirectable = req.method === 'GET' || req.method === 'HEAD';
    res.writeHead(redirectable ? 400 : 426, { Connection: 'close', Upgrade: 'TLS/1.2', 'Cache-Control': 'no-store' }); res.end();
    req.destroy();
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
    if (setupRoutes(req, res, path, context)) return;
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

  /** One request pipeline for both servers: metrics, access log and the final safety net. */
  function observed(serve: (req: IncomingMessage, res: ServerResponse, context: RequestContext) => void | Promise<void>) {
    return (req: IncomingMessage, res: ServerResponse): void => {
      const context: RequestContext = { route: 'other' };
      const began = performance.now();
      res.once('finish', () => {
        const durationMs = performance.now() - began;
        const status = String(res.statusCode);
        requests.inc({ route: context.route, status }); latency.observe(durationMs, { route: context.route });
        const fields = { method: req.method, route: context.route, status: res.statusCode, durationMs: Math.round(durationMs * 10) / 10, bytes: Number(res.getHeader('Content-Length') ?? 0) || undefined, ip: clientIp(req), sessionId: context.sessionId, playerId: context.playerId };
        if (QUIET.has(context.route) && res.statusCode < 500) log.debug('http.request', 'HTTP-запрос', fields); else log.info('http.request', 'HTTP-запрос', fields);
      });
      void Promise.resolve().then(() => serve(req, res, context)).catch((cause: unknown) => {
        log.error('http.failed', 'Необработанная ошибка HTTP-обработчика', { route: context.route, method: req.method, error: cause });
        if (!res.headersSent) error(res, 503, 'UNAVAILABLE', 'Сервис временно недоступен'); else res.destroy();
      });
    };
  }

  let lastFailureLog = 0;
  const transport = createTransport(deps.certificate, observed(handle), observed((req, res, context) => plain(req, res, context)), (cause, address) => {
    const reason = handshakeFailure((cause as NodeJS.ErrnoException).code);
    tlsFailures.inc({ reason });
    // Browsers retry a rejected certificate several times a second; keep one record per device and a calm log.
    if (reason === 'untrusted' && address) { untrusted.delete(address); untrusted.set(address, { ts: deps.clock.now(), reason }); if (untrusted.size > UNTRUSTED_KEEP) untrusted.delete(untrusted.keys().next().value!); }
    const now = deps.clock.now();
    if (now - lastFailureLog >= 10_000) { lastFailureLog = now; log.warn('tls.handshake.failed', 'TLS-рукопожатие не удалось', { reason, ip: address, code: (cause as NodeJS.ErrnoException).code }); }
  });
  /** `server` is the listening socket (address, close); `secure` carries HTTPS and Socket.IO (TLS-007). */
  const server = Object.assign(transport.listener, { closeAllConnections: () => transport.closeAllConnections() });
  return { server, secure: transport.secure, rejectNewRequests() { stopping = true; } };
}
