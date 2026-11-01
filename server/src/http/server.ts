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
  readonly operator?: Pick<OperatorDeps, 'languageReady' | 'health' | 'warnings' | 'dump'>;
}
export function createHttpServer(config: Config, deps: { auth: SessionVerifier & { guest(name: string): { token: string; expiresAt: number } }; game: GameRuntime; npcReady(): boolean; logger: Logger }) {
  let stopping = false;
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
    void handle(req, res).catch(() => { deps.logger.error('HTTP request failed'); if (!res.headersSent) error(res, 503, 'UNAVAILABLE', 'Сервис временно недоступен'); else res.destroy(); });
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000;
  return { server, rejectNewRequests() { stopping = true; } };
}
