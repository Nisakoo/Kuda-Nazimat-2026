import type { IncomingMessage, ServerResponse } from 'node:http';
import { WindowLimiter } from '../auth/limits.ts';
import type { Clock } from '../common/time.ts';
import type { Logger } from '../common/logger.ts';
import { FPS_BUCKETS, MS_BUCKETS, MetricsRegistry } from '../common/metrics.ts';
import type { SessionVerifier } from '../contracts.ts';
import type { PerfReport } from '../obs/clientPerf.ts';
import { BodyError, bearer, body, error, fields, type RequestContext } from './util.ts';

const TEXT: Readonly<Record<string, number>> = { message: 500, stack: 4000, source: 500, build: 500, map: 500 };
/** Allowed ranges of the numeric fields (OBS-011). */
const NUMBERS: Readonly<Record<string, readonly [number, number]>> = { fps: [0, 1000], frameMs: [0, 10_000], drawCalls: [0, 1_000_000] };
const clean = (value: string, max: number): string => value.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '').slice(0, max);
const number = (value: unknown, [min, max]: readonly [number, number]): boolean => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

/**
 * OBS-011: client error and perf reports, authenticated and rate-limited per session and kind
 * (errors 10/min, perf 12/min). Perf feeds the admin screen through `perf` and the client histograms.
 */
export function telemetryHandler(deps: { sessions: SessionVerifier; clock: Clock; logger: Logger; metrics?: MetricsRegistry; perf?: (playerId: string, report: PerfReport) => void }) {
  const limits = { error: new WindowLimiter(deps.clock, 10, 60_000), perf: new WindowLimiter(deps.clock, 12, 60_000) };
  const metrics = deps.metrics ?? new MetricsRegistry();
  const reports = metrics.counter('client_reports_total', 'Отчёты клиентов по виду');
  const fps = metrics.histogram('client_fps', 'FPS клиентов с видимой вкладки', FPS_BUCKETS);
  const frame = metrics.histogram('client_frame_ms', 'p95 интервала кадра клиентов с видимой вкладки', MS_BUCKETS);
  const log = deps.logger.child('client');
  return async (req: IncomingMessage, res: ServerResponse, context: RequestContext): Promise<void> => {
    context.route = '/api/telemetry/client';
    const token = bearer(req);
    const session = token ? await deps.sessions.verify(token) : { ok: false as const };
    if (!session.ok) { req.resume(); error(res, 401, 'UNAUTHORIZED', 'Требуется вход'); return; }
    context.sessionId = session.sessionId; context.playerId = session.identity.playerId;
    let input: Record<string, unknown> | null;
    try { input = fields(await body(req, 8192), ['v', 'kind'], [...Object.keys(TEXT), ...Object.keys(NUMBERS), 'visible']); }
    catch (cause) { if (!(cause instanceof BodyError)) throw cause; input = null; }
    const perf = input?.kind === 'perf';
    const valid = input && input.v === 1 && ['error', 'unhandled_rejection', 'perf'].includes(input.kind as string)
      && Object.keys(TEXT).every((key) => input![key] === undefined || typeof input![key] === 'string')
      && Object.entries(NUMBERS).every(([key, range]) => input![key] === undefined || number(input![key], range))
      && (input.drawCalls === undefined || Number.isInteger(input.drawCalls))
      && (input.visible === undefined || typeof input.visible === 'boolean')
      && (!perf || (input.fps !== undefined && input.visible !== undefined));
    if (!input || !valid) { error(res, 400, 'INVALID', 'Некорректный отчёт клиента.'); return; }
    const wait = limits[perf ? 'perf' : 'error'].hit(session.sessionId ?? session.identity.accountId);
    if (wait) { error(res, 429, 'RATE_LIMIT', 'Слишком много отчётов', { retryAfterSeconds: wait }); return; }
    const report: Record<string, unknown> = { playerId: session.identity.playerId, sessionId: session.sessionId, kind: input.kind };
    for (const [key, max] of Object.entries(TEXT)) if (typeof input[key] === 'string') report[key] = clean(input[key], max);
    for (const key of [...Object.keys(NUMBERS), 'visible']) if (input[key] !== undefined) report[key] = input[key];
    reports.inc({ kind: input.kind as string });
    if (perf) {
      const accepted: PerfReport = { fps: input.fps as number, visible: input.visible as boolean, ...(input.frameMs !== undefined ? { frameMs: input.frameMs as number } : {}), ...(input.drawCalls !== undefined ? { drawCalls: input.drawCalls as number } : {}) };
      if (accepted.visible) { fps.observe(accepted.fps); if (accepted.frameMs !== undefined) frame.observe(accepted.frameMs); }
      deps.perf?.(session.identity.playerId, accepted);
      log.debug('client.perf', 'Показатели клиента', report);
    } else log.warn('client.error', 'Ошибка в браузере игрока', report);
    res.writeHead(204); res.end();
  };
}
