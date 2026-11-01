import type { IncomingMessage, ServerResponse } from 'node:http';
import { WindowLimiter } from '../auth/limits.ts';
import type { Clock } from '../common/time.ts';
import type { Logger } from '../common/logger.ts';
import type { SessionVerifier } from '../contracts.ts';
import { BodyError, bearer, body, error, fields, type RequestContext } from './util.ts';

const TEXT: Readonly<Record<string, number>> = { message: 500, stack: 4000, source: 500, build: 500, map: 500 };
const NUMBERS = ['fps', 'frameMs', 'drawCalls'] as const;
const clean = (value: string, max: number): string => value.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '').slice(0, max);

/** OBS-011: optional client error/perf reports, authenticated and rate-limited per session. */
export function telemetryHandler(deps: { sessions: SessionVerifier; clock: Clock; logger: Logger }) {
  const limiter = new WindowLimiter(deps.clock, 10, 60_000);
  const log = deps.logger.child('client');
  return async (req: IncomingMessage, res: ServerResponse, context: RequestContext): Promise<void> => {
    context.route = '/api/telemetry/client';
    const token = bearer(req);
    const session = token ? await deps.sessions.verify(token) : { ok: false as const };
    if (!session.ok) { req.resume(); error(res, 401, 'UNAUTHORIZED', 'Требуется вход'); return; }
    context.sessionId = session.sessionId; context.playerId = session.identity.playerId;
    const wait = limiter.hit(session.sessionId ?? session.identity.accountId);
    if (wait) { req.resume(); error(res, 429, 'RATE_LIMIT', 'Слишком много отчётов', { retryAfterSeconds: wait }); return; }
    let input: Record<string, unknown> | null;
    try { input = fields(await body(req, 8192), ['v', 'kind'], [...Object.keys(TEXT), ...NUMBERS]); }
    catch (cause) { if (!(cause instanceof BodyError)) throw cause; input = null; }
    const valid = input && input.v === 1 && ['error', 'unhandled_rejection', 'perf'].includes(input.kind as string)
      && Object.keys(TEXT).every((key) => input![key] === undefined || typeof input![key] === 'string')
      && NUMBERS.every((key) => input![key] === undefined || (typeof input![key] === 'number' && Number.isFinite(input![key])));
    if (!input || !valid) { error(res, 400, 'INVALID', 'Некорректный отчёт клиента.'); return; }
    const report: Record<string, unknown> = { playerId: session.identity.playerId, sessionId: session.sessionId, kind: input.kind };
    for (const [key, max] of Object.entries(TEXT)) if (typeof input[key] === 'string') report[key] = clean(input[key], max);
    for (const key of NUMBERS) if (input[key] !== undefined) report[key] = input[key];
    if (input.kind === 'perf') log.info('client.perf', 'Показатели клиента', report);
    else log.warn('client.error', 'Ошибка в браузере игрока', report);
    res.writeHead(204); res.end();
  };
}
