import type { IncomingMessage, ServerResponse } from 'node:http';

/** Per-request context filled by handlers and read by the access log (OBS-003 `http.request`). */
export interface RequestContext { route: string; sessionId?: string; playerId?: string }

export function json(res: ServerResponse, status: number, value: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers }); res.end(JSON.stringify(value));
}
export function error(res: ServerResponse, status: number, code: string, message: string, extra: Record<string, unknown> = {}): void {
  json(res, status, { error: { code, message, ...extra } }, typeof extra.retryAfterSeconds === 'number' ? { 'Retry-After': String(extra.retryAfterSeconds) } : {});
}

export class BodyError extends Error {}
/** JSON body up to `limit` bytes; anything else is a BodyError. */
export async function body(req: IncomingMessage, limit = 1024): Promise<unknown> {
  if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json' || Number(req.headers['content-length'] ?? 0) > limit) {
    req.resume(); throw new BodyError(`Expected JSON up to ${limit} bytes`);
  }
  const encoded = await new Promise<Buffer>((resolve, reject) => {
    const buffers: Buffer[] = []; let bytes = 0;
    const cleanup = () => { req.off('data', data); req.off('end', end); req.off('error', fail); req.off('aborted', fail); };
    const fail = () => { cleanup(); reject(new BodyError('Invalid body')); };
    const data = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > limit) { fail(); req.resume(); return; }
      buffers.push(chunk);
    };
    const end = () => { cleanup(); resolve(Buffer.concat(buffers)); };
    req.on('data', data); req.once('end', end); req.once('error', fail); req.once('aborted', fail);
  });
  try { return JSON.parse(encoded.toString('utf8')); } catch { throw new BodyError('Invalid JSON'); }
}

/** Exact key set check for request bodies; returns the object or null. */
export function fields(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (required.some((key) => !keys.includes(key)) || keys.some((key) => !required.includes(key) && !optional.includes(key))) return null;
  return record;
}

export const bearer = (req: IncomingMessage): string | null => /^Bearer ([A-Za-z0-9_-]{43})$/.exec(req.headers.authorization ?? '')?.[1] ?? null;
export const clientIp = (req: IncomingMessage): string => req.socket.remoteAddress ?? 'unknown';
