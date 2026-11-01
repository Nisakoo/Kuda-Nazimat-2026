import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { Config } from '../app/config.ts';
import type { GameRuntime, SessionVerifier } from '../contracts.ts';
import type { Logger } from '../common/logger.ts';
import { validName, hashToken } from '../auth/AuthService.ts';
import { parseBabylonRequest } from '../../../shared/babylon/validate.ts';
import { BabylonError, type BabylonService } from '../babylon/BabylonService.ts';
import { connectionInfo, isLoopback, lanAddresses } from '../common/network.ts';
import { OPERATOR_PAGE } from './operatorPage.ts';

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
export function createHttpServer(config: Config, deps: { auth: SessionVerifier & { guest(name: string): { token: string; expiresAt: number } }; game: GameRuntime; npcReady(): boolean; logger: Logger; babylon?: BabylonService; cancelBabylon?(connectionId: string): void }) {
  let stopping = false;
  const startedAt = Date.now();
  /** OFFLINE-010: operator data, loopback only; names and maps but no tokens, chat or NPC texts. */
  function operatorStatus(req: IncomingMessage) {
    const info = connectionInfo(config.host, req.socket.localPort ?? config.port, lanAddresses());
    const players = deps.game.presence();
    return { addresses: [info.local, ...info.lan.filter((entry) => entry.kind !== 'link-local').map((entry) => entry.url)], players, seats: { used: players.length, max: config.maxPlayers }, npc: deps.npcReady() ? 'ready' : 'unavailable', uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) };
  }
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
    if (req.method === 'POST' && path === '/api/auth/guest') {
      let name: string | null;
      try { const value = await body(req) as Record<string, unknown>; name = value && Object.keys(value).length === 1 && Object.hasOwn(value, 'name') ? validName(value.name) : null; }
      catch { name = null; }
      if (!name) { error(res, 400, 'INVALID', 'Введите имя длиной 1–32 символа без управляющих символов'); return; }
      json(res, 200, deps.auth.guest(name)); return;
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
    if (path === '/operator' || path === '/api/operator/status') {
      if (!isLoopback(req.socket.remoteAddress)) { res.writeHead(404); res.end(); return; }
      if (path === '/api/operator/status') { json(res, 200, operatorStatus(req)); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'" });
      res.end(req.method === 'HEAD' ? undefined : OPERATOR_PAGE); return;
    }
    if (path === '/api/health') { json(res, 200, { status: 'ok', protocol: 3, npc: deps.npcReady() ? 'ready' : 'unavailable' }); return; }
    if (path === '/config.json') { json(res, 200, { session: 'online', serverUrl: null, mapId: config.defaultMap, chunkRadius: null, debug: false }); return; }
    if (path.startsWith('/world/')) {
      const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '');
      const session = bearer ? await deps.auth.verify(bearer[1]!) : { ok: false as const };
      if (!session.ok) { error(res, 401, 'UNAUTHORIZED', 'Требуется вход'); return; }
      const access = deps.game.worldFile(path.slice('/world/'.length), session.identity.accountId);
      let data: Buffer | undefined;
      let failed = false;
      // SERVER-WORLD-005: a vanished or unreadable allowlisted file is a server error, reported without the disk path.
      if (access.ok) { try { data = await readFile(access.file.absolutePath); } catch { failed = true; deps.logger.error('Файл мира не прочитан', { path }); } }
      const status = data ? 200 : failed ? 500 : 404;
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
