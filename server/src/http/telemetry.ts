import type { IncomingMessage, ServerResponse } from 'node:http';
import { WindowLimiter } from '../auth/limits.ts';
import type { Clock } from '../common/time.ts';
import type { Logger } from '../common/logger.ts';
import type { SessionVerifier } from '../contracts.ts';
import { MetricsRegistry, type Metrics } from '../common/metrics.ts';
import type { ClientPerfStore } from '../obs/clientPerf.ts';
import { BodyError, bearer, body, error, fields, type RequestContext } from './util.ts';

const TEXT: Readonly<Record<string, number>> = { message: 500, stack: 4000, source: 500, build: 500, map: 500 };
const NUMBERS = ['fps', 'frameMs', 'drawCalls'] as const;
const clean = (value: string, max: number): string => value.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '').slice(0, max);

/** OBS-011: optional client error/perf reports, authenticated and rate-limited per session. */
export function telemetryHandler(deps: { sessions: SessionVerifier; clock: Clock; logger: Logger; metrics?: Metrics; perf?: ClientPerfStore }) {
  const limiter = new WindowLimiter(deps.clock, 10, 60_000);
  const metrics = deps.metrics ?? new MetricsRegistry();
  const reports = metrics.counter('client_reports_total', 'Отчёты клиентов по виду и результату');
  const fps = metrics.histogram('client_fps', 'FPS клиентов из отчётов perf', [10, 20, 30, 45, 60, 90, 120, 144]);
  const frame = metrics.histogram('client_frame_ms', 'Время кадра клиентов, мс', [4, 8, 16, 33, 50, 100, 200]);
  const draws = metrics.histogram('client_draw_calls', 'Draw calls клиентов', [50, 100, 200, 500, 1000, 2000, 5000]);
  const log = deps.logger.child('client');
  return async (req: IncomingMessage, res: ServerResponse, context: RequestContext): Promise<void> => {
    context.route = '/api/telemetry/client';
    const token = bearer(req);
    const session = token ? await deps.sessions.verify(token) : { ok: false as const };
    if (!session.ok) { req.resume(); error(res, 401, 'UNAUTHORIZED', 'Требуется вход'); return; }
    context.sessionId = session.sessionId; context.playerId = session.identity.playerId;
    const wait = limiter.hit(session.sessionId ?? session.identity.accountId);
    if (wait) { reports.inc({ kind: 'unknown', result: 'limited' }); req.resume(); error(res, 429, 'RATE_LIMIT', 'Слишком много отчётов', { retryAfterSeconds: wait }); return; }
    let input: Record<string, unknown> | null;
    try { input = fields(await body(req, 8192), ['v', 'kind'], [...Object.keys(TEXT), ...NUMBERS]); }
    catch (cause) { if (!(cause instanceof BodyError)) throw cause; input = null; }
    const valid = input && input.v === 1 && ['error', 'unhandled_rejection', 'perf'].includes(input.kind as string)
      && Object.keys(TEXT).every((key) => input![key] === undefined || typeof input![key] === 'string')
      && NUMBERS.every((key) => input![key] === undefined || (typeof input![key] === 'number' && Number.isFinite(input![key])));
    if (!input || !valid) { reports.inc({ kind: 'unknown', result: 'rejected' }); error(res, 400, 'INVALID', 'Некорректный отчёт клиента.'); return; }
    const report: Record<string, unknown> = { playerId: session.identity.playerId, sessionId: session.sessionId, kind: input.kind };
    for (const [key, max] of Object.entries(TEXT)) if (typeof input[key] === 'string') report[key] = clean(input[key], max);
    for (const key of NUMBERS) if (input[key] !== undefined) report[key] = input[key];
    reports.inc({ kind: String(input.kind), result: 'accepted' });
    if (input.kind === 'perf') {
      deps.perf?.record(session.identity.playerId, input);
      if (typeof input.fps === 'number') fps.observe(input.fps);
      if (typeof input.frameMs === 'number') frame.observe(input.frameMs);
      if (typeof input.drawCalls === 'number') draws.observe(input.drawCalls);
      log.info('client.perf', 'Показатели клиента', report);
    }
    else log.warn('client.error', 'Ошибка в браузере игрока', report);
    res.writeHead(204); res.end();
  };
}
