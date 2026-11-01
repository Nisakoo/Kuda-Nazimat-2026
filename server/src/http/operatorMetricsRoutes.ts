import type { IncomingMessage, ServerResponse } from 'node:http';
import type { MetricsRegistry } from '../common/metrics.ts';
import type { Overview } from '../obs/overview.ts';
import { json } from './util.ts';

/** Admin read-only metrics (OBS-008, OBS-014); the caller has already checked loopback. False when not ours. */
export function handleOperatorMetrics(req: IncomingMessage, res: ServerResponse, path: string, deps: { readonly metrics: MetricsRegistry; readonly overview?: Pick<Overview, 'series'> }): boolean {
  if (req.method !== 'GET') return false;
  if (path === '/api/operator/metrics') { json(res, 200, deps.metrics.snapshot()); return true; }
  if (path === '/api/operator/history' && deps.overview) { json(res, 200, deps.overview.series()); return true; }
  return false;
}
