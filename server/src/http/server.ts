import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { Config } from '../app/config.ts';
import type { AvatarStore, EquipmentStore, GameRuntime } from '../contracts.ts';
import { parseAvatarSelection } from '../../../shared/avatar/validate.ts';
import { AVATAR_IDS } from '../../../shared/avatar/types.ts';
import type { Logger } from '../common/logger.ts';
import { AuthError, type AuthService, validName, hashToken, parseCredentials } from '../auth/AuthService.ts';
import { parseEquipmentState } from '../../../shared/equipment/validate.ts';
import { parseBabylonRequest } from '../../../shared/babylon/validate.ts';
import { BabylonError, type BabylonService } from '../babylon/BabylonService.ts';

const mime: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
function json(res: ServerResponse, status: number, value: unknown): void { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
function error(res: ServerResponse, status: number, code: string, message: string): void { json(res, status, { error: { code, message } }); }
async function body(req: IncomingMessage, limit = 1024): Promise<unknown> {
  if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json' || Number(req.headers['content-length'] ?? 0) > limit) {
    req.resume(); throw new Error('Expected JSON up to 1 KiB');
  }
  const encoded = await new Promise<Buffer>((resolve, reject) => {
    const buffers: Buffer[] = []; let bytes = 0;
    const cleanup = () => { req.off('data', data); req.off('end', end); req.off('error', fail); req.off('aborted', aborted); };
    const fail = () => { cleanup(); reject(new Error('Invalid body')); };
    const aborted = () => fail();
    const data = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > limit) { fail(); req.resume(); return; }
      buffers.push(chunk);
    };
    const end = () => { cleanup(); resolve(Buffer.concat(buffers)); };
    req.on('data', data); req.once('end', end); req.once('error', fail); req.once('aborted', aborted);
  });
  return JSON.parse(encoded.toString('utf8'));
}
export function createHttpServer(config: Config, deps: { auth: AuthService; game: GameRuntime; avatars?: AvatarStore; equipment?: EquipmentStore; npcReady(): boolean; logger: Logger; babylon?: BabylonService; cancelBabylon?(connectionId: string): void }) {
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
    if (req.method === 'POST' && ['/api/auth/guest', '/api/auth/register', '/api/auth/login'].includes(path)) {
      let value: unknown;
      try { value = await body(req); } catch { error(res, 400, 'INVALID', 'Некорректные данные входа'); return; }
      const source = req.socket.remoteAddress ?? 'unknown';
      try {
        if (path === '/api/auth/guest') {
          const record = value as Record<string, unknown> | null;
          const name = record && !Array.isArray(record) && Object.keys(record).length === 1 && Object.hasOwn(record, 'name') ? validName(record.name) : null;
          if (!name) throw new AuthError('INVALID');
          json(res, 200, deps.auth.guest(name, source));
        } else {
          const { name, password } = parseCredentials(value);
          const registered = path === '/api/auth/register';
          const session = await (registered ? deps.auth.register(name, password, source) : deps.auth.login(name, password, source));
          json(res, registered ? 201 : 200, session);
        }
      } catch (cause) {
        if (!(cause instanceof AuthError)) throw cause;
        error(res, cause.status, cause.code, cause.message);
      }
      return;
    }
    if ((path === '/api/auth/state' && req.method === 'GET') || (path === '/api/auth/logout' && req.method === 'POST')) {
      const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '');
      const session = bearer ? await deps.auth.verify(bearer[1]!) : { ok: false as const };
      if (!session.ok) { req.resume(); error(res, 401, 'UNAUTHORIZED', 'Требуется вход'); return; }
      if (path === '/api/auth/state') { json(res, 200, deps.auth.state(session.identity)); return; }
      if (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0' || req.headers['transfer-encoding']) {
        try {
          const value = await body(req);
          if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length) throw new Error();
        } catch { error(res, 400, 'INVALID', 'Выход не принимает параметры'); return; }
      }
      if (!(await deps.auth.verify(bearer![1]!)).ok) { error(res, 401, 'UNAUTHORIZED', 'Требуется вход'); return; }
      deps.auth.logout(bearer![1]!);
      deps.cancelBabylon?.('babel:' + hashToken(bearer![1]!));
      res.writeHead(204); res.end(); return;
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
    if (req.method === 'POST' && path === '/api/babylon' && deps.babylon) {
      const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '');
      const session = bearer ? await deps.auth.verify(bearer[1]!) : { ok: false as const };
      if (!session.ok) { req.resume(); error(res, 401, 'UNAUTHORIZED', 'Требуется вход'); return; }
      let packet;
      try { packet = parseBabylonRequest(await body(req, 262144)); }
      catch { error(res, 400, 'INVALID', 'Некорректное действие BABEL v2'); return; }
      const sessionKey = hashToken(bearer![1]!);
      const gameplay = ['buy', 'feed', 'npc', 'chat', 'carve'].includes(packet.action.type);
      if (gameplay && !deps.game.canAct?.(session.identity.accountId, sessionKey)) { error(res, 403, 'FORBIDDEN', 'Войдите в мир в этом окне, чтобы выполнить действие'); return; }
      const connectionId = 'babel:' + sessionKey;
      const close = () => { if (!res.writableEnded) deps.cancelBabylon?.(connectionId); };
      res.once('close', close);
      try {
        const result = await deps.babylon.handle(session.identity, packet, connectionId, async () => (await deps.auth.verify(bearer![1]!)).ok && (!gameplay || !!deps.game.canAct?.(session.identity.accountId, sessionKey)));
        if (!res.destroyed) json(res, 200, result);
      } catch (cause) {
        const failure = cause instanceof BabylonError ? cause : new BabylonError('UNAVAILABLE', 'Сервис временно недоступен');
        const status = { INVALID: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, CONFLICT: 409, NOT_READY: 409, RATE_LIMIT: 429, UNAVAILABLE: 503 }[failure.code];
        if (!res.destroyed) json(res, status, { v: 2, requestId: packet.requestId, error: { code: failure.code, message: failure.message } });
      } finally { res.off('close', close); }
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method ?? '')) { res.writeHead(404); res.end(); return; }
    if (path === '/api/health') { json(res, 200, { status: 'ok', protocol: 3, npc: deps.npcReady() ? 'ready' : 'unavailable' }); return; }
    if (path === '/config.json') { json(res, 200, { session: 'online', serverUrl: null, mapId: config.defaultMap, chunkRadius: null, debug: false }); return; }
    if (path.startsWith('/world/')) {
      const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '');
      const session = bearer ? await deps.auth.verify(bearer[1]!) : { ok: false as const };
      if (!session.ok) { error(res, 401, 'UNAUTHORIZED', 'Требуется вход'); return; }
      const access = deps.game.worldFile(path.slice('/world/'.length), session.identity.accountId);
      let data: Buffer | undefined;
      if (access.ok) { try { data = await readFile(access.file.absolutePath); } catch { /* Resource unavailable -> 404. */ } }
      const status = data ? 200 : 404;
      if (config.logWorldAccess) deps.logger.info('world', { playerId: session.identity.playerId, path, status, bytes: data?.byteLength ?? 0 });
      res.writeHead(status, data && access.ok ? { 'Content-Type': access.file.contentType, 'Content-Length': data.byteLength } : {});
      res.end(req.method === 'HEAD' ? undefined : data); return;
    }
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
